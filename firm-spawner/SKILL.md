---
name: company-spawner
description: Spawn a complete, deployable digital company (a "firm") from a template firm made of Docker images, Colab/Kaggle notebooks, harness configuration and a values file. The model does the firm-specific creative work (agent roles and schemas, harness plugin selection, research and comparison of free platforms and providers, generation of secret-creation guides), fills the template with the firm's hard-coded values, validates it, and deploys it to the platforms the operator chose. Use this skill whenever the user wants to create, spawn, configure, deploy, clone, update, migrate or roll back a firm or company, asks which free platform or provider to use for inference, storage, hosting or compute, wants help creating API tokens or secrets for a firm, or mentions firm template, firm repo, Firm Forge, DSH harness plugins, notebook-based workers, or deploying agents to Hugging Face, Colab, Kaggle or a local machine. Use it even if the user does not say "skill" or "spawner".
---

# Company Spawner

You build and deploy a firm from a pre-engineered template. The operator is a solo developer
with no budget: everything is free by design, and you do the work. The operator supplies
decisions, approvals and, where no one else can, credentials (you walk them through each one).

The deployable unit is the **firm**: a GitHub repo holding rendered Docker image sources,
notebooks, harness configuration, agent definitions and a values file. Same template, N values
files, N firms.

## Division of labour

| Who | Does what |
|---|---|
| **You (the model)** | Author and maintain the template assets (images, notebooks, contracts). Write each firm's agents, roles, plugin selection and business mechanics. Research platforms and compare them. Draft secret-creation guides. Fill the template with the firm's values. Run validators. Deploy and verify. |
| **The operator** | Describes the business. Picks providers. Creates accounts and tokens on the pages you link, step by step. Approves every external side effect. |
| **Deterministic scripts** | Decide what must not depend on your judgment: placeholder resolution, schema checks, free-only eligibility, secret scanning, fixed-logic integrity. You run them and obey them. |

Judgment stays with you; compliance gates stay in code. When a script says no, the answer is no.

## Non-negotiable rules

1. **Free only.** `allow_paid` is false and cannot be set true. Selectable options are permanently free, open-source with no mandatory provider charge, or a genuine free tier. Trial credits do not count. State any payment-card requirement and every limit before the operator chooses. See `references/provider-discovery.md`.
2. **Evidence, not memory.** A provider's status comes from `scripts/eligibility.py` fed with a source URL, date and quoted terms. Never assert eligibility from memory.
3. **No invented infrastructure.** Only images in `catalogue/images.yaml` and plugins in `catalogue/plugins.yaml` may be used. Unknown or `unverified` entries are rejected until the inventory stage confirms them.
4. **Write only inside slots.** Firm facts go into the values file and agent files. Images and every notebook cell except CONFIG are fixed; `scripts/validate.py` checks they are unchanged.
5. **Secrets are names, never values.** Values live in each platform's secret store. They never enter chat, repos, notebooks, images, logs or your context. Run `scripts/scan_secrets.py` before anything leaves the machine.
6. **The operator approves external side effects.** Creating buckets, Spaces, jobs, repos, pushing code and pasting notebooks all wait for an explicit yes. If the operator runs a signed-order flow (mind/signer/hands), route those steps through it; otherwise their yes in chat is the approval.
7. **Read before you write.** Probe the real state of a platform before changing it, and verify after.
8. **Refuse, don't improvise.** If a required fact or interface is unknown, mark it UNKNOWN and ask. Never fabricate an API, image name or CLI flag; check `--help` or the official docs.
9. **Ephemeral is not production.** Colab and Kaggle sessions are batch workers. Never present them as persistent endpoints.

## What tools you have decides how you execute

Work out which tier applies at the start and say so in one line.

- **Tier A, shell and network:** run scripts and CLIs yourself (`git`, `hf`, `kaggle`). Only the operator's secret entry and approvals are manual.
- **Tier B, browser tool:** drive web UIs (Colab, Kaggle, token pages) step by step, but never type secret values yourself; the operator types them.
- **Tier C, chat only:** produce exact numbered steps with direct links, the files to copy (as downloadable files), and ask the operator to paste back non-secret probe results (status codes, logs with secrets removed).

The workflow is identical in every tier; only who presses the buttons changes.

## Workflow

Read each reference only when you reach its stage. Stages marked **[GATE]** need the operator's yes.

