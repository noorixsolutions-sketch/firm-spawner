# Firm Forge — Master Spec (Task 6-a backend, Task 6-b frontend)

## What we are building

A **tested, end-to-end working workspace** around the `company-spawner` skill (already installed at
`/home/z/my-project/firm-spawner/` — DO NOT modify skill files except nothing; catalogue/tests are already Stage-0 updated).
The app is a Next.js 16 App Router single-page tool ("Firm Forge") that:

1. Lets the operator compose firms (values + agents) — Stage 6.
2. Renders + validates + secret-scans them with the skill's real Python scripts — Stage 7.
3. Runs a REAL end-to-end pipeline (seed state → reference harness over HTTP → real worker.py drains the queue →
   results in `queue/done`, LLM answers via z-ai SDK, governance refusals in `queue/failed`) — Stage 11.
4. Runs the skill's own pytest suite (`python3 -m pytest tests -q` in `firm-spawner/`).
5. Runs the eligibility gate (`scripts/eligibility.py`) on provider evidence records — Stage 3/4.
6. Browses/downloads the rendered firm repo (Docker image sources, notebooks, compose, constitution).

**Shared types are already written**: `src/lib/firm-forge/types.ts` — import from `@/lib/firm-forge/types`.
Follow them EXACTLY. Database: Prisma + SQLite (`@/lib/db` exports `db`). Models: Firm, Agent, EvidenceRecord,
Decision, TestRun (already pushed + seeded with firm `lumen-research`).

## Hard rules

- TypeScript strict, ES modules, `'use client'` only in client components. z-ai-web-dev-sdk ONLY in backend code.
- API routes (not server actions). Relative-path fetches from the browser only.
- Use existing shadcn/ui components in `src/components/ui` + lucide-react icons. NO blue/indigo palette —
  the theme is "forge": amber/copper accents on dark charcoal (use Tailwind/CSS vars; the app is dark-first).
- No secrets anywhere: secrets are NAMES only (UPPER_SNAKE). The E2E and all logs must never print token values.
- Python scripts are the authority. Never reimplement their logic in TS beyond orchestration/parsing.
- Never edit files under `firm-spawner/` from app code at runtime (read-only template + catalogue).

## Filesystem layout (authoritative)

```
/home/z/my-project/
  firm-spawner/                     the skill (SKILL.md, scripts/, catalogue/, assets/firm-template/, tests/)
  workspaces/<firmId>/              per-firm workspace (created by backend at build time)
    rendered/                       the rendered firm repo (render.py output + composed agent files + decisions.jsonl)
    state/                          STATE_DIR: constitution/, queue/{pending,claimed,done,failed}, HEALTH/, RUNS/, EVENTS/, MEMORY/, ROUTING/, ENDPOINTS/
    manifest.json                   written by the E2E
  src/lib/firm-forge/               types.ts (exists) + backend-only libs (Task 6-a)
  src/app/api/...                   API routes (Task 6-a)
  src/components/firm-forge/...     UI components (Task 6-b)
  src/app/page.tsx                  the single page (Task 6-b)
```

## Python script invocations (Task 6-a uses exactly these)

All run with `python3`, cwd `/home/z/my-project`, timeout 120s (e2e worker runs: 300s):

```
python3 firm-spawner/scripts/render.py      --template firm-spawner/assets/firm-template --values <ws>/values.yaml --out <ws>/rendered
python3 firm-spawner/scripts/validate.py    --rendered <ws>/rendered --template firm-spawner/assets/firm-template --catalogue firm-spawner/catalogue
python3 firm-spawner/scripts/scan_secrets.py <ws>/rendered
python3 firm-spawner/scripts/eligibility.py --evidence <tmp-records.json> [--need batch|persistent_serving|interactive|experimentation] --today <YYYY-MM-DD>
python3 -m pytest tests -q                  (cwd firm-spawner)
python3 <ws>/rendered/images/worker/worker.py --state-dir <ws>/state --worker-id <id> --harness-url <url> --once   (env: see E2E)
sh <ws>/rendered/images/worker/run.sh       (bare-mode run; env: RUN_MODE=bare STATE_DIR=... HARNESS_BASE_URL=... FIRM_PARTITION=kaggle ...)
```

