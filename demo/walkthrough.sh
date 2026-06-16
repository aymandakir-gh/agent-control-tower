#!/usr/bin/env bash
# A short narrated walkthrough against the bundled sample fleet.
# Usage: pnpm build && bash demo/walkthrough.sh
set -euo pipefail

cd "$(dirname "$0")/.."
CLI="node dist/cli.js"

if [ ! -f dist/cli.js ]; then
  echo "Building first…"
  pnpm build
fi

say() { printf "\n\033[1;36m# %s\033[0m\n" "$1"; sleep 1; }

say "A fleet of agents at a glance (sample data):"
$CLI scan --sample
sleep 2

say "The same fleet as JSON (pipe it anywhere):"
$CLI scan --sample --json | head -c 600; echo " …"
sleep 2

say "Start the live web dashboard with:  agent-control-tower web --sample"
say "Or the live terminal board with:    agent-control-tower --sample"
echo
echo "Read-only · local-only · no telemetry. That's the whole pitch."
