import { ProviderError } from '@mml/muse-provider';
import {
  API_ERROR_CODES,
  apiFailure,
  ForgeProjectIdSchema,
  MEDIA_AUDIO_MAX_BASE64_CHARS,
  MEDIA_AUDIO_MAX_BYTES,
  MEDIA_AUDIO_UPLOAD_BODY_LIMIT_BYTES,
  MEDIA_UPLOAD_BODY_LIMIT_BYTES,
  MEDIA_UPLOAD_MAX_BASE64_CHARS,
  MEDIA_UPLOAD_MAX_BYTES,
  MEDIA_VIDEO_MAX_BASE64_CHARS,
  MEDIA_VIDEO_MAX_BYTES,
  MEDIA_VIDEO_UPLOAD_BODY_LIMIT_BYTES,
  MediaAssetListSchema,
  MediaClipRequestSchema,
  MediaClipResponseSchema,
  MediaCutoutRequestSchema,
  MediaEditRequestSchema,
  MediaGenerateRequestSchema,
  MediaJobListSchema,
  MediaJobSchema,
  MediaProposalRequestSchema,
  MediaProposalResultSchema,
  MediaSegmentRequestSchema,
  MediaSegmentResponseSchema,
  MediaSourceListSchema,
  MediaSourceRecordSchema,
  MediaSourceUploadRequestSchema,
  MediaSuggestRequestSchema,
  MediaSuggestResponseSchema,
  MediaTranscribeRequestSchema,
  MediaTranscriptSchema,
  MediaUploadRequestSchema,
  MediaVersionListSchema,
  MediaVersionRecordSchema,
} from '@mml/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MediaError } from '../media/assets.js';
import { MediaJobError } from '../media/jobs.js';
import { type MediaService, MediaServiceError } from '../media/service.js';
import { MediaSourceError } from '../media/source-format.js';

const ProjectParams = z.object({ id: ForgeProjectIdSchema });
const AssetParams = z.object({
  id: ForgeProjectIdSchema,
  assetId: z.uuid(),
});
const SegmentParams = z.object({
  id: ForgeProjectIdSchema,
  segmentId: z.uuid(),
});
const VersionParams = z.object({
  id: ForgeProjectIdSchema,
  assetId: z.uuid(),
  version: z.coerce.number().int().min(1).max(999_999_999),
});
const JobParams = z.object({
  id: ForgeProjectIdSchema,
  jobId: z.uuid(),
});
const SourceParams = z.object({
  id: ForgeProjectIdSchema,
  sourceId: z.uuid(),
});

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeSourceUpload(mime: 'audio/wav' | 'video/mp4', dataBase64: string): Buffer {
  const maxChars =
    mime === 'audio/wav' ? MEDIA_AUDIO_MAX_BASE64_CHARS : MEDIA_VIDEO_MAX_BASE64_CHARS;
  const maxBytes = mime === 'audio/wav' ? MEDIA_AUDIO_MAX_BYTES : MEDIA_VIDEO_MAX_BYTES;
  if (!BASE64.test(dataBase64) || dataBase64.length % 4 !== 0) {
    throw new MediaSourceError(
      'malformed_media',
      'Source payload is not canonical base64; refusing to decode ambiguous bytes.',
    );
  }
  if (dataBase64.length > maxChars) {
    throw new MediaSourceError(
      'size_exceeded',
      `Source payload is ${String(dataBase64.length)} base64 chars, above the ${String(maxChars)}-char bound.`,
    );
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length > maxBytes) {
    throw new MediaSourceError(
      'size_exceeded',
      `Source is ${String(bytes.length)} bytes, above the ${String(maxBytes)}-byte limit.`,
    );
  }
  if (bytes.length === 0) {
    throw new MediaSourceError('malformed_media', 'The uploaded source is empty.');
  }
  return bytes;
}

function decodeUpload(dataBase64: string): Buffer {
  if (!BASE64.test(dataBase64) || dataBase64.length % 4 !== 0) {
    throw new MediaError(
      'malformed_media',
      'Upload payload is not canonical base64; refusing to decode ambiguous bytes.',
    );
  }
  if (dataBase64.length > MEDIA_UPLOAD_MAX_BASE64_CHARS) {
    throw new MediaError(
      'malformed_media',
      `Upload payload is ${String(dataBase64.length)} base64 chars, above the bounded decode limit.`,
    );
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length > MEDIA_UPLOAD_MAX_BYTES) {
    throw new MediaError(
      'malformed_media',
      `Upload is ${String(bytes.length)} bytes, above the ${String(MEDIA_UPLOAD_MAX_BYTES)}-byte limit.`,
    );
  }
  return bytes;
}

