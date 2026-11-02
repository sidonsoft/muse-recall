import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { reserveLoopbackPort } from '../../scripts/lib/batchd-live.js';
import {
  DOCUMENTED_PORTS,
  FirstRunBlocked,
  firstRunIssues,
  portBusy,
  readServiceMeta,
  withDocumentedFirstRun,
} from '../../scripts/lib/first-run.js';

describe('the documented first run', () => {
  it('treats a first run that only loads a page as broken', () => {
    const good: Parameters<typeof firstRunIssues>[0] = {
      apiHealthy: true,
      webStatus: 200,
      provider: 'echo',
      buildIdentity: null,
      environment: 'development',
      mounted: true,
      consoleErrors: [],
      nonLocalRequests: [],
      metaContractViolation: false,
      tabsVisited: ['Memory'],
      missingTabs: [],
    };
    expect(firstRunIssues(good)).toEqual([]);
    expect(firstRunIssues({ ...good, mounted: false }).join(' ')).toContain('never mounted');
    expect(firstRunIssues({ ...good, provider: 'muse' }).join(' ')).toContain('not echo');
    expect(firstRunIssues({ ...good, provider: null }).join(' ')).toContain('/api/meta');
    expect(firstRunIssues({ ...good, buildIdentity: 'a'.repeat(40) }).join(' ')).toContain(
      'not the development server',
    );
    expect(firstRunIssues({ ...good, nonLocalRequests: ['api.example.com'] }).join(' ')).toContain(
      'does not allowlist',
    );
    // The approved Phaser CDN is the product's documented exception. Recording it
    // is honest; calling it a leak would be wrong, and pretending it is not there
    // would launder an offline claim.
    expect(firstRunIssues({ ...good, nonLocalRequests: ['cdn.jsdelivr.net'] })).toEqual([]);
    expect(
      firstRunIssues({ ...good, nonLocalRequests: ['cdn.jsdelivr.net', 'tracker.example'] }).join(
        ' ',
      ),
    ).toContain('tracker.example');
    expect(firstRunIssues({ ...good, consoleErrors: ['boom'] }).join(' ')).toContain(
      'console errors',
    );
  });

  it('reads the metadata envelope rather than guessing its shape', () => {
    const meta = {
      service: 'muse-memory-lab',
      version: '0.1.0',
      environment: 'development',
      phase: 5,
      provider: {
        id: 'echo',
        name: 'Deterministic offline provider',
        configured_model: null,
        capabilities: {
          streaming: false,
          tool_calling: false,
          structured_output: false,
          provider_sessions: false,
          max_context_tokens: 8_000,
          models: ['echo'],
        },
      },
      forge: { provider: 'fake-muse', configured_model: null, observed_model: null },
      media: {
        image_model: 'muse-image-1.0',
        sam_model: 'sam-3.1',
        vision_model: 'muse-spark-1.3',
        transcribe_model: 'muse-voice-transcribe-1.0',
        video_model: 'muse-spark-1.3',
        max_retries: 0,
      },
      modules: {
        memory_engine: 'complete',
        agent_runtime: 'complete',
        muse_integration: 'complete',
        ui_protocol: 'complete',
        agent_tools: 'complete',
        evaluation: 'complete',
      },
      memory: {
        default_budget: { max_memories: 8, max_characters: 2000, max_tokens: 800 },
        weights: { recency: 1, relevance: 1, importance: 1 },
      },
      safety: { tool_approval_policy: 'always', generated_code_execution: false },
      build: null,
    };
    // The server wraps success in { ok: true, data: … }. Reading the unwrapped
    // shape is what makes "the contract changed underneath us" a failure.
    const wrapped = readServiceMeta({ status: 200, body: { ok: true, data: meta } });
    expect(wrapped.violation).toBe(false);
    expect(wrapped.meta?.provider.id).toBe('echo');
    expect(readServiceMeta({ status: 200, body: meta }).meta?.provider.id).toBe('echo');
    expect(readServiceMeta({ status: 500, body: null }).violation).toBe(true);
    expect(readServiceMeta({ status: 200, body: { ok: true, data: { nope: 1 } } }).violation).toBe(
      true,
    );
    expect(
      firstRunIssues({
        apiHealthy: true,
        webStatus: 200,
        provider: null,
        environment: null,
        buildIdentity: null,
        mounted: true,
        consoleErrors: [],
        nonLocalRequests: [],
        metaContractViolation: true,
        tabsVisited: [],
        missingTabs: [],
      }).join(' '),
    ).toContain('ServiceMetaSchema');
  });

  describe('starting the documented first run', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'first-run-harness-'));
    let logIndex = 0;
    const nextLog = (): string => {
      logIndex += 1;
      return join(logDir, `run-${String(logIndex)}.log`);
    };

    afterAll(() => {
      // The temp log directory is disposable; nothing is left behind on purpose.
    });

    const fakeDev = (api: number, web: number): [string, ...string[]] => [
      process.execPath,
      '-e',
      `const http=require('node:http');
     const serve=(port)=>http.createServer((_q,r)=>{r.writeHead(200,{'content-type':'application/json'});r.end('{"ok":true}');}).listen(port,'127.0.0.1');
     serve(${String(api)});serve(${String(web)});
     setTimeout(()=>process.exit(0),30000);`,
    ];

    it('starts, hands over working urls, and leaves nothing listening', async () => {
      const api = await reserveLoopbackPort();
      const web = await reserveLoopbackPort();
      const run = await withDocumentedFirstRun(
        {
          command: fakeDev(api, web),
          cwd: logDir,
          logFile: nextLog(),
          ports: { api, web },
          startupTimeoutMs: 20_000,
        },
        async (urls) => {
          const apiResponse = await fetch(`${urls.apiUrl}/api/health`);
          const webResponse = await fetch(urls.webUrl);
          return { apiStatus: apiResponse.status, webStatus: webResponse.status };
        },
      );
      expect(run.value).toEqual({ apiStatus: 200, webStatus: 200 });
      expect(run.portsReleased).toBe(true);
      expect(await portBusy(api)).toBe(false);
      expect(await portBusy(web)).toBe(false);
    });

    it('refuses to measure a machine that already holds the documented ports', async () => {
      const api = await reserveLoopbackPort();
      const web = await reserveLoopbackPort();
      const squatter = createServer();
      squatter.listen(api, '127.0.0.1');
      await new Promise((resolve) => squatter.once('listening', resolve));
      try {
        await expect(
          withDocumentedFirstRun(
            {
              command: fakeDev(api, web),
              cwd: logDir,
              logFile: nextLog(),
              ports: { api, web },
              startupTimeoutMs: 5_000,
            },
            async () => 'should not run',
          ),
        ).rejects.toThrow(FirstRunBlocked);
        await expect(
          withDocumentedFirstRun(
            {
              command: fakeDev(api, web),
              cwd: logDir,
              logFile: nextLog(),
              ports: { api, web },
              startupTimeoutMs: 5_000,
            },
            async () => 'should not run',
          ),
        ).rejects.toThrow(new RegExp(String(api)));
      } finally {
        squatter.close();
      }
    });

    it('says whether the start command died or merely never came up', async () => {
      const api = await reserveLoopbackPort();
      const web = await reserveLoopbackPort();
      await expect(
        withDocumentedFirstRun(
          {
            command: [process.execPath, '-e', 'setTimeout(() => {}, 20000)'],
            cwd: logDir,
            logFile: nextLog(),
            ports: { api, web },
            startupTimeoutMs: 1_500,
          },
          async () => 'should not run',
        ),
      ).rejects.toThrow(/stayed running/);
    });

    it('keeps the documented ports as the default, so the check follows the README', () => {
      expect(DOCUMENTED_PORTS).toEqual({ api: 8787, web: 5173 });
    });
  });
});
