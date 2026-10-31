/**
 * Study 02 full-file generation runner (Dell PolyStrata endpoint).
 *
 * Prompt path: production `MemoryEngine` (in-memory DB) seeded per arm, the
 * production retrieval query and Forge budgets (6 memories / 3,000 chars), the
 * production `buildForgePrompt` Forge memory block, the frozen baseline
 * appended, and the Phase 17 "return the complete index.html" instruction.
 * This mirrors docs/hackathon-evidence/phase17/run_open.mjs, with one required
 * update: production `buildForgePrompt` now takes structured `memories`
 * (`RetrievedMemory[]`) and renders the Forge block itself. Phase 17's
 * `run_open.mjs` passed the removed `memoryBlock` string property, which the
 * current production builder ignores -- copying it verbatim would silently
 * drop the memory block. See 09-SCORING.md and the Lead report.
 *
 * Transport: Dell PolyStrata chat completions, thinking explicitly disabled,
 * every sampler field sent explicitly, explicit per-run seed, 400 s abort
 * timeout (fixes Phase 17 R6), at most one retry with every attempt recorded,
 * incremental atomic records so the pilot is resumable and a recorded run is
 * never re-executed.
 *
 * Usage (normally via run_pilot.mjs):
 *   pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/runner.mjs \
 *     --plan experiments/study-02-rare-trigger/pilot/pilot-plan.json --dry-run
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildForgePrompt, buildRetrievalQuery } from '../../../../apps/server/src/forge/prompt.ts';
import { MemoryEngine, openDatabase } from '../../../../packages/memory-engine/src/index.ts';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
/** experiments/study-02-rare-trigger */
export const STUDY = path.resolve(HERE, '../..');
/** repository root */
export const REPO = path.resolve(STUDY, '../..');
export const PHASE17 = path.join(REPO, 'docs/hackathon-evidence/phase17');

export const ARMS = ['none', 'memory', 'manual', 'corrected'];
export const STRATA = [
  'farm-arcade',
  'farm-challenge',
  'orchard-arcade',
  'orchard-challenge',
  'focus-reward',
  'focus-lively',
];
export const ORDER_SEED = 2760742;
export const RUNNER_VERSION = 's02-runner-0.1';

export const ENDPOINT_DEFAULT = 'http://192.168.86.39:8080/v1/chat/completions';
export const MODELS_URL_DEFAULT = 'http://192.168.86.39:8080/v1/models';
export const MODEL_DEFAULT = 'qwen3.6-35b-a3b-ud-q3_k_m';
export const MAX_TOKENS_DEFAULT = 16384;
/**
 * Per-request timeout. 900 s, following 07-ENDPOINT-QUALIFICATION.md §4
 * (observed max 282.8 s; recommend >=400 s, 900 s for headroom). This is a
 * *safety* bound, not an expected runtime: the measured pilot mean is ~4 min.
 */
export const TIMEOUT_MS_DEFAULT = 900_000;
export const MAX_RETRIES = 1; // total attempts = 2 (Phase 17 R10: record, do not hide)

export const EXPECTED_MEMORIES = { none: 0, memory: 2, manual: 1, corrected: 2 };
export const EXPECTED_RULE_IN_PROMPT = { none: false, memory: true, manual: true, corrected: false };

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const sha256Json = (value) => sha256(JSON.stringify(value));

