import type { MediaImageSize } from '@mml/shared';
import {
  type MediaAssetStore,
  type MediaAssetSummary,
  MediaError,
  type MediaMime,
  type MediaVersionRecord,
} from './assets.js';
import type { MediaJob, MediaJobLoadResult, MediaJobStore } from './jobs.js';
import type { MediaImageOutput, MediaOperations } from './operations.js';

/**
 * Batch B — orchestration between the asset store, the job store and the
 * documented provider operations.
 *
 * Generation and editing are asynchronous: the route enqueues a job and
 * returns it immediately; the worker transitions queued -> running ->
 * succeeded|failed through the job store, so restart recovery (`recover()`
 * marks abandoned jobs `interrupted`) and cancellation fencing (a cancelled
 * job's generation bump refuses late publishes) apply unchanged.
 *
 * Bytes are only written after the provider call and validation succeed, and
 * a worker publishes `asset_id/version/sha256` last: a crash can leave an
 * unreferenced asset version, never a succeeded job pointing at nothing.
 */

export type MediaServiceErrorCode =
  | 'media_unconfigured'
  | 'unsupported_job'
  | 'unsupported_parent'
  | 'job_not_found';

export class MediaServiceError extends Error {
  constructor(
    readonly code: MediaServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MediaServiceError';
  }
}

export interface MediaServiceOptions {
  /** Provider model id; defaults to the adapter's targeted model. */
  model?: string;
}

export interface UploadInput {
  mime: MediaMime;
  bytes: Buffer;
  source_text?: string;
}

interface GenerateParams {
  prompt: string;
  size?: MediaImageSize;
}

interface EditParams extends GenerateParams {
  parent: { asset_id: string; version: number };
}

function providerModelName(output: MediaImageOutput): {
  provider?: string;
  model?: string;
  observed?: string;
} {
  return {
    provider: 'meta',
    // `model` is what we explicitly requested; `observed` is what the
    // provider said it used, and is only present when the provider reported it.
    ...(output.model.length > 0 ? { model: output.model } : {}),
    ...(output.observed_model !== null ? { observed: output.observed_model } : {}),
  };
}