/**
 * Batch B — media HTTP surface.
 *
 * Uploads and provider generation both create candidate versions only; nothing
 * becomes visible to an approved artifact until the asset version is approved
 * AND the owning Forge job is approved (approval embeds approved images).
 */
export function registerMediaRoutes(app: FastifyInstance, deps: { service: MediaService }): void {
  const { service } = deps;

  // --- Batch D: voice and video sources ----------------------------------
  // Static `/media/sources` routes are registered before `/media/:assetId`
  // so a source id can never be mistaken for an image asset id.
  app.get('/api/forge/projects/:id/media/sources', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      return envelope(MediaSourceListSchema.parse({ items: await service.listSources(id) }));
    });
  });

  app.post(
    '/api/forge/projects/:id/media/sources',
    {
      bodyLimit: Math.max(MEDIA_AUDIO_UPLOAD_BODY_LIMIT_BYTES, MEDIA_VIDEO_UPLOAD_BODY_LIMIT_BYTES),
    },
    async (request, reply) => {
      return guard(reply, async () => {
        const { id } = ProjectParams.parse(request.params);
        const body = MediaSourceUploadRequestSchema.parse(request.body ?? {});
        const record = await service.uploadSource(id, {
          mime: body.mime,
          bytes: decodeSourceUpload(body.mime, body.data_base64),
          origin: body.origin,
          ...(body.original_name !== undefined ? { original_name: body.original_name } : {}),
        });
        return reply.status(201).send(envelope(MediaSourceRecordSchema.parse(record)));
      });
    },
  );

  app.get('/api/forge/projects/:id/media/sources/:sourceId/bytes', async (request, reply) => {
    return guard(reply, async () => {
      const { id, sourceId } = SourceParams.parse(request.params);
      const record = await service.getSource(id, sourceId);
      const bytes = await service.readSourceBytes(id, sourceId);
      return reply
        .status(200)
        .header('content-type', record.mime)
        .header('content-length', String(bytes.length))
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header(
          'content-disposition',
          `inline; filename="${record.source_id}.${record.mime.split('/')[1] ?? 'bin'}"`,
        )
        .send(bytes);
    });
  });

  app.post('/api/forge/projects/:id/media/sources/:sourceId/transcribe', async (request, reply) => {
    return guard(reply, async () => {
      const { id, sourceId } = SourceParams.parse(request.params);
      const body = MediaTranscribeRequestSchema.parse(request.body ?? {});
      const transcript = await service.transcribeSource(id, sourceId, {
        mode: body.mode,
        languageBias: body.language_bias,
        keywords: body.keywords,
      });
      return envelope(MediaTranscriptSchema.parse(transcript));
    });
  });

  app.post('/api/forge/projects/:id/media/sources/:sourceId/clip', async (request, reply) => {
    return guard(reply, async () => {
      const { id, sourceId } = SourceParams.parse(request.params);
      const body = MediaClipRequestSchema.parse(request.body ?? {});
      const clip = await service.understandClip(id, sourceId, {
        ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
      });
      return envelope(MediaClipResponseSchema.parse(clip));
    });
  });

  app.post('/api/forge/projects/:id/media/sources/:sourceId/proposals', async (request, reply) => {
    return guard(reply, async () => {
      const { id, sourceId } = SourceParams.parse(request.params);
      const body = MediaProposalRequestSchema.parse(request.body ?? {});
      const result = await service.proposeFromSource(id, sourceId, body.proposals);
      return reply.status(201).send(envelope(MediaProposalResultSchema.parse(result)));
    });
  });

  app.get('/api/forge/projects/:id/media', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      return envelope(MediaAssetListSchema.parse({ items: await service.listAssets(id) }));
    });
  });

  app.post(
    '/api/forge/projects/:id/media/upload',
    { bodyLimit: MEDIA_UPLOAD_BODY_LIMIT_BYTES },
    async (request, reply) => {
      return guard(reply, async () => {
        const { id } = ProjectParams.parse(request.params);
        const body = MediaUploadRequestSchema.parse(request.body ?? {});
        const record = await service.upload(id, {
          mime: body.mime,
          bytes: decodeUpload(body.data_base64),
          ...(body.source_text !== undefined ? { source_text: body.source_text } : {}),
        });
        return envelope(MediaVersionRecordSchema.parse(record));
      });
    },
  );

  app.get('/api/forge/projects/:id/media/jobs', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const loaded = await service.listJobs(id);
      // The store reports {jobs, issues}; the list contract is {items, issues}.
      return envelope(
        MediaJobListSchema.parse({
          items: loaded.jobs,
          ...(loaded.issues.length > 0 ? { issues: loaded.issues } : {}),
        }),
      );
    });
  });

  app.post('/api/forge/projects/:id/media/generate', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const body = MediaGenerateRequestSchema.parse(request.body ?? {});
      const job = await service.enqueueGenerate(id, {
        prompt: body.prompt,
        ...(body.size !== undefined ? { size: body.size } : {}),
      });
      return reply.status(202).send(envelope(MediaJobSchema.parse(job)));
    });
  });

  app.post('/api/forge/projects/:id/media/edit', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const body = MediaEditRequestSchema.parse(request.body ?? {});
      const parent =
        body.parent.version !== undefined
          ? await service.getVersion(id, body.parent.asset_id, body.parent.version)
          : await service.latestVersion(id, body.parent.asset_id);
      const job = await service.enqueueEdit(id, {
        prompt: body.prompt,
        ...(body.size !== undefined ? { size: body.size } : {}),
        parent: { asset_id: body.parent.asset_id, version: parent.version },
      });
      return reply.status(202).send(envelope(MediaJobSchema.parse(job)));
    });
  });

  app.get('/api/forge/projects/:id/media/jobs/:jobId', async (request, reply) => {
    return guard(reply, async () => {
      const { id, jobId } = JobParams.parse(request.params);
      return envelope(MediaJobSchema.parse(await service.getJob(id, jobId)));
    });
  });

  /**
   * Batch C track 1 — reference-image suggestions. Inference only: the
   * response carries drafts for review, and nothing is written to memory
   * until the caller proposes a confirmed suggestion through the memory
   * engine. Dismissed suggestions never enter memory at all.
   */
  app.post('/api/forge/projects/:id/media/suggest', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const body = MediaSuggestRequestSchema.parse(request.body ?? {});
      const response = await service.suggestDecisions(id, {
        asset_id: body.asset_id,
        ...(body.version !== undefined ? { version: body.version } : {}),
        ...(body.guidance !== undefined ? { guidance: body.guidance } : {}),
        ...(body.count !== undefined ? { count: body.count } : {}),
      });
      return envelope(MediaSuggestResponseSchema.parse(response));
    });
  });

  /**
   * Batch C track 2 — SAM segmentation. Returns inspectable matches with
   * previews; an empty match list is valid (zero matches), not an error.
   * The session id selects the match to save without re-calling SAM.
   */
  app.post('/api/forge/projects/:id/media/segment', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const body = MediaSegmentRequestSchema.parse(request.body ?? {});
      const response = await service.runSegmentation(id, {
        asset_id: body.asset_id,
        ...(body.version !== undefined ? { version: body.version } : {}),
        concept: body.concept,
      });
      return envelope(MediaSegmentResponseSchema.parse(response));
    });
  });

  app.post('/api/forge/projects/:id/media/segments/:segmentId/cutout', async (request, reply) => {
    return guard(reply, async () => {
      const { id, segmentId } = SegmentParams.parse(request.params);
      const body = MediaCutoutRequestSchema.parse(request.body ?? {});
      const record = await service.saveCutout(id, segmentId, body.match_index);
      return envelope(MediaVersionRecordSchema.parse(record));
    });
  });

  app.post('/api/forge/projects/:id/media/jobs/:jobId/cancel', async (request, reply) => {
    return guard(reply, async () => {
      const { id, jobId } = JobParams.parse(request.params);
      return envelope(MediaJobSchema.parse(await service.cancel(id, jobId)));
    });
  });

  app.get('/api/forge/projects/:id/media/:assetId', async (request, reply) => {
    return guard(reply, async () => {
      const { id, assetId } = AssetParams.parse(request.params);
      return envelope(
        MediaVersionListSchema.parse({ items: await service.listVersions(id, assetId) }),
      );
    });
  });

  for (const action of ['approve', 'reject'] as const) {
    app.post(
      `/api/forge/projects/:id/media/:assetId/versions/:version/${action}`,
      async (request, reply) => {
        return guard(reply, async () => {
          const { id, assetId, version } = VersionParams.parse(request.params);
          const record =
            action === 'approve'
              ? await service.approve(id, assetId, version)
              : await service.reject(id, assetId, version);
          return envelope(MediaVersionRecordSchema.parse(record));
        });
      },
    );
  }

  app.get(
    '/api/forge/projects/:id/media/:assetId/versions/:version/bytes',
    async (request, reply) => {
      return guard(reply, async () => {
        const { id, assetId, version } = VersionParams.parse(request.params);
        const record = await service.getVersion(id, assetId, version);
        // Bytes are re-verified against the immutable manifest on every read;
        // the response is never cached because curation status can change.
        const bytes = await service.readBytes(id, assetId, version);
        return reply
          .status(200)
          .header('content-type', record.mime)
          .header('content-length', String(bytes.length))
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox")
          .header(
            'content-disposition',
            `inline; filename="${record.asset_id}-v${String(record.version)}.${record.mime.split('/')[1] ?? 'bin'}"`,
          )
          .send(bytes);
      });
    },
  );
}