export function readJson(file, what = file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read ${what}: ${err.message}`);
  }
}

export function writeAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

function writeJsonAtomic(file, value) {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Deterministic order and seeds
// ---------------------------------------------------------------------------

/** Locked execution order: ascending ASCII of sha256("<seed>:<scenario>:<arm>:<rep>"). */
export function orderKey(seed, scenarioId, arm, rep) {
  return sha256(`${seed}:${scenarioId}:${arm}:${rep}`);
}

export function compareAscii(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Per-execution sampling seed. Distinct across (scenario, arm, rep) by
 * construction; a same-seed repeat reuses the seed of its base rep 0 run.
 * Formula (also recorded per run):
 *   seed = uint32(sha256("<ORDER_SEED>:seed:<scenario_id>:<arm>:<rep>")[0:8])
 */
export function deriveSeed(scenarioId, arm, rep) {
  const digest = sha256(`${ORDER_SEED}:seed:${scenarioId}:${arm}:${rep}`);
  return Number.parseInt(digest.slice(0, 8), 16) >>> 0;
}

export function seedFormula(scenarioId, arm, rep) {
  return `uint32(sha256("${ORDER_SEED}:seed:${scenarioId}:${arm}:${rep}")[0:8])`;
}

// ---------------------------------------------------------------------------
// Corpus / pilot plan interface
// ---------------------------------------------------------------------------

function asText(value, what) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object') {
    for (const key of ['text', 'request_text', 'request', 'paraphrase_text']) {
      if (typeof value[key] === 'string' && value[key].length > 0) return value[key];
    }
  }
  throw new Error(`${what} is not text`);
}

export function normalizeParaphrases(raw) {
  const map = new Map();
  if (raw && typeof raw === 'object' && raw.requests && typeof raw.requests === 'object' && !Array.isArray(raw.requests)) {
    // Real corpus shape: { requests: { <request_id>: { corpus: [...], pilot_only: [...] } } }
    for (const [requestId, group] of Object.entries(raw.requests)) {
      if (!group || typeof group !== 'object') throw new Error(`paraphrase request ${requestId} is not an object`);
      for (const scope of ['corpus', 'pilot_only']) {
        const entries = Array.isArray(group[scope]) ? group[scope] : [];
        for (const entry of entries) {
          const id = entry?.paraphrase_id ?? entry?.id;
          if (!id) throw new Error(`paraphrase entry under ${requestId}.${scope} has no paraphrase_id`);
          map.set(id, asText(entry, `paraphrase ${id}`));
        }
      }
    }
    if (map.size === 0) throw new Error('corpus/paraphrases.json has no paraphrase texts');
    return map;
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const id = entry.paraphrase_id ?? entry.id ?? entry.request_id;
      if (!id) throw new Error('paraphrase entry has no id');
      map.set(id, asText(entry, `paraphrase ${id}`));
    }
  } else if (raw && typeof raw === 'object') {
    for (const [id, entry] of Object.entries(raw)) map.set(id, asText(entry, `paraphrase ${id}`));
  } else {
    throw new Error('corpus/paraphrases.json must be an object or array');
  }
  return map;
}

export function normalizeLabels(raw) {
  const map = new Map();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry.scenario_id !== 'string') throw new Error('label entry has no scenario_id');
      map.set(entry.scenario_id, entry);
    }
  } else if (raw && typeof raw === 'object') {
    if (typeof raw.scenario_id === 'string') map.set(raw.scenario_id, raw);
    else {
      for (const [id, entry] of Object.entries(raw)) {
        if (!entry || typeof entry !== 'object') throw new Error(`label ${id} is not an object`);
        map.set(id, entry);
      }
    }
  } else {
    throw new Error('corpus/labels.json must be an object or array');
  }
  return map;
}

/**
 * Load and validate the corpus contract. Pilot scenarios are disjoint from the
 * confirmatory corpus, but the runner refuses to run against a missing or
 * malformed corpus so a pilot cannot silently run beside an incomplete design.
 */
export function loadCorpus({ corpusRoot = STUDY } = {}) {
  const corpusDir = path.join(corpusRoot, 'corpus');
  const corpusFile = path.join(corpusDir, 'corpus.json');
  const variantsDir = path.join(corpusDir, 'variants');
  const paraphrasesFile = path.join(corpusDir, 'paraphrases.json');
  const labelsFile = path.join(corpusDir, 'labels.json');
  for (const file of [corpusFile, paraphrasesFile, labelsFile]) {
    if (!existsSync(file)) throw new Error(`corpus file missing: ${file}`);
  }
  if (!existsSync(variantsDir)) throw new Error(`corpus variants directory missing: ${variantsDir}`);

  const scenarios = readJson(corpusFile, 'corpus/corpus.json');
  if (!Array.isArray(scenarios) || scenarios.length !== 400) {
    throw new Error(`corpus/corpus.json must be an array of 400 scenarios (found ${Array.isArray(scenarios) ? scenarios.length : typeof scenarios})`);
  }
  const paraphrases = normalizeParaphrases(readJson(paraphrasesFile, 'corpus/paraphrases.json'));
  const labels = normalizeLabels(readJson(labelsFile, 'corpus/labels.json'));
  if (labels.size !== 400) throw new Error(`corpus/labels.json must hold 400 label records (found ${labels.size})`);

  const seen = new Set();
  const variantCache = new Map();
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== 'object') throw new Error('corpus scenario is not an object');
    const id = scenario.scenario_id;
    if (typeof id !== 'string') throw new Error('corpus scenario has no scenario_id');
    if (seen.has(id)) throw new Error(`duplicate scenario_id in corpus: ${id}`);
    seen.add(id);
    if (!STRATA.includes(scenario.stratum)) throw new Error(`${id}: unknown stratum ${scenario.stratum}`);
    const variantId = scenario.variant_id ?? scenario.baseline_id;
    if (!variantId) throw new Error(`${id}: no variant_id/baseline_id`);
    if (!variantCache.has(variantId)) {
      const variantFile = path.join(variantsDir, `${variantId}.html`);
      if (!existsSync(variantFile)) throw new Error(`${id}: variant file missing: ${variantFile}`);
      variantCache.set(variantId, variantFile);
    }
    const requestText =
      typeof scenario.paraphrase_text === 'string' && scenario.paraphrase_text.length > 0
        ? scenario.paraphrase_text
        : paraphrases.get(scenario.request_id ?? scenario.paraphrase_id);
    if (!requestText) throw new Error(`${id}: request text not resolvable from corpus/paraphrases.json`);
    const label = labels.get(id);
    if (!label) throw new Error(`${id}: no label record in corpus/labels.json`);
    if (label.stratum && label.stratum !== scenario.stratum) {
      throw new Error(`${id}: label stratum ${label.stratum} != corpus stratum ${scenario.stratum}`);
    }
    if (scenario.opportunity_class && label.opportunity_class && scenario.opportunity_class !== label.opportunity_class) {
      throw new Error(`${id}: opportunity_class disagrees between corpus and labels`);
    }
  }
  return { corpusDir, corpusFile, variantsDir, paraphrasesFile, labelsFile, scenarios, paraphrases, labels, variantCache };
}

/**
 * Normalise the pilot plan into exactly 132 execution specs (120 primary +
 * 12 repeats). Accepted shapes:
 *   A) { seed?, arms?, scenarios:[30], repeats:[12] }  (canonical)
 *   B) { seed?, runs:[132] } or { executions:[132] }   (explicit list)
 * Each scenario entry needs scenario_id + stratum + (variant_id|baseline_id)
 * and a request_text (or a paraphrase_id resolvable from paraphrases).
 */
export function normalizePilotPlan(plan, corpus) {
  const arms = Array.isArray(plan.arms) ? plan.arms : ARMS;
  if (arms.length !== 4 || !ARMS.every((arm) => arms.includes(arm))) {
    throw new Error(`pilot plan arms must be exactly ${ARMS.join(',')}`);
  }
  const seed = plan.seed ?? ORDER_SEED;
  if (seed !== ORDER_SEED) throw new Error(`pilot plan seed ${seed} != locked order seed ${ORDER_SEED}`);

  const normalizeScenario = (entry, where) => {
    if (!entry || typeof entry !== 'object') throw new Error(`${where}: scenario entry is not an object`);
    const scenarioId = entry.scenario_id ?? entry.pilot_scenario_id;
    if (typeof scenarioId !== 'string') throw new Error(`${where}: scenario_id (or pilot_scenario_id) missing`);
    if (!STRATA.includes(entry.stratum)) throw new Error(`${where}: unknown stratum ${entry.stratum}`);
    const variantId = entry.variant_id ?? entry.baseline_id ?? entry.label_record?.baseline_id;
    if (!variantId) throw new Error(`${where}: variant_id missing`);
    const variantFile = path.join(corpus.variantsDir, `${variantId}.html`);
    if (!existsSync(variantFile)) throw new Error(`${where}: variant file missing ${variantFile}`);
    const paraphraseId = entry.paraphrase_id ?? entry.request_id ?? null;
    let requestText = entry.request_text ?? entry.request ?? entry.paraphrase_text ?? null;
    if (!requestText && paraphraseId) requestText = corpus.paraphrases.get(paraphraseId) ?? null;
    if (!requestText) throw new Error(`${where}: request text missing (set request_text or a resolvable paraphrase_id)`);
    const labelRecord = entry.label_record ?? corpus.labels.get(scenarioId) ?? null;
    if (labelRecord && labelRecord.stratum && labelRecord.stratum !== entry.stratum) {
      throw new Error(`${where}: label stratum ${labelRecord.stratum} != ${entry.stratum}`);
    }
    return {
      scenario_id: scenarioId,
      stratum: entry.stratum,
      variant_id: variantId,
      paraphrase_id: paraphraseId,
      request_text: requestText,
      opportunity_class: entry.opportunity_class ?? labelRecord?.opportunity_class ?? null,
      label_record: labelRecord,
      variant_file: variantFile,
      plan_seeds: entry.seeds && typeof entry.seeds === 'object' ? entry.seeds : null,
    };
  };

  const scenarioMap = new Map();
  const specs = [];
  const makeSpec = (scenario, arm, rep, { seedMode = 'primary', repeatOf = null, repeatId = null, planSeed = undefined } = {}) => {
    if (!ARMS.includes(arm)) throw new Error(`unknown arm ${arm}`);
    if (!Number.isInteger(rep) || rep < 0) throw new Error(`rep must be a non-negative integer, got ${rep}`);
    const runId = `${scenario.scenario_id}--${arm}--r${rep}`;
    const spec = {
      run_id: runId,
      scenario_id: scenario.scenario_id,
      stratum: scenario.stratum,
      arm,
      rep,
      repeat_id: repeatId,
      repeat_of: repeatOf,
      seed_mode: seedMode,
      variant_id: scenario.variant_id,
      variant_file: scenario.variant_file,
      paraphrase_id: scenario.paraphrase_id,
      request_text: scenario.request_text,
      opportunity_class: scenario.opportunity_class,
      label_record: scenario.label_record,
    };
    const primaryPlanSeed = scenario.plan_seeds?.[arm];
    spec.derived_seed = deriveSeed(spec.scenario_id, arm, seedMode === 'same' ? 0 : rep);
    if (seedMode === 'primary') {
      spec.seed = primaryPlanSeed ?? spec.derived_seed;
      spec.seed_source = primaryPlanSeed !== undefined ? 'plan_seed' : 'derived_formula';
      spec.seeded_from_rep = rep;
    } else if (seedMode === 'same') {
      spec.seed = planSeed ?? primaryPlanSeed ?? deriveSeed(spec.scenario_id, arm, 0);
      spec.seed_source = planSeed !== undefined ? 'plan_repeat_seed' : 'plan_primary_seed';
      spec.seeded_from_rep = 0;
    } else {
      spec.seed = planSeed ?? deriveSeed(spec.scenario_id, arm, rep);
      spec.seed_source = planSeed !== undefined ? 'plan_repeat_seed' : 'derived_formula';
      spec.seeded_from_rep = rep;
    }
    spec.seed_formula = seedFormula(spec.scenario_id, arm, spec.seeded_from_rep);
    spec.order_key = orderKey(ORDER_SEED, spec.scenario_id, arm, rep);
    return spec;
  };

  const runs = Array.isArray(plan.runs) ? plan.runs : Array.isArray(plan.executions) ? plan.executions : null;
  if (runs) {
    for (const [index, entry] of runs.entries()) {
      const where = `runs[${index}]`;
      const scenario = normalizeScenario(entry, where);
      scenarioMap.set(scenario.scenario_id, scenario);
      const isRepeat = entry.kind === 'repeat' || entry.repeat === true || entry.phase === 'repeat' || entry.seed_mode === 'same';
      specs.push(
        makeSpec(scenario, entry.arm, entry.rep ?? (isRepeat ? 1 : 0), {
          seedMode: entry.seed_mode ?? (isRepeat ? 'new' : 'primary'),
          repeatOf: entry.repeat_of ?? null,
          repeatId: entry.repeat_id ?? null,
          planSeed: entry.seed,
        }),
      );
    }
  } else {
    const scenarios = Array.isArray(plan.pilot_scenarios) ? plan.pilot_scenarios : plan.scenarios;
    if (!Array.isArray(scenarios) || scenarios.length !== 30) {
      throw new Error(`pilot plan must list exactly 30 scenarios (found ${Array.isArray(scenarios) ? scenarios.length : 'none'})`);
    }
    for (const [index, entry] of scenarios.entries()) {
      const scenario = normalizeScenario(entry, `scenarios[${index}]`);
      if (scenarioMap.has(scenario.scenario_id)) throw new Error(`duplicate pilot scenario ${scenario.scenario_id}`);
      scenarioMap.set(scenario.scenario_id, scenario);
    }
    const primaryRep = plan.primary?.rep ?? 0;
    for (const scenario of scenarioMap.values()) {
      for (const arm of ARMS) specs.push(makeSpec(scenario, arm, primaryRep));
    }
    const repeats = plan.repeats;
    if (!Array.isArray(repeats) || repeats.length !== 12) {
      throw new Error(`pilot plan must list exactly 12 repeat specs (found ${Array.isArray(repeats) ? repeats.length : 'none'})`);
    }
    for (const [index, repeat] of repeats.entries()) {
      const where = `repeats[${index}]`;
      if (!repeat || typeof repeat !== 'object') throw new Error(`${where}: repeat spec is not an object`);
      const scenarioId = repeat.scenario_id ?? repeat.pilot_scenario_id;
      const scenario = scenarioMap.get(scenarioId);
      if (!scenario) throw new Error(`${where}: scenario ${scenarioId} is not one of the 30 pilot scenarios`);
      const rep = repeat.rep ?? 1;
      if (rep === primaryRep) throw new Error(`${where}: repeat rep must differ from the primary rep (${primaryRep})`);
      const seedMode =
        repeat.seed_mode ??
        (repeat.repeat_type === 'same_seed_determinism'
          ? 'same'
          : repeat.repeat_type === 'new_seed_variability'
            ? 'new'
            : 'new');
      if (!['same', 'new'].includes(seedMode)) throw new Error(`${where}: seed_mode must be "same" or "new"`);
      specs.push(
        makeSpec(scenario, repeat.arm, rep, {
          seedMode,
          repeatOf: repeat.repeat_of ?? `${scenario.scenario_id}--${repeat.arm}--r${primaryRep}`,
          repeatId: repeat.repeat_id ?? `repeat-${index + 1}`,
          planSeed: repeat.seed,
        }),
      );
    }
  }

  const primary = specs.filter((spec) => spec.seed_mode === 'primary');
  const repeats = specs.filter((spec) => spec.seed_mode !== 'primary');
  if (primary.length !== 120) throw new Error(`pilot plan must hold exactly 120 primary executions (found ${primary.length})`);
  if (repeats.length !== 12) throw new Error(`pilot plan must hold exactly 12 repeat executions (found ${repeats.length})`);
  if (specs.length !== 132) throw new Error(`pilot plan must hold exactly 132 executions (found ${specs.length})`);

  const runIds = new Set();
  for (const spec of specs) {
    if (runIds.has(spec.run_id)) throw new Error(`duplicate execution id: ${spec.run_id}`);
    runIds.add(spec.run_id);
  }
  const primarySeeds = new Set();
  for (const spec of primary) {
    if (primarySeeds.has(spec.seed)) throw new Error(`seed collision among primary executions: ${spec.seed}`);
    primarySeeds.add(spec.seed);
  }
  for (const spec of repeats.filter((entry) => entry.seed_mode === 'same')) {
    const base = primary.find((entry) => entry.run_id === spec.repeat_of);
    if (!base) throw new Error(`same-seed repeat ${spec.run_id} has no base execution ${spec.repeat_of}`);
    if (base.seed !== spec.seed) throw new Error(`same-seed repeat ${spec.run_id} seed differs from its base (${spec.seed} != ${base.seed})`);
  }
  for (const spec of repeats.filter((entry) => entry.seed_mode === 'new')) {
    const base = primary.find((entry) => entry.run_id === spec.repeat_of);
    if (!base) throw new Error(`new-seed repeat ${spec.run_id} has no base execution ${spec.repeat_of}`);
    if (base.seed === spec.seed) throw new Error(`new-seed repeat ${spec.run_id} reuses the base seed ${base.seed}`);
  }

  const repeatsSame = repeats.filter((spec) => spec.seed_mode === 'same').length;
  const repeatsNew = repeats.filter((spec) => spec.seed_mode === 'new').length;
  const ordered = specs.slice().sort((a, b) => compareAscii(a.order_key, b.order_key));
  return { specs: ordered, primary, repeats, repeatsSame, repeatsNew, seed: ORDER_SEED };
}

// ---------------------------------------------------------------------------
// Prompt construction (production memory path)
// ---------------------------------------------------------------------------

function memoryInput(projectId, content) {
  return {
    type: 'constraint',
    scope: 'project',
    project_id: projectId,
    content,
    source: { session_id: null, reference: 'study02' },
    confidence: 0.95,
    validation_status: 'verified',
    tags: ['study02'],
    expires_at: null,
  };
}

export function stratumPlan(design, stratum) {
  const entry = design.strata.find((s) => s.id === stratum);
  if (!entry) throw new Error(`stratum ${stratum} not in design`);
  const baseline = design.baselines[entry.baseline];
  return { stratumEntry: entry, baseline, rule: design.rules[baseline.rule] };
}

/** What one arm puts where, with the scenario's own paraphrase as the request. */
export function armPlan(design, spec) {
  const { baseline, rule } = stratumPlan(design, spec.stratum);
  const baseRequest = spec.request_text;
  const context = baseline.context;
  switch (spec.arm) {
    case 'none':
      return { memories: [], correct: null, request: baseRequest };
    case 'memory':
      return { memories: [rule.text, context], correct: null, request: baseRequest };
    case 'manual':
      return { memories: [context], correct: null, request: `${baseRequest}\n\n${rule.text}` };
    case 'corrected':
      return {
        memories: [rule.text, context],
        correct: { target: rule.text, content: rule.correction, reason: rule.correction_reason },
        request: baseRequest,
      };
    default:
      throw new Error(`unknown arm ${spec.arm}`);
  }
}

/**
 * Build the exact production prompt for one execution and the manipulation
 * evidence that goes with it. Makes no network call.
 */
export function buildPrompt(design, spec) {
  const baselineHtml = readFileSync(spec.variant_file, 'utf8');
  const plan = armPlan(design, spec);
  const projectId = 's02';
  const database = openDatabase({ path: ':memory:', wal: false });
  try {
    const engine = new MemoryEngine(database.db);
    engine.ensureProject(projectId, 'Study 02');
    const seeded = plan.memories.map((content) => ({
      id: engine.create(memoryInput(projectId, content)).memory.id,
      content,
    }));
    let correction = null;
    if (plan.correct) {
      const target = seeded.find((memory) => memory.content === plan.correct.target);
      if (!target) throw new Error('correction target was not seeded');
      const { expires_at, ...fields } = memoryInput(projectId, plan.correct.content);
      const corrected = engine.correct({ ...fields, reason: plan.correct.reason, supersedes: [target.id] }, 'user');
      correction = { superseded_id: target.id, replacement_id: corrected.memory.id };
    }
    // Mirrors ForgeJobManager.start (apps/server/src/forge/runner.ts): the
    // production query, the Forge retrieval profile, and the production
    // buildForgePrompt memory block (structured RetrievedMemory records).
    const query = buildRetrievalQuery({ projectId, kind: 'modify', prompt: plan.request, request: plan.request });
    const retrieval = engine.retrieve(
      { project_id: projectId, query, mode: 'forge', budget: { max_memories: 6, max_characters: 3_000 } },
      { now: new Date() },
    );
    const memoryIds = retrieval.results.map((result) => result.memory.id);
    const memoryContents = retrieval.results.map((result) => result.injected_content);
    const base = buildForgePrompt({
      kind: 'modify',
      prompt: plan.request,
      request: plan.request,
      memories: retrieval.results,
      hasScreenshot: false,
    });
    const prompt = `${base}\n\nThe current index.html is:\n\`\`\`html\n${baselineHtml}\n\`\`\`\n\nReturn the complete updated index.html in one \`\`\`html code block. No commentary.`;
    const { rule } = stratumPlan(design, spec.stratum);
    const manipulation = checkManipulation({
      arm: spec.arm,
      prompt,
      rule,
      memoryIds,
      correction,
    });
    return {
      prompt,
      prompt_sha256: sha256(prompt),
      prompt_bytes: Buffer.byteLength(prompt),
      baseline_sha256: sha256(baselineHtml),
      seeded,
      correction,
      memory_ids: memoryIds,
      memory_contents: memoryContents,
      retrieval: {
        memory_count: memoryIds.length,
        characters_used: retrieval.metadata.characters_used,
        character_budget: retrieval.metadata.character_budget,
        memory_budget: retrieval.metadata.memory_budget,
        query_mode: retrieval.metadata.query_mode,
      },
      request_text: plan.request,
      rule_in_prompt: prompt.includes(rule.text),
      correction_in_prompt: rule.correction ? prompt.includes(rule.correction) : false,
      manipulation,
    };
  } finally {
    database.close();
  }
}

