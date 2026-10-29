import { createHash } from 'node:crypto';
import type { MemoryEngine } from '@mml/memory-engine';
import {
  FORGE_MODIFY_BODY_LIMIT_BYTES,
  FORGE_SCREENSHOT_MAX_BYTES,
  ForgeApproveSchema,
  ForgeArtifactSchema,
  ForgeCreateProjectSchema,
  ForgeDiffSchema,
  ForgeGenerateSchema,
  ForgeJobSchema,
  ForgeModifySchema,
  ForgeProjectViewSchema,
  ForgeRecoveryAckSchema,
  ForgeRecoveryReportSchema,
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
const ArtifactQuery = z.object({ job: z.uuid().optional() });

/**
 * The document title is untrusted generated text. It is returned as JSON and
 * rendered as a text child by the client; tags are stripped so a title can
 * never leak markup into a panel heading.
 */
function documentTitle(html: string, fallback: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = (match?.[1] ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text.length > 0 ? text : fallback).slice(0, 160);
}

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

  const projectView = async (projectId: string) =>
    ForgeProjectViewSchema.parse({
      state: await workspace.state(projectId),
      jobs: manager.list(projectId),
      recovery: manager.recovery(projectId),
    });

  app.post('/api/forge/projects', async (request, reply) => {
    return guard(reply, async () => {
      const body = ForgeCreateProjectSchema.parse(request.body ?? {});
      deps.engine.ensureProject(body.project_id, body.name ?? body.project_id);
      await workspace.ensureProject(body.project_id);
      return envelope(await projectView(body.project_id));
    });
  });

  app.get('/api/forge/projects/:id', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      // Reads are side-effect free. A missing project renders as an empty view;
      // only POST/create/generate paths initialise the workspace.
      return envelope(await projectView(id));
    });
  });

  app.post('/api/forge/projects/:id/recovery/ack', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const body = ForgeRecoveryAckSchema.parse(request.body ?? {});
      return envelope(
        ForgeRecoveryReportSchema.parse(await manager.acknowledge(id, body.issue_ids)),
      );
    });
  });

  app.post('/api/forge/projects/:id/storage-check', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      return envelope(ForgeRecoveryReportSchema.parse(await manager.checkStorage(id)));
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

  app.post(
    '/api/forge/projects/:id/modify',
    { bodyLimit: FORGE_MODIFY_BODY_LIMIT_BYTES },
    async (request, reply) => {
      return guard(reply, async () => {
        const { id } = ProjectParams.parse(request.params);
        const body = ForgeModifySchema.parse(request.body ?? {});
        const screenshot = body.screenshot_data_url
          ? decodePng(body.screenshot_data_url)
          : undefined;
        await workspace.ensureProject(id);
        const job = await manager.start({
          projectId: id,
          kind: 'modify',
          prompt: body.request,
          request: body.request,
          ...(screenshot ? { screenshot } : {}),
        });
        reply.status(202);
        return envelope(ForgeJobSchema.parse(job));
      });
    },
  );

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
   * Inspectable source for the approved or staged artifact.
   *
   * This is read-only JSON: returning the bytes as text lets the studio show
   * line numbers, integrity, and export without executing generated code in
   * the application origin. The sandboxed preview remains the only renderer.
   */
  app.get('/api/forge/projects/:id/artifact', async (request, reply) => {
    return guard(reply, async () => {
      const { id } = ProjectParams.parse(request.params);
      const query = ArtifactQuery.parse(request.query ?? {});
      const state = await workspace.state(id);

      let html: string | null;
      let sha256: string;
      let jobId: string | null = null;
      let version: number | null = state.current_version;

      if (query.job) {
        const job = manager.get(query.job);
        if (!job || job.project_id !== id) return notFound(reply, 'Unknown review job.');
        const snapshot = await workspace.stagedSnapshot(id, query.job);
        if (!snapshot) return notFound(reply, 'This review has no staged HTML.');
        html = snapshot.html;
        sha256 = snapshot.sha256;
        jobId = query.job;
        version = null;
      } else {
        html = await workspace.currentHtml(id);
        if (html === null) return notFound(reply, 'No approved HTML yet.');
        sha256 = createHash('sha256').update(html, 'utf8').digest('hex');
        // Compare the bytes actually served with the hash recorded for this
        // version; a changed file must not be presented as approved source.
        const recorded = state.versions.find(
          (entry) => entry.version === state.current_version,
        )?.sha256;
        if (recorded && recorded !== sha256) {
          throw new ForgeError(
            'version_corrupt',
            `v${String(state.current_version)} no longer matches its recorded hash.`,
          );
        }
      }

      return envelope(
        ForgeArtifactSchema.parse({
          project_id: id,
          job_id: jobId,
          version,
          staged: jobId !== null,
          artifact_type: 'html',
          title: documentTitle(html, id),
          bytes: Buffer.byteLength(html, 'utf8'),
          lines: html.length === 0 ? 0 : html.split('\n').length,
          sha256,
          html,
        }),
      );
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
      if (html === null) return notFound(reply, 'No application to preview yet.');
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
 * Preview-only Web Storage. A sandboxed document has an opaque origin, so the
 * real Storage accessors throw `SecurityError`. Generated applications that
 * save in localStorage or sessionStorage still need working storage while they
 * are reviewed; this data lives for the life of the preview document and is
 * never written to the artifact or the approved file.
 */
const STORAGE_SHIM = `<script data-forge-preview-storage>(function(){
function createStorage(){
  var data=Object.create(null);
  var keys=[];
  function has(key){return Object.prototype.hasOwnProperty.call(data,key);}
  return {
    getItem:function(key){key=String(key);return has(key)?data[key]:null;},
    setItem:function(key,value){
      key=String(key);value=String(value);
      if(!has(key))keys.push(key);
      data[key]=value;
    },
    removeItem:function(key){
      key=String(key);
      if(!has(key))return;
      delete data[key];
      var at=keys.indexOf(key);
      if(at>=0)keys.splice(at,1);
    },
    clear:function(){data=Object.create(null);keys.length=0;},
    key:function(index){var at=Number(index)>>>0;return at<keys.length?keys[at]:null;},
    get length(){return keys.length;}
  };
}
function install(name){
  // Leave real storage alone when it is usable; only replace an accessor that
  // throws because the document is sandboxed.
  try{window[name];return;}catch(error){}
  try{
    Object.defineProperty(window,name,{value:createStorage(),configurable:true,enumerable:true});
  }catch(error){}
}
install('localStorage');
install('sessionStorage');
})();</script>`;

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
  // Both scripts must run before generated code: the storage shim before any
  // application script touches Web Storage, and the Phaser accessor before the
  // CDN script assigns window.Phaser (which would replace the accessor).
  const injected = `${STORAGE_SHIM}${CAPTURE_BRIDGE}`;
  const head = /<head[^>]*>/i.exec(html);
  const firstScript = /<script\b/i.exec(html);
  const at = head ? head.index + head[0].length : 0;
  // Normal documents put <head> before every script. Also cover a malformed
  // leading script so the shim is never after application code.
  if (firstScript && firstScript.index < at) {
    return `${html.slice(0, firstScript.index)}${injected}${html.slice(firstScript.index)}`;
  }
  if (head) {
    return `${html.slice(0, at)}${injected}${html.slice(at)}`;
  }
  return `${injected}${html}`;
}

function envelope<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({ ok: false, error: { code: 'not_found', message } });
}

/** PNG magic bytes plus the IHDR length/type/width/height prefix. */
const PNG_HEADER_BYTES = 24;

function decodePng(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match?.[1])
    throw new ForgeError('invalid_screenshot', 'Screenshot must be a base64 PNG data URL.');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length < 8 || buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new ForgeError('invalid_screenshot', 'Screenshot is not a valid PNG.');
  }
  if (buffer.length > FORGE_SCREENSHOT_MAX_BYTES) {
    throw new ForgeError('invalid_screenshot', 'Screenshot is too large.');
  }
  // Width and height live at offsets 16 and 20. A truncated PNG must fail as a
  // request error, not as a RangeError escaping the route guard.
  if (buffer.length < PNG_HEADER_BYTES) {
    throw new ForgeError('invalid_screenshot', 'Screenshot PNG header is truncated.');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 32 || height < 32) {
    throw new ForgeError('invalid_screenshot', 'Screenshot is too small to be a preview capture.');
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
              : error.code === 'persistence_failed' || error.code === 'shutting_down'
                ? 503
                : error.code === 'state_corrupt'
                  ? 500
                  : error.code === 'path_escape' ||
                      error.code === 'invalid_project_id' ||
                      error.code === 'decision_required' ||
                      error.code === 'invalid_screenshot'
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
