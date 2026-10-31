/**
 * Study 02 checkpoint 2 — build the REAL production Forge prompt for the Dell
 * qualification runs. Mirrors docs/hackathon-evidence/phase17/run_open.mjs but
 * uses the CURRENT production buildForgePrompt signature (memories array, as
 * apps/server/src/forge/runner.ts:1215 calls it) and the production retrieval
 * mode 'forge' (FORGE_RETRIEVAL_BUDGET = max_memories 6 / max_characters 3000).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = '/Users/burnz/projects/muse-memory-lab';
const OUT = '/tmp/study02-qual/prompts';
mkdirSync(OUT, { recursive: true });

const { buildForgePrompt, buildRetrievalQuery } = await import(path.join(ROOT, 'apps/server/src/forge/prompt.ts'));
const { MemoryEngine, openDatabase } = await import(path.join(ROOT, 'packages/memory-engine/src/index.ts'));

const DESIGN = JSON.parse(readFileSync(path.join(ROOT, 'docs/hackathon-evidence/phase17/design.json'), 'utf8'));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const memoryInput = (projectId, content) => ({
  type: 'constraint', scope: 'project', project_id: projectId, content,
  source: { session_id: null, reference: 'study02-qualification' },
  confidence: 0.95, validation_status: 'verified', tags: ['study02', 'qualification'], expires_at: null,
});

// The three Phase 17 baselines required by the checkpoint-2 scope.
const TARGETS = [
  { key: 'farmyard',  stratum: 'farm-arcade',   request_id: 'arcade',  label: 'Farmyard Memory Match' },
  { key: 'orchard',   stratum: 'orchard-arcade', request_id: 'arcade',  label: 'Orchard Catch' },
  { key: 'focusflow', stratum: 'focus-reward',   request_id: 'reward',  label: 'FocusFlow task planner' },
];

const NOW = new Date('2026-10-31T00:00:00.000Z');
const manifest = [];

for (const target of TARGETS) {
  const baseline = DESIGN.baselines[target.key];
  const rule = DESIGN.rules[baseline.rule];
  const request = DESIGN.requests[target.request_id];
  const baselineHtml = readFileSync(path.join(ROOT, baseline.path), 'utf8');

  const projectId = 'p17';
  const database = openDatabase({ path: ':memory:', wal: false });
  try {
    const engine = new MemoryEngine(database.db);
    engine.ensureProject(projectId, 'Study 02 qualification');
    // Arm = 'memory' (armPlan('memory')): [rule.text, context], no correction.
    const contents = [rule.text, baseline.context];
    const seeded = contents.map((content) => {
      const created = engine.create(memoryInput(projectId, content));
      return { id: created.memory.id, content };
    });
    // Production path: buildRetrievalQuery + retrieve mode 'forge' (budget 6 / 3000).
    const query = buildRetrievalQuery({ projectId, kind: 'modify', prompt: request, request });
    const retrieval = engine.retrieve({ project_id: projectId, query, mode: 'forge' }, { now: NOW });
    const memoryIds = retrieval.results.map((r) => r.memory.id);

    const base = buildForgePrompt({
      kind: 'modify', prompt: request, request, memories: retrieval.results, hasScreenshot: false,
    });
    const prompt = `${base}\n\nThe current index.html is:\n\`\`\`html\n${baselineHtml}\n\`\`\`\n\nReturn the complete updated index.html in one \`\`\`html code block. No commentary.`;

    const file = path.join(OUT, `${target.key}.txt`);
    writeFileSync(file, prompt);
    manifest.push({
      key: target.key,
      label: target.label,
      stratum: target.stratum,
      request_id: target.request_id,
      rule_id: baseline.rule,
      baseline_path: baseline.path,
      baseline_sha256: sha256(baselineHtml),
      baseline_chars: baselineHtml.length,
      request_text: request,
      rule_text: rule.text,
      context_text: baseline.context,
      project_id: projectId,
      seeded,
      retrieval: {
        mode: 'forge',
        budget: { max_memories: 6, max_characters: 3000 },
        queried_at: NOW.toISOString(),
        count: retrieval.results.length,
        memory_ids: memoryIds,
        injected_characters: retrieval.results.reduce((n, r) => n + r.injected_content.length, 0),
        memory_block_present: retrieval.results.length > 0,
      },
      prompt_file: file,
      prompt_sha256: sha256(prompt),
      prompt_chars: prompt.length,
      prompt_bytes: Buffer.byteLength(prompt),
      rule_in_prompt: prompt.includes(rule.text),
      context_in_prompt: prompt.includes(baseline.context),
      baseline_in_prompt: prompt.includes(baselineHtml),
      ends_with_return_instruction: prompt.includes('Return the complete updated index.html in one ```html code block. No commentary.'),
    });
    console.log(target.key, 'prompt_chars=', prompt.length, 'memories=', retrieval.results.length,
      'rule_in=', prompt.includes(rule.text), 'ctx_in=', prompt.includes(baseline.context));
  } finally {
    database.close();
  }
}

writeFileSync('/tmp/study02-qual/prompts/manifest.json', `${JSON.stringify({
  generated_at: new Date().toISOString(),
  source_design: 'docs/hackathon-evidence/phase17/design.json',
  prompt_builder: 'apps/server/src/forge/prompt.ts#buildForgePrompt (production signature)',
  retrieval: 'packages/memory-engine#MemoryEngine.retrieve mode:forge (=6/3000)',
  arm: 'memory',
  baselines: manifest,
}, null, 2)}\n`);
console.log('manifest written');