/** Phase 17 manipulation checks, unchanged. Recorded, never silently dropped. */
export function checkManipulation({ arm, prompt, rule, memoryIds, correction }) {
  const problems = [];
  const expectedRule = EXPECTED_RULE_IN_PROMPT[arm];
  const ruleInPrompt = prompt.includes(rule.text);
  const correctionInPrompt = rule.correction ? prompt.includes(rule.correction) : false;
  if (ruleInPrompt !== expectedRule) {
    problems.push(`rule_in_prompt=${ruleInPrompt}, expected ${expectedRule}`);
  }
  if (memoryIds.length !== EXPECTED_MEMORIES[arm]) {
    problems.push(`${memoryIds.length} memories supplied, expected ${EXPECTED_MEMORIES[arm]}`);
  }
  if (arm === 'corrected') {
    if (!correction) problems.push('correction was not created');
    else {
      if (memoryIds.includes(correction.superseded_id)) problems.push('superseded rule id still supplied');
      if (!memoryIds.includes(correction.replacement_id)) problems.push('replacement id not supplied');
      if (!correctionInPrompt) problems.push('correction text missing from prompt');
    }
  }
  return {
    passed: problems.length === 0,
    problems,
    expected: {
      memories: EXPECTED_MEMORIES[arm],
      rule_in_prompt: EXPECTED_RULE_IN_PROMPT[arm],
    },
  };
}

