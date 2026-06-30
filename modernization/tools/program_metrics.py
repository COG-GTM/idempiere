"""Program-level migration metrics from the Devin API v3 (exec mini-dashboard).

Pulls session/PR/throughput signals for the modernization program so a stakeholder can see
"how much has Devin done" at a glance. Reads DEVIN_API_KEY from the environment (never printed).

Usage:
    DEVIN_API_KEY=... python program_metrics.py --tag oracle-migration
    DEVIN_API_KEY=... python program_metrics.py --since-days 14 --markdown

Docs: https://docs.devin.ai/api-reference/overview  (v3 endpoints, e.g. /v1/sessions, analytics).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

API_BASE = os.environ.get("DEVIN_API_BASE", "https://api.devin.ai/v1")


def _get(path: str, params: dict | None = None) -> dict:
    key = os.environ.get("DEVIN_API_KEY")
    if not key:
        print("DEVIN_API_KEY not set.", file=sys.stderr)
        raise SystemExit(2)
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def list_sessions(tag: str | None, since_days: int) -> list[dict]:
    params: dict = {"limit": 200}
    if tag:
        params["tags"] = tag
    data = _get("/sessions", params)
    return data.get("sessions", data if isinstance(data, list) else [])


def summarize(sessions: list[dict]) -> dict:
    total = len(sessions)
    by_status: dict[str, int] = {}
    prs = 0
    for s in sessions:
        st = s.get("status_enum") or s.get("status") or "unknown"
        by_status[st] = by_status.get(st, 0) + 1
        prs += len(s.get("pull_requests", []) or [])
    return {"total_sessions": total, "by_status": by_status, "pull_requests": prs}


def render_markdown(summary: dict) -> str:
    lines = ["## Migration program metrics", "", f"- **Sessions:** {summary['total_sessions']}",
             f"- **PRs opened:** {summary['pull_requests']}", "- **By status:**"]
    for st, n in sorted(summary["by_status"].items()):
        lines.append(f"  - {st}: {n}")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default=None)
    ap.add_argument("--since-days", type=int, default=30)
    ap.add_argument("--markdown", action="store_true")
    args = ap.parse_args()

    sessions = list_sessions(args.tag, args.since_days)
    summary = summarize(sessions)
    print(render_markdown(summary) if args.markdown else json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
