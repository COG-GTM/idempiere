"""Post a migration-progress message to Slack via an incoming webhook.

Reads the webhook URL from the SLACK_INCOMING_WEBHOOK_URL secret (never printed).
Used by the modernization demo to post plan/PR/map links back to the team channel.

Usage:
    python notify_slack.py --text "Migration plan PR opened: <url>"
    python notify_slack.py --journey order-to-cash --plan-url <url> --map-url <url>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request


def post(text: str, blocks: list | None = None) -> int:
    url = os.environ.get("SLACK_INCOMING_WEBHOOK_URL")
    if not url:
        print("SLACK_INCOMING_WEBHOOK_URL not set; skipping Slack post.", file=sys.stderr)
        return 1
    payload: dict = {"text": text}
    if blocks:
        payload["blocks"] = blocks
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status


def build_progress_blocks(journey: str, plan_url: str, map_url: str) -> tuple[str, list]:
    title = f":compass: Modernization update — {journey}"
    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": "Oracle/COTS Modernization"}},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*Journey:* {journey}\n"
                    f"*Migration plan:* {plan_url}\n"
                    f"*Interactive journey map:* {map_url}"
                ),
            },
        },
    ]
    return title, blocks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text")
    ap.add_argument("--journey")
    ap.add_argument("--plan-url", default="")
    ap.add_argument("--map-url", default="https://cog-gtm.github.io/idempiere/")
    args = ap.parse_args()

    if args.journey:
        text, blocks = build_progress_blocks(args.journey, args.plan_url, args.map_url)
        status = post(text, blocks)
    elif args.text:
        status = post(args.text)
    else:
        ap.error("provide --text or --journey")
        return 2
    print(f"Slack post HTTP {status}")
    return 0 if status == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
