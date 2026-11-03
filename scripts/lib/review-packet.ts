/**
 * The human-review packet: what a person needs in order to judge a Muse-built app,
 * and the objective facts that either support or undercut the evidence they are
 * about to look at.
 *
 * The point of keeping this in a library with tests is honesty. Every remaining
 * open item in this release is a question of **judgement** — is the generated app
 * good, did it follow the project's decisions, would you use it — and this
 * repository has repeatedly refused to launder judgement into an automatic score.
 * So the packet renders blank rows for a human and spends its machine effort on
 * the opposite problem: proving the evidence is worth judging. A screenshot of a
 * page that threw three console errors, or of an effectively blank canvas, cannot
 * support a visual verdict, and the packet says so before anyone writes a number
 * on it.
 */

export interface PacketDecision {
  id: string;
  revision: number;
  type: string;
  content: string;
}

export interface PacketFacts {
  project: string;
  app_name: string;
  brief_path: string;
  created_at: string;
  commit: string;
  bundle_identity: {
    server_build_hash: string;
    web_build_hash: string;
    supports_commit_identity: boolean;
    note: string;
  };
  decisions: PacketDecision[];
  job: {
    id: string;
    kind: string;
    status: string;
    usage_calls: number | null;
    model_observed: string | null;
    /**
     * Which CLI produced this app. A fixture CLI named in the packet tells the
     * reviewer the run proves plumbing, not model quality.
     */
    coding_cli?: string | null;
  };
  artifact: {
    version: number | null;
    sha256: string;
    bytes: number;
    saved_to: string;
  };
  /** Provider media dispatches seen in the trace. The packet promises zero. */
  media_dispatches: number;
  screenshots: { name: string; label: string; bytes: number }[];
  /**
   * How the screenshots were taken. The artifact endpoint answers with a JSON
   * envelope, so a screenshot of the product's preview and a screenshot of the
   * bytes as a document are different observations and must not be conflated.
   */
  loaded_via?: string;
  /**
   * Who paid for the app. A key delivered by the harness and a CLI riding its
   * own login are different spends, and a reviewer comparing two packets needs
   * to know which one they are reading.
   */
  credential_basis?: string;
  /**
   * Which commit produced the bytes under review, and which commit's harness measured them. A
   * re-measured packet keeps the first from the paid run and gains the second, so a reader can tell
   * "the app was built at X" from "the numbers were taken by the code at Y" (KI-84's lesson).
   */
  built_at_commit?: string;
  measured_by_commit?: string;
  /** The cost record as it travelled, and every packet directory it passed through. */
  cost?: CostRecord | null;
  cost_chain?: string[];
  page: {
    title: string;
    interactive_controls: number;
    distinct_colors: number;
    console_errors: number;
    http_failures: number;
    non_local_requests: string[];
    /**
     * Distinct colours in the used-state capture, when the harness drove the app
     * into one. The initial-state count is a blank-page detector, not a reading
     * of what the app shows once it is doing its job.
     */
    distinct_colors_used_state?: number;
    /**
     * Native `alert`/`confirm`/`prompt`/`beforeunload` dialogs the app raised.
     * This is a fact, not a judgement: a project decision may forbid them, and
     * whether the app used one is measurable rather than a matter of taste.
     */
    native_dialogs?: string[];
    /**
     * Measured facts about how the app presents itself. None of these are
     * judgements: a reviewer still decides whether five saturated hues is a
     * violation or the point of the app. They are here because "look at the
     * screenshot" is not evidence, and because a decision about contrast or
     * inline status is checkable against numbers.
     */
    app_facts?: {
      named_controls: string[];
      /** Icon-only or unnamed-text controls with an accessible name. */
      controls_without_visible_label: number;
      /**
       * Text fields, counted separately because a field can never have text
       * content of its own, so folding them into the count above would make the
       * number meaningless.
       */
      fields_without_visible_label?: number;
      /** Text the app put in a status region, which is how it reports results. */
      status_texts: string[];
      contrast: {
        /** Leaf text elements over a solid background that could be measured. */
        checked: number;
        /** How many measured below 4.5:1. */
        below_4_5: number;
        /** The three worst, with the measured ratio and the text itself. */
        worst: { ratio: number; text: string }[];
        /** Text it could not measure: gradients, images, transparent layers. */
        skipped: number;
      };
      contrast_note?: string;
    };
  };
}

