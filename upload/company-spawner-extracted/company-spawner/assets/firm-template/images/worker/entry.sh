#!/bin/sh
# Dual-mode entrypoint. Identical in every image.
# container = Docker / HF Space / HF Job / local compose.
# bare      = Colab / Kaggle notebook (no Docker daemon).
set -eu
RUN_MODE="${RUN_MODE:-auto}"
if [ "$RUN_MODE" = "auto" ]; then
  if [ -f /.dockerenv ] || [ -n "${HF_SPACE_ID:-}" ] || [ -n "${JOB_ID:-}" ]; then RUN_MODE=container; else RUN_MODE=bare; fi
fi
export RUN_MODE
HERE="$(cd "$(dirname "$0")" && pwd)"
exec sh "$HERE/run.sh" "$@"