render.py: exit 0 → stdout JSON `{"ok":true,"out":...,"files_rendered":N}`; exit 1 → `{"ok":false,"errors":[...]}`.
validate.py: stdout JSON `{"ok":bool,"errors":[],"warnings":[]}`. scan_secrets.py: stdout lines + `secret scan: N finding(s)`;
exit 1 when findings. eligibility.py: stdout `{"results":[...],"selectable":[providers]}`.

## API contract (Task 6-a implements; Task 6-b consumes)

All JSON. Errors: `{ "error": "message" }` with 4xx/5xx.

- `GET  /api/health` → WorkspaceHealth. Probes: python3 --version, `python3 -c "import yaml"`, pytest presence,
  skill dir presence, `git --version`, docker presence (expected absent), harness health via internal fetch of
  `http://localhost:3000/api/harness/firms/lumen-research/health` (fallback up:false). skill.tests: parse the LAST
  pytest run cached in memory (do not run pytest on every health call; run once lazily and cache 60s).
- `GET  /api/firms` → `{ firms: FirmDef[] }` (include agents, decisions, lastRun = latest TestRun).
- `POST /api/firms` body FirmInput → `{ firm }`. Validate: firmId matches `^[a-z][a-z0-9-]{2,30}$` and unique;
  name/purpose non-empty and free of `" \ { } newline backslash` (render.py rejects them); workerTargets ⊆
  {kaggle,colab,hf-job,local}; controlTarget ∈ {hf-space,local}; secretsRequired UPPER_SNAKE.
  stateBucket defaults to `file:///home/z/my-project/workspaces/<firmId>/state`. Create default agents if none passed.
- `GET  /api/firms/[dbId]` → `{ firm }`
- `PATCH /api/firms/[dbId]` body FirmInput (+agents array replaces agents) → `{ firm }` (validations as above).
- `DELETE /api/firms/[dbId]` → `{ ok }` + rm -rf workspace dir.
- `POST /api/firms/[dbId]/build` → BuildResult. Pipeline:
  1. Generate `values.yaml` (see generator spec below) at `<ws>/values.yaml`.
  2. render.py → parse result.
  3. Compose agents: write `<ws>/rendered/constitution/agents/<fileName>` per DB agent (YAML: id, role,
     responsibilities list, plugins list, permissions list, reports_to). Remove any other `*.yaml` in that dir
     (template examples). Write `<ws>/rendered/decisions.jsonl` from DB Decision rows (one JSON per line).
  4. validate.py; 5. scan_secrets.py. Persist a TestRun kind='build' with steps [render, validate, scan].
- `POST /api/firms/[dbId]/e2e` → E2EResult (see E2E pipeline spec below). Long-running (60-120s) — synchronous response is fine.
- `GET  /api/firms/[dbId]/files` → `{ tree: FileNode[] }` (rendered/ + state/, path-sorted, dirs first).
- `GET  /api/firms/[dbId]/file?path=rendered/values.yaml` → `{ path, content, size, truncated }`. Path traversal
  guarded (must resolve inside the workspace). Text files only, max 200KB (truncated flag). `.ipynb` content:
  parse JSON and pretty-print with 2-space indent. 
- `GET  /api/firms/[dbId]/runs` → `{ runs: TestRunDef[] }` (latest first, cap 20).
- `GET  /api/firms/[dbId]/download` → tar.gz stream of `rendered/` (spawn `tar -czf - -C <ws> rendered`,
  Content-Type application/gzip, Content-Disposition attachment filename=`firm-<firmId>.tar.gz`). 404 if not built.