/**
 * What a packet says was paid for the app inside it. Every field is nullable on purpose: "unknown"
 * has to be representable, or a missing measurement prints as a reassuring zero.
 */
export interface CostRecord {
  coding_jobs?: number | null;
  max_calls_per_job?: number | null;
  idempotency_key?: string | null;
  media_dispatches?: number | null;
  coding_calls_known?: number | null;
  coding_calls_unknown_jobs?: number | null;
}

interface SourceReport {
  paid?: CostRecord | null;
  observations?: { paid_basis_carried_forward?: CostRecord | null; cost_chain?: string[] } | null;
}

/**
 * Carry the cost record across a re-measurement hop.
 *
 * A paid packet writes its own `paid` block. A re-measured packet does not spend anything, so it
 * carries the original in `observations.paid_basis_carried_forward`. Reading only `paid` therefore
 * loses the record on the second hop: the 2026-11-03 re-measurement of the Palette Bench packet
 * printed nulls where the paid run had recorded one job, three calls and an idempotency key (KI-85).
 */
export function carryCost(source: SourceReport | null | undefined): CostRecord | null {
  if (!source) return null;
  const carried = source.observations?.paid_basis_carried_forward ?? null;
  const own = source.paid ?? null;
  // Prefer the record that says more: a re-measured source has `paid: null` and its truth carried.
  const candidates = [carried, own].filter((c): c is CostRecord => c !== null);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] ?? null;
}

function score(record: CostRecord): number {
  return Object.values(record).filter((v) => v !== null && v !== undefined).length;
}

/** Every packet directory this cost record has been copied through, oldest last. */
export function costChain(source: SourceReport | null | undefined, sourceDir: string): string[] {
  const prior = source?.observations?.cost_chain ?? [];
  return [sourceDir, ...prior];
}

/** Whether a cost record says anything at all. Silent means the packet cannot state its own price. */
export function costRecordIsSilent(record: CostRecord | null | undefined): boolean {
  if (!record) return true;
  return Object.values(record).every((v) => v === null || v === undefined);
}

export function describeCost(record: CostRecord | null | undefined): string {
  if (costRecordIsSilent(record)) {
    return 'not recorded — this packet cannot state what was paid for the app inside it';
  }
  const r = record as CostRecord;
  const jobs = r.coding_jobs === null || r.coding_jobs === undefined ? '?' : String(r.coding_jobs);
  const calls =
    r.coding_calls_known === null || r.coding_calls_known === undefined
      ? 'unknown internal calls'
      : `${String(r.coding_calls_known)} internal call(s)`;
  const cap =
    r.max_calls_per_job === null || r.max_calls_per_job === undefined
      ? ''
      : `, capped at ${String(r.max_calls_per_job)}`;
  const media =
    r.media_dispatches === null || r.media_dispatches === undefined
      ? 'media calls unknown'
      : `${String(r.media_dispatches)} provider media call(s)`;
  const key = r.idempotency_key
    ? `, Idempotency-Key ${r.idempotency_key}`
    : ', no Idempotency-Key recorded';
  return `${jobs} coding job(s), ${calls}${cap}, ${media}${key}`;
}