function envelope<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function projectScoped(error: MediaError | MediaJobError): boolean {
  return (
    error.code === 'asset_not_found' ||
    error.code === 'job_not_found' ||
    error.code === 'invalid_job_id'
  );
}

function mediaStatus(error: MediaError | MediaJobError): number {
  if (projectScoped(error)) return 404;
  if (error.code === 'persistence_failed' || error.code === 'invalid_job_state') return 503;
  if (error.code === 'version_corrupt' || error.code === 'cross_project_reference') return 409;
  if (error.code === 'cancelled') return 409;
  return 400;
}

/**
 * Media and provider failures → HTTP reply, shared with the Forge surface.
 * Batch E's screenshot review is a Forge route that performs a media call, so
 * a media or provider failure has to mean the same thing on both surfaces.
 * Returns false when `error` is not a media failure, leaving the caller's own
 * mapping untouched.
 */
export function sendMediaError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof MediaError || error instanceof MediaJobError) {
    reply.status(mediaStatus(error)).send({
      ok: false,
      error: { code: error.code, message: error.message },
    });
    return true;
  }
  if (error instanceof MediaSourceError) {
    const status =
      error.code === 'source_not_found'
        ? 404
        : error.code === 'size_exceeded'
          ? 413
          : error.code === 'persistence_failed'
            ? 503
            : error.code === 'source_corrupt'
              ? 409
              : 400;
    reply.status(status).send({
      ok: false,
      error: { code: error.code, message: error.message },
    });
    return true;
  }
  if (error instanceof MediaServiceError) {
    const status =
      error.code === 'media_unconfigured'
        ? 503
        : error.code === 'job_not_found' ||
            error.code === 'segment_not_found' ||
            error.code === 'media_source_not_found'
          ? 404
          : error.code === 'proposal_conflict'
            ? 409
            : 400;
    reply.status(status).send({
      ok: false,
      error: { code: error.code, message: error.message },
    });
    return true;
  }
  if (ProviderError.isProviderError(error)) {
    const status =
      error.code === 'invalid_request'
        ? 400
        : error.code === 'provider_timeout'
          ? 504
          : error.code === 'provider_cancelled'
            ? 409
            : error.code === 'provider_auth_failed'
              ? 502
              : 502;
    // Surface only the bounded, non-secret provider telemetry the
    // adapter attaches (HTTP status, dispatch count, bounded stream
    // evidence) so acceptance harnesses can account exact attempts
    // even on failure.
    const details: Record<string, unknown> = {};
    if (typeof error.details.status === 'number') details.status = error.details.status;
    if (typeof error.details.attempts === 'number') details.attempts = error.details.attempts;
    if (typeof error.details.stream_events === 'number')
      details.stream_events = error.details.stream_events;
    if (typeof error.details.stream_bytes === 'number')
      details.stream_bytes = error.details.stream_bytes;
    if (
      typeof error.details.response_sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(error.details.response_sha256)
    )
      details.response_sha256 = error.details.response_sha256;
    if (typeof error.details.delta_events === 'number')
      details.delta_events = error.details.delta_events;
    if (typeof error.details.ignored_events === 'number')
      details.ignored_events = error.details.ignored_events;
    reply.status(status).send({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(Object.keys(details).length > 0 ? { details } : {}),
      },
    });
    return true;
  }
  return false;
}

async function guard(reply: FastifyReply, run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    if (sendMediaError(reply, error)) {
      return undefined;
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send(
        apiFailure(
          API_ERROR_CODES.validationFailed,
          'The request did not match the expected schema.',
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        ),
      );
    }
    throw error;
  }
}