- `POST /api/selftest` → SelfTestResult: run pytest in firm-spawner (timeout 180s), parse `N passed` / `N failed`
  from the tail; store nothing.
- `GET  /api/evidence` → `{ records: EvidenceDef[] }`; `POST /api/evidence` body EvidenceInput → `{ record }`;
  `PATCH /api/evidence/[id]` body partial EvidenceInput → `{ record }`; `DELETE /api/evidence/[id]` → `{ ok }`.
- `POST /api/eligibility` body `{ records?: EvidenceInput[], need?: string }` → `{ results: EligibilityResult[], selectable: string[] }`.
  Map DB/input records to the script's JSON shape (provider, capability, execution, pricing_model, card_required,
  compute_cost, source_url, verified_at, terms_excerpt, limits, restrictions), write to a temp file, run
  eligibility.py with `--today <today>`; parse output. When `records` omitted → use all DB records.
- `GET  /api/decisions?firmId=<dbId>` → `{ decisions: DecisionDef[] }`.
- `POST /api/decisions` body `{ firmId(db), capability, choice, evidence, verifiedAt }` → `{ decision }`; also
  append the line to `<ws>/rendered/decisions.jsonl` if the file exists.
- `GET  /api/catalogue` → Catalogue (parse the three YAMLs in firm-spawner/catalogue; capabilities.yaml has a
  top-level `capabilities` map (id → {contract, implementations}) plus `rules` list — convert map to array with id).
- `GET  /api/playbook` → `{ skill: string, references: { name: string, content: string }[] }` (read SKILL.md +
  the five files in firm-spawner/references/ — pure text passthrough).

### Reference harness (the adapter contract — Task 6-a)

Routes under `/api/harness/firms/[firmId]/...` where `[firmId]` is the FIRM SLUG (e.g. `lumen-research`):

- `GET .../health` → reads `<ws>/state/constitution/constitution.yaml`. Seeded → 200 HarnessHealth
  `{ status:'ok', firm_id, name, runtime, agents:[{id,role,reports_to}], ts }`; else 503 `{ status:'unready', reason:'constitution not seeded — run the E2E or seed state first' }`.
- `POST .../v1/tasks/run` body = task JSON `{id,type,payload,...}`:
  - Load constitution + agents from state. Append `{ts, event:'task.received', task_id, type}` to
    `<ws>/state/EVENTS/tasks.jsonl`. Write `<ws>/state/RUNS/<task-id>.harness.json` `{task_id,type,ts,mode:'reference-harness'}`.
  - **Governance gate FIRST**: if `payload.action` ∈ constitution `policy.human_approval_required_for`
    (spend, external_publish, credential_change, destructive_action) → HTTP 422 `{ error: 'human approval required for action: <action>' }`
    (worker retries → task lands in queue/failed with last_error — intended).
  - `type === 'job'`: payload may have `query`. Call z-ai LLM (system: firm constitution summary + agent roster;
    user: the query). Return `{ result: { answer: <text>, firm_id, task_id, worker_model: 'workspace-llm', agents: [ids] } }`.
    If payload has no query → deterministic `{ result: { echo: payload, firm_id, task_id } }` (no LLM).
  - `type === 'echo'` → `{ result: { echo: payload, task_id } }` (deterministic, no LLM).
  - other types → treat like job.
  - LLM failure → HTTP 502 `{ error: 'model plane unavailable: ...' }` (honest failure, worker will retry).
- `POST .../v1/chat/completions` body OpenAI-ish `{model?, messages:[{role,content}], temperature?}`:
  call z-ai LLM, return OpenAI shape `{ id:'chatcmpl-<rand>', object:'chat.completion', created:<epoch>,
  model: body.model||'workspace-llm', choices:[{index:0,message:{role:'assistant',content:<text>},finish_reason:'stop'}],
  usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0} }`. 502 on SDK failure.