**Stage 0, inventory (once per workspace).** Find what exists: the firm harness and its real plugin interface, existing Dockerfiles and notebooks, the GitHub path, how secrets are stored. Record each as working, partial, broken or absent; anything not found is UNKNOWN. Update `catalogue/plugins.yaml` from the harness's real interface and flip catalogue images from `unverified` to `verified` only with evidence. "DSH" is not defined anywhere in this skill's sources; resolve what it is here and write it down. See `references/architecture-and-contracts.md` (Harness).

**Stage 1, business discovery.** Ask what the firm does and for whom. Capture purpose, operations, expected workload, data it touches, external services, human approval points. One or two questions at a time.

**Stage 2, capability decomposition.** Turn the business into capabilities from `catalogue/capabilities.yaml` (inference, state storage, control-plane hosting, batch compute, plus any the harness plugins provide). Do not name providers yet.

**Stage 3, research and compare.** For each capability, research current options, build evidence records, run `scripts/eligibility.py`, and compare only selectable options on what each actually does. See `references/provider-discovery.md`.

**Stage 4, operator decides [GATE].** Present the comparison with real choices (use whatever selection UI the host offers, else numbered options). The operator can pick one or several, reject all, or ask for more research. Record the decision in `decisions.jsonl` in the firm repo.

**Stage 5, guided provisioning.** For each chosen provider, give the operator the exact page, token type, minimum scopes and where to store it, then a non-secret check. See `references/credentials.md`. The operator creates and enters secrets; you wire names only.

**Stage 6, compose.** Choose images and platforms from the catalogue. Design the agents: id, role, responsibilities, plugins, permissions, who they report to. Select plugins from the catalogue. Write `values.yaml` from `assets/firm-template/values/example.yaml` and the agent files.

**Stage 7, render and validate.**

```bash
python3 scripts/render.py   --template assets/firm-template --values values.yaml --out rendered/<firm-id>
python3 scripts/validate.py --rendered rendered/<firm-id>
python3 scripts/scan_secrets.py rendered/<firm-id>
```

Fix the cause of every error, rerun, and never edit rendered files by hand. Rendering is deterministic: a fix goes into values or agents, then re-render.

**Stage 8, approve [GATE].** Show the operator the topology (which image runs where), chosen providers with their limits and card disclosures, secrets by name, permissions per agent, and the deployment plan. Wait for yes.

**Stage 9, publish [GATE].** Choose and record exact versions: pin `LLAMA_CPP_REF`, resolve image digests (from the CI summary or the platform build), write `versions.lock`, then publish in two commits (images first, so `firm.commit` can pin the SHA of the machinery the notebooks clone; see `references/deploy-recipes.md` section 9) and run `validate.py --publish`. Use the existing GitHub path. Never publish credentials.

**Stage 10, deploy [GATE per step].** Follow `pattern.yaml` order and the recipes in `references/deploy-recipes.md` for each chosen platform: storage, control plane, workers, inference, seed state.

**Stage 11, verify.** Probe every deployed asset, then run one real task end to end (enqueue, worker claims it, harness or inference answers, result lands in `queue/done`). Write `manifest.json` with each asset's endpoint and result. A firm whose containers start but whose task fails is not done. See `references/validation-and-recovery.md`.

**Lifecycle later:** update (edit values, re-render, validate, redeploy changed assets), pause and resume (stop workers, leave state), roll back (previous `versions.lock` and commit), migrate (same values, different `deploy.*` targets), destroy (operator confirms, then delete assets and revoke secrets).

## Where things live

```
SKILL.md                       this file
references/                    read per stage
  architecture-and-contracts.md what goes in images vs notebooks vs harness, with each contract
  provider-discovery.md          free-only policy, evidence records, comparison format
  credentials.md                 guided secret creation, links, non-secret checks
  deploy-recipes.md              HF Space/Job, Kaggle, Colab, local
  validation-and-recovery.md     verification, manifest, failures and fixes
catalogue/                     images.yaml, plugins.yaml, capabilities.yaml (reject-by-default)
assets/firm-template/          the template firm (template.yaml, pattern.yaml, images, notebooks, ...)
scripts/                       render.py, validate.py, eligibility.py, scan_secrets.py
tests/                         python3 -m pytest tests -q
```

## What you author versus what you fill

Authoring or changing the template (images, notebooks, contracts, scripts) is skill maintenance: do it
deliberately, run `python3 -m pytest tests -q`, and keep the contracts in
`references/architecture-and-contracts.md` true. Spawning a firm never changes the template; it only
produces values, agent files and a rendered copy.

## Reporting

Be plain and specific. After each stage say what was done, what was verified and how, and what is next.
Distinguish checked (a script or probe confirmed it) from assumed. Mock results and real results are
labelled as such. If something could not be completed, name exactly what is missing and the next
operator action.
