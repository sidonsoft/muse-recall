/**
 * Phase 11C — decision-aware memory evaluation harness.
 *
 * Research layer only: nothing here runs inside the Forge runtime. It
 * measures what the EXISTING memory engine already provides for
 * decision-aware development, and demonstrates (as evaluation code) the
 * smallest proposed "decision guard": retrieval of the decision + its
 * rationale, conflict hints, and compliance checks whose violations cite
 * the decision memory id.
 *
 * Compliance patterns are fixture-level proxies. Boundary labels state
 * exactly what is deterministic, what needs real Muse inference, and what
 * needs browser/runtime inspection (see BOUNDARIES).
 *
 * Reproduce: pnpm tsx tests/evaluation/forge-decision/decision-harness.ts [--json]
 *            pnpm vitest run tests/evaluation/forge-decision
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRetrievalQuery } from '../../../apps/server/src/forge/prompt.js';
import { MemoryEngine, openDatabase } from '../../../packages/memory-engine/src/index.js';
import { buildForgePromptForEval } from '../forge-memory/harness.js';

export const DECISION_PROJECT = 'forge-decision-eval';

export interface DecisionDef {
  scenario: string;
  content: string;
  rationale: string;
  tags: string[];
  correctedContent?: string;
  correctedRationale?: string;
  correctionReason?: string;
}

export const SCENARIOS: Record<'s1' | 's2' | 's3', DecisionDef> = {
  s1: {
    scenario: 'child-friendly game',
    content:
      'This game is intended for children aged 5-8. Avoid flashing effects, countdown timers, and penalties for mistakes.',
    rationale:
      'Why: young children are distressed by time pressure and punishment; the game must stay welcoming.',
    tags: ['design-decision', 'no-flashing', 'no-countdown', 'no-penalty'],
  },
  s2: {
    scenario: 'accessibility',
    content: 'All essential game actions must remain usable without colour discrimination.',
    rationale:
      'Why: roughly 8 percent of male players have colour vision deficiency; colour-only cues lock them out.',
    tags: ['design-decision', 'no-colour-only-cue'],
  },
  s3: {
    scenario: 'corrected design decision',
    content: 'The game should use a warm sunset palette.',
    rationale: 'Why: sunset tones matched the original story mood.',
    correctedContent: 'The game should use a cool ocean palette instead.',
    correctedRationale: 'Why: the story moved underwater; cool tones now carry the mood.',
    correctionReason: 'Director replaced the sunset mood with an ocean mood.',
    tags: ['design-decision'],
  },
};

export const REQUESTS: Record<'s1' | 's2' | 's3', string> = {
  s1: 'Make the game more exciting and challenging.',
  s2: 'Make the red and green collectibles behave differently.',
  s3: 'Add a new level-selection screen.',
};

export interface DecisionSetup {
  engine: MemoryEngine;
  directory: string;
  decisionId: string;
  correctedId: string | null;
  close: () => void;
}

/** Repeatable setup; file-backed db so cross-session behaviour stays real. */
export function setupDecision(key: 's1' | 's2' | 's3'): DecisionSetup {
  const def = SCENARIOS[key];
  const directory = mkdtempSync(join(tmpdir(), 'forge-decision-eval-'));
  const { db, close } = openDatabase({ path: join(directory, 'memory.db') });
  const engine = new MemoryEngine(db);
  const base = {
    type: 'constraint' as const,
    scope: 'project' as const,
    project_id: DECISION_PROJECT,
  };
  const decisionId = engine.create({
    ...base,
    content: `${def.content} ${def.rationale}`,
    tags: def.tags,
  }).memory.id;
  let correctedId: string | null = null;
  if (def.correctedContent) {
    correctedId = engine.correct({
      ...base,
      content: `${def.correctedContent} ${def.correctedRationale ?? ''}`.trim(),
      tags: def.tags,
      supersedes: [decisionId],
      reason: def.correctionReason ?? null,
    }).memory.id;
  }
  return { engine, directory, decisionId, correctedId, close };
}

/** Mirrors the production retrieval call (same shape/budget as runner.ts). */
export function retrieveDecision(engine: MemoryEngine, request: string) {
  return engine.retrieve({
    project_id: DECISION_PROJECT,
    query: buildRetrievalQuery({
      projectId: DECISION_PROJECT,
      kind: 'modify',
      prompt: request,
      request,
    }),
    budget: { max_memories: 6, max_characters: 3_000 },
  });
}

export function decisionPromptFor(engine: MemoryEngine, request: string): string {
  return buildForgePromptForEval(retrieveDecision(engine, request), request);
}

// ---------------------------------------------------------------------------
// Proposed decision guard (evaluation code, NOT production).
// Each check cites the decision memory that it enforces.

export interface GuardIssue {
  check: string;
  decision_id: string;
  decision_excerpt: string;
  evidence: string;
}

type Guard = (html: string, decision: { id: string; content: string }) => GuardIssue[];

