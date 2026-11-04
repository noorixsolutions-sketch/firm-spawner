# Deployment recipes

Stage 10. Follow `pattern.yaml` order. Every step: probe current state, ask for approval, act, verify. Commands
below are the ones documented for each tool; for any flag you are not sure of, run `<tool> --help` first and use what it
prints. Do not guess flags.

Contents: 1 storage, 2 control plane on an HF Space, 3 workers on Kaggle, 4 workers on Colab, 5 HF Job, 6 local, 7 inference,
8 seed state, 9 versions and digests.

Execution tiers (from SKILL.md): in Tier A you run the commands; in Tier B you drive the web UI but the operator types secrets; in Tier C
you give the operator the steps and files and they report back status.

## 1. Storage

Create the state bucket (and the models bucket if the firm uses inference). HF buckets are managed through the `hf` CLI
(`hf buckets --help` shows create, copy, move, remove and sync). Name them after the firm: `<user>/<firm-id>-state`,
`<user>/<firm-id>-models`. Set `state.state_bucket` in values to `hf://buckets/<user>/<firm-id>-state`. Local firms use
`file:///state` backed by a docker volume.

Verify: list the bucket; write and read a small test object; delete it.

## 2. Control plane on an HF Space (Docker)

For `deploy.control_target: hf-space`, the harness (and optionally gateway and UI) run as a Docker Space.

1. Create a Space with the Docker SDK (`hf repo create --help` for the current flags, or the web UI).
2. The Space repo root holds the Dockerfile of the verified harness image and a `README.md` whose YAML header declares `sdk: docker` and the `app_port` the harness listens on. Take both from the verified catalogue entry; do not guess the port.
3. Space Settings, Variables and secrets: add each name in `secrets.required` (operator types values).
4. Mount the state bucket as a volume at `/state` (the Spaces volume-mount guide on the Hub docs shows the current method).
5. Push the files (`git` to the Space repo). HF builds the image; no local Docker needed.
6. Watch the build log. Verify: `GET <space-url>/health` returns 200, and `/state/HEALTH` shows the harness.

The free CPU tier sleeps when idle; the first request after sleep is slow. Say so to the operator, and do not configure
anything that depends on instant response.

## 3. Workers on Kaggle

Kaggle cannot run Docker; the notebook runs the same worker code.

1. Take `notebooks/kaggle.worker.ipynb` (and `kaggle.inference.ipynb` if inference is enabled) from the rendered repo. Run `scripts/scan_secrets.py` on them.
2. Operator adds the secrets in the notebook's Add-ons, Secrets (`HF_TOKEN`, plus `GITHUB_TOKEN` if the firm repo is private).
3. Tier A: write a `kernel-metadata.json` (`id`, `title`, `code_file`, `language`, `kernel_type`, `is_private`, `enable_gpu`, `enable_internet`, plus `dataset_sources` if weights are a dataset) next to the notebook and run `kaggle kernels push -p <dir>`. Internet must be enabled or the clone and installs fail. GPU on for inference.
4. Weights for inference: upload once as a Kaggle dataset (`kaggle datasets create -p <dir>`) and attach it; the notebook reads it from `/kaggle/input/firm-models` so nothing is downloaded each run.
5. Scheduling: set the recurrence in the notebook's own settings in the Kaggle UI (guided step for the operator); `deploy.kaggle_schedule` documents the intended cadence. Do not claim the API sets it unless you have verified that in current Kaggle docs.
6. Verify: run it once; the log must show `bootstrap ok`, the worker claim loop, and, after enqueueing a test task, a file in `queue/done`.

Kaggle's weekly GPU quota is limited; schedule inference notebooks sparingly and tell the operator the actual quota from the evidence record.

## 4. Workers on Colab

No API starts Colab runs, so Colab is guided and interactive.

1. Open the notebook from GitHub: `https://colab.research.google.com/github/<owner>/<repo>/blob/<commit>/notebooks/colab.worker.ipynb` (private repos need Colab's GitHub authorization, or the operator uploads the rendered `.ipynb` file).
2. Secrets: key icon in the left sidebar, add `HF_TOKEN` (and `GITHUB_TOKEN`), switch on Notebook access.
3. Runtime menu: change runtime type (GPU for inference), then Run all.
4. Verify as for Kaggle. Tell the operator the session ends when idle or at the runtime limit; `deploy.idle_exit_seconds` makes the worker exit cleanly before that.

## 5. HF Job

For `hf-job` workers: HF Jobs run a Docker image from Docker Hub or from a Space, and accept volumes. Documented form:
`hf jobs run -v hf://buckets/<user>/<bucket>:/data <image> <command>`. Confirm with `hf jobs run --help` and confirm that the
image source you plan to use (a Docker Hub image, or a Space build; GHCR support is not established here) is accepted, and
confirm the Job's hardware is free-eligible via an evidence record before using it. Mount the state bucket at `/state`.
Pass secrets as job secrets.

## 6. Local

```
cp .env.example .env     # operator fills values; chmod 600
docker compose -f compose/local.yml up -d              # harness + worker
docker compose -f compose/local.yml --profile gpu up -d  # adds inference (needs NVIDIA GPU + container toolkit)
```

`HARNESS_IMAGE` and `LLAMA_CPP_REF` come from `versions.lock`. The compose file refuses to start without them. Verify with
`docker compose ps` (all healthy) and the end-to-end task.

## 7. Inference

Only when `inference.enabled`. Choose per the decision record: a hosted free-tier API (no image needed; set `model_plane.backends`
and the provider key secret), or `firm-inference` on Kaggle or Colab (batch, ephemeral), HF Job, or a local GPU. State plainly what
the operator gets: a Kaggle or Colab inference notebook serves only while the session lives and answers `inference` tasks from the
queue; it is not a permanent public endpoint.

## 8. Seed state

Copy `constitution/`, `plugins/bindings.yaml` and `state/LAYOUT.md` into `/state/constitution/` (and create the empty queue
directories). The harness loads agents and plugin bindings from there. Verify by reading them back.

## 9. Versions and digests

- Pick the llama.cpp release tag or commit to build (`LLAMA_CPP_REF`) from llama.cpp's own releases page, and record it.
- Run the `build-images` workflow (GitHub Actions) or let the HF Space build; read each image's `sha256:` digest from the workflow
  summary or build output, and write it into `versions.lock`:

```yaml
llama_cpp_ref: <tag-or-sha>
images:
  firm-worker:    { digest: "sha256:<64 hex>" }
  firm-inference: { digest: "sha256:<64 hex>" }
```

- **Pinning `firm.commit`.** A notebook cannot name the SHA of the commit that contains it. So publish in two commits: commit A holds `images/`
  and `requirements.lock` (the fixed logic the notebooks clone); take its full 40-character SHA, set `firm.commit` in `values.yaml` to it,
  re-render, and push commit B (notebooks with the pin, plus everything else). Notebooks then clone commit A's exact machinery.
  Then run `python3 scripts/validate.py --rendered <dir> --publish`.
- GitHub Actions needs the repo variable `LLAMA_CPP_REF` set (Settings, Secrets and variables, Variables).