export class MediaService {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly assets: MediaAssetStore,
    private readonly jobs: MediaJobStore,
    private readonly operations: MediaOperations | null,
  ) {}

  private requireOperations(): MediaOperations {
    if (this.operations === null) {
      throw new MediaServiceError(
        'media_unconfigured',
        'Image generation is not configured: set the provider API key to enable media operations.',
      );
    }
    return this.operations;
  }

  /** Abort in-flight provider work; job records stay `running` for recovery. */
  shutdown(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }

  async upload(projectId: string, input: UploadInput): Promise<MediaVersionRecord> {
    return this.assets.createAsset(projectId, {
      kind: 'image',
      mime: input.mime,
      bytes: input.bytes,
      source:
        input.source_text !== undefined
          ? { kind: 'upload', text: input.source_text }
          : { kind: 'upload' },
    });
  }

  async enqueueGenerate(projectId: string, params: GenerateParams): Promise<MediaJob> {
    this.requireOperations();
    const job = await this.jobs.enqueue(projectId, {
      kind: 'generate',
      params: {
        prompt: params.prompt,
        ...(params.size !== undefined ? { size: params.size } : {}),
      },
    });
    this.launch(projectId, job.id, 'generate');
    return job;
  }

  async enqueueEdit(projectId: string, params: EditParams): Promise<MediaJob> {
    this.requireOperations();
    const parent = await this.assets.getVersion(
      projectId,
      params.parent.asset_id,
      params.parent.version,
    );
    if (parent.project_id !== projectId) {
      throw new MediaServiceError(
        'unsupported_parent',
        `Parent ${params.parent.asset_id} does not belong to project ${projectId}.`,
      );
    }
    const job = await this.jobs.enqueue(projectId, {
      kind: 'edit',
      params: {
        prompt: params.prompt,
        ...(params.size !== undefined ? { size: params.size } : {}),
        parent: { ...params.parent },
      },
    });
    this.launch(projectId, job.id, 'edit');
    return job;
  }

  /**
   * Cancel is cooperative: the job's generation is bumped first (so a late
   * provider result can never publish) and the in-flight operation is aborted.
   */
  async cancel(projectId: string, jobId: string): Promise<MediaJob> {
    const job = await this.jobs.cancel(projectId, jobId);
    this.active.get(jobId)?.abort();
    return job;
  }

  async getJob(projectId: string, jobId: string): Promise<MediaJob> {
    return this.jobs.get(projectId, jobId);
  }

  async listJobs(projectId: string): Promise<MediaJobLoadResult> {
    return this.jobs.loadAll({ projectId });
  }

  async listAssets(projectId: string): Promise<MediaAssetSummary[]> {
    return this.assets.listAssets(projectId);
  }

  async listVersions(projectId: string, assetId: string): Promise<MediaVersionRecord[]> {
    return this.assets.listVersions(projectId, assetId);
  }

  async getVersion(
    projectId: string,
    assetId: string,
    version: number,
  ): Promise<MediaVersionRecord> {
    return this.assets.getVersion(projectId, assetId, version);
  }

  async latestVersion(projectId: string, assetId: string): Promise<MediaVersionRecord> {
    const versions = await this.assets.listVersions(projectId, assetId);
    const latest = versions.at(-1);
    if (latest === undefined) {
      throw new MediaError(
        'asset_not_found',
        `Media asset ${assetId} has no versions in this project.`,
      );
    }
    return latest;
  }

  async readBytes(projectId: string, assetId: string, version: number): Promise<Buffer> {
    return this.assets.readBytes(projectId, assetId, version);
  }

  async approve(projectId: string, assetId: string, version: number): Promise<MediaVersionRecord> {
    return this.assets.approve(projectId, assetId, version);
  }

  async reject(projectId: string, assetId: string, version: number): Promise<MediaVersionRecord> {
    return this.assets.reject(projectId, assetId, version);
  }

  private launch(projectId: string, jobId: string, kind: 'generate' | 'edit'): void {
    const controller = new AbortController();
    this.active.set(jobId, controller);
    void this.run(projectId, jobId, kind, controller.signal).finally(() => {
      if (this.active.get(jobId) === controller) this.active.delete(jobId);
    });
  }

  private async run(
    projectId: string,
    jobId: string,
    kind: 'generate' | 'edit',
    signal: AbortSignal,
  ): Promise<void> {
    const operations = this.operations;
    if (operations === null) return;
    let generation: number;
    let job: MediaJob;
    try {
      const started = await this.jobs.start(projectId, jobId);
      generation = started.generation;
      job = started.job;
    } catch {
      // Cancelled or otherwise no longer startable before work began.
      return;
    }
    try {
      const output = await this.execute(projectId, job, kind, operations, signal);
      const record = await this.persist(projectId, job, kind, output);
      await this.jobs.publishResult(projectId, jobId, generation, {
        asset_id: record.asset_id,
        version: record.version,
        sha256: record.sha256,
      });
    } catch (error) {
      if (signal.aborted) return; // cancel() already recorded the terminal state
      const message = error instanceof Error ? error.message : String(error);
      await this.jobs.fail(projectId, jobId, message, generation).catch(() => undefined);
    }
  }

  private async execute(
    projectId: string,
    job: MediaJob,
    kind: 'generate' | 'edit',
    operations: MediaOperations,
    signal: AbortSignal,
  ): Promise<MediaImageOutput> {
    const prompt = typeof job.params.prompt === 'string' ? job.params.prompt : '';
    const size =
      typeof job.params.size === 'string' ? (job.params.size as MediaImageSize) : undefined;
    if (kind === 'generate') {
      return operations.generate(
        { prompt, ...(size !== undefined ? { size } : {}) },
        { signal, idempotencyKey: job.id },
      );
    }
    const parent = job.params.parent as { asset_id?: unknown; version?: unknown } | undefined;
    if (
      parent === undefined ||
      typeof parent.asset_id !== 'string' ||
      !Number.isSafeInteger(parent.version)
    ) {
      throw new MediaServiceError('unsupported_parent', 'Edit job is missing a valid parent.');
    }
    const version = parent.version as number;
    const source = await this.assets.readBytes(projectId, parent.asset_id, version);
    const parentRecord = await this.assets.getVersion(projectId, parent.asset_id, version);
    return operations.edit(
      {
        prompt,
        ...(size !== undefined ? { size } : {}),
        image: { bytes: source, mime: parentRecord.mime },
      },
      { signal, idempotencyKey: job.id },
    );
  }

  private async persist(
    projectId: string,
    job: MediaJob,
    kind: 'generate' | 'edit',
    output: MediaImageOutput,
  ): Promise<MediaVersionRecord> {
    const provider = providerModelName(output);
    if (kind === 'generate') {
      return this.assets.createAsset(projectId, {
        kind: 'image',
        mime: output.mime,
        bytes: output.bytes,
        source: { kind: 'prompt', text: String(job.params.prompt ?? ''), job_id: job.id },
        job_id: job.id,
        model: provider,
        ...(output.usage !== null ? { usage: output.usage } : {}),
      });
    }
    const parent = job.params.parent as { asset_id: string; version: number };
    return this.assets.addVersion(projectId, parent.asset_id, {
      kind: 'image',
      mime: output.mime,
      bytes: output.bytes,
      parent: { asset_id: parent.asset_id, version: parent.version, project_id: projectId },
      source: { kind: 'edit', text: String(job.params.prompt ?? ''), job_id: job.id },
      job_id: job.id,
      model: provider,
      ...(output.usage !== null ? { usage: output.usage } : {}),
    });
  }
}

export type { MediaError };