// ---------------------------------------------------------------------------
// Endpoint client
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * JSON-over-HTTP client built on `node:http`/`node:https`.
 *
 * Node's global `fetch` (undici) applies a 300 s `bodyTimeout` by default.
 * The Dell engine sends no bytes until a full-file generation finishes
 * (~4-5 min), so a `fetch` request dies at ~301 s with "fetch failed" even
 * though the server is healthy — this was pilot defect D-P2, observed on the
 * first pilot execution (two attempts, 301.0 s and 306.0 s, no output).
 * `node:http` has no such default body timeout; we add an explicit socket
 * idle timeout equal to the per-request budget and destroy the request on
 * expiry (recorded as a `timeout` attempt, not a silent hang).
 */
function fetchJson(url, options = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const payload = options.body == null ? null : String(options.body);
    const headers = { ...(options.headers || {}) };
    if (payload != null) headers['content-length'] = Buffer.byteLength(payload);
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: options.method || 'GET',
        headers,
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            body = { raw: text.slice(0, 2_000) };
          }
          const status = res.statusCode ?? 0;
          resolve({ status, ok: status >= 200 && status < 300, body });
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timeout after ${timeoutMs} ms`));
    });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

/** GET /v1/models; assert the configured model id equals the served id. */
export async function preflight({ modelsUrl = MODELS_URL_DEFAULT, model = MODEL_DEFAULT } = {}) {
  const res = await fetchJson(modelsUrl, { method: 'GET' }, 15_000);
  if (!res.ok) throw new Error(`GET /v1/models failed: HTTP ${res.status}`);
  const entries = Array.isArray(res.body?.data) ? res.body.data : [];
  const ids = entries.map((entry) => entry?.id).filter((id) => typeof id === 'string');
  if (ids.length === 0) throw new Error('/v1/models returned no model ids');
  const observed = model && ids.includes(model) ? model : ids.length === 1 ? ids[0] : null;
  if (!observed) throw new Error(`configured model ${model} is not served; /v1/models ids: ${ids.join(', ')}`);
  if (model && observed !== model) throw new Error(`model assertion failed: configured ${model}, /v1/models ${observed}`);
  return { models: ids, model: observed, raw: res.body };
}

export function requestBody({ model, prompt, seed, maxTokens }) {
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    reasoning_effort: 'none',
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    presence_penalty: 1.5,
    min_p: 0,
    max_tokens: maxTokens,
    seed,
    stream: false,
  };
}

function extractHtml(content) {
  if (typeof content !== 'string') return { html: null, method: null };
  const fenced = /```html\s*([\s\S]*?)```/i.exec(content) || /```\s*([\s\S]*?)```/.exec(content);
  if (fenced) return { html: fenced[1].trim(), method: 'fence' };
  if (/<html[\s>]/i.test(content)) return { html: content.trim(), method: 'raw' };
  return { html: null, method: null };
}

/**
 * Execute one run. Writes the response JSON and HTML incrementally; the final
 * record is written atomically after the attempt loop. Returns the record.
 */
export async function executeRun(spec, promptInfo, options) {
  const {
    endpoint = ENDPOINT_DEFAULT,
    model,
    maxTokens = MAX_TOKENS_DEFAULT,
    timeoutMs = TIMEOUT_MS_DEFAULT,
    pilotDir,
    onProgress = () => {},
  } = options;
  const body = requestBody({ model, prompt: promptInfo.prompt, seed: spec.seed, maxTokens });
  const requestSha = sha256Json(body);
  const record = {
    runner_version: RUNNER_VERSION,
    run_id: spec.run_id,
    scenario_id: spec.scenario_id,
    stratum: spec.stratum,
    arm: spec.arm,
    rep: spec.rep,
    repeat_id: spec.repeat_id,
    repeat_of: spec.repeat_of,
    seed_mode: spec.seed_mode,
    seed: spec.seed,
    seed_formula: spec.seed_formula,
    seed_source: spec.seed_source,
    derived_seed: spec.derived_seed,
    order_key: spec.order_key,
    variant_id: spec.variant_id,
    baseline_sha256: promptInfo.baseline_sha256,
    request_text: promptInfo.request_text,
    prompt_file: path.relative(STUDY, path.join(pilotDir, 'prompts', `${spec.run_id}.txt`)),
    prompt_sha256: promptInfo.prompt_sha256,
    prompt_bytes: promptInfo.prompt_bytes,
    request_sha256: requestSha,
    model_requested: model,
    model_observed: null,
    memory_ids: promptInfo.memory_ids,
    memory_contents: promptInfo.memory_contents,
    seeded: promptInfo.seeded,
    correction: promptInfo.correction,
    retrieval: promptInfo.retrieval,
    rule_in_prompt: promptInfo.rule_in_prompt,
    correction_in_prompt: promptInfo.correction_in_prompt,
    manipulation: promptInfo.manipulation,
    attempts: [],
    status: 'failed',
    usable: false,
    error: null,
    finish_reason: null,
    usage: null,
    timings: null,
    http: null,
    output_file: null,
    output_bytes: null,
    output_sha256: null,
    raw_file: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    seconds_total: null,
  };
  const startedMs = Date.now();
  const rawDir = path.join(pilotDir, 'raw');
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(path.join(pilotDir, 'outputs'), { recursive: true });

  let attempt = 0;
  let lastKind = null;
  while (attempt < 1 + MAX_RETRIES) {
    attempt += 1;
    const attemptStarted = Date.now();
    const attemptRecord = { attempt, started_at: new Date().toISOString() };
    try {
      const res = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, timeoutMs);
      attemptRecord.http = res.status;
      attemptRecord.ok = res.ok;
      attemptRecord.seconds = Number(((Date.now() - attemptStarted) / 1000).toFixed(3));
      const response = res.body ?? {};
      const rawFile = path.join(rawDir, `${spec.run_id}.attempt${attempt}.json`);
      writeJsonAtomic(rawFile, response);
      attemptRecord.raw_file = path.relative(STUDY, rawFile);
      attemptRecord.response_sha256 = sha256Json(response);
      record.raw_file = attemptRecord.raw_file;
      record.http = res.status;
      record.usage = response.usage ?? null;
      record.timings = response.timings ?? null;
      record.finish_reason = response.choices?.[0]?.finish_reason ?? null;
      record.model_observed = response.model ?? null;
      record.attempts.push(attemptRecord);

      if (!res.ok) {
        lastKind = 'http_error';
        attemptRecord.error = `HTTP ${res.status}: ${JSON.stringify(response).slice(0, 300)}`;
        if (res.status >= 500 && attempt < 1 + MAX_RETRIES) {
          record.error = attemptRecord.error;
          await sleep(3_000);
          continue;
        }
        record.error = attemptRecord.error;
        break;
      }
      if (response.model && response.model !== model) {
        lastKind = 'model_mismatch';
        record.error = `served model ${response.model} != asserted ${model}`;
        break;
      }
      if (record.finish_reason === 'length') {
        lastKind = 'length';
        record.error = 'truncated at max_tokens (finish_reason=length); unusable by protocol';
        break;
      }
      const content = response.choices?.[0]?.message?.content;
      const { html, method } = extractHtml(content);
      if (!html || !/<html[\s>]/i.test(html)) {
        lastKind = 'no_html';
        record.error = `no complete HTML document in response (extraction=${method})`;
        attemptRecord.error = record.error;
        if (attempt < 1 + MAX_RETRIES) {
          await sleep(3_000);
          continue;
        }
        break;
      }
      const outputFile = path.join(pilotDir, 'outputs', `${spec.run_id}.html`);
      writeAtomic(outputFile, html);
      record.output_file = path.relative(STUDY, outputFile);
      record.output_bytes = Buffer.byteLength(html);
      record.output_sha256 = sha256(html);
      record.status = 'succeeded';
      record.usable = true;
      record.error = null;
      record.extraction = method;
      lastKind = 'ok';
      break;
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || /aborted|timeout/i.test(String(err?.message));
      lastKind = timeout ? 'timeout' : 'transport';
      attemptRecord.error = String(err?.message ?? err).slice(0, 400);
      if (timeout) attemptRecord.timeout_ms = timeoutMs;
      attemptRecord.seconds = Number(((Date.now() - attemptStarted) / 1000).toFixed(3));
      record.attempts.push(attemptRecord);
      record.error = attemptRecord.error;
      if (attempt < 1 + MAX_RETRIES) {
        await sleep(3_000);
        continue;
      }
      break;
    } finally {
      if (attemptRecord.seconds === undefined) {
        attemptRecord.seconds = Number(((Date.now() - attemptStarted) / 1000).toFixed(3));
      }
    }
  }
  record.attempt_count = record.attempts.length;
  record.failure_kind = record.status === 'succeeded' ? null : lastKind;
  record.finished_at = new Date().toISOString();
  record.seconds_total = Number(((Date.now() - startedMs) / 1000).toFixed(3));
  writeJsonAtomic(path.join(pilotDir, 'records', `${spec.run_id}.json`), record);
  return record;
}

// ---------------------------------------------------------------------------
// Pilot driver
// ---------------------------------------------------------------------------

export function pilotPaths(pilotDir) {
  return {
    pilotDir,
    promptsDir: path.join(pilotDir, 'prompts'),
    rawDir: path.join(pilotDir, 'raw'),
    recordsDir: path.join(pilotDir, 'records'),
    outputsDir: path.join(pilotDir, 'outputs'),
    manifestFile: path.join(pilotDir, 'manifest.json'),
    summaryFile: path.join(pilotDir, 'summary.json'),
  };
}

function summarize(specs, records) {
  const byStatus = {};
  const byArm = {};
  const byStratum = {};
  let manipulationFailures = 0;
  for (const record of records) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    byArm[record.arm] = byArm[record.arm] ?? { total: 0, usable: 0 };
    byArm[record.arm].total += 1;
    byArm[record.arm].usable += record.usable ? 1 : 0;
    byStratum[record.stratum] = byStratum[record.stratum] ?? { total: 0, usable: 0 };
    byStratum[record.stratum].total += 1;
    byStratum[record.stratum].usable += record.usable ? 1 : 0;
    if (!record.manipulation?.passed) manipulationFailures += 1;
  }
  return {
    planned: specs.length,
    recorded: records.length,
    remaining: specs.length - records.length,
    usable: records.filter((record) => record.usable).length,
    unusable: records.filter((record) => !record.usable).length,
    manipulation_failures: manipulationFailures,
    by_status: byStatus,
    by_arm: byArm,
    by_stratum: byStratum,
  };
}

/**
 * Run (or dry-run) the pilot. Validates everything before the first model call
 * and refuses the forbidden configurations itself so every caller inherits the
 * guards. Returns the summary and the ordered specs.
 */
export async function runPilot(options = {}) {
  const {
    planFile = path.join(STUDY, 'pilot', 'pilot-plan.json'),
    corpusRoot = STUDY,
    pilotDir = path.join(STUDY, 'pilot'),
    designFile = path.join(PHASE17, 'design.json'),
    endpoint = ENDPOINT_DEFAULT,
    modelsUrl = MODELS_URL_DEFAULT,
    model = MODEL_DEFAULT,
    maxTokens = MAX_TOKENS_DEFAULT,
    timeoutMs = TIMEOUT_MS_DEFAULT,
    concurrency = 1,
    limit = null,
    dryRun = false,
    onProgress = () => {},
  } = options;

  if (options.confirmatory) throw new Error('REFUSED: --confirmatory is not a supported mode in the pilot tooling');
  const design = readJson(designFile, 'production design (rules/contexts)');
  if (!design.rules || !design.baselines || !design.strata) throw new Error(`${designFile}: not a Phase 17 design file`);
  const planRaw = readJson(planFile, 'pilot plan');
  const corpus = loadCorpus({ corpusRoot });
  const plan = normalizePilotPlan(planRaw, corpus);

  let specs = plan.specs;
  if (limit !== null && limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
    specs = specs.slice(0, limit);
  }

  const paths = pilotPaths(pilotDir);
  for (const dir of [paths.promptsDir, paths.rawDir, paths.recordsDir, paths.outputsDir]) mkdirSync(dir, { recursive: true });

  // Prompts are built before any model call and written for every planned run.
  const promptInfos = new Map();
  for (const spec of specs) {
    const info = buildPrompt(design, spec);
    promptInfos.set(spec.run_id, info);
    writeAtomic(path.join(paths.promptsDir, `${spec.run_id}.txt`), info.prompt);
  }

  const manifest = {
    runner_version: RUNNER_VERSION,
    created_at: new Date().toISOString(),
    endpoint,
    models_url: modelsUrl,
    model,
    max_tokens: maxTokens,
    timeout_ms: timeoutMs,
    concurrency,
    dry_run: dryRun,
    order_seed: ORDER_SEED,
    order_formula: 'sha256("<seed>:<scenario_id>:<arm>:<rep>") ascending ASCII',
    seed_formula: 'uint32(sha256("<ORDER_SEED>:seed:<scenario_id>:<arm>:<rep>")[0:8])',
    plan_file: path.relative(STUDY, planFile),
    corpus_root: path.relative(STUDY, corpusRoot) || '.',
    repeats: { total: plan.repeats.length, same_seed: plan.repeatsSame, new_seed: plan.repeatsNew },
    counts: { planned: plan.specs.length, selected: specs.length, primary: plan.primary.length, repeats: plan.repeats.length },
    runs: specs.map((spec) => ({
      run_id: spec.run_id,
      scenario_id: spec.scenario_id,
      stratum: spec.stratum,
      arm: spec.arm,
      rep: spec.rep,
      repeat_id: spec.repeat_id,
      repeat_of: spec.repeat_of,
      seed_mode: spec.seed_mode,
      seed: spec.seed,
      seed_formula: spec.seed_formula,
      seed_source: spec.seed_source,
      derived_seed: spec.derived_seed,
      order_key: spec.order_key,
      variant_id: spec.variant_id,
      baseline_sha256: promptInfos.get(spec.run_id).baseline_sha256,
      prompt_sha256: promptInfos.get(spec.run_id).prompt_sha256,
      prompt_bytes: promptInfos.get(spec.run_id).prompt_bytes,
      memory_ids: promptInfos.get(spec.run_id).memory_ids,
      rule_in_prompt: promptInfos.get(spec.run_id).rule_in_prompt,
      correction_in_prompt: promptInfos.get(spec.run_id).correction_in_prompt,
      manipulation: promptInfos.get(spec.run_id).manipulation,
    })),
  };
  writeJsonAtomic(paths.manifestFile, manifest);

  if (dryRun) {
    const summary = {
      runner_version: RUNNER_VERSION,
      dry_run: true,
      created_at: new Date().toISOString(),
      manifest: path.relative(STUDY, paths.manifestFile),
      counts: manifest.counts,
      repeat_composition: manifest.repeats,
      prompts_written: specs.length,
      model_calls: 0,
      manipulation_failures: specs.filter((spec) => !promptInfos.get(spec.run_id).manipulation.passed).length,
      note: 'dry run: prompts and manifest only; zero model calls',
    };
    writeJsonAtomic(paths.summaryFile, summary);
    return { summary, manifest, specs, promptInfos };
  }

  const preflightResult = await preflight({ modelsUrl, model });
  manifest.model_observed = preflightResult.model;
  manifest.models_served = preflightResult.models;
  writeJsonAtomic(paths.manifestFile, manifest);

  const recorded = [];
  const selected = specs;
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < selected.length) {
      const spec = selected[nextIndex];
      nextIndex += 1;
      const recordFile = path.join(paths.recordsDir, `${spec.run_id}.json`);
      if (existsSync(recordFile)) {
        recorded.push(readJson(recordFile, 'existing run record'));
        onProgress(spec, { status: 'skipped_existing' });
        continue;
      }
      try {
        const record = await executeRun(spec, promptInfos.get(spec.run_id), {
          endpoint, model, maxTokens, timeoutMs, pilotDir, onProgress,
        });
        recorded.push(record);
      } catch (err) {
        // executeRun writes its own record; a throw here is a hard harness bug.
        const failed = {
          runner_version: RUNNER_VERSION,
          run_id: spec.run_id,
          scenario_id: spec.scenario_id,
          stratum: spec.stratum,
          arm: spec.arm,
          rep: spec.rep,
          seed: spec.seed,
          status: 'failed',
          usable: false,
          error: `harness error before request: ${String(err?.message ?? err)}`,
          manipulation: promptInfos.get(spec.run_id).manipulation,
        };
        writeJsonAtomic(recordFile, failed);
        recorded.push(failed);
      }
      const summary = summarize(plan.specs, recorded);
      writeJsonAtomic(paths.summaryFile, {
        runner_version: RUNNER_VERSION,
        updated_at: new Date().toISOString(),
        ...summary,
      });
      onProgress(spec, recorded[recorded.length - 1]);
    }
  };
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  const summary = summarize(plan.specs, recorded);
  const finalSummary = {
    runner_version: RUNNER_VERSION,
    completed_at: new Date().toISOString(),
    endpoint,
    model_requested: model,
    model_observed: preflightResult.model,
    ...summary,
  };
  writeJsonAtomic(paths.summaryFile, finalSummary);
  return { summary: finalSummary, manifest, specs: selected, promptInfos };
}

export { summarize };
