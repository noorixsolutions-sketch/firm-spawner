# Validation, verification and recovery

Stages 7 and 11, plus what to do when something fails.

## Before deploy: three commands, all must pass

```bash
python3 scripts/render.py   --template assets/firm-template --values values.yaml --out rendered/<id>
python3 scripts/validate.py --rendered rendered/<id>
python3 scripts/scan_secrets.py rendered/<id>
```

`validate.py` rejects: unresolved placeholders; `allow_paid` true; bad control or worker targets; secret names that are not UPPER_SNAKE;
agents missing a required key, duplicated, or using an unbound plugin; plugin bindings absent from `catalogue/plugins.yaml`; images
absent from the catalogue or not `authored`/`verified`; an image asked to run on a target it does not support; a needed secret not
declared; any edit to fixed image files or non-CONFIG notebook cells. With `--publish` it also requires `versions.lock` with
`sha256` digests, `llama_cpp_ref` when inference is on, and a full 40-character `firm.commit`.

A failing error list is the to-do list. Fix the source (values, agent files, or, only if the template is truly wrong, the template with
tests), re-render, rerun. Never patch rendered output.

## After deploy: verify each layer, then the business

| Layer | Check | Pass |
|---|---|---|
| State | write, read and delete a test object in the bucket or `/state` | round-trips |
| Control plane | `GET /health` on the harness URL | 200 |
| Seed | read back `constitution/`, `plugins/bindings.yaml` from `/state` | present and unchanged |
| Worker | `HEALTH/worker.json` timestamp is fresh; a run record appears in `RUNS/` | fresh, present |
| Inference (if on) | `GET :8000/health`; one `/v1/chat/completions` call | 200 and a completion |
| Plugin | one agent action that calls a bound plugin | result returned, permission respected |
| End to end | enqueue `{"id":"verify-1","type":"job","payload":{...}}`; wait for it | file in `queue/done` with `result` |
| Persistence | restart the worker or Space; state still there | yes |
| Secrets | `scripts/scan_secrets.py` on the repo and on any pasted notebook | 0 findings |

A firm is complete only when the end-to-end task passes. Write `manifest.json`:

```json
{"firm_id":"<id>","verified_at":"<date>","commit":"<sha>",
 "assets":[{"name":"harness","target":"hf-space","endpoint":"<url>","health":"200"},
           {"name":"worker-kaggle","target":"kaggle","last_run":"<id>","result":"done"}],
 "end_to_end":{"task":"verify-1","result":"done"},
 "limits":["<free-tier limits the operator accepted>"],
 "mocked":[]}
```

List anything checked against a stand-in under `mocked`. Never report a mocked check as a real integration.

## Failures and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `render.py`: unknown key or missing value | value outside `template.yaml`, or required value absent | add the missing value or remove the key; add a schema slot only as deliberate template change |
| `render.py`: quote or brace in a string | a value would break a notebook or YAML | rephrase it without quotes, backslashes, newlines, braces |
| `validate.py`: image unverified | Stage 0 not completed for that image | locate its Dockerfile, record real env, ports, health, set `verified` with evidence |
| `validate.py`: plugin not in catalogue | harness plugin interface not inventoried | add the plugin from the real interface, or drop the binding |
| `validate.py`: fixed cell or file modified | template logic edited inside a firm | revert; re-render from the template |
| Notebook stops at "Add these secrets" | secret missing or Notebook access off | add it in the platform's secret panel under the exact name |
| Notebook clone or pip fails | internet off (Kaggle), private repo with no `GITHUB_TOKEN`, wrong `firm.commit` | enable internet, add token, correct the SHA |
| `hf sync` error in the state cell | argument order differs in the installed version | read the printed `hf sync --help`, correct the sync commands in the template's state cell, retest, re-render |
| Worker idles, queue not draining | wrong partition or wrong state path; sync not pushing | check `FIRM_PARTITION` against the directory tasks were written to; check `STATE_PUSH_CMD`; read `HEALTH/worker.json` |
| Tasks end in `queue/failed` | harness unreachable or non-2xx | read `last_error`; check `HARNESS_BASE_URL` points at a reachable URL (a Colab worker cannot reach `localhost` on another machine) |
| Space build fails | Dockerfile or `app_port` wrong | read the build log; fix in the verified image source; push again |
| Space slow on first call | free tier sleeps when idle | expected; wake it before a run |
| Free quota exhausted, 429 errors | provider limits | back off; check the evidence record's limits; route to a second selected provider; tell the operator |
| llama-server exits | out of GPU memory, wrong model file, bad `LLAMA_CPP_REF` | smaller quantization or context (`inference.ctx`), correct names, pin a valid ref |
| Token check fails | wrong scope, expired, or entered under the wrong name | recreate with the scopes in `references/credentials.md`; re-enter; rerun the check |

## Rollback

Keep every deployed `versions.lock` and commit. To roll back: check out the previous commit and lock, re-render from its
`values.yaml`, redeploy only the assets whose digest or config changed, rerun the end-to-end check. State in the bucket is
untouched unless the layout changed; if it did, migrate state before cutover and keep a copy.

## Retry rules

Retry a failed deploy step once after reading the error and fixing its cause. If it fails again, stop, report the exact error with
secrets removed, mark that asset failed in `manifest.json`, and continue only with assets that do not depend on it.
