# Firm Forge

**A Next.js workspace for spawning complete, deployable digital companies ("firms") from templates.**

Firm Forge is the visual workbench for the `company-spawner` skill. It lets you compose, build, validate, and deploy autonomous agent firms to free-tier platforms (Kaggle, Colab, Hugging Face) with zero budget requirements.

---

## What is a Firm?

A **firm** is a complete, deployable system consisting of:
- **Agents**: Autonomous workers with defined roles, responsibilities, and permissions
- **Constitution**: Governance rules and approval policies
- **Workers**: Container and notebook-based executors
- **Harness**: Reference implementation for task routing and LLM integration
- **Infrastructure**: Docker images, deployment configurations, state management

**Key Philosophy**: Free-only, secrets-as-names, operator-approved deployments, deterministic validation.

---

## Quick Start

### Prerequisites

- **Node.js** (installed at `C:\Program Files\nodejs\node.exe`)
- **Python 3** (as `python`, not `python3`)
- **Bun** (package manager)
- **Git**

### Installation

```bash
# Install dependencies
bun install

# Generate Prisma client
bun run db:generate

# Push database schema
bun run db:push

# Start development server
bun run dev
```

Access the application at `http://localhost:3000`

### Quick Verification

```bash
# Run Python tests (firm-spawner skill validation)
cd firm-spawner
python -m pytest tests -q
cd ..

# Run Next.js linter
bun run lint
```

---

## Architecture

### Stack

- **Frontend**: Next.js 16 App Router, React 19, TailwindCSS, shadcn/ui
- **Backend**: Next.js API routes, Python validation scripts
- **Database**: Prisma + SQLite (`db/custom.db`)
- **AI**: z-ai-web-dev-sdk for LLM integration
- **Styling**: Dark-first "forge" aesthetic (amber/copper on charcoal)

### Directory Structure

```
firm-spawner/
├── SKILL.md                    # company-spawner skill documentation
├── assets/firm-template/       # Template firm (Dockerfiles, notebooks, constitution)
├── catalogue/                  # Images, plugins, capabilities (YAML)
├── references/                 # Architecture, credentials, deploy recipes
├── scripts/                    # render.py, validate.py, eligibility.py, scan_secrets.py
└── tests/                      # pytest suite

src/
├── app/
│   ├── api/                    # API routes (Task 6-a: backend)
│   │   ├── health/            # Workspace health checks
│   │   ├── firms/             # Firm CRUD + build/e2e
│   │   ├── harness/           # Reference harness implementation
│   │   ├── evidence/          # Provider evidence records
│   │   ├── eligibility/       # Free-tier eligibility gate
│   │   └── catalogue/         # Catalogue queries
│   └── page.tsx               # Main UI (Task 6-b: frontend)
├── components/
│   ├── ui/                    # shadcn/ui components
│   └── firm-forge/            # Application-specific components
└── lib/
    ├── db.ts                  # Prisma client
    └── firm-forge/            # Backend utilities (types, Python runners, harness)

workspaces/<firmId>/
├── values.yaml                # Firm configuration
├── rendered/                  # Rendered firm repo (images, notebooks, constitution)
└── state/                     # Runtime state (queue, events, runs, health)

.zscripts/                     # Build and development scripts
prisma/                        # Database schema + seed
```

---

## Core Workflows

### 1. Create a Firm

**UI**: Firms tab → New Firm
- Define identity (firmId, name, purpose)
- Configure state, inference, model plane, harness
- Design agents (roles, responsibilities, plugins, permissions)
- Select deployment targets (kaggle, colab, hf-space, local)
- Declare required secrets (UPPER_SNAKE names only)

**API**: `POST /api/firms`

### 2. Build a Firm

**Pipeline**: Render → Validate → Secret Scan