const CHECKS: Record<string, { pattern: RegExp; label: string }> = {
  'no-flashing': {
    pattern: /@keyframes\s+[\w-]*(blink|flash)|setInterval\([^)]*(toggle|blink|flash)/i,
    label: 'flashing effect introduced',
  },
  'no-countdown': {
    pattern: /\bcountdown\b|setInterval\([^)]{0,120}(time|timer)[^)]*(--|-=|decrement)/i,
    label: 'countdown timer introduced',
  },
  'no-penalty': {
    pattern: /score\s*(-=|-\s|=\s*score\s*-)/i,
    label: 'mistake penalty detected',
  },
};

export const decisionGuard: Guard = (html, decision) => {
  const issues: GuardIssue[] = [];
  const tags = decisionTagsFor(decision);
  for (const tag of tags) {
    const check = CHECKS[tag];
    if (!check) continue;
    const match = html.match(check.pattern);
    if (match) {
      issues.push({
        check: tag,
        decision_id: decision.id,
        decision_excerpt: decision.content.slice(0, 80),
        evidence: `${check.label}: ${match[0].slice(0, 60)}`,
      });
    }
  }
  return issues;
};

function decisionTagsFor(decision: { id: string; content: string }): string[] {
  // The harness controls tags via setupDecision; re-read them from the engine
  // is impossible with only {id,content}, so encode tag intent in lookups:
  const tags: string[] = [];
  if (/flashing effects/.test(decision.content)) tags.push('no-flashing');
  if (/countdown timers/.test(decision.content)) tags.push('no-countdown');
  if (/penalties for mistakes/.test(decision.content)) tags.push('no-penalty');
  return tags;
}

/** Accessibility guard: colour-only distinction between collectibles. */
export const accessibilityGuard: Guard = (html, decision) => {
  const hasRed = /#FF0000|#F00|\bred\b|#DC143C|#FF4C4C/i;
  const hasGreen = /#00FF00|#0F0|\bgreen\b|#2E8B57|#4CAF50/i;
  const nonColourCue = /\b(shape|icon|symbol|letter|label|circle|square|triangle|star|pattern)\b/i;
  if (hasRed.test(html) && hasGreen.test(html) && !nonColourCue.test(html)) {
    return [
      {
        check: 'no-colour-only-cue',
        decision_id: decision.id,
        decision_excerpt: decision.content.slice(0, 80),
        evidence: 'red/green pair distinguished without shape, icon, or label cue',
      },
    ];
  }
  return [];
};

/** Corrected-palette guard: the superseded sunset palette must not return. */
export const paletteGuard: Guard = (html, decision) => {
  const warm = /#FF7E5F|#FFA500|\bsunset\b|\btomato\b|\bsalmon\b|\borange\b/i;
  const cool = /#4EA8DE|\bocean\b|\bteal\b|\baqua\b|\bblue\b|#1E90FF/i;
  const issues: GuardIssue[] = [];
  if (warm.test(html) && !cool.test(html)) {
    issues.push({
      check: 'cool-ocean-palette',
      decision_id: decision.id,
      decision_excerpt: decision.content.slice(0, 80),
      evidence: 'warm sunset palette reintroduced; corrected ocean palette absent',
    });
  }
  return issues;
};

/**
 * Demonstrative conflict hint (proposed feature, heuristic only): maps risky
 * request vocabulary to constraint tags so the approval UI can surface
 * "this request often violates remembered decisions" BEFORE generation.
 * Real conflict detection needs model judgement (labelled below).
 */
export function conflictHints(request: string, decision: { content: string; tags: string[] }) {
  const riskyWords = /excit|challeng|difficult|hard|fast|intense|thrill/i;
  const hints: string[] = [];
  if (riskyWords.test(request) && /avoid/i.test(decision.content)) {
    hints.push('request language historically pushes toward flashing/timers/penalties');
  }
  if (/red|green|colou?r/i.test(request) && /colour discrimination/i.test(decision.content)) {
    hints.push('request is colour-framed while decision forbids colour-only cues');
  }
  return hints;
}

// ---------------------------------------------------------------------------
// Boundary labels: what each scenario can and cannot be proven with.

export const BOUNDARIES = {
  deterministic: [
    'decision retrieval (constraint pinning) and prompt inclusion of decision + rationale',
    'supersession exclusion and correction audit trail (reason recorded)',
    'fixture-level guard checks: prohibited-pattern detection with decision citation',
    'conflict-hint heuristic output',
  ],
  requires_real_model: [
    'whether the model actually avoids prohibited mechanics in real generated code',
    'whether the model proposes safe alternatives when a request conflicts',
    'semantic conflict judgement beyond the word heuristic',
  ],
  requires_browser_runtime: [
    'rendered flashing/pacing (source regex is a proxy; visual timing needs frames)',
    'rendered palette pixels (style blocks can be overridden by Phaser calls)',
    'interactive accessibility: real colour-blind simulation and input paths',
  ],
} as const;

// ---------------------------------------------------------------------------
// Scenario fixtures (compact HTML, guarded above).

