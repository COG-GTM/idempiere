#!/usr/bin/env bash
# Re-render the modernization architecture diagram (needs Graphviz: apt-get install graphviz).
set -euo pipefail
cd "$(dirname "$0")"
dot -Tpng -Gdpi=110 architecture.dot -o architecture.png
dot -Tsvg architecture.dot -o architecture.svg