z-ai usage (backend only): `import ZAI from 'z-ai-web-dev-sdk'; const zai = await ZAI.create();
const completion = await zai.chat.completions.create({ messages: [{role:'assistant', content: system}, {role:'user', content}], thinking: { type: 'disabled' } });
const text = completion.choices[0]?.message?.content`. Keep a module-level singleton. Add a retry (2 attempts).

### values.yaml generator (exact)

```yaml
firm:
  id: <firmId>
  name: <name>            # single-line, quote-free
  purpose: <purpose>
  owner_gmail: <ownerGmail>
  repo: <repo>
  commit: main
policy:
  allow_paid: false
state:
  state_bucket: file:///home/z/my-project/workspaces/<firmId>/state
  models_bucket: ""
inference:
  enabled: <inferenceEnabled>
  backend: llama.cpp
  model_repo: <modelRepo>
  model_file: <modelFile>
  llama_cpp_ref: <llamaCppRef>
  ctx: <ctx>
model_plane:
  backends: [<modelBackends...>]
harness:
  runtime: <harnessRuntime>
  base_url: http://localhost:3000/api/harness/firms/<firmId>
deploy:
  control_target: <controlTarget>
  worker_targets: [<workerTargets...>]
  colab_workers: <colabWorkers>
  kaggle_workers: <kaggleWorkers>
  kaggle_schedule: <kaggleSchedule>
  hf_space_hardware: <hfSpaceHardware>
  idle_exit_seconds: <idleExitSeconds>
agents:
  files: [<agent fileName list>]
plugins:
  bindings: [<pluginBindings...>]
secrets:
  required: [<secretsRequired...>]
```
Emit with a small hand-rolled serializer (strings must be YAML-safe: strip `"` `\` newlines `{{` `}}`; lists of plain
strings; booleans as true/false). Do NOT add keys outside this schema (render.py rejects unknown keys).

### E2E pipeline (POST /api/firms/[dbId]/e2e) — the golden path

Every step records `{name, status: pass|fail, detail, ms}`; on failure of a hard step, record it, mark ok:false,
skip dependents, still persist the TestRun (kind 'e2e'), and return what completed. Logs: append worker
stdout/stderr + key probe outputs (secret-free).

1. **build** — run the same pipeline as POST /build (reuse the function). Fail → stop.
2. **seed state** — `rm -rf <ws>/state` then copy `rendered/constitution/` → `state/constitution/`,
   `rendered/plugins/bindings.yaml` → `state/constitution/plugins/bindings.yaml`, `rendered/state/LAYOUT.md` →
   `state/constitution/LAYOUT.md`; mkdir `state/queue/{pending/kaggle,claimed,done,failed}`, `HEALTH`, `RUNS`,
   `EVENTS`, `MEMORY`, `ROUTING`, `ENDPOINTS`. Read back constitution.yaml + one agent → compare bytes (pass).
3. **harness health** — `fetch('http://localhost:3000/api/harness/firms/<firmId>/health')` → expect 200 (real
   HTTP probe; detail includes status code + firm name).
4. **enqueue tasks** — write `state/queue/pending/verify-1.json` =
   `{"id":"verify-1","type":"job","payload":{"query":"In two sentences: what is the firm-worker claim-then-execute contract?"},"attempts":0,"created":<iso>}`;
   `state/queue/pending/verify-2.json` =
   `{"id":"verify-2","type":"inference","payload":{"messages":[{"role":"user","content":"Reply with exactly one word: operational"}]},"attempts":0,"created":<iso>}`;
   `state/queue/pending/verify-gov.json` =
   `{"id":"verify-gov","type":"job","payload":{"action":"spend","amount":100,"note":"governance gate test"},"attempts":0,"created":<iso>}`.
5. **worker (container code path)** — spawn
   `python3 <ws>/rendered/images/worker/worker.py --state-dir <ws>/state --worker-id <firmId>-local --harness-url
   http://localhost:3000/api/harness/firms/<firmId> --once --poll 1` with env
   `STATE_DIR=<ws>/state, HARNESS_BASE_URL=<url>, INFERENCE_URL=http://localhost:3000/api/harness/firms/<firmId>,
   FIRM_WORKER_ID=<firmId>-local, RUN_MODE=container, FIRM_MAX_ATTEMPTS=3` (timeout 300s). Then assert:
   `state/queue/done/verify-1.json` exists with non-empty `result.answer`; `state/queue/done/verify-2.json` exists
   with `result.choices[0].message.content`; `state/queue/claimed/` is empty; `state/HEALTH/worker.json` exists
   with mode 'container'; ≥1 file in `state/RUNS/`.
6. **governance gate** — assert `state/queue/failed/verify-gov.json` exists, `attempts>=1`, `last_error` mentions
   'human approval required'. (The worker's retry loop lands it there in the same run.)
7. **worker (bare / notebook code path)** — write `state/queue/pending/kaggle/verify-3.json` =
   `{"id":"verify-3","type":"echo","payload":{"note":"bare mode notebook path"},"attempts":0,"created":<iso>}`;
   then simulate the notebook bootstrap: `git init` + `git add -A` + `git commit -m firm` inside `<ws>/rendered`
   (set user.email/user.name locally, `git -c` flags; tolerate existing repo by re-committing), capture the 40-char
   commit SHA; `git clone <ws>/rendered <tmp>/firm-clone` + `git -C <clone> checkout <sha>`; then spawn
   `sh <clone>/images/worker/run.sh` with env `RUN_MODE=bare, STATE_DIR=<ws>/state,
   HARNESS_BASE_URL=http://localhost:3000/api/harness/firms/<firmId>, FIRM_PARTITION=kaggle,
   FIRM_WORKER_ID=<firmId>-kaggle, FIRM_IDLE_EXIT=5` (timeout 120s). Assert `state/queue/done/verify-3.json`
   exists and `state/HEALTH/worker.json` mode becomes 'bare' (read after run).
8. **persistence** — re-verify verify-1/verify-2 done files still present + EVENTS/tasks.jsonl exists.
9. **manifest** — write `<ws>/manifest.json`:
```json
{
  "firm_id": "<firmId>",
  "verified_at": "<iso>",
  "commit": "<the 40-char sha from step 7, else 'workspace (not published)'>",
  "assets": [
    {"name":"harness","target":"local (reference impl)","endpoint":"http://localhost:3000/api/harness/firms/<firmId>","health":"200"},
    {"name":"worker-local","target":"local","result":"done"},
    {"name":"worker-bare","target":"kaggle partition (notebook code path)","result":"done"},
    {"name":"inference-model-plane","target":"workspace-llm","result":"real chat completion"},
    {"name":"firm-inference (llama.cpp)","target":"authored image sources","result":"not exercised: no GPU/Docker in sandbox"}
  ],
  "end_to_end": {"task":"verify-1","result":"done"},
  "limits": ["workspace model plane is internal to this sandbox","Kaggle/Colab/HF deploys are operator-gated"],
  "mocked": ["firm-harness is the workspace reference implementation, not the operator's Synapses-Firm harness"]
}
```
Persist TestRun kind 'e2e' (steps + manifest + summary 'N/M steps passed'). Return E2EResult with
`results.{jobTask,inferenceTask,governanceTask,bareTask}` = parsed task files (or null).

## Frontend brief (Task 6-b) — single page at `/`

Dark-first "forge" aesthetic: deep charcoal background (#0c0a09-ish, use bg of choice via wrapper), amber-500/600
accents, copper borders (border-amber-900/40), stone neutrals. All cards p-4/p-6, gap-4/gap-6. Responsive
mobile-first. Sticky footer via root `min-h-screen flex flex-col` + `mt-auto` footer. Semantic main/header/nav.
Framer-motion transitions (subtle). Loading/error/empty states everywhere. Use TanStack Query (already installed)
with a small `api()` fetch helper. next-themes for light/dark with a toggle (default dark).

Tabs (URL-synced via `?tab=`): **Overview · Firms · Build · E2E Lab · Eligibility · Catalogue · Playbook**.

- **Overview**: hero paragraph; 12-stage workflow tracker (stages 0-11 from SKILL.md with status chips:
  0 inventory done, 1-6 done for demo firm, 7 done via Build, 8/9/10 operator-gated, 11 via E2E Lab);
  environment card (GET /api/health) with green/amber/red chips; self-test card (POST /api/selftest button,
  output tail in a scrollable pre, max-h-96); latest E2E card (from /api/firms → lastRun) + big CTA
  "Run full E2E" that switches to E2E Lab and triggers the run.
- **Firms**: left list (cards w/ firmId, name, target chips) + right editor form (sections: Identity, State &
  Inference, Model plane, Harness, Deploy, Agents, Plugins, Secrets). Agents: editable cards (add/remove,
  responsibilities/plugins/permissions as comma or tag inputs). Plugins picker = checkboxes from /api/catalogue
  plugins. Secrets: chips + add (UPPER_SNAKE validated). values.yaml live preview (right column, mono, generated
  client-side mirroring the generator shape). Save → PATCH → toast. New firm button (prefilled from demo values,
  firmId editable). Delete with AlertDialog confirm.
- **Build**: firm select; "Build firm" button (POST build) → 3 step cards (Render / Validate / Secret scan) with
  pass/fail icons, error lists (destructive), warnings (amber); file tree browser (GET files) side panel +
  file viewer dialog or inline (mono pre, scrollable, max-h-[480px], pretty for .ipynb/.json); Download repo
  button (link to /download). Long lists scrollable with styled scrollbar.
- **E2E Lab**: firm select; Run E2E button (POST e2e, min 60s timeout, animated progress with rotating status
  text); steps timeline (numbered, icons ✓/✗/skip, ms badges, detail text collapsible); results grid: job answer
  (LLM text in a quote card), inference completion content, governance refusal (last_error), bare task echo;
  manifest viewer (pretty JSON); logs (collapsible pre); run history (GET runs). Honest "mocked" callout from
  manifest.mocked rendered as amber warning card.
- **Eligibility**: records table (provider, capability, execution, pricing, verified_at, status chip,
  selectable ✓/✗); "Run gate" toolbar with need select (batch/persistent_serving/interactive/experimentation)
  → POST /api/eligibility → results with disclosures/reasons expandable; add/edit record Dialog (all fields);
  decisions section (list for chosen firm + add form).
- **Catalogue**: three sections — images (cards: id, status badge authored=amber/verified=green/unverified=gray,
  deploys_to chips, env, health), plugins (id, version, permissions chips, health), capabilities (contract +
  implementations table). Rules list.
- **Playbook**: doc picker (SKILL.md + 5 references) + react-markdown rendering (prose styling, dark-friendly).

Global: header (anvil icon + "Firm Forge" + subtitle "company-spawner workspace", health chips, theme toggle);
footer (fixed bottom): "company-spawner · free-only policy enforced by scripts · secrets are names, never values".

## Coordination

- Task 6-a owns: `src/app/api/**` (all routes incl. harness), `src/lib/firm-forge/**` (paths.ts, python.ts,
  values.ts, harness.ts, e2e.ts, api-helpers). Do NOT touch page.tsx or components.
- Task 6-b owns: `src/app/page.tsx`, `src/app/layout.tsx` (metadata + ThemeProvider), `src/components/firm-forge/**`.
  Do NOT touch api routes or lib (except importing types).
- Both: `bun run lint` must pass on your files. No test files. No new deps (yaml/next-themes/react-markdown exist).