/** The dimensions a human scores. Fixed, so two apps can be compared by hand. */
export const REVIEW_DIMENSIONS: readonly string[] = [
  'Task fit — does it do every job the brief asked for, and only those?',
  'Interaction quality — when you use it, does it behave the way the labels promise?',
  'Visual quality — hierarchy, spacing, alignment, colour, legibility.',
  'Failure behaviour — odd input (empty seed, huge seed, rapid clicking, double action).',
  'Hand-off — would you send this to a colleague as-is, iterate, or reject it?',
];

/** One row per decision: did the app follow the text that was actually in force? */
export function decisionChecklist(decisions: readonly PacketDecision[]): string[] {
  return decisions.map(
    (decision) =>
      `Decision ${decision.id.slice(0, 8)} (revision ${String(decision.revision)}, ${decision.type}): ${decision.content}`,
  );
}

/**
 * Reasons the evidence itself is weak. These are **not** verdicts about the app's
 * quality: they are statements about whether what was captured can support one.
 */
export function packetIssues(facts: PacketFacts): string[] {
  const issues: string[] = [];
  if (facts.artifact.version === null) {
    issues.push('no approved version: the packet captured an artifact the product never approved');
  }
  if (facts.cost !== undefined && costRecordIsSilent(facts.cost)) {
    issues.push(
      'the cost record is silent: the packet cannot say how many paid calls produced this app, so ' +
        'its evidence cannot support any claim about what a review cost',
    );
  }
  if (facts.artifact.bytes === 0) {
    issues.push('the artifact is empty: there is nothing to review');
  }
  if (facts.job.usage_calls === null) {
    issues.push(
      `job ${facts.job.id.slice(0, 8)} reports no usable usage.calls, so what this run spent is unknown`,
    );
  }
  if (facts.job.status !== 'succeeded') {
    issues.push(`the coding job ended ${facts.job.status}, not succeeded`);
  }
  if (facts.job.status === 'succeeded' && facts.job.model_observed === null) {
    issues.push(
      'the coding job succeeded but names no model, so the run cannot say what produced this',
    );
  }
  if (facts.media_dispatches > 0) {
    issues.push(
      `the packet promises zero provider media calls and the ledger shows ${String(facts.media_dispatches)}`,
    );
  }
  if (facts.page.distinct_colors < 3) {
    issues.push(
      `the captured page holds ${String(facts.page.distinct_colors)} distinct colour(s): it is effectively blank, and no screenshot of it can support a visual judgement`,
    );
  }
  if (facts.page.interactive_controls < 3) {
    issues.push(
      `only ${String(facts.page.interactive_controls)} interactive control(s) were found on the captured page: it may not be the app the brief described`,
    );
  }
  if (facts.page.console_errors > 0) {
    issues.push(
      `${String(facts.page.console_errors)} console error(s) during load: the screenshots show a page that was already failing`,
    );
  }
  if (facts.page.http_failures > 0) {
    issues.push(
      `${String(facts.page.http_failures)} request(s) returned HTTP >= 400 while the page loaded`,
    );
  }
  if (facts.page.non_local_requests.length > 0) {
    issues.push(
      `the brief forbade network use and ${String(facts.page.non_local_requests.length)} non-local request(s) were recorded: ${facts.page.non_local_requests.slice(0, 5).join(', ')}`,
    );
  }
  if (!facts.bundle_identity.supports_commit_identity) {
    issues.push(
      `this packet cannot anchor a release identity: ${facts.bundle_identity.note || 'the build did not record a clean tree at the tested commit'}`,
    );
  }
  return issues;
}

function row(label: string, value: string): string {
  return `| ${label} | ${value} |`;
}

/**
 * The document a human fills in. It carries no score of its own: the only numbers
 * in it are measurements of bytes, calls, colours and controls.
 */
