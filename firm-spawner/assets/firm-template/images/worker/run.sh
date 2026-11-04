#!/bin/sh
# Same code path in container and bare mode.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${STATE_DIR:=/state}"
: "${FIRM_WORKER_ID:=$(hostname)}"
mkdir -p "$STATE_DIR"
exec python3 "$HERE/worker.py" \
  --state-dir "$STATE_DIR" \
  --worker-id "$FIRM_WORKER_ID" \
  --idle-exit "${FIRM_IDLE_EXIT:-900}" \
  --harness-url "${HARNESS_BASE_URL:-}" \
  --max-attempts "${FIRM_MAX_ATTEMPTS:-3}"
