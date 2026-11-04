#!/usr/bin/env python3
"""firm-worker: drains /state/queue/pending, one task at a time.

Contract (see references/architecture-and-contracts.md):
  claim    atomic rename pending/<id>.json -> claimed/<id>.<worker>.json
  execute  POST {harness-url}/v1/tasks/run with the task JSON; expects {"result": ...}
           tasks of type "inference" go to INFERENCE_URL (/v1/chat/completions) when it is set
  finish   write done/<id>.json (or failed/<id>.json after max attempts)
  health   write HEALTH/worker.json every loop
Optional: STATE_PULL_CMD / STATE_PUSH_CMD (shell) run before claiming / after finishing,
for platforms with no mounted bucket. FIRM_PARTITION restricts to queue/pending/<partition>/.
Stdlib only.
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def sh(cmd):
    if cmd:
        subprocess.run(cmd, shell=True, check=False)


def heartbeat(state, worker, mode):
    write_json(os.path.join(state, "HEALTH", "worker.json"),
               {"service": "worker", "worker": worker, "ts": now(), "mode": mode})


def claim(state, worker, partition):
    pending = os.path.join(state, "queue", "pending", partition)
    claimed = os.path.join(state, "queue", "claimed")
    os.makedirs(pending, exist_ok=True)
    os.makedirs(claimed, exist_ok=True)
    for name in sorted(os.listdir(pending)):
        if not name.endswith(".json"):
            continue
        src = os.path.join(pending, name)
        dst = os.path.join(claimed, name[:-5] + "." + worker + ".json")
        try:
            os.rename(src, dst)  # atomic on one filesystem; the loser gets FileNotFoundError
        except FileNotFoundError:
            continue
        return dst
    return None


def execute(harness_url, task, timeout=600):
    if not harness_url:
        raise RuntimeError("HARNESS_BASE_URL not set")
    req = urllib.request.Request(
        harness_url.rstrip("/") + "/v1/tasks/run",
        data=json.dumps(task).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode())
    if "result" not in body:
        raise RuntimeError("harness response has no result")
    return body["result"]


def execute_inference(url, task, timeout=900):
    req = urllib.request.Request(
        url.rstrip("/") + "/v1/chat/completions",
        data=json.dumps(task.get("payload", {})).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def finish(state, claimed_path, task, worker, max_attempts, error=None, result=None):
    os.remove(claimed_path)
    if error is None:
        task.update(result=result, worker=worker, finished=now())
        write_json(os.path.join(state, "queue", "done", task["id"] + ".json"), task)
        return "done"
    task["attempts"] = int(task.get("attempts", 0)) + 1
    task["last_error"] = str(error)[:500]
    if task["attempts"] >= max_attempts:
        task.update(worker=worker, finished=now())
        write_json(os.path.join(state, "queue", "failed", task["id"] + ".json"), task)
        return "failed"
    write_json(os.path.join(state, "queue", "pending", task["id"] + ".json"), task)
    return "retry"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--state-dir", default="/state")
    ap.add_argument("--worker-id", default=socket.gethostname())
    ap.add_argument("--idle-exit", type=int, default=900)
    ap.add_argument("--harness-url", default="")
    ap.add_argument("--max-attempts", type=int, default=3)
    ap.add_argument("--poll", type=float, default=2.0)
    ap.add_argument("--once", action="store_true", help="drain once and exit (tests, cron)")
    a = ap.parse_args(argv)

    mode = os.environ.get("RUN_MODE", "container")
    partition = os.environ.get("FIRM_PARTITION", "")
    pull, push = os.environ.get("STATE_PULL_CMD", ""), os.environ.get("STATE_PUSH_CMD", "")
    run_id = a.worker_id + "-" + str(int(time.time()))
    stats = {"id": run_id, "worker": a.worker_id, "started": now(), "done": 0, "failed": 0, "retry": 0}
    idle_since = time.time()

    while True:
        sh(pull)
        heartbeat(a.state_dir, a.worker_id, mode)
        path = claim(a.state_dir, a.worker_id, partition)
        if path is None:
            if a.once or time.time() - idle_since > a.idle_exit:
                break
            time.sleep(a.poll)
            continue
        idle_since = time.time()
        with open(path) as f:
            task = json.load(f)
        inference_url = os.environ.get("INFERENCE_URL", "")
        try:
            if task.get("type") == "inference" and inference_url:
                result = execute_inference(inference_url, task)
            else:
                result = execute(a.harness_url, task)
            outcome = finish(a.state_dir, path, task, a.worker_id, a.max_attempts, result=result)
        except (urllib.error.URLError, RuntimeError, ValueError, OSError) as e:
            outcome = finish(a.state_dir, path, task, a.worker_id, a.max_attempts, error=e)
        stats[outcome] += 1
        sh(push)

    stats["ended"] = now()
    write_json(os.path.join(a.state_dir, "RUNS", run_id + ".json"), stats)
    sh(push)
    return 0


if __name__ == "__main__":
    sys.exit(main())