export const FIXTURES: Record<
  's1' | 's2' | 's3',
  { base: string; compliant: string; violating: string }
> = {
  s1: {
    base: '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></head><body><div id="game"></div><div id="score">Score: 0</div><button id="restart">Restart</button></body></html>',
    compliant:
      '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></head><body><div id="game"></div><div id="score">Score: 0</div><button id="restart">Restart</button><button id="next-level">Next Level</button><p>New levels add variety, pace stays calm.</p></body></html>',
    violating:
      '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script><style>@keyframes blinkBanner{50%{opacity:0}}</style></head><body><div id="game"></div><div id="score">Score: 0</div><div id="countdown">10</div><button id="restart">Restart</button><script>setInterval(function tickTimeLeft(){ time--; }, 1000); function wrong(){ score -= 1; }</script></body></html>',
  },
  s2: {
    base: '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></head><body><div id="game"></div><button id="restart">Restart</button></body></html>',
    compliant:
      '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></head><body><div id="game"></div><p>Red collectible is a circle; green collectible is a square with a star icon; letters R and G label each shape.</p><button id="restart">Restart</button></body></html>',
    violating:
      '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></head><body><div id="game"></div><script>collectibleA.fill = "#FF0000"; collectibleB.fill = "#00FF00";</script><button id="restart">Restart</button></body></html>',
  },
  s3: {
    base: '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></head><body><div id="game"></div><button id="restart">Restart</button></body></html>',
    compliant:
      '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script><style>:root{--accent:#4EA8DE;--deep:#102A43}</style></head><body><div id="game"></div><button id="level-select">Ocean level selection</button><button id="restart">Restart</button></body></html>',
    violating:
      '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script><style>:root{--accent:#FF7E5F}/* sunset banner */</style></head><body><div id="game"></div><button id="level-select">Sunset level selection</button><button id="restart">Restart</button></body></html>',
  },
};

export interface ScenarioEvidence {
  scenario: string;
  request: string;
  retrieved_memory_ids: string[];
  prompt_contains: { decision: boolean; rationale: boolean; superseded_decision_text: boolean };
  conflict_hints: string[];
  guard_violations_on_violating_fixture: GuardIssue[];
  guard_violations_on_compliant_fixture: GuardIssue[];
}

export function captureScenario(key: 's1' | 's2' | 's3'): ScenarioEvidence {
  const def = SCENARIOS[key];
  const request = REQUESTS[key];
  const setup = setupDecision(key);
  try {
    const retrieval = retrieveDecision(setup.engine, request);
    const prompt = buildForgePromptForEval(retrieval, request);
    const active = retrieval.results.map((r) => r.memory);
    const decisionSource = active.find((m) => m.id === (setup.correctedId ?? setup.decisionId));
    const guard = key === 's2' ? accessibilityGuard : key === 's3' ? paletteGuard : decisionGuard;
    const cited = decisionSource
      ? { id: decisionSource.id, content: decisionSource.content }
      : { id: setup.correctedId ?? setup.decisionId, content: def.content };
    const supersededText = def.correctedContent !== undefined && prompt.includes(def.content);
    return {
      scenario: def.scenario,
      request,
      retrieved_memory_ids: retrieval.results.map((r) => r.memory.id),
      prompt_contains: {
        decision: prompt.includes(
          `${def.correctedContent ?? def.content} ${def.correctedRationale ?? def.rationale}`,
        ),
        rationale: prompt.includes(def.correctedRationale ?? def.rationale),
        superseded_decision_text: supersededText,
      },
      conflict_hints: conflictHints(request, {
        content: decisionSource?.content ?? def.content,
        tags: def.tags,
      }),
      guard_violations_on_violating_fixture: guard(FIXTURES[key].violating, cited),
      guard_violations_on_compliant_fixture: guard(FIXTURES[key].compliant, cited),
    };
  } finally {
    setup.close();
    rmSync(setup.directory, { recursive: true, force: true });
  }
}

export function buildDecisionReport(baseCommit: string) {
  return {
    generated_at: new Date().toISOString(),
    base_commit: baseCommit,
    boundaries: BOUNDARIES,
    scenarios: (['s1', 's2', 's3'] as const).map(captureScenario),
  };
}

// CLI entry: `pnpm tsx tests/evaluation/forge-decision/decision-harness.ts [--json]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = buildDecisionReport(process.env.PHASE11_BASE_COMMIT ?? '0ce6444');
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const s of report.scenarios) {
      process.stdout.write(
        `${s.scenario}: memories=${s.retrieved_memory_ids.length} ` +
          `decision_in_prompt=${s.prompt_contains.decision} ` +
          `superseded_leaks=${s.prompt_contains.superseded_decision_text} ` +
          `hints=${s.conflict_hints.length} ` +
          `violations(bad_fixture)=${s.guard_violations_on_violating_fixture.length} ` +
          `violations(good_fixture)=${s.guard_violations_on_compliant_fixture.length}\n`,
      );
    }
  }
}
