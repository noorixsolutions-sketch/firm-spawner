# firm-worker: queue consumer. Pure stdlib Python. No firm values, no secrets, no state.
FROM python:3.11-slim-bookworm
RUN useradd -m -u 1000 firm && mkdir -p /app /state && chown firm:firm /state
COPY entry.sh run.sh worker.py /app/
RUN chmod +x /app/entry.sh /app/run.sh
USER firm
ENV RUN_MODE=auto STATE_DIR=/state
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD test -f /state/HEALTH/worker.json || exit 1
ENTRYPOINT ["/app/entry.sh"]
