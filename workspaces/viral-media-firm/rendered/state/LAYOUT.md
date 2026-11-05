# State layout: the durable-disk contract

Every image and notebook reads and writes this layout under STATE_DIR (/state by default).
Nothing else holds state. State bucket for this firm: file:///home/z/my-project/workspaces/viral-media-firm/state

    /state
      constitution/        constitution.yaml, agents/*.yaml, plugins/bindings.yaml (seeded once)
      queue/pending/       <task-id>.json            tasks waiting
      queue/claimed/       <task-id>.<worker>.json   claimed by exactly one worker (atomic rename)
      queue/done/          <task-id>.json            result written
      queue/failed/        <task-id>.json            retries exhausted, reason recorded
      HEALTH/<service>.json     last heartbeat {service, worker, ts, mode}
      ENDPOINTS/<service>.json  {service, url, ts}
      RUNS/<run-id>.json        one record per worker run
      EVENTS/                   append-only log, one JSON object per line
      MEMORY/                   harness memory, owned by the harness
      ROUTING/                  provider routing table, owned by the model plane

Model weights live in the models bucket (), mounted at /models, never in /state.

Task file:   {"id": str, "type": str, "payload": object, "attempts": int, "created": iso8601}
Result file: task file plus {"result": object, "worker": str, "finished": iso8601}
