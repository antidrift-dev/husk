#!/usr/bin/env bash
# Run Husk performance tests + benchmarks in Docker.
# Results persist to bench-runs/ in the project root.
#
# Usage:
#   ./scripts/run-perf-docker.sh                          # 1 run, build image first
#   ./scripts/run-perf-docker.sh --no-build               # 1 run, skip rebuild
#   BENCH_RUNS=500 ./scripts/run-perf-docker.sh --no-build  # 500 runs, one container
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
IMAGE="husk-perf"

# Pre-create files/dirs so Docker mounts them correctly
[[ -f "$ROOT/perf-results.json" ]] || echo "[]" > "$ROOT/perf-results.json"
mkdir -p "$ROOT/bench-runs"



if [[ "${1:-}" != "--no-build" ]]; then
  echo "Building $IMAGE..."
  docker build -f "$ROOT/Dockerfile.perf" -t "$IMAGE" "$ROOT"
fi

echo "Running (BENCH_RUNS=${BENCH_RUNS:-1})..."
docker run --rm \
  -e BENCH_RUNS="${BENCH_RUNS:-1}" \
  -e ELECTRON_DISABLE_SANDBOX=1 \
  -v "$ROOT/perf-results.json:/app/perf-results.json" \
  -v "$ROOT/bench-runs:/app/bench-runs" \
  "$IMAGE"
