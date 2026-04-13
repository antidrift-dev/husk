#!/usr/bin/env bash
set -euo pipefail

BENCH_RUNS="${BENCH_RUNS:-1}"

echo "=== E2E performance tests (Electron + Xvfb, ${BENCH_RUNS} runs) ==="
for ((i = 1; i <= BENCH_RUNS; i++)); do
  echo "--- run $i / $BENCH_RUNS ---"
  __PERF_RUN_ID="" xvfb-run \
    --auto-servernum \
    --server-args='-screen 0 1280x720x24 -ac' \
    npm run test:e2e:perf
done
