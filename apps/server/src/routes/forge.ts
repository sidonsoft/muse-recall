import type { MemoryEngine } from '@mml/memory-engine';
import {
  ForgeApproveSchema,
  ForgeCreateProjectSchema,
  ForgeDiffSchema,
  ForgeGenerateSchema,
  ForgeJobSchema,
  ForgeModifySchema,
  ForgeProjectViewSchema,
  ForgeStateSchema,
} from '@mml/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ForgeJobManager } from '../forge/runner.js';
import { ForgeError, type ForgeWorkspace } from '../forge/workspace.js';

const ProjectParams = z.object({ id: z.string().min(2).max(64) });
const JobParams = z.object({ jobId: z.uuid() });
const _DiffParams = z.object({ id: z.string().min(2).max(64), jobId: z.uuid() });
const PreviewQuery = z.object({ job: z.uuid().optional() });

/**
 * Forge HTTP surface.
 *
 * Generation and modification are jobs, not request/response calls. Nothing a
 * job writes is visible until the user approves the staged diff.
 */
export function registerForgeRoutes(
  app: FastifyInstance,
  deps: { manager: ForgeJobManager; workspace: ForgeWorkspace; engine: MemoryEngine },
): void {
  const { manager, workspace } = deps;

  app.post('/api/forge/projects', async (request, reply) => {
    return guard(reply, async () => {
      const body = ForgeCreateProjectSchema.parse(request.body ?? {});
      deps.engine.ensureProject(body.project_id, body.name ?? body.project_id);
      await workspace.ensureProject(body.project_id);
      return envelope(
        ForgeProjectViewSchema.parse({
          state: await workspace.state(body.project_id),
          jobs: manager.list(body.project_id),
        }),
      );
    });
  });

  app.get('/api/forge/projects/:id', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      await workspace.ensureProject(id);
      return envelope(
        ForgeProjectViewSchema.parse({ state: await workspace.state(id), jobs: manager.list(id) }),
      );
    });
  });

  app.post('/api/forge/projects/:id/generate', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const body = ForgeGenerateSchema.parse(request.body ?? {});
      await workspace.ensureProject(id);
      deps.engine.ensureProject(id);
      const job = await manager.start({ projectId: id, kind: 'generate', prompt: body.prompt });
      reply.status(202);
      return envelope(ForgeJobSchema.parse(job));
    });
  });

  app.post('/api/forge/projects/:id/modify', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const body = ForgeModifySchema.parse(request.body ?? {});
      const screenshot = decodePng(body.screenshot_data_url);
      await workspace.ensureProject(id);
      const job = await manager.start({
        projectId: id,
        kind: 'modify',
        prompt: body.request,
        request: body.request,
        screenshot,
      });
      reply.status(202);
      return envelope(ForgeJobSchema.parse(job));
    });
  });

  app.get('/api/forge/jobs/:jobId', async (request, reply) => {
    return guard(reply, async () => {
      const { jobId } = JobParams.parse(request.params);
      const job = manager.get(jobId);
      if (!job) return notFound(reply, 'Unknown job.');
      return envelope(ForgeJobSchema.parse(job));
    });
  });

  app.post('/api/forge/jobs/:jobId/cancel', async (request, reply) => {
    return guard(reply, async () => {
      const { jobId } = JobParams.parse(request.params);
      const job = manager.cancel(jobId);
      if (!job) return notFound(reply, 'Unknown job.');
      return envelope(ForgeJobSchema.parse(job));
    });
  });

  app.get('/api/forge/jobs/:jobId/diff', async (request, reply) => {
    return guard(reply, async () => {
      const { jobId } = JobParams.parse(request.params);
      if (!manager.get(jobId)) return notFound(reply, 'Unknown job.');
      return envelope(ForgeDiffSchema.parse(await manager.diff(jobId)));
    });
  });

  app.post('/api/forge/jobs/:jobId/approve', async (request, reply) => {
    return guard(reply, async () => {
      const { jobId } = JobParams.parse(request.params);
      const body = ForgeApproveSchema.parse(request.body ?? {});
      const result = await manager.approve(jobId, {
        captureMemory: body.capture_memory,
        ...(body.decision ? { decision: body.decision } : {}),
      });
      return envelope(result);
    });
  });

  app.post('/api/forge/jobs/:jobId/reject', async (request, reply) => {
    return guard(reply, async () => {
      const { jobId } = JobParams.parse(request.params);
      return envelope(await manager.reject(jobId));
    });
  });

  app.post('/api/forge/projects/:id/rollback', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      await manager.rollback(id);
      return envelope(ForgeStateSchema.parse(await workspace.state(id)));
    });
  });

  /**
   * Preview. Served same-origin but always inside a sandboxed iframe: the CSP
   * `sandbox allow-scripts` directive gives the document an opaque origin, so it
   * cannot read application storage, cookies, or privileged APIs.
   */
  app.get('/api/forge/projects/:id/preview', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const query = PreviewQuery.parse(request.query ?? {});
      const html = query.job
        ? await workspace.stagedHtml(id, query.job)
        : await workspace.currentHtml(id);
      if (html === null) return notFound(reply, 'No game to preview yet.');
      reply
        .header('content-type', 'text/html; charset=utf-8')
        .header(
          'content-security-policy',
          [
            'sandbox allow-scripts',
            "default-src 'none'",
            "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
            "style-src 'unsafe-inline'",
            'img-src data: blob:',
            'connect-src https://cdn.jsdelivr.net',
            "frame-ancestors 'self'",
            "base-uri 'none'",
            "form-action 'none'",
            "object-src 'none'",
          ].join('; '),
        )
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff');
      return reply.send(withCaptureBridge(html));
    });
  });
}

