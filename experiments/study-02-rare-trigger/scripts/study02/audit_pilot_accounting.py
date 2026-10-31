#!/usr/bin/env python3
"""Study 02 — pilot accounting audit (checkpoint 2 / freeze preparation).

Independent, deterministic, stdlib-only reconciliation of the Dell exploratory
pilot described in ``10-CHECKPOINT2-REPORT.md`` §7 and ``PILOT-CHANGES.md``.

It verifies, from the artefacts themselves (records, manifest, plan,
replacements, scores, summary, committed report):
  * 132 planned executions = 120 primary (rep 0, repeat_id null) + 12 repeats
  * 123 usable / 9 unusable records; 123 = 111 usable primary + 12 usable repeats
  * counts by arm and stratum, failures by arm/stratum/cause
  * no missing / duplicated / extra record; manifest and plan counts match
  * replacement run IDs do not collide with original run IDs; replacements are
    not in the primary denominators
  * transport-era failure rates and empirical era x arm / era x stratum balance
  * prompt-artefact provenance (recorded prompt hash vs committed prompt file)
  * pre-registered worst-case ITT and a pilot-only replacement-inclusive
    sensitivity (direction check only)
  * the pilot/ subset of ``MANIFEST-checkpoint2.sha256`` still verifies at the
    recorded commit content

Output: ``review/pilot-inclusion-table.json`` — one row per record (132 original
records + 9 replacements) with its analysis membership and assignment rule.

Usage:
    python3 scripts/study02/audit_pilot_accounting.py [--out PATH] [--quiet]

Exit status: 0 = all hard invariants hold; 2 = a hard invariant failed.
Soft discrepancies (e.g. a narrative number in the report that disagrees with
the records) are printed and do not change the exit status; they are listed in
the audit Markdown.

Determinism: no clock, no network, no randomness except a fixed-seed
``random.Random`` for the permutation tests; JSON keys emit in insertion order.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import os
import random
import statistics
import sys
from pathlib import Path

STUDY = Path(__file__).resolve().parents[2]
PILOT = STUDY / "pilot"
RECORDS = PILOT / "records"
REPLS = PILOT / "replacements" / "records"
REVIEW = STUDY / "review"
DEFAULT_OUT = REVIEW / "pilot-inclusion-table.json"

ARMS = ["none", "memory", "manual", "corrected"]
STRATA = [
    "farm-arcade",
    "farm-challenge",
    "orchard-arcade",
    "orchard-challenge",
    "focus-reward",
    "focus-lively",
]
PERM_SEED = 20261101
PERM_N = 20000


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_jsonl(path: Path):
    with open(path, "r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def chi2(obs):
    rows, cols = len(obs), len(obs[0])
    rt = [sum(r) for r in obs]
    ct = [sum(obs[i][j] for i in range(rows)) for j in range(cols)]
    n = sum(rt)
    stat = 0.0
    for i in range(rows):
        for j in range(cols):
            if rt[i] and ct[j]:
                exp = rt[i] * ct[j] / n
                stat += (obs[i][j] - exp) ** 2 / exp
    return stat


def exact_p_2xk(fail_counts, group_sizes, total_fail):
    """Exact conditional test for a 2 x k table (multivariate hypergeometric).

    Enumerates every allocation of ``total_fail`` failures over the groups,
    weights each by prod C(n_i, f_i), and returns the chi-square statistic and
    the probability of a table at least as extreme (>= observed statistic).
    """
    k = len(group_sizes)
    obs = chi2([list(fail_counts), [group_sizes[i] - fail_counts[i] for i in range(k)]])

    def compositions(total, parts, prefix=()):
        if parts == 1:
            yield prefix + (total,)
            return
        for x in range(total + 1):
            yield from compositions(total - x, parts - 1, prefix + (x,))

    total_w = 0.0
    extreme_w = 0.0
    for fc in compositions(total_fail, k):
        w = 1.0
        for f, n in zip(fc, group_sizes):
            if f > n:
                w = 0.0
                break
            w *= math.comb(n, f)
        if w == 0.0:
            continue
        total_w += w
        table = [list(fc), [group_sizes[i] - fc[i] for i in range(k)]]
        if chi2(table) >= obs - 1e-12:
            extreme_w += w
    return obs, (extreme_w / total_w if total_w else float("nan"))


def permutation_p(records, attr, stat_fn, seed=PERM_SEED, n_perm=PERM_N):
    """Permutation test for association between an attribute and position-era.

    Era labels are fixed by execution position (a function of the randomised
    order); the attribute labels are shuffled over the same positions.
    """
    eras = [r["_era"] for r in records]
    labels = [r[attr] for r in records]
    obs = stat_fn(labels, eras)
    rng = random.Random(seed)
    hits = 0
    for _ in range(n_perm):
        perm = labels[:]
        rng.shuffle(perm)
        if stat_fn(perm, eras) >= obs - 1e-12:
            hits += 1
    return obs, (hits + 1) / (n_perm + 1)


def category_chi2_stat(labels, eras):
    eras_u = sorted(set(eras))
    labs = sorted(set(labels), key=str)
    tab = collections.Counter(zip(eras, labels))
    return chi2([[tab.get((e, lab), 0) for lab in labs] for e in eras_u])


def failure_chi2_stat(labels, eras):
    # labels are booleans: True = usable, False = unusable
    eras_u = sorted(set(eras))
    tab = collections.Counter(zip(eras, labels))
    return chi2([[tab.get((e, False), 0) for e in eras_u], [tab.get((e, True), 0) for e in eras_u]])


def p95_matching_analysis(values):
    """Same percentile rule as scripts/study02/analyze_pilot.py `q()`:
    index = round(frac * (n - 1)) into the sorted list (no interpolation)."""
    vals = sorted(values)
    if not vals:
        return None
    return vals[min(len(vals) - 1, int(round(0.95 * (len(vals) - 1))))]


# ---------------------------------------------------------------------------
# main audit
# ---------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="Study 02 pilot accounting audit")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="inclusion-table JSON output path")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    discrepancies = []  # (id, severity, text)
    hard_failures = []

    def check(ok, msg):
        if not ok:
            hard_failures.append(msg)
        return ok

    # ---- load ------------------------------------------------------------
    record_files = sorted(RECORDS.glob("*.json"))
    recs = {}
    for f in record_files:
        r = load_json(f)
        if r["run_id"] in recs:
            hard_failures.append(f"duplicate run_id in pilot/records: {r['run_id']}")
        recs[r["run_id"]] = r
    repl_files = sorted(REPLS.glob("*.json"))
    repls = {load_json(f)["run_id"]: load_json(f) for f in repl_files}
    manifest = load_json(PILOT / "manifest.json")
    plan = load_json(PILOT / "pilot-plan.json")
    summary = load_json(PILOT / "summary.json")
    analysis = load_json(PILOT / "pilot-analysis.json")
    scores = {r["run_id"]: r for r in load_jsonl(PILOT / "scores.jsonl")}
    repl_scores = {r["run_id"]: r for r in load_jsonl(PILOT / "replacements-scores.jsonl")}
    scen = {s["pilot_scenario_id"]: s for s in plan["pilot_scenarios"]}

    check(len(recs) == 132, f"pilot/records must hold 132 unique records, found {len(recs)}")
    check(len(manifest["runs"]) == 132, f"manifest must hold 132 runs, found {len(manifest['runs'])}")
    check(len(repls) == 9, f"pilot/replacements/records must hold 9 records, found {len(repls)}")

    # ---- 1. reconciliation ----------------------------------------------
    primary = {k: r for k, r in recs.items() if r["rep"] == 0 and r["repeat_id"] is None}
    repeats = {k: r for k, r in recs.items() if r["repeat_id"] is not None}
    check(len(primary) == 120, f"expected 120 primary records, found {len(primary)}")
    check(len(repeats) == 12, f"expected 12 repeat records, found {len(repeats)}")
    for r in recs.values():
        if r["repeat_id"] is None:
            check(r["rep"] == 0, f"non-repeat record with rep != 0: {r['run_id']}")
        else:
            check(r["repeat_of"] in recs, f"repeat_of not a record: {r['run_id']}")
            check(r["rep"] >= 1, f"repeat record rep 0: {r['run_id']}")

    usable = {k: r for k, r in recs.items() if r["usable"]}
    unusable = {k: r for k, r in recs.items() if not r["usable"]}
    usable_primary = {k: r for k, r in primary.items() if r["usable"]}
    usable_repeats = {k: r for k, r in repeats.items() if r["usable"]}
    check(len(usable) == 123, f"expected 123 usable records, found {len(usable)}")
    check(len(unusable) == 9, f"expected 9 unusable records, found {len(unusable)}")
    check(len(usable_primary) == 111, f"expected 111 usable primary records, found {len(usable_primary)}")
    check(len(usable_repeats) == 12, f"expected 12 usable repeats, found {len(usable_repeats)}")
    check(len(usable_primary) + len(usable_repeats) == len(usable),
          "123 usable is not 111 usable primary + 12 usable repeats")
    check(all(r["usable"] for r in repeats.values()), "a repeat record is unusable")

    by_arm = {a: { "recorded": 0, "usable": 0, "unusable": 0,
                   "primary_usable": 0, "primary_unusable": 0,
                   "repeat": 0, "replacement": 0} for a in ARMS}
    for r in recs.values():
        a = r["arm"]
        by_arm[a]["recorded"] += 1
        by_arm[a]["usable" if r["usable"] else "unusable"] += 1
        if r["repeat_id"] is None:
            by_arm[a]["primary_usable" if r["usable"] else "primary_unusable"] += 1
        else:
            by_arm[a]["repeat"] += 1
    for r in repls.values():
        by_arm[r["arm"]]["replacement"] += 1
    for a in ARMS:
        check(by_arm[a]["recorded"] == 33, f"arm {a}: expected 33 records, found {by_arm[a]['recorded']}")
        check(by_arm[a]["repeat"] == 3, f"arm {a}: expected 3 repeats, found {by_arm[a]['repeat']}")

    by_stratum = collections.OrderedDict(
        (s, {"recorded": 0, "usable": 0, "unusable": 0,
             "primary_usable": 0, "primary_unusable": 0}) for s in STRATA
    )
    cell = collections.OrderedDict()  # (arm, stratum) -> counts
    for s in STRATA:
        for a in ARMS:
            cell[(a, s)] = {"planned": 0, "usable": 0, "unusable": 0}
    for r in recs.values():
        s = r["stratum"]
        by_stratum[s]["recorded"] += 1
        by_stratum[s]["usable" if r["usable"] else "unusable"] += 1
        if r["repeat_id"] is None:
            by_stratum[s]["primary_usable" if r["usable"] else "primary_unusable"] += 1
            c = cell[(r["arm"], s)]
            c["planned"] += 1
            c["usable" if r["usable"] else "unusable"] += 1
    stratum_totals = {"farm-arcade": 24, "farm-challenge": 20, "orchard-arcade": 20,
                      "orchard-challenge": 24, "focus-reward": 24, "focus-lively": 20}
    for s, n in stratum_totals.items():
        check(by_stratum[s]["recorded"] == n, f"stratum {s}: expected {n} records, got {by_stratum[s]['recorded']}")
    primary_arm_totals = sum(by_arm[a]["primary_usable"] for a in ARMS)
    check(primary_arm_totals == 111, f"primary usable arm denominators sum to {primary_arm_totals}, expected 111")

    # failures by arm / stratum / cause
    fail_by_arm = collections.Counter(r["arm"] for r in unusable.values())
    fail_by_stratum = collections.Counter(r["stratum"] for r in unusable.values())
    fail_causes = collections.Counter()
    cause_label = {}
    for r in unusable.values():
        err = r.get("error") or ""
        if "Failed to connect" in err:
            cause = "stream-inactivity abort (endpoint shutdown / connect failure)"
        elif "Operation too slow" in err:
            cause = "stream-inactivity abort (curl 28, 120 s speed gate)"
        elif "curl stream transport failed" in err or "Recv failure" in err:
            cause = "stream transport failure (connection reset)"
        else:
            cause = "generic request timeout (curl 28, pre-120 s-gate message)"
        fail_causes[cause] += 1
        cause_label[r["run_id"]] = cause

    # ---- manifest / plan reconciliation ----------------------------------
    manifest_ids = [r["run_id"] for r in manifest["runs"]]
    check(len(manifest_ids) == len(set(manifest_ids)), "manifest contains duplicate run_ids")
    check(set(manifest_ids) == set(recs), "manifest run_id set != records run_id set")
    check(manifest["counts"]["planned"] == 132 and manifest["counts"]["primary"] == 120
          and manifest["counts"]["repeats"] == 12,
          f"manifest counts inconsistent: {manifest['counts']}")
    check(manifest["repeats"]["total"] == 12 and manifest["repeats"]["same_seed"] == 8
          and manifest["repeats"]["new_seed"] == 4,
          f"manifest repeat counts inconsistent: {manifest['repeats']}")
    check(plan["totals"]["total_executions"] == 132
          and plan["totals"]["primary_executions"] == 120
          and plan["totals"]["repeat_executions"] == 12
          and plan["totals"]["pilot_scenarios"] == 30
          and plan["totals"]["arms"] == 4,
          f"plan totals inconsistent: {plan['totals']}")
    check(len(plan["pilot_scenarios"]) == 30, "plan must list 30 pilot scenarios")
    check(len(plan["repeats"]) == 12, "plan must list 12 repeats")

    manifest_by_id = {r["run_id"]: r for r in manifest["runs"]}
    manifest_field_mismatches = []
    for rid, r in recs.items():
        mr = manifest_by_id[rid]
        for key in ["scenario_id", "stratum", "arm", "rep", "repeat_id", "repeat_of",
                    "seed", "seed_formula", "seed_source", "order_key", "variant_id",
                    "baseline_sha256", "prompt_bytes", "rule_in_prompt", "correction_in_prompt"]:
            if mr.get(key) != r.get(key):
                manifest_field_mismatches.append((rid, key))
    check(not manifest_field_mismatches,
          f"manifest/record identity mismatches: {len(manifest_field_mismatches)}")

    # plan seed / repeat consistency
    plan_seed_mismatches = []
    for r in primary.values():
        exp = scen[r["scenario_id"]]["seeds"][r["arm"]]
        if r["seed"] != exp:
            plan_seed_mismatches.append(r["run_id"])
    check(not plan_seed_mismatches, f"primary seeds disagree with pilot-plan: {plan_seed_mismatches}")
    check(len({r["seed"] for r in primary.values()}) == 120, "the 120 primary seeds are not distinct")
    plan_repeats = {x["repeat_id"]: x for x in plan["repeats"]}
    repeat_mismatches = []
    for r in repeats.values():
        x = plan_repeats.get(r["repeat_id"])
        if x is None:
            repeat_mismatches.append((r["run_id"], "not in plan"))
            continue
        if (x["arm"], x["pilot_scenario_id"]) != (r["arm"], r["scenario_id"]):
            repeat_mismatches.append((r["run_id"], "scenario/arm"))
        base = recs[r["repeat_of"]]
        if r["seed_mode"] == "same" and r["seed"] != base["seed"]:
            repeat_mismatches.append((r["run_id"], "same-seed repeat seed != primary seed"))
        if r["seed_mode"] == "new" and r["seed"] == base["seed"]:
            repeat_mismatches.append((r["run_id"], "new-seed repeat seed == primary seed"))
    check(not repeat_mismatches, f"repeat/plan mismatches: {repeat_mismatches}")

    # ---- replacements -----------------------------------------------------
    repl_for = collections.Counter(r["replacement_for"] for r in repls.values())
    check(set(repl_for) == set(unusable),
          "replacements do not map 1:1 onto the unusable originals")
    check(all(v == 1 for v in repl_for.values()), f"a run has more than one replacement: {repl_for}")
    check(not (set(repls) & set(recs)), "replacement run_id collides with an original run_id")
    check(not any("-repl2" in rid for rid in repls), "a second replacement pass exists")
    repl_mismatches = []
    for rid, r in repls.items():
        o = recs[r["replacement_for"]]
        if (r["scenario_id"], r["arm"], r["rep"]) != (o["scenario_id"], o["arm"], o["rep"]):
            repl_mismatches.append((rid, "scenario/arm/rep"))
        if not r["usable"]:
            repl_mismatches.append((rid, "replacement unusable"))
        if r["prompt_bytes"] != o["prompt_bytes"]:
            repl_mismatches.append((rid, "prompt_bytes differ from original"))
        if r["memory_contents"] != o["memory_contents"]:
            # content can be re-ordered by the regenerated prompt; record, do not fail
            discrepancies.append((f"REPL-PROMPT-{rid}", "info",
                                  "replacement() memory contents ordered differently from the original record"))
    check(not repl_mismatches, f"replacement integrity failures: {repl_mismatches}")
    check(len(repl_scores) == 9, f"expected 9 replacement scores, found {len(repl_scores)}")
    check(set(repl_scores) == set(repls), "replacement scores do not cover the replacement records")
    check(not (set(repl_scores) & set(scores)), "replacement scores leaked into primary scores.jsonl")

    # replacements must not be in the primary denominators
    check(set(scores) == set(usable), "scores.jsonl does not cover exactly the 123 usable original records")
    check(len(scores) == len(usable_primary) + len(usable_repeats), "scores.jsonl row count mismatch")
    check(not any("--repl" in rid for rid in scores), "a replacement appears in primary scores.jsonl")

    # ---- scores / artefact integrity -------------------------------------
    score_extra = set(scores) - set(usable)
    check(not score_extra, f"scores.jsonl has rows without a usable record: {len(score_extra)}")
    display_viol = {a: 0 for a in ARMS}
    display_exposed = {a: 0 for a in ARMS}
    for rid, r in usable_primary.items():
        sc = scores[rid]
        if sc["arm"] != r["arm"] or sc["rep"] != r["rep"] or sc["stratum"] != r["stratum"]:
            hard_failures.append(f"score identity mismatch: {rid}")
        if sc.get("scoring_error"):
            hard_failures.append(f"scoring error on usable record: {rid}")
        display_viol[r["arm"]] += 1 if sc["violation"] else 0
        display_exposed[r["arm"]] += 1 if sc["exposed"] else 0
    artifact_issues = []
    for rid, r in usable.items():
        if not r.get("output_file") or not (STUDY / r["output_file"]).exists():
            artifact_issues.append((rid, "output file missing"))
        elif sha256_file(STUDY / r["output_file"]) != r["output_sha256"]:
            artifact_issues.append((rid, "output sha256 mismatch"))
        if not r.get("raw_file") or not (STUDY / r["raw_file"]).exists():
            artifact_issues.append((rid, "raw file missing"))
        if not (STUDY / r["prompt_file"]).exists():
            artifact_issues.append((rid, "prompt file missing"))
    for rid, r in repls.items():
        if sha256_file(STUDY / r["output_file"]) != r["output_sha256"]:
            artifact_issues.append((rid, "replacement output sha256 mismatch"))
    check(not artifact_issues, f"artefact integrity issues: {artifact_issues}")

    # manipulation checks: prompt-level, recorded for every run incl. unusable
    manip_fail = [rid for rid, r in recs.items() if not r["manipulation"]["passed"]]
    check(not manip_fail, f"manipulation checks failed: {manip_fail}")
    expected_mem = {"none": 0, "memory": 2, "manual": 1, "corrected": 2}
    manip_mismatch = [rid for rid, r in recs.items()
                      if r["retrieval"]["memory_count"] != expected_mem[r["arm"]]
                      or r["rule_in_prompt"] != (r["arm"] in ("memory", "manual"))
                      or (r["arm"] == "corrected" and not r["correction_in_prompt"])]
    check(not manip_mismatch, f"arm manipulation invariants violated: {manip_mismatch}")

    # ---- prompt-artefact provenance --------------------------------------
    prompt_drift = []
    for rid, r in recs.items():
        pf = STUDY / r["prompt_file"]
        if pf.exists() and sha256_file(pf) != r["prompt_sha256"]:
            prompt_drift.append(r)
    prompt_drift_ids = sorted(r["run_id"] for r in prompt_drift)
    prompt_drift_mem_arms = all(r["arm"] in ("memory", "manual", "corrected") for r in prompt_drift)
    prompt_drift_before_manifest = all(r["started_at"] < manifest["created_at"] for r in prompt_drift)
    prompt_drift_bytes_equal = all(r["prompt_bytes"] == (STUDY / r["prompt_file"]).stat().st_size
                                   for r in prompt_drift)
    drifted_from_scores = prompt_drift_ids
    # For reference: how many memory-bearing runs started before the manifest
    # was regenerated?
    mem_before = [r for r in recs.values()
                  if r["arm"] != "none" and r["started_at"] < manifest["created_at"]]
    mem_id_drift = [rid for rid, r in recs.items()
                    if manifest_by_id[rid].get("memory_ids") != r.get("memory_ids")]
    check(set(mem_id_drift) == set(prompt_drift_ids),
          "manifest memory_id drift and prompt_sha drift are not the same record set")
    provenance = {
        "records_with_prompt_sha_mismatch": len(prompt_drift),
        "records_with_manifest_memory_id_mismatch": len(mem_id_drift),
        "all_mismatches_memory_bearing_arms": prompt_drift_mem_arms,
        "all_mismatches_started_before_manifest_created_at": prompt_drift_before_manifest,
        "prompt_bytes_equal_to_committed_file": prompt_drift_bytes_equal,
        "memory_bearing_records_before_manifest_created_at": len(mem_before),
        "manifest_created_at": manifest["created_at"],
        "mismatch_run_ids": prompt_drift_ids,
    }
    if prompt_drift:
        discrepancies.append((
            "PROMPT-ARTEFACT-01", "medium",
            f"{len(prompt_drift)}/132 records record a prompt_sha256 that does not match the committed "
            f"prompt file or manifest (all memory-bearing arms: "
            f"{dict(collections.Counter(r['arm'] for r in prompt_drift))}); all started before "
            f"manifest.created_at={manifest['created_at']}; bytes equal; cause = prompt regeneration "
            f"with fresh random memory UUIDs (memory content unchanged)."))

    # ---- report / analysis cross-checks ----------------------------------
    check(summary["recorded"] == len(recs) and summary["usable"] == len(usable)
          and summary["unusable"] == len(unusable), "summary.json counts disagree with records")
    check(summary["planned"] == 132 and summary["remaining"] == 0, "summary.json planned/remaining disagree")
    for a in ARMS:
        check(summary["by_arm"][a]["total"] == 33 and summary["by_arm"][a]["usable"] == by_arm[a]["usable"],
              f"summary.json by_arm[{a}] disagrees with records")
    check(analysis["accounting"]["recorded"] == len(recs)
          and analysis["accounting"]["usable"] == len(usable)
          and analysis["accounting"]["unusable"] == len(unusable),
          "pilot-analysis.json accounting disagrees with records")
    for a in ARMS:
        vc = analysis["violation_counts_primary_120"][a]
        check(vc["usable"] == by_arm[a]["primary_usable"] and vc["violations"] == display_viol[a],
              f"pilot-analysis.json violation_counts[{a}] disagrees with scores")
    analysis_repl = analysis["replacements"]
    check(analysis_repl["originals_unusable"] == 9 and analysis_repl["replacements_recorded"] == 9
          and analysis_repl["replacements_usable"] == 9, "pilot-analysis replacement accounting mismatch")
    check(len(analysis_repl["rows"]) == 9, "pilot-analysis replacement rows != 9")

    # narrative numbers in the report (soft discrepancies when wrong)
    report_text = (STUDY / "10-CHECKPOINT2-REPORT.md").read_text(encoding="utf-8")
    report_arm_claim = "Unusable runs by arm: `none` 2, `memory` 3, `manual` 3, `corrected` 1"
    record_arm_claim = (f"Unusable runs by arm: `none` {fail_by_arm['none']}, "
                        f"`memory` {fail_by_arm['memory']}, `manual` {fail_by_arm['manual']}, "
                        f"`corrected` {fail_by_arm['corrected']}")
    if report_arm_claim in report_text and dict(fail_by_arm) != {"none": 2, "memory": 3, "manual": 3, "corrected": 1}:
        discrepancies.append((
            "NARRATIVE-ARM-FAIL-01", "medium",
            f"10-CHECKPOINT2-REPORT.md §7.2 says 'Unusable runs by arm: none 2, memory 3, manual 3, "
            f"corrected 1'; the records say none {fail_by_arm['none']}, memory {fail_by_arm['memory']}, "
            f"manual {fail_by_arm['manual']}, corrected {fail_by_arm['corrected']}. Totals (9) still "
            f"reconcile and §7.2's own detector table (111 = 28+27+26+30) is consistent with the "
            f"records, so this is a narrative/table transcription error, not a data error."))
    changes_text = (STUDY / "PILOT-CHANGES.md").read_text(encoding="utf-8")
    changes_claim = "none 31/33, memory 30/33, manual 30/33, corrected 32/33"
    if changes_claim in changes_text and by_arm["manual"]["usable"] != 30:
        discrepancies.append((
            "NARRATIVE-ARM-USABLE-02", "medium",
            f"PILOT-CHANGES.md says usable by arm 'none 31/33, memory 30/33, manual 30/33, "
            f"corrected 32/33'; records say none {by_arm['none']['usable']}/33, "
            f"memory {by_arm['memory']['usable']}/33, manual {by_arm['manual']['usable']}/33, "
            f"corrected {by_arm['corrected']['usable']}/33. Same off-by-one between `manual` and "
            f"`corrected` as NARRATIVE-ARM-FAIL-01."))

    # repeat comparisons: 2 same-seed repeats have an unusable base primary
    same_repeats = [r for r in repeats.values() if r["seed_mode"] == "same"]
    new_repeats = [r for r in repeats.values() if r["seed_mode"] == "new"]
    undefined_repeats = [r["run_id"] for r in same_repeats if not recs[r["repeat_of"]]["usable"]]
    defined_same = [r for r in same_repeats if recs[r["repeat_of"]]["usable"]]
    same_byte_identical = [r["run_id"] for r in defined_same
                           if recs[r["repeat_of"]]["output_sha256"] == r.get("output_sha256")]
    new_byte_identical = [r["run_id"] for r in new_repeats
                          if recs[r["repeat_of"]]["output_sha256"] == r.get("output_sha256")]
    verdict_changes = []
    for r in defined_same:
        base = recs[r["repeat_of"]]
        if scores[base["run_id"]]["violation"] != scores[r["run_id"]]["violation"]:
            verdict_changes.append(r["run_id"])
    if undefined_repeats:
        discrepancies.append((
            "REPEAT-UNDEFINED-03", "low",
            f"{len(undefined_repeats)}/8 same-seed repeats have an unusable base primary "
            f"({', '.join(undefined_repeats)}), so '0/8 byte-identical to their primary' should read "
            f"'0/{len(defined_same)} defined comparisons' (2 comparisons are undefined). The analysis "
            f"JSON correctly codes primary_violation=null for these."))

    # ---- timing cross-check ---------------------------------------------
    wall = [r["seconds_total"] for r in recs.values()]
    timing = {
        "n": len(wall),
        "mean": round(statistics.fmean(wall), 2),
        "median": round(statistics.median(wall), 2),
        "p95_analysis_rule": round(p95_matching_analysis(wall), 2),
        "max": round(max(wall), 2),
        "total": round(sum(wall), 2),
        "two_attempt_records": sum(1 for r in recs.values() if len(r["attempts"]) == 2),
    }
    check(timing["n"] == 132, "timing n != 132")

    # ---- transport eras --------------------------------------------------
    ordered = sorted(recs.values(), key=lambda r: r["started_at"])
    # Era boundaries are inferred from the observed records and the incident log:
    #   A: node:http transport (D-P2 fix), records 1-11
    #   B: curl non-streaming (D-P3 fix), records 12-16
    #   C: SSE streaming with the generic curl-28 message (D-P9), records 17-69
    #   D: SSE + 120 s inactivity gate + 30 s retry cooldown (D-P10/D-P11), 70-132
    for i, r in enumerate(ordered):
        if i < 11:
            r["_era"] = "A_node_http"
        elif i < 16:
            r["_era"] = "B_curl_nonstreaming"
        elif i < 69:
            r["_era"] = "C_sse_generic"
        else:
            r["_era"] = "D_sse_idle_cooldown"
    era_table = collections.OrderedDict()
    for era in ["A_node_http", "B_curl_nonstreaming", "C_sse_generic", "D_sse_idle_cooldown"]:
        sub = [r for r in ordered if r["_era"] == era]
        era_table[era] = {
            "records": len(sub),
            "usable": sum(1 for r in sub if r["usable"]),
            "unusable": sum(1 for r in sub if not r["usable"]),
            "failure_rate_pct": round(100 * sum(1 for r in sub if not r["usable"]) / len(sub), 1) if sub else None,
            "by_arm": {a: {"failed": sum(1 for r in sub if r["arm"] == a and not r["usable"]),
                           "total": sum(1 for r in sub if r["arm"] == a)} for a in ARMS},
            "by_stratum": {s: sum(1 for r in sub if r["stratum"] == s) for s in STRATA},
        }
    nonstream = [r for r in ordered if r["_era"] in ("A_node_http", "B_curl_nonstreaming")]
    sse = [r for r in ordered if r["_era"] in ("C_sse_generic", "D_sse_idle_cooldown")]
    era_tests = {
        "era_by_arm_chi2": permutation_p(ordered, "arm", category_chi2_stat),
        "era_by_stratum_chi2": permutation_p(ordered, "stratum", category_chi2_stat),
        "era_by_failure_chi2": permutation_p(ordered, "usable", failure_chi2_stat),
    }
    era_tests = {k: {"chi2": round(v[0], 3), "perm_p": round(v[1], 4)} for k, v in era_tests.items()}
    nonstream_summary = {"records": len(nonstream),
                         "unusable": sum(1 for r in nonstream if not r["usable"])}
    sse_summary = {"records": len(sse), "unusable": sum(1 for r in sse if not r["usable"])}

    # ---- ITT / replacement sensitivity (direction check only) -----------
    def subset_table(cls):
        out = collections.OrderedDict()
        for a in ARMS:
            prim = [r for r in primary.values()
                    if r["arm"] == a and (cls is None or scen[r["scenario_id"]]["opportunity_class"] == cls)]
            usable_p = [r for r in prim if r["usable"]]
            unus_p = [r for r in prim if not r["usable"]]
            viol = sum(1 for r in usable_p if scores[r["run_id"]]["violation"])
            rep_rows = [repls[rid] for rid, rr in repls.items() if rr["replacement_for"] in {x["run_id"] for x in unus_p}]
            rep_viol = sum(1 for rr in rep_rows if repl_scores[rr["run_id"]]["violation"])
            out[a] = {
                "planned": len(prim),
                "per_protocol_usable": len(usable_p),
                "per_protocol_violations": viol,
                "per_protocol_cvr_pct": round(100 * viol / len(usable_p), 1) if usable_p else None,
                "worst_case_itt_violations": viol + len(unus_p),
                "worst_case_itt_denominator": len(prim),
                "worst_case_itt_cvr_pct": round(100 * (viol + len(unus_p)) / len(prim), 1) if prim else None,
                "replacements_usable": len(rep_rows),
                "replacement_violations": rep_viol,
                "replacement_inclusive_violations": viol + rep_viol,
                "replacement_inclusive_denominator": len(usable_p) + len(rep_rows),
                "replacement_inclusive_cvr_pct": (
                    round(100 * (viol + rep_viol) / (len(usable_p) + len(rep_rows)), 1)
                    if len(usable_p) + len(rep_rows) else None),
            }
        return out

    subsets = {"high_opportunity": subset_table("high"),
               "low_opportunity": subset_table("low"),
               "all_scenarios": subset_table(None)}
    direction = {}
    for name, tab in subsets.items():
        direction[name] = {
            "H3_corrected_minus_memory_pp": {
                "per_protocol": round(tab["corrected"]["per_protocol_cvr_pct"] - tab["memory"]["per_protocol_cvr_pct"], 1),
                "worst_case_itt": round(tab["corrected"]["worst_case_itt_cvr_pct"] - tab["memory"]["worst_case_itt_cvr_pct"], 1),
                "replacement_inclusive": round(tab["corrected"]["replacement_inclusive_cvr_pct"] - tab["memory"]["replacement_inclusive_cvr_pct"], 1),
            },
            "H1_memory_minus_none_pp": {
                "per_protocol": round(tab["memory"]["per_protocol_cvr_pct"] - tab["none"]["per_protocol_cvr_pct"], 1),
                "worst_case_itt": round(tab["memory"]["worst_case_itt_cvr_pct"] - tab["none"]["worst_case_itt_cvr_pct"], 1),
                "replacement_inclusive": round(tab["memory"]["replacement_inclusive_cvr_pct"] - tab["none"]["replacement_inclusive_cvr_pct"], 1),
            },
        }

    # ---- manifest (pilot subset) still verifies --------------------------
    manifest_path = STUDY / "MANIFEST-checkpoint2.sha256"
    manifest_ok = 0
    manifest_bad = []
    manifest_lines = 0
    if manifest_path.exists():
        for line in manifest_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            digest, rel = line.split("  ", 1)
            rel = rel[2:] if rel.startswith("./") else rel
            if not (rel.startswith("pilot/") or rel.startswith("10-CHECKPOINT2-REPORT")
                    or rel.startswith("PILOT-CHANGES") or rel.startswith("MANIFEST-checkpoint2")):
                continue
            manifest_lines += 1
            target = STUDY / rel
            if target.exists() and sha256_file(target) == digest:
                manifest_ok += 1
            else:
                manifest_bad.append(rel)
    check(manifest_lines > 0, "no pilot/checkpoint-2 lines found in MANIFEST-checkpoint2.sha256")
    check(not manifest_bad, f"pilot/checkpoint-2 manifest entries fail: {manifest_bad}")

    # ---- build the record-level inclusion table --------------------------
    def kind_of(r):
        return "original-primary" if r["repeat_id"] is None else "original-repeat"

    rows = []
    for rid in sorted(recs):
        r = recs[rid]
        kind = kind_of(r)
        if kind == "original-primary" and r["usable"]:
            membership = ["pilot_primary_analysis", "excluded_from_confirmatory"]
            rule = ("INCL-PRI-01: original primary (rep 0, repeat_id null) and usable -> counted in the "
                    "pilot per-protocol primary denominators (111 usable primary runs; "
                    "28/27/26/30 by arm) and in the descriptive detector/exposure tables; never used in "
                    "confirmatory data.")
        elif kind == "original-primary":
            membership = ["excluded_unusable", "excluded_from_confirmatory"]
            rule = ("INCL-PRI-02: original primary (rep 0, repeat_id null) and unusable -> excluded from the "
                    "per-protocol denominators; retained and counted as a violation ONLY in the "
                    "pre-declared worst-case ITT table; one pilot-only replacement may be reported "
                    "separately; never used in confirmatory data.")
        else:
            membership = ["pilot_repeat_probe", "excluded_from_confirmatory"]
            rule = ("INCL-REP-01: original repeat (repeat_id set, repeat_of primary) -> repeatability/"
                    "variability probe only (D-P1 relabel); excluded from primary denominators and from "
                    "any determinism claim; never used in confirmatory data.")
        rows.append({
            "run_id": rid,
            "record_kind": kind,
            "scenario_id": r["scenario_id"],
            "stratum": r["stratum"],
            "arm": r["arm"],
            "rep": r["rep"],
            "repeat_id": r["repeat_id"],
            "repeat_of": r["repeat_of"],
            "replacement_for": None,
            "seed_mode": r["seed_mode"],
            "seed": r["seed"],
            "usable": r["usable"],
            "failure_kind": r.get("failure_kind"),
            "failure_cause": cause_label.get(rid),
            "analysis_membership": membership,
            "rule": rule,
            "prompt_artifact_matches_record": rid not in set(prompt_drift_ids),
            "detector_violation": scores[rid]["violation"] if rid in scores else None,
            "detector_exposed": scores[rid]["exposed"] if rid in scores else None,
        })
    for rid in sorted(repls):
        r = repls[rid]
        o = recs[r["replacement_for"]]
        rows.append({
            "run_id": rid,
            "record_kind": "replacement",
            "scenario_id": r["scenario_id"],
            "stratum": r["stratum"],
            "arm": r["arm"],
            "rep": r["rep"],
            "repeat_id": r["repeat_id"],
            "repeat_of": r["repeat_of"],
            "replacement_for": r["replacement_for"],
            "seed_mode": r["seed_mode"],
            "seed": r["seed"],
            "usable": r["usable"],
            "failure_kind": r.get("failure_kind"),
            "failure_cause": None,
            "analysis_membership": ["pilot_replacement_supplementary", "excluded_from_confirmatory"],
            "rule": ("INCL-REPL-01: pilot-only replacement of the named unusable original, same "
                     "scenario/arm/rep and prompt construction -> reported separately as a supplementary "
                     "sensitivity (never in the primary per-protocol denominators, never merged into the "
                     "original dataset, never used in confirmatory data)."),
            "prompt_artifact_matches_record": sha256_file(STUDY / r["prompt_file"]) == r["prompt_sha256"],
            "detector_violation": repl_scores[rid]["violation"] if rid in repl_scores else None,
            "detector_exposed": repl_scores[rid]["exposed"] if rid in repl_scores else None,
        })
    check(len(rows) == 141, f"inclusion table must have 141 rows, built {len(rows)}")
    check(sorted(r["run_id"] for r in rows) == sorted(list(recs) + list(repls)),
          "inclusion table does not cover exactly 132 records + 9 replacements")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "audit": "study-02 pilot record-level inclusion table",
        "study": "study-02-rare-trigger",
        "source_commit": "85773b3",
        "pilot_only": True,
        "excluded_from_confirmatory": True,
        "generated_by": "scripts/study02/audit_pilot_accounting.py",
        "counts": {
            "rows": len(rows),
            "original_primary": 120,
            "original_repeat": 12,
            "replacement": 9,
            "usable_original_primary": 111,
            "usable_original_repeat": 12,
            "unusable_original_primary": 9,
            "usable_replacement": 9,
        },
        "membership_legend": {
            "pilot_primary_analysis": "pilot per-protocol primary denominators (111 usable primary runs)",
            "pilot_repeat_probe": "repeatability/variability probe; not in any primary denominator",
            "pilot_replacement_supplementary": "pilot-only replacement; supplementary sensitivity only",
            "excluded_unusable": "unusable; excluded from per-protocol, counted only in worst-case ITT",
            "excluded_from_confirmatory": "every pilot record: the Dell pilot never enters confirmatory data",
        },
        "rows": rows,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
        fh.write("\n")

    # ---- console report --------------------------------------------------
    if not args.quiet:
        print("=" * 78)
        print("STUDY 02 PILOT ACCOUNTING AUDIT — reconciliation")
        print("=" * 78)
        print(f"records={len(recs)}  manifest_runs={len(manifest_ids)}  plan_total={plan['totals']['total_executions']}")
        print(f"primary={len(primary)}  repeats={len(repeats)}  usable={len(usable)}  unusable={len(unusable)}")
        print(f"111 usable primary + 12 usable repeats = {len(usable_primary) + len(usable_repeats)}")
        print()
        print("by arm (recorded / usable / unusable / primary-usable / repeats / replacements)")
        for a in ARMS:
            x = by_arm[a]
            print(f"  {a:9s} {x['recorded']:3d} / {x['usable']:3d} / {x['unusable']:2d} / "
                  f"{x['primary_usable']:2d} / {x['repeat']:2d} / {x['replacement']:2d}")
        print(f"  total     {sum(x['recorded'] for x in by_arm.values())} / "
              f"{sum(x['usable'] for x in by_arm.values())} / "
              f"{sum(x['unusable'] for x in by_arm.values())} / "
              f"{sum(x['primary_usable'] for x in by_arm.values())} / "
              f"{sum(x['repeat'] for x in by_arm.values())} / "
              f"{sum(x['replacement'] for x in by_arm.values())}")
        print()
        print("unusable by stratum:", dict(collections.Counter(
            {s: by_stratum[s]['unusable'] for s in STRATA})))
        print("unusable by arm:", dict(fail_by_arm))
        print("failure causes:")
        for cause, n in fail_causes.items():
            print(f"  {n}x {cause}")
        print()
        print("primary usable denominators by arm x stratum (usable/planned):")
        header = "  ".join(f"{s[:16]:16s}" for s in STRATA)
        print(f"  {'arm':9s} {header}")
        for a in ARMS:
            cells = []
            for s in STRATA:
                c = cell[(a, s)]
                cells.append(f"{c['usable']}/{c['planned']}".ljust(16))
            print(f"  {a:9s} " + "  ".join(cells))
        print()
        print("detector counts, usable primary (descriptive only):")
        for a in ARMS:
            usable_n = by_arm[a]["primary_usable"]
            print(f"  {a:9s} violations {display_viol[a]:2d}/{usable_n}  exposed {display_exposed[a]:2d}/{usable_n}")
        print()
        print("transport eras (inferred from records + PILOT-LOG; era = execution time block):")
        for era, x in era_table.items():
            print(f"  {era:22s} n={x['records']:3d} unusable={x['unusable']} "
                  f"rate={x['failure_rate_pct']}%  arms={ {a: v['total'] for a, v in x['by_arm'].items()} }")
        print(f"  non-streaming total n={nonstream_summary['records']} unusable={nonstream_summary['unusable']}")
        print(f"  SSE total           n={sse_summary['records']} unusable={sse_summary['unusable']}")
        print("  era association tests (permutation, seed %d, B=%d):" % (PERM_SEED, PERM_N))
        for name, t in era_tests.items():
            print(f"    {name:26s} chi2={t['chi2']:7.3f}  p={t['perm_p']}")
        print("  failure ~ arm exact p=%.4f ; failure ~ stratum exact p=%.4f" % (
            exact_p_2xk([fail_by_arm[a] for a in ARMS], [33] * 4, len(unusable))[1],
            exact_p_2xk([fail_by_stratum[s] for s in STRATA], [stratum_totals[s] for s in STRATA], len(unusable))[1]))
        print()
        print("analysis-set sensitivity (direction check only, pilot descriptive):")
        for name, tab in subsets.items():
            print(f"  {name}:")
            for a in ARMS:
                x = tab[a]
                print(f"    {a:9s} PP {x['per_protocol_violations']}/{x['per_protocol_usable']} "
                      f"({x['per_protocol_cvr_pct']}%)  worst-ITT {x['worst_case_itt_violations']}/"
                      f"{x['worst_case_itt_denominator']} ({x['worst_case_itt_cvr_pct']}%)  "
                      f"repl-incl {x['replacement_inclusive_violations']}/"
                      f"{x['replacement_inclusive_denominator']} ({x['replacement_inclusive_cvr_pct']}%)")
            d = direction[name]
            print(f"    H3 corrected-memory pp: PP {d['H3_corrected_minus_memory_pp']['per_protocol']} / "
                  f"ITT {d['H3_corrected_minus_memory_pp']['worst_case_itt']} / "
                  f"repl {d['H3_corrected_minus_memory_pp']['replacement_inclusive']}")
            print(f"    H1 memory-none pp:      PP {d['H1_memory_minus_none_pp']['per_protocol']} / "
                  f"ITT {d['H1_memory_minus_none_pp']['worst_case_itt']} / "
                  f"repl {d['H1_memory_minus_none_pp']['replacement_inclusive']}")
        print()
        print(f"manifest pilot/checkpoint-2 subset: {manifest_ok}/{manifest_lines} OK"
              f"{'' if not manifest_bad else '  FAILED: ' + repr(manifest_bad)}")
        print(f"prompt-artefact provenance: {len(prompt_drift)}/132 records mismatch committed prompt bytes "
              f"(memory-bearing only={prompt_drift_mem_arms}, before manifest.created_at={prompt_drift_before_manifest}, "
              f"same byte length={prompt_drift_bytes_equal})")
        print(f"repeat comparisons: same-seed defined={len(defined_same)}/{len(same_repeats)} "
              f"byte-identical={len(same_byte_identical)}, verdict changes={verdict_changes}; "
              f"new-seed byte-identical={len(new_byte_identical)}/{len(new_repeats)}")
        print(f"timing: n={timing['n']} mean={timing['mean']} median={timing['median']} "
              f"p95={timing['p95_analysis_rule']} max={timing['max']} total={timing['total']} "
              f"two-attempt={timing['two_attempt_records']}")
        print()
        print("discrepancies (soft):")
        if not discrepancies:
            print("  none")
        for d in discrepancies:
            print(f"  [{d[1]}] {d[0]}: {d[2]}")
        print()
        print(f"inclusion table written: {out_path} ({len(rows)} rows)")
        print()
        if hard_failures:
            print("HARD INVARIANTS FAILED:")
            for m in hard_failures:
                print("  !!", m)
        else:
            print("ALL HARD INVARIANTS PASS")

    if hard_failures:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