```bash
# What happens:
1. Generate values.yaml from firm configuration
2. python firm-spawner/scripts/render.py --template ... --values ... --out workspaces/<firmId>/rendered
3. Compose agent YAML files into rendered/constitution/agents/
4. Write decisions.jsonl from database
5. python firm-spawner/scripts/validate.py --rendered ...
6. python firm-spawner/scripts/scan_secrets.py workspaces/<firmId>/rendered
```

**UI**: Build tab → Select firm → Build Firm
**API**: `POST /api/firms/[id]/build`

### 3. Run End-to-End Test

**The Golden Path**: Verifies the entire stack works

```
1. Build (render + validate + scan)
2. Seed state directories
3. Harness health check
4. Enqueue 3 test tasks (job, inference, governance)
5. Run worker (container code path) - processes tasks
6. Verify governance gate (refusal in queue/failed)
7. Run worker (bare/notebook code path) - Kaggle simulation
8. Verify persistence (tasks in queue/done)
9. Generate manifest.json
```

**UI**: E2E Lab tab → Select firm → Run E2E
**API**: `POST /api/firms/[id]/e2e`
**Duration**: 60-120 seconds

### 4. Provider Eligibility

Research and compare free-tier providers:

```bash
# Eligibility gate
python firm-spawner/scripts/eligibility.py \
  --evidence evidence.json \
  --need batch \
  --today 2026-11-04
```

**UI**: Eligibility tab → Add evidence → Run gate
**API**: `POST /api/eligibility`

---

## API Reference

All routes return JSON. Errors: `{ "error": "message" }` with 4xx/5xx status.

### Health & System

- `GET /api/health` → WorkspaceHealth (Python, pytest, skill dir, harness)
- `POST /api/selftest` → Run pytest suite, return results

### Firms

- `GET /api/firms` → List all firms with agents, decisions, lastRun
- `POST /api/firms` → Create firm (validates firmId, name, targets, secrets)
- `GET /api/firms/[id]` → Get single firm
- `PATCH /api/firms/[id]` → Update firm
- `DELETE /api/firms/[id]` → Delete firm + workspace
- `POST /api/firms/[id]/build` → Build pipeline (render, validate, scan)
- `POST /api/firms/[id]/e2e` → End-to-end test (long-running: 60-120s)
- `GET /api/firms/[id]/files` → File tree (rendered/ + state/)
- `GET /api/firms/[id]/file?path=...` → File content (text, max 200KB)
- `GET /api/firms/[id]/download` → tar.gz of rendered/
- `GET /api/firms/[id]/runs` → Test run history (latest 20)

### Reference Harness

Routes under `/api/harness/firms/[firmId]/...`:
- `GET .../health` → HarnessHealth (constitution, agents, runtime)
- `POST .../v1/tasks/run` → Execute task (governance gate enforced)
- `POST .../v1/chat/completions` → OpenAI-compatible chat endpoint

### Evidence & Eligibility

- `GET /api/evidence` → List provider evidence records
- `POST /api/evidence` → Create evidence record
- `PATCH /api/evidence/[id]` → Update evidence
- `DELETE /api/evidence/[id]` → Delete evidence
- `POST /api/eligibility` → Run eligibility gate

### Decisions

- `GET /api/decisions?firmId=...` → Decisions for firm
- `POST /api/decisions` → Record decision + append to decisions.jsonl

### Catalogue & Playbook

