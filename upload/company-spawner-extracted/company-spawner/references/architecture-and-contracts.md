# Architecture and contracts

What goes in Docker images, what goes in notebooks, what the harness is, and the contract each item
must satisfy. Contents: 1 the four layers, 2 images, 3 notebooks, 4 harness and plugins, 5 state,
6 secrets, 7 the firm repo, 8 who may write what, 9 what each platform can run.

## 1. The four layers

| Layer | Contains | Changes per firm? |
|---|---|---|
| **Docker image** | Runtime, pinned dependencies, fixed program logic, entrypoint. The machinery. | No |
| **Notebook** | A launcher that runs the same image code on platforms with no Docker daemon (Colab, Kaggle). One CONFIG cell, then fixed cells. | CONFIG cell only |
| **Harness configuration** | Constitution, agent definitions, plugin bindings, seeded into `/state/constitution`. The firm's brain and its business. | Yes, entirely |
| **Values file** | Every firm-specific fact, in one schema (`template.yaml`). Rendered into the files above. | Yes |

Test for where something belongs: if it would be identical in every firm, it is machinery (image).
If it is a fact about this firm, it is a value or an agent file. If it only exists because a platform
cannot run Docker, it is a notebook, and the notebook must contain no logic the image does not.

## 2. Docker images

An image never contains firm values, secrets or state. Seven rules every image obeys:

1. **State lives under `/state`** (the bucket mount), models under `/models`. Never in the image or on local disk.
2. **Secrets arrive as environment variables**, named in the catalogue entry. Never baked, never in the Dockerfile.
3. **Runs as non-root** (uid 1000), read-only filesystem where the program allows.
4. **Idempotent:** a restart re-converges and never duplicates work or state.
5. **Dual-mode entrypoint:** `entry.sh` detects `container` or `bare` mode and runs the same `run.sh`. One code path, so notebooks and containers cannot drift.
6. **Healthcheck** declared in the Dockerfile and in the catalogue manifest.
7. **Reproducible:** dependencies pinned; build references pinned (`LLAMA_CPP_REF`); the published image is referenced by `sha256` digest in `versions.lock`, never by a mutable tag alone.

Catalogue manifest fields (`catalogue/images.yaml`): `id`, `status` (`authored` | `verified` | `unverified`),
`source`, `architectures`, `capabilities`, `deploys_to`, `env_required`, `env_optional`, `secrets`,
`health`, `state_mount`, optionally `gpu`. Anything not listed is rejected.

### The images in this template

| Image | Status | Role | Runs on | Needs |
|---|---|---|---|---|
| `firm-worker` | authored | Queue consumer; claims tasks, calls the harness (or local inference), writes results | local, HF Space, HF Job, Colab, Kaggle | `STATE_DIR` |
| `firm-inference` | authored | llama.cpp `llama-server`, OpenAI-compatible on :8000 | local, HF Job, Colab, Kaggle (GPU) | `MODEL_REPO`, `MODEL_FILE`, `HF_TOKEN` |
| `firm-harness` | unverified | The firm's brain runtime (see section 4) | local, HF Space | `STATE_DIR` |
| `firm-gateway` | unverified | Single MCP surface for outside models | local, HF Space | inventory |
| `firm-agentos` | unverified | Agent shell, human-approval gates | local, HF Space | inventory |
| `firm-ui` | unverified | Dashboard | local, HF Space | inventory |
| `firm-humanoid` | unverified | Screen automation; needs a display | local only | inventory |