/**
 * Injected into every preview, in the sandboxed document only. It lets the host
 * request a PNG of the game canvas; the generated game never sees app state.
 */
const CAPTURE_BRIDGE = `<script>(function(){
function post(source,message){try{if(source)source.postMessage(message,'*');}catch(error){}}
function fallback(source,error){
  var canvas=document.querySelector('canvas');
  try{
    if(canvas){post(source,{type:'forge:screenshot',dataUrl:canvas.toDataURL('image/png'),method:'canvas'});}
    else{post(source,{type:'forge:screenshot',error:error?String(error):'No canvas found.'});}
  }catch(cause){post(source,{type:'forge:screenshot',error:String(cause)});}
}
// Wrap Phaser.Game as soon as the CDN assigns window.Phaser, before the game
// script runs, so capture can use renderer.snapshot() instead of toDataURL on a
// WebGL canvas whose drawing buffer is already cleared.
try{
  Object.defineProperty(window,'Phaser',{
    configurable:true,
    get:function(){return undefined;},
    set:function(value){
      try{
        var Original=value&&value.Game;
        if(typeof Original==='function'&&!Original.__forgeWrapped){
          var Wrapped=function(config){
            var game=new Original(config);
            window.__forgeGame=game;
            return game;
          };
          Wrapped.prototype=Original.prototype;
          Wrapped.__forgeWrapped=true;
          value.Game=Wrapped;
        }
      }catch(error){}
      Object.defineProperty(window,'Phaser',{value:value,writable:true,configurable:true,enumerable:true});
    }
  });
}catch(error){}
window.addEventListener('message',function(event){
  var data=event.data;if(!data)return;
  var source=event.source||window.parent;
  if(data.type==='forge:restart'){window.location.reload();return;}
  if(data.type!=='forge:capture')return;
  var game=window.__forgeGame;
  if(game&&game.renderer&&typeof game.renderer.snapshot==='function'){
    try{
      game.renderer.snapshot(function(image){
        if(image&&image.src){post(source,{type:'forge:screenshot',dataUrl:image.src,method:'snapshot'});}
        else{fallback(source,'Snapshot returned no image.');}
      });
      return;
    }catch(error){fallback(source,error);return;}
  }
  fallback(source,'No Phaser game instance; using canvas capture.');
});
window.addEventListener('error',function(event){
  var message=event&&event.message?String(event.message):'';
  if(message&&window.parent)window.parent.postMessage({type:'forge:preview-error',message:message},'*');
});
})();</script>`;
function withCaptureBridge(html: string): string {
  // Must run before the Phaser CDN script: defining window.Phaser after the CDN
  // has assigned it would replace the library with our accessor.
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${CAPTURE_BRIDGE}${html.slice(at)}`;
  }
  return `${CAPTURE_BRIDGE}${html}`;
}

function envelope<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({ ok: false, error: { code: 'not_found', message } });
}

function decodePng(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match?.[1])
    throw new ForgeError('invalid_staged', 'Screenshot must be a base64 PNG data URL.');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length < 8 || buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new ForgeError('invalid_staged', 'Screenshot is not a valid PNG.');
  }
  if (buffer.length > 6_000_000) throw new ForgeError('invalid_staged', 'Screenshot is too large.');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 32 || height < 32) {
    throw new ForgeError('invalid_staged', 'Screenshot is too small to be a game preview.');
  }
  return buffer;
}

async function guard(reply: FastifyReply, run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ForgeError) {
      const status =
        error.code === 'invalid_job_id'
          ? 404
          : error.code === 'runtime_failed'
            ? 422
            : error.code === 'too_many_jobs'
              ? 429
              : error.code === 'path_escape' ||
                  error.code === 'invalid_project_id' ||
                  error.code === 'decision_required'
                ? 400
                : 409;
      return reply.status(status).send({
        ok: false,
        error: { code: error.code, message: error.message, issues: error.details },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'invalid_request', message: error.issues[0]?.message ?? 'Invalid request.' },
      });
    }
    throw error;
  }
}
