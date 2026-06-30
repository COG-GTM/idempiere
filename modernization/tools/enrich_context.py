#!/usr/bin/env python3
"""Pre-work context enrichment for iDempiere journey-migration tasks.

Before Devin writes migration code for a journey, it gathers the operational
context a human engineer would otherwise chase by hand:

  1. CI status          (LIVE)  - latest GitHub Actions run for the repo/branch
  2. Code quality gate  (LIVE)  - SonarCloud quality gate + key measures
  3. Data-estate profile(MOCK)  - per-journey Oracle table volumes
  4. Downstream impact  (MOCK)  - consuming systems, owners, approvers, change window

Prints a consolidated Markdown report and, with --post-to L8N2-123, posts it as a
Jira comment so the enrichment is captured on the board.

Env vars:
  GH_TOKEN / GITHUB_TOKEN     - GitHub API (CI status)
  SONAR_TOKEN                 - SonarCloud API (quality gate)
  JIRA_EMAIL, JIRA_API_TOKEN  - Jira REST (optional, for --post-to)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import journey_data  # noqa: E402

HERE = Path(__file__).resolve().parent
REGISTRY_FILE = HERE / "downstream" / "registry.json"

GITHUB_REPO = os.getenv("GITHUB_REPO", "COG-GTM/idempiere")
SONAR_ORG = os.getenv("SONAR_ORG", "cog-gtm")
SONAR_PROJECT = os.getenv("SONAR_PROJECT", "COG-GTM_idempiere")
JIRA_BASE = os.getenv("JIRA_BASE_URL", "https://cog-gtm.atlassian.net")

TIMEOUT = 20


# 1. CI status (LIVE) ------------------------------------------------------- #
def _github_token() -> str | None:
    token = os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN")
    if token:
        return token
    try:
        import subprocess

        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, ValueError):
        pass
    return None


def fetch_ci_status(branch: str | None) -> dict:
    token = _github_token()
    if not token:
        return {"available": False, "reason": "no GitHub token (GH_TOKEN / gh auth)"}
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    url = f"https://api.github.com/repos/{GITHUB_REPO}/actions/runs"
    params = {"per_page": 1}
    if branch:
        params["branch"] = branch
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        runs = resp.json().get("workflow_runs", [])
    except requests.RequestException as exc:
        return {"available": False, "reason": str(exc)}
    if not runs:
        return {"available": True, "found": False, "branch": branch}
    run = runs[0]
    return {
        "available": True,
        "found": True,
        "workflow": run.get("name"),
        "branch": run.get("head_branch"),
        "status": run.get("status"),
        "conclusion": run.get("conclusion"),
        "commit": (run.get("head_sha") or "")[:8],
        "url": run.get("html_url"),
    }


# 2. Code quality gate (LIVE) ----------------------------------------------- #
def fetch_sonar_status() -> dict:
    token = os.getenv("SONAR_TOKEN")
    if not token:
        return {"available": False, "reason": "SONAR_TOKEN not set"}
    auth = (token, "")
    try:
        qg = requests.get(
            "https://sonarcloud.io/api/qualitygates/project_status",
            params={"projectKey": SONAR_PROJECT}, auth=auth, timeout=TIMEOUT,
        )
        qg.raise_for_status()
        status = qg.json().get("projectStatus", {})
        metric_keys = "bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density,ncloc"
        meas = requests.get(
            "https://sonarcloud.io/api/measures/component",
            params={"component": SONAR_PROJECT, "metricKeys": metric_keys},
            auth=auth, timeout=TIMEOUT,
        )
        meas.raise_for_status()
        measures = {
            m["metric"]: m.get("value")
            for m in meas.json().get("component", {}).get("measures", [])
        }
    except requests.RequestException as exc:
        return {"available": False, "reason": str(exc)}
    return {
        "available": True,
        "gate_status": status.get("status", "NONE"),
        "measures": measures,
        "url": f"https://sonarcloud.io/project/overview?id={SONAR_PROJECT}",
    }


# 3. Data-estate profile (MOCK) --------------------------------------------- #
def fetch_data_profile(journey: str) -> dict:
    try:
        return {"available": True, **journey_data.profile_journey(journey)}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": str(exc)}


# 4. Downstream impact (MOCK) ----------------------------------------------- #
def fetch_downstream_impact(journey: str) -> dict:
    try:
        reg = json.loads(REGISTRY_FILE.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return {"available": False, "reason": str(exc)}
    sys_id = reg.get("journey_to_system", {}).get(journey)
    if not sys_id:
        return {"available": True, "found": False, "journey": journey}
    s = reg["systems"].get(sys_id, {})
    return {"available": True, "found": True, "system_id": sys_id, **s}


# Report -------------------------------------------------------------------- #
def _icon(ok: bool) -> str:
    return "[OK]" if ok else "[!!]"


def render_report(journey: str, ci: dict, sonar: dict, data: dict, ds: dict) -> str:
    L: list[str] = [f"## Context enrichment — journey `{journey}`", "",
                    "_Automated pre-work context gathered before migration coding begins._", ""]

    L.append("### 1. CI status (live — GitHub Actions)")
    if not ci.get("available"):
        L.append(f"- Unavailable: {ci.get('reason')}")
    elif not ci.get("found"):
        L.append(f"- No workflow runs found yet for branch `{ci.get('branch')}`.")
    else:
        ok = ci.get("conclusion") in (None, "success")
        L.append(f"- {_icon(ok)} **{ci.get('conclusion') or ci.get('status')}** — "
                 f"`{ci.get('workflow')}` on `{ci.get('branch')}` (`{ci.get('commit')}`)")
        if ci.get("url"):
            L.append(f"- Run: {ci['url']}")
    L.append("")

    L.append("### 2. Code quality gate (live — SonarCloud)")
    if not sonar.get("available"):
        L.append(f"- Unavailable: {sonar.get('reason')}")
    else:
        gate = sonar.get("gate_status", "NONE")
        L.append(f"- {_icon(gate in ('OK', 'NONE'))} Quality gate: **{gate}**")
        m = sonar.get("measures", {})
        if m:
            L.append(f"- bugs={m.get('bugs','-')}, vulnerabilities={m.get('vulnerabilities','-')}, "
                     f"code_smells={m.get('code_smells','-')}, coverage={m.get('coverage','-')}%, "
                     f"duplication={m.get('duplicated_lines_density','-')}%, lines={m.get('ncloc','-')}")
        if sonar.get("url"):
            L.append(f"- Project: {sonar['url']}")
    L.append("")

    L.append("### 3. Data-estate profile (mock — Oracle warehouse)")
    if not data.get("available") or not data.get("found"):
        L.append(f"- Unavailable / no tables for `{journey}`.")
    else:
        L.append(f"- Total rows across journey tables: **{data.get('total_rows', 0):,}**")
        L.append("")
        L.append("  | Table | Approx rows |")
        L.append("  |---|---:|")
        for t in data.get("tables", []):
            L.append(f"  | {t['table']} | {t['rows']:,} |")
    L.append("")

    L.append("### 4. Downstream impact (mock — systems registry)")
    if not ds.get("available") or not ds.get("found"):
        L.append(f"- No system mapped for journey `{journey}`.")
    else:
        L.append(f"- System: **{ds.get('name')}** (`{ds.get('system_id')}`)")
        L.append(f"- Service: {ds.get('business_service')} · Criticality: **{ds.get('criticality')}** · "
                 f"Owner: {ds.get('owner_team')} · Change window: {ds.get('change_window')}")
        consumers = ds.get("downstream_consumers", [])
        if consumers:
            L.append(f"- **{len(consumers)} downstream consumer(s)** — blast radius:")
            for c in consumers:
                L.append(f"  - **{c.get('name')}** ({c.get('type')}, owner {c.get('owner_team')}, "
                         f"SLA {c.get('sla')}): {c.get('impact_if_broken')}")
        approvers = ds.get("approvers", [])
        if approvers:
            L.append("- Required approvers: " + ", ".join(f"{a['name']} ({a['role']})" for a in approvers))
    L.append("")
    L.append("---")
    L.append("_Sources: GitHub Actions + SonarCloud (live); data estate + systems registry (mocked for demo)._")
    return "\n".join(L)


def post_to_jira(issue_key: str, body: str) -> None:
    email, token = os.getenv("JIRA_EMAIL"), os.getenv("JIRA_API_TOKEN")
    if not (email and token):
        print("[enrich] JIRA_EMAIL/JIRA_API_TOKEN not set; skipping Jira post.", file=sys.stderr)
        return
    url = f"{JIRA_BASE}/rest/api/2/issue/{issue_key}/comment"
    resp = requests.post(url, auth=(email, token), json={"body": body}, timeout=TIMEOUT)
    if resp.status_code >= 300:
        print(f"[enrich] Jira post failed ({resp.status_code}): {resp.text[:300]}", file=sys.stderr)
    else:
        print(f"[enrich] Posted enrichment report to {issue_key}.", file=sys.stderr)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--journey", default="order-to-cash", help="Journey key (e.g. order-to-cash)")
    p.add_argument("--branch", default=None, help="Branch for CI lookup")
    p.add_argument("--post-to", default=None, help="Jira issue key to comment on")
    p.add_argument("--json", action="store_true", help="Also emit raw JSON to stderr")
    args = p.parse_args()

    ci = fetch_ci_status(args.branch)
    sonar = fetch_sonar_status()
    data = fetch_data_profile(args.journey)
    ds = fetch_downstream_impact(args.journey)

    report = render_report(args.journey, ci, sonar, data, ds)
    print(report)
    if args.json:
        print(json.dumps({"ci": ci, "sonar": sonar, "data": data, "downstream": ds},
                         indent=2, default=str), file=sys.stderr)
    if args.post_to:
        post_to_jira(args.post_to, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