`authored` images are built from `assets/firm-template/images/*` (the platform builds the Dockerfile:
an HF Docker Space builds it itself; GitHub Actions builds it for CI use; no Docker install is needed on the
operator's machine). `unverified` images come from the operator's own repositories (per the design discussion:
Synapses-Firm harness and gateway, AgentOS, humanoid-mcp). Their contents and health endpoints are not known
to this skill. In Stage 0, locate their Dockerfiles, record the real env vars, ports and health checks, and only then set
`status: verified`. Until then `validate.py` rejects them.

## 3. Notebooks

Notebooks exist because Colab and Kaggle cannot run Docker. They are paste units: the same code path as the
image, started from a notebook. Template notebooks: `{colab,kaggle}.worker.ipynb`, `{colab,kaggle}.inference.ipynb`.

Contract:

1. **Cell layout is fixed:** title, CONFIG, bootstrap, state, run. Only the CONFIG cell is edited (it holds `{{placeholders}}` from the values file, rendered).
2. **Secrets come from the platform secret store** (Colab: Secrets panel via `google.colab.userdata`; Kaggle: Add-ons, Secrets via `kaggle_secrets`). A value is never typed into a cell.
3. **Bootstrap** sets `RUN_MODE=bare`, clones the firm repo at `FIRM_COMMIT`, installs `requirements.lock`, then runs `images/<x>/run.sh` from the clone. No logic is duplicated into the notebook.
4. **State:** with no bucket mount, the notebook mirrors `/state` with `hf sync` (`STATE_PULL_CMD` before each claim, `STATE_PUSH_CMD` after each task). It prints `hf sync --help` first so a changed argument order is visible. Mirrored state cannot do atomic cross-machine claims, so each bare-mode worker owns a disjoint queue partition (`FIRM_PARTITION`, default `kaggle` or `colab`): it only reads `queue/pending/<partition>/`.
5. **Inference notebooks** start `llama-server` on localhost, wait for `/health`, then drain `inference` tasks via `INFERENCE_URL`. They are batch workers; the endpoint dies with the session.
6. **Execution class is `ephemeral_notebook`.** Colab sessions are interactive and time-limited. Kaggle runs can be scheduled in its UI and are subject to weekly GPU quota. Neither is a permanent server.
7. **Integrity:** `validate.py` compares every non-CONFIG code cell to the template and rejects edits.

## 4. Harness and plugins

The harness is the firm's brain: it decides what happens. Plugins expose capabilities; containers do the work.
Do not turn plugins into competing orchestrators, and do not add a second agent runtime.

What the design discussion established (from the operator's own codebase, to be confirmed in Stage 0):

- **Chassis:** the Synapses harness `ProjectSpawner` turns a brief into contracts, containers and a task graph.
- **Runtime:** `AGENT_RUNTIME` selects the cognitive runtime for spawned agents (`sim`, `prime-agent`, `opencode`). `prime-agent` is an IPython-kernel agent with a persistent session; run it only in a real sandbox (`SANDBOX_MODE=real`, never passthrough).
- **Governance of self-modification:** propose, ground (read before write), gate (human approval), apply in sandbox, audit, revert, learn.
- **Spawner brain:** `LocalBrain` today; DSPy is an optional replacement for it, not for the harness.
- **"DSH":** the operator uses this name for the firm harness with a plugin architecture. The discussion uses it near DSPy and the prime-agent harness but never defines it. Do not assume; resolve in Stage 0.

What this skill requires of whatever implements the harness slot (adapter contract):

| Interface | Contract |
|---|---|
| Config in | Reads `/state/constitution/constitution.yaml`, `agents/*.yaml`, `plugins/bindings.yaml` |
| `GET /health` | 200 when ready |
| `POST /v1/tasks/run` | Body: task JSON. Response: `{"result": <any>}`. Non-2xx means failure and triggers worker retry |
| State | Reads and writes only under `/state` per the layout |
| Secrets | From env, named in `secrets.required` |

This HTTP shape is what `firm-worker` speaks. It is a contract the harness adapter must satisfy, not a claim
about an existing API. If the real harness exposes something different, change the adapter or the worker's `execute()`
and update the catalogue and tests, never the other way round silently.

Plugin binding contract (`catalogue/plugins.yaml`): `id`, `version`, `requires_capabilities`, `permissions`,
`secret_refs`, `health`. A binding references the plugin id; each agent lists the plugin ids it uses and the
permissions it holds. Plugins receive only the permissions and secret names their agents need.

Agent definition (`constitution/agents/*.yaml`), all keys required: `id`, `role`, `responsibilities` (list),
`plugins` (list of bound ids), `permissions` (list), `reports_to`. Write these from the business, one file per
agent, with distinct responsibilities and no overlap in authority.

## 5. State

The bucket layout in `assets/firm-template/state/LAYOUT.md` is the contract everything depends on. Change it
before changing any image. HF buckets mount into Spaces and Jobs as volumes and can be mirrored to a local
directory with `hf sync`. The state bucket and the models bucket are separate by default: small high-churn
task state versus large rarely-changing weights.

Task states: `pending` to `claimed` (atomic rename, one winner) to `done` or `failed` (after `FIRM_MAX_ATTEMPTS`,
default 3, with `last_error`). Every worker loop writes `HEALTH/worker.json`; every run writes `RUNS/<id>.json`.

## 6. Secrets

One name per secret, the same on every platform; only the injection point differs.

| Secret | Used by | Where it is set |
|---|---|---|
| `HF_TOKEN` | inference model download, bucket access, HF deploys | local `.env` (chmod 600, never committed); Space Settings, Secrets; Job secrets at launch; Colab Secrets panel; Kaggle Add-ons, Secrets |
| `GITHUB_TOKEN` | cloning a private firm repo in notebooks; publishing | same places |
| provider keys (`GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, ...) | model plane | same places |

Values are not stored in the repo, the values file, images, notebooks or chat. The operator also keeps their own
copy in a password manager so a lost platform secret can be re-entered without regenerating it.

## 7. The firm repo (rendered output)

```
firm-<id>/
  values.yaml              the firm's facts (no secrets)
  template.yaml            the schema it was rendered against
  pattern.yaml             deployment order
  constitution/            constitution.yaml, agents/*.yaml
  plugins/bindings.yaml    plugin ids + secret NAMES
  images/                  worker/, inference/ (+ any verified-image sources)
  notebooks/               4 notebooks, CONFIG rendered
  compose/local.yml        local fleet
  state/LAYOUT.md          the durable-disk contract
  requirements.lock        notebook dependency pins
  versions.lock            image digests, LLAMA_CPP_REF (added at publish)
  decisions.jsonl          operator choices with evidence references
  manifest.json            live endpoints and verification results (after deploy)
  .github/workflows/       build-images.yml
```

## 8. Who may write what

| Artifact | Model may | Model may not |
|---|---|---|
| `values.yaml` | write every slot | add keys outside `template.yaml` |
| `constitution/agents/*.yaml` | author fully | omit required keys, bind unknown plugins |
| `catalogue/plugins.yaml` | add entries from the real harness interface (Stage 0) | invent plugins |
| `catalogue/images.yaml` | flip `unverified` to `verified` with evidence | add images with no source |
| `images/**`, notebook non-CONFIG cells | change only as deliberate template maintenance, with tests | change them inside a firm |
| rendered files | nothing by hand | edit; re-render instead |
| secrets | explain, name, wire references | see, store or echo values |

## 9. What each platform can run

| Surface | Docker image | Notebook | Persistent | Notes |
|---|---|---|---|---|
| Local machine | yes (compose) | yes (Jupyter) | while the machine is on | only place `firm-humanoid` can run |
| HF Space (Docker SDK) | built from Dockerfile | no | yes, free CPU basic tier sleeps when idle | control plane, UI |
| HF Job | image from Docker Hub or a Space (check GHCR support before relying on it) | no | batch | buckets mount as volumes via `-v` |
| Kaggle | no daemon | yes | no, scheduled/ephemeral | GPU weekly quota; weights can be a Kaggle dataset |
| Colab | no daemon | yes | no, interactive session | no scheduling, no API to start runs |

Architecture: `firm-worker` builds for amd64 and arm64; `firm-inference` is amd64 and needs an NVIDIA GPU.
Do not assume Docker exists on a surface; check `deploys_to` in the catalogue.