export function renderReviewPacket(facts: PacketFacts, issues: readonly string[]): string {
  const lines: string[] = [];
  lines.push(`# Human quality review — ${facts.app_name}`);
  lines.push('');
  lines.push(
    `Built by the coding model on ${facts.created_at}. This packet is the evidence; the judgement is yours.`,
  );
  lines.push('');
  lines.push('## What to look at');
  lines.push('');
  lines.push(`- Project: \`${facts.project}\``);
  lines.push(`- Brief: \`${facts.brief_path}\``);
  lines.push(
    `- Approved artifact: \`${facts.artifact.saved_to}\` (version ${String(facts.artifact.version)}, sha256 \`${facts.artifact.sha256}\`, ${String(facts.artifact.bytes)} bytes)`,
  );
  lines.push(`- Coding CLI that produced it: \`${facts.job.coding_cli ?? 'not recorded'}\``);
  lines.push(`- Screenshots taken from: ${facts.loaded_via ?? 'not recorded'}`);
  lines.push(`- Paid by: ${facts.credential_basis ?? 'not recorded'}`);
  for (const shot of facts.screenshots) {
    lines.push(`- Screenshot \`${shot.name}\` — ${shot.label} (${String(shot.bytes)} bytes)`);
  }
  lines.push('');
  lines.push('## Objective facts about the capture');
  lines.push('');
  lines.push('| fact | value |');
  lines.push('| --- | --- |');
  lines.push(
    row('coding job', `${facts.job.id.slice(0, 8)} (${facts.job.kind}, ${facts.job.status})`),
  );
  lines.push(
    row(
      'coding calls / model',
      `${facts.job.usage_calls === null ? 'unknown' : String(facts.job.usage_calls)} internal call(s) / ${facts.job.model_observed ?? 'unnamed'}`,
    ),
  );
  lines.push(row('provider media dispatches', String(facts.media_dispatches)));
  if (facts.built_at_commit || facts.measured_by_commit) {
    lines.push(
      row(
        'bytes built at / measured by',
        `${facts.built_at_commit ?? 'unknown commit'} / ${facts.measured_by_commit ?? 'unknown commit'}`,
      ),
    );
  }
  if (facts.cost !== undefined) {
    lines.push(row('what was paid for the app', describeCost(facts.cost)));
  }
  if (facts.cost_chain && facts.cost_chain.length > 0) {
    lines.push(
      row(
        'this cost record was copied through',
        facts.cost_chain.map((dir) => `\`${dir}\``).join(' → '),
      ),
    );
  }
  lines.push(row('page title', facts.page.title || '(none)'));
  lines.push(row('interactive controls on the page', String(facts.page.interactive_controls)));
  lines.push(row('distinct colours in the initial capture', String(facts.page.distinct_colors)));
  if (Array.isArray(facts.page.native_dialogs)) {
    lines.push(
      row(
        `native dialogs raised (alert/confirm/prompt/beforeunload): ${String(facts.page.native_dialogs.length)}`,
        facts.page.native_dialogs.length > 0 ? facts.page.native_dialogs.join(' | ') : 'none',
      ),
    );
  }
  const app = facts.page.app_facts;
  if (app) {
    lines.push(
      row(
        'named controls',
        app.named_controls.length > 0 ? app.named_controls.join(', ') : 'none named',
      ),
    );
    lines.push(
      row(
        'controls with an accessible name but no visible text of their own',
        `${String(app.controls_without_visible_label)} control(s)` +
          (typeof app.fields_without_visible_label === 'number'
            ? `, ${String(app.fields_without_visible_label)} text field(s)`
            : ''),
      ),
    );
    lines.push(
      row(
        'text the app put in a status region',
        app.status_texts.length > 0 ? app.status_texts.join(' / ') : 'none',
      ),
    );
    lines.push(
      row(
        `text contrast: ${String(app.contrast.checked)} element(s) measured over a solid background, ${String(app.contrast.below_4_5)} below 4.5:1, ${String(app.contrast.skipped)} not measurable (gradient, image or transparent)`,
        app.contrast_note ??
          (app.contrast.checked === 0
            ? 'nothing measurable: the contrast numbers below say nothing about legibility'
            : app.contrast.worst.length > 0
              ? app.contrast.worst
                  .map((entry) => `${entry.ratio.toFixed(2)}:1 — "${entry.text}"`)
                  .join(' | ')
              : 'no measured element fell below 4.5:1'),
      ),
    );
  }
  if (typeof facts.page.distinct_colors_used_state === 'number') {
    lines.push(
      row(
        'distinct colours in the used-state capture',
        String(facts.page.distinct_colors_used_state),
      ),
    );
  }
  lines.push(
    row(
      'console errors / failed requests',
      `${String(facts.page.console_errors)} / ${String(facts.page.http_failures)}`,
    ),
  );
  lines.push(
    row(
      'non-local requests',
      facts.page.non_local_requests.length === 0
        ? 'none'
        : facts.page.non_local_requests.slice(0, 5).join(', '),
    ),
  );
  lines.push(row('tested commit', `\`${facts.commit.slice(0, 12)}\``));
  lines.push(
    row(
      'server / web bundle',
      `${facts.bundle_identity.server_build_hash.slice(0, 12)}… / ${facts.bundle_identity.web_build_hash.slice(0, 12)}…`,
    ),
  );
  lines.push('');
  lines.push('### Reasons this capture may not be worth judging as it stands');
  lines.push('');
  if (issues.length === 0) {
    lines.push('none — the capture loaded cleanly, rendered content, and spent no media call.');
  } else {
    for (const issue of issues) lines.push(`- ${issue}`);
  }
  lines.push('');
  lines.push('## Decisions that were in force while it was built');
  lines.push('');
  lines.push(
    'These were seeded as project decisions before the job ran and are **not** in the brief, so following them is a real test rather than an instruction the brief handed over. The revision pins the exact wording a reviewer is being asked about.',
  );
  lines.push('');
  for (const line of decisionChecklist(facts.decisions)) {
    lines.push(`- [ ] follows it?  ${line}`);
  }
  lines.push('');
  lines.push('## Judgement sheet');
  lines.push('');
  lines.push('Write a number 1–5 and at least one sentence. A bare number is not a review.');
  lines.push('');
  lines.push('| dimension | score 1-5 | what you saw |');
  lines.push('| --- | --- | --- |');
  for (const dimension of REVIEW_DIMENSIONS) {
    lines.push(`| ${dimension} |  |  |`);
  }
  lines.push('');
  lines.push('### Decisions');
  lines.push('');
  lines.push('| decision | followed? | evidence you looked at |');
  lines.push('| --- | --- | --- |');
  for (const decision of facts.decisions) {
    lines.push(
      `| ${decision.id.slice(0, 8)} r${String(decision.revision)}: ${decision.content} |  |  |`,
    );
  }
  lines.push('');
  lines.push('### Things to try, in order');
  lines.push('');
  lines.push('1. Set a seed, generate, and check the same seed reproduces the palette.');
  lines.push(
    '2. Lock one swatch, generate again, and see whether only the four unlocked ones move.',
  );
  lines.push('3. Click a swatch and look for where the confirmation appears.');
  lines.push('4. Clear the palette, then look for the way back.');
  lines.push('5. Resize to 390 px wide and use it with the keyboard only.');
  lines.push('');
  lines.push('## What this packet does not claim');
  lines.push('');
  lines.push(
    '- **No automatic score.** Nothing in this repository can rate the quality of a generated app, and it will not pretend to.',
  );
  lines.push(
    '- The objective facts above describe the **load** of the page: colour spread, controls present, errors thrown, requests made. They say nothing about whether the app is good to use.',
  );
  lines.push('- The screenshot colour count is a blank-page detector, not an aesthetic measure.');
  lines.push(
    '- The advisory visual review (`verify:review-live-smoke`) was **not** run for this app unless the run recorded it; if you want model-generated findings to compare against your own, that is a separate paid call.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}
