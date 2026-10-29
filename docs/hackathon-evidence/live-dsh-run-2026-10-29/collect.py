"""Snapshot the server's own record of the run: project, jobs, guard, memories, versions."""
import json, sys, hashlib, pathlib, urllib.request

API = "http://127.0.0.1:8797"
PROJECT = sys.argv[1] if len(sys.argv) > 1 else "reading-nook"
OUT = pathlib.Path(__file__).parent / "ground-truth"
OUT.mkdir(exist_ok=True)


def get(path):
    with urllib.request.urlopen(API + path) as r:
        return json.load(r)["data"]


project = get(f"/api/forge/projects/{PROJECT}")
(OUT / "project.json").write_text(json.dumps(project, indent=2))

mems = get(f"/api/memories?project_id={PROJECT}&limit=100")
items = mems.get("items", mems) if isinstance(mems, dict) else mems
ids = [m["id"] for m in items]
for m in items:  # active list omits superseded records; follow the chain back
    ids += [s for s in (m.get("supersedes") or []) if s not in ids]
details = [get(f"/api/memories/{i}") for i in ids]
(OUT / "memories.json").write_text(json.dumps(details, indent=2))

rows = []
for job in sorted(project["jobs"], key=lambda j: j["created_at"]):
    full = get(f"/api/forge/jobs/{job['id']}")
    (OUT / f"job-{job['id'][:8]}.json").write_text(json.dumps(full, indent=2))
    try:
        art = get(f"/api/forge/projects/{PROJECT}/artifact?job={job['id']}")
        (OUT / f"staged-{job['id'][:8]}.html").write_text(art["html"])
        staged = f"{art['bytes']}B {art['sha256'][:12]}"
    except Exception:
        staged = "-"
    g = full.get("decision_guard") or {}
    verdicts = [(e.get("decision_id", "")[:8], e.get("verdict"), e.get("rule")) for e in g.get("evaluations", [])]
    u = full.get("usage") or {}
    rows.append({
        "job": full["id"][:8], "kind": full["kind"], "status": full["status"],
        "base": full["base_version"], "version": full["version"],
        "secs": None, "started": full["started_at"], "finished": full["finished_at"],
        "usage": u, "memory_ids": [m[:8] for m in full["memory_ids"]],
        "guard_overall": g.get("overall") or g.get("verdict"), "guard": verdicts,
        "validation_ok": (full.get("validation") or {}).get("ok"),
        "staged": staged, "request": (full.get("request") or full["prompt"])[:120],
    })
(OUT / "jobs-summary.json").write_text(json.dumps(rows, indent=2))

current = None
try:
    art = get(f"/api/forge/projects/{PROJECT}/artifact")
    (OUT / f"approved-v{art['version']}.html").write_text(art["html"])
    current = (art["version"], art["sha256"])
except Exception:
    pass
print(json.dumps({"versions": project["state"]["versions"], "current": current, "jobs": rows}, indent=2))
