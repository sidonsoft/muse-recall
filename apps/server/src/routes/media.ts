import { ProviderError } from '@mml/muse-provider';
import {
  API_ERROR_CODES,
  apiFailure,
  ForgeProjectIdSchema,
  MEDIA_UPLOAD_BODY_LIMIT_BYTES,
  MEDIA_UPLOAD_MAX_BASE64_CHARS,
  MEDIA_UPLOAD_MAX_BYTES,
  MediaAssetListSchema,
  MediaEditRequestSchema,
  MediaGenerateRequestSchema,
  MediaJobListSchema,
  MediaJobSchema,
  MediaUploadRequestSchema,
  MediaVersionListSchema,
  MediaVersionRecordSchema,
} from '@mml/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MediaError } from '../media/assets.js';
import { MediaJobError } from '../media/jobs.js';
import { type MediaService, MediaServiceError } from '../media/service.js';

const ProjectParams = z.object({ id: ForgeProjectIdSchema });
const AssetParams = z.object({
  id: ForgeProjectIdSchema,
  assetId: z.uuid(),
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

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

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

async function guard(reply: FastifyReply, run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MediaError || error instanceof MediaJobError) {
      return reply.status(mediaStatus(error)).send({
        ok: false,
        error: { code: error.code, message: error.message },
      });
    }
    if (error instanceof MediaServiceError) {
      const status =
        error.code === 'media_unconfigured' ? 503 : error.code === 'job_not_found' ? 404 : 400;
      return reply.status(status).send({
        ok: false,
        error: { code: error.code, message: error.message },
      });
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
      return reply.status(status).send({
        ok: false,
        error: { code: error.code, message: error.message },
      });
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