- `GET /api/catalogue` → Images, plugins, capabilities (from YAML)
- `GET /api/playbook` → SKILL.md + references/* (documentation)

---

## Python Scripts (firm-spawner/scripts/)

All invoked with `python` (not `python3` per Windows setup):

### render.py

```bash
python firm-spawner/scripts/render.py \
  --template firm-spawner/assets/firm-template \
  --values workspaces/<firmId>/values.yaml \
  --out workspaces/<firmId>/rendered
```

**Output**: JSON with `{"ok":true, "files_rendered":N}` or `{"ok":false, "errors":[...]}`

### validate.py

```bash
python firm-spawner/scripts/validate.py \
  --rendered workspaces/<firmId>/rendered \
  --template firm-spawner/assets/firm-template \
  --catalogue firm-spawner/catalogue
```

**Output**: JSON with `{"ok":bool, "errors":[], "warnings":[]}`

### scan_secrets.py

```bash
python firm-spawner/scripts/scan_secrets.py workspaces/<firmId>/rendered
```

**Output**: "secret scan: N finding(s)" + exit 1 if findings exist

### eligibility.py

```bash
python firm-spawner/scripts/eligibility.py \
  --evidence evidence.json \
  --need batch \
  --today 2026-11-04
```

**Output**: JSON with `{"results":[...], "selectable":["provider1", ...]}`

---

## Database Schema (Prisma)

### Models

- **Firm**: firmId, name, purpose, owner, config (inference, deploy, secrets)
- **Agent**: id, role, responsibilities, plugins, permissions, reportsTo
- **EvidenceRecord**: provider, capability, execution, pricing, verified_at
- **Decision**: capability, choice, evidence, verifiedAt
- **TestRun**: kind (build|e2e), status, steps, logs, manifest

### Commands

```bash
bun run db:generate     # Generate Prisma client
bun run db:push         # Push schema to database
bun run db:migrate      # Create migration
bun run db:reset        # Reset database
```

---

## Frontend (Task 6-b)

**Single Page Application** at `/` with URL-synced tabs:

### Tabs

1. **Overview**: Hero, workflow tracker, environment health, self-test, latest E2E
2. **Firms**: List + editor (identity, agents, plugins, secrets, values.yaml preview)
3. **Build**: Firm select, build button, step cards, file tree browser, download
4. **E2E Lab**: Run button, steps timeline, results grid, manifest, logs, history
5. **Eligibility**: Evidence table, gate runner, decisions
6. **Catalogue**: Images, plugins, capabilities (from YAML)
7. **Playbook**: SKILL.md + references (react-markdown rendering)

### Theme

**"Forge" Aesthetic**:
- Dark-first (deep charcoal background)
- Amber/copper accents (amber-500/600)
- Stone neutrals
- next-themes with toggle (default dark)

---

## Configuration Files

### .env (not in repo)

```env
# Database
DATABASE_URL="file:./db/custom.db"

# Z-AI SDK (optional, for LLM features)
# ANTHROPIC_API_KEY=...
```

### tsconfig.json

TypeScript strict mode, path aliases (`@/*` → `src/*`)

### tailwind.config.ts

Custom theme with forge colors, dark-first design tokens

### next.config.ts

Standalone output for production builds

---

## Development Scripts

```bash
# Development
bun run dev                # Start dev server (port 3000)

# Production
bun run build              # Build for production
bun run start              # Start production server

# Database
bun run db:generate        # Generate Prisma client
bun run db:push            # Push schema changes
bun run db:migrate         # Create migration
bun run db:reset           # Reset database

# Linting
bun run lint               # Run ESLint
```

---

## Testing

### Python Tests (Skill Validation)

```bash
cd firm-spawner
python -m pytest tests -q
cd ..
```

**Tests**: render.py, validate.py, scan_secrets.py, eligibility.py

### Manual E2E Test

Via UI (E2E Lab tab) or API:

```bash
curl -X POST http://localhost:3000/api/firms/<id>/e2e
```

Verifies: render, validate, scan, state seeding, harness health, worker execution (container + bare), governance gate, persistence.

---

## Key Principles

### 1. Free-Only Policy

- `allow_paid` is always `false`
- Only permanently free services (no trials)
- Payment card requirements must be disclosed
- Eligibility enforced by `eligibility.py`

### 2. Secrets as Names

- Secrets are `UPPER_SNAKE` identifiers only
- Values never appear in: code, repos, notebooks, logs, chat
- Stored in platform secret stores (env vars, HF secrets, Kaggle secrets)
- `scan_secrets.py` runs before any external push

### 3. Operator Approval Gates

External side effects require explicit approval:
- Creating cloud resources
- Pushing code to GitHub
- Pasting notebooks to Kaggle/Colab
- Deploying to Hugging Face

### 4. Deterministic Validation

- Python scripts are the authority (not TypeScript reimplementations)
- Validation is reject-by-default
- Template modifications require pytest suite to pass
- Rendered output is read-only (never hand-edited)

---

## Deployment Targets

### Local

- Control: Reference harness at `http://localhost:3000/api/harness/firms/<firmId>`
- Workers: Run worker.py with `--once` flag
- State: File-based in `workspaces/<firmId>/state`

### Kaggle

- Workers: Notebook-based (notebooks/kaggle.worker.ipynb)
- Secrets: Kaggle Secrets (Add-ons → Secrets)
- Partition: `kaggle` (queue/pending/kaggle/)

### Colab

- Workers: Notebook-based (notebooks/colab.worker.ipynb)
- Secrets: Colab Secrets (left sidebar 🔑)
- Batch execution (not persistent)

### Hugging Face

- Control: HF Space (gradio/streamlit/static)
- Workers: HF Jobs (scheduled)
- Inference: HF Inference Endpoints (if needed)
- Secrets: HF Space/Repo secrets

---

## Troubleshooting

### Build Failures

**render.py fails**:
- Check values.yaml syntax (YAML-safe strings, no `"` `\` `{{` `}}`)
- Validate firmId: `^[a-z][a-z0-9-]{2,30}$`
- Ensure all required fields present

**validate.py fails**:
- Verify template files unchanged
- Check catalogue references (images, plugins exist)
- Confirm agent plugin names match catalogue

**scan_secrets.py fails**:
- Remove any secret values from values.yaml
- Use `UPPER_SNAKE` secret names only
- Check .env files not in rendered/

### E2E Failures

**Harness health 503**:
- Check constitution.yaml seeded in state/
- Verify workspace directory structure

**Worker hangs**:
- Check timeout settings (300s for E2E)
- Verify harness_url reachable
- Review worker logs in E2E result

**Tasks stuck in queue/claimed**:
- Worker may have crashed
- Check FIRM_MAX_ATTEMPTS setting
- Review EVENTS/tasks.jsonl

### Database Issues

```bash
# Reset database completely
bun run db:reset

# Regenerate Prisma client
bun run db:generate

# Push schema changes
bun run db:push
```

---

## Contributing

### Code Style

- **TypeScript**: Strict mode, ES modules
- **Client Components**: `'use client'` directive required
- **API Routes**: Not server actions
- **Secrets**: Names only, never values
- **Python**: Follow firm-spawner test suite patterns

### Adding New Features

1. Read `agent-ctx/MASTER_SPEC.md` for architecture
2. Follow Task 6-a (backend) / Task 6-b (frontend) boundaries
3. Match existing shadcn/ui components
4. Use "forge" theme (amber/copper on charcoal)
5. Run linter: `bun run lint`
6. Test Python changes: `cd firm-spawner && python -m pytest tests -q`

---

## Resources

### Documentation

- **SKILL.md**: company-spawner skill workflow (12 stages)
- **MASTER_SPEC.md**: Complete architecture specification (Task 6-a/6-b)
- **firm-spawner/references/**: Architecture, credentials, deploy recipes

### External Links

- [Next.js 16 Docs](https://nextjs.org/docs)
- [Prisma Docs](https://www.prisma.io/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [z-ai SDK](https://github.com/zaidhafeeez/z-ai)

---

## License

[Specify license here]

---

## Demo Firm: lumen-research

Pre-seeded demo firm included in `workspaces/lumen-research/`:

- **Purpose**: Research assistant firm
- **Agents**: Orchestrator, Researcher
- **Workers**: Kaggle + local
- **State**: File-based in workspaces/lumen-research/state

Build and run E2E to verify workspace setup.

---

**Built with Next.js 16, Prisma, and the company-spawner skill.**
