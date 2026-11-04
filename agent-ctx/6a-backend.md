# Task 6-a — Firm Forge BACKEND (API routes + server libs)

Agent: Task 6-a (Backend) · Status: **COMPLETE — all endpoints live, `bun run lint` clean, E2E 9/9 steps passing twice in a row.**

## What was built

All types come from `src/lib/firm-forge/types.ts` (never redefined). Python scripts are the authority —
no validation logic was reimplemented beyond input shape checks at the API boundary.

### Server libs (`src/lib/firm-forge/`, all server-only, no 'use client')

| File | Purpose |
|---|---|
| `paths.ts` | `PROJECT_ROOT` (cwd-verified fallback `/home/z/my-project`), `SKILL_DIR`, `WORKSPACES_DIR`, `workspaceDir/renderedDir/stateDir/valuesPath(firmId)`, `harnessBaseUrl`, `defaultStateBucket`, `ensureWorkspace` (mkdir -p). |
| `python.ts` | `spawnCapture(cmd,args,{cwd,env,timeoutMs})` → `{code,stdout,stderr,timedOut}` (SIGKILL on timeout, code 124); `runPython` (python3, 120s default); `runPythonJson` → tolerant JSON extraction (first `{` … last `}`). |
| `values.ts` | `generateValuesYaml(firm, agentFileNames)` — EXACT MASTER_SPEC shape (state_bucket derived from firmId per spec; `models_bucket: ""`; booleans true/false; flow lists). `sanitize` strips `"` `\` newlines `{{` `}}`; `yamlScalar` plain-or-single-quoted (never double-quoted so render.py's unsafe-char check never trips); `sanitizeAgentYaml` / `agentYamlFromDef` emit agent files (id, role, responsibilities block-list, plugins, permissions, reports_to). |
| `catalogue.ts` | `loadCatalogue()` — parses the 3 YAMLs with the `yaml` npm pkg, converts `capabilities.yaml`'s top-level map to array + `rules`; cached by mtime. |
| `helpers.ts` | Safe Json coercions (`asString/asStringArray/asSteps/asManifest`…), DB row→DTO mappers (`toFirmDef/toAgentDef/toDecisionDef/toEvidenceDef/toTestRunDef`), firm/evidence input validation, `defaultAgents()` trio, `FirmNotFoundError`. |
| `harness.ts` | Reference harness core: ZAI **module-level singleton** (create failure resets so it can retry), `llmComplete(messages)` **1 initial + 2 retries**, thinking disabled; `getFirmBySlug`, `loadConstitution` (state/constitution/constitution.yaml + agents/*.yaml), `harnessHealth`, `runTask` (EVENTS append + RUNS `<task-id>.harness.json`, **governance gate first**, job/inference/echo routing, 502 on model-plane failure), `chatCompletions` → OpenAI shape. |
| `e2e.ts` | `buildFirm(dbId)` (values → render.py → agent composition + decisions.jsonl → validate.py → scan_secrets.py → TestRun kind 'build' with steps [render, validate, scan]) and `runE2e(dbId)` — the 9-step golden path with per-step deps, skip-on-failure of dependents, independent steps still attempted, manifest.json + TestRun kind 'e2e'. |

### API routes (`src/app/api/**`, all `dynamic = 'force-dynamic'`, `runtime = 'nodejs'`)

`health` (GET, lazy 60s-cached background pytest), `firms` (GET/POST), `firms/[dbId]` (GET/PATCH/DELETE + rm -rf workspace),
`firms/[dbId]/{build,e2e,files,file,runs,download}` (download = spawn `tar -czf -` streamed as application/gzip),
`selftest` (POST, pytest 180s), `evidence` + `evidence/[id]`, `eligibility` (POST, temp-file → eligibility.py `--today`),
`decisions` (GET ?firmId / POST + decisions.jsonl append), `catalogue`, `playbook` (SKILL.md + 5 references passthrough),
`harness/firms/[firmId]/health`, `harness/firms/[firmId]/v1/tasks/run`, `harness/firms/[firmId]/v1/chat/completions`.
The existing `src/app/api/route.ts` was left untouched. No file under `prisma/`, `firm-spawner/`, `src/app/page.tsx`, `src/components/**` was modified.

## KEY IMPLEMENTATION DISCOVERY (important for 6-b / future maintenance)

The worker's `str(HTTPError)` for a 422 is `HTTP Error 422: <reason phrase>` — it does NOT read the response body.
So the governance refusal puts `human approval required for action: spend` into the **HTTP status line** via
`new NextResponse(body, { status: 422, statusText })`. Verified live: `HTTP/1.1 422 human approval required for action: external_publish`
→ worker retries 3× → `queue/failed/verify-gov.json` has `last_error: "HTTP Error 422: human approval required for action: spend"`.
Next.js DOES forward custom statusText through the Node server (this is what makes the governance E2E step pass).

## Verified curl results (dev server port 3000)

- GET `/api/health` → 200 `{ok:true, python 3.12.16, yaml/pytest true, skill.tests {25,0} (lazy-cached), harness.up true, docker false, git true}`
- GET `/api/firms` → 200 `{firms:[lumen-research + agents/decisions/lastRun]}`
- POST `/api/firms` → 201 (default 3 agents, stateBucket default); bad firmId → 400; duplicate → 409
- GET/PATCH/DELETE `/api/firms/[dbId]` → 200 / 200 (agents replaced in transaction) / `{ok:true}` + workspace removed
- POST `/api/firms/[dbId]/build` → 200 `{ok, render 23 files, validate ok (1 expected warning), scan 0}` + TestRun 'build'
- POST `/api/firms/[dbId]/e2e` → 200, **9/9 steps pass** (~9s), twice consecutively (git re-commit path verified)
- GET `/api/firms/[dbId]/files` → 200 tree (rendered/ + state/ + values.yaml + manifest.json, dirs first, .git skipped)
- GET `/api/firms/[dbId]/file?path=…` → 200 (200KB cap, `.ipynb` pretty-printed, traversal `../../etc/passwd` → 400)
- GET `/api/firms/[dbId]/runs` → 200 latest-first; GET `/download` → 200 application/gzip 45KB (unbuilt → 404)
- POST `/api/selftest` → 200 `{ok:true, 25 passed, 0 failed}`
- `/api/evidence` GET/POST/PATCH/DELETE → 200/201/200/{ok}; `/api/eligibility` → 200 (DB records + inline records + need gate)
- `/api/decisions` GET/POST → 200/201 + line appended to `rendered/decisions.jsonl`
- GET `/api/catalogue`, `/api/playbook` → 200
- GET `/api/harness/firms/lumen-research/health` → 503 unready before E2E, **200 ok after** (constitution from state)
- POST `…/v1/tasks/run` → echo 200, job w/o query 200 (deterministic echo), gov action → **422 with the message in the status line**
- POST `…/v1/chat/completions` → 200 real LLM content in OpenAI shape (model passthrough works)

## E2E golden path (verified twice)

build 300ms → seed state 3ms (byte-identical readback) → harness health 37ms (real HTTP 200) → enqueue 0ms →
worker container ~2.0s (verify-1 answered 322 chars via LLM, verify-2 completion "Operational", claimed empty,
HEALTH mode=container, ≥1 RUNS) → governance 0ms (`HTTP Error 422: human approval required for action: spend`, attempts 3) →
worker bare 6.4s (git init/commit → clone → checkout → run.sh with FIRM_PARTITION=kaggle, verify-3 echo, HEALTH mode=bare) →
persistence 0ms → manifest 0ms. State on disk: `queue/done/{verify-1,verify-2,verify-3}.json`, `queue/failed/verify-gov.json`,
`EVENTS/tasks.jsonl` (5 lines), `RUNS/` (harness + worker records), `HEALTH/worker.json`, `manifest.json` (commit sha).

## Notes for Task 6-b (frontend)

- Import DTO types from `@/lib/firm-forge/types` — response shapes match exactly (incl. `FirmDef.lastRun`, `E2EResult.results.{jobTask,inferenceTask,governanceTask,bareTask}`, `E2EResult.logs`).
- `GET /api/health` may return `skill.tests: null` on the very first call (pytest runs lazily in the background, cached 60s) — re-poll.
- Firm lookups: `/api/firms/[dbId]/*` uses the cuid; harness routes use the slug.
- E2E takes ~10s (LLM speed dependent); route is synchronous, set a generous fetch timeout.
- The values.yaml live preview must mirror `generateValuesYaml` (state_bucket = `file:///home/z/my-project/workspaces/<firmId>/state`, harness.base_url = `http://localhost:3000/api/harness/firms/<firmId>` — both derived from firmId, not DB fields).

## Deviations (minor, deliberate)

1. LLM retry policy implemented as 1 initial + 2 retries (3 attempts) — task said "2 retries"; MASTER_SPEC said "retry (2 attempts)" (ambiguous). Chose the more robust reading.
2. `/api/firms/[dbId]/files` also lists top-level `values.yaml` + `manifest.json` (spec says rendered/ + state/; added for the Build file-browser and E2E manifest viewer UX).
3. PATCH allows changing `firmId` (validated + uniqueness-checked, stateBucket recomputed); spec didn't forbid it.
4. `manifest.assets[].result` / `end_to_end.result` are computed honestly (`done` only when the task file exists) instead of hardcoded `done` — identical output on a passing run.
