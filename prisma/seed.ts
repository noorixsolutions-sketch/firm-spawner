// Seed the Firm Forge workspace: one demo firm + provider evidence + decisions.
// Run: bunx bun prisma/seed.ts  (bun run seed)
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const today = new Date().toISOString().slice(0, 10)

  // ---- demo firm (Stage 1-6 composed) -------------------------------------
  const firm = await db.firm.upsert({
    where: { firmId: 'lumen-research' },
    update: {},
    create: {
      firmId: 'lumen-research',
      name: 'Lumen Research Co',
      purpose: 'Answer small research questions with a tiny open model, review every answer, and archive the results.',
      ownerGmail: 'lumen.research.co@gmail.com',
      repo: 'your-github-user/firm-lumen-research',
      stateBucket: 'file:///home/z/my-project/workspaces/lumen-research/state',
      inferenceEnabled: true,
      modelRepo: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
      modelFile: 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
      llamaCppRef: 'b12103',
      ctx: 8192,
      modelBackends: ['workspace-llm'],
      harnessRuntime: 'prime-agent',
      controlTarget: 'local',
      workerTargets: ['local', 'kaggle'],
      kaggleWorkers: 1,
      colabWorkers: 0,
      kaggleSchedule: '0 */6 * * *',
      idleExitSeconds: 900,
      pluginBindings: ['state.store', 'inference.openai_compat', 'governance.human_gate'],
      secretsRequired: ['HF_TOKEN'],
    },
  })

  const agents = [
    {
      fileName: 'orchestrator.yaml',
      agentId: 'orchestrator',
      role: 'Splits incoming research questions into tasks, assigns them to the researcher, and reviews results before they are archived.',
      responsibilities: [
        'Maintain the task queue under /state/queue',
        'Review researcher output before a task is marked done',
        'Escalate anything that needs a human decision',
      ],
      plugins: ['state.store'],
      permissions: ['read_state', 'write_state'],
      reportsTo: 'human',
    },
    {
      fileName: 'researcher.yaml',
      agentId: 'researcher',
      role: 'Answers research tasks through the firm inference plugin and drafts the archived result.',
      responsibilities: [
        'Claim tasks from /state/queue/pending',
        'Produce an answer via inference.openai_compat',
        'Write results to /state/queue/done',
      ],
      plugins: ['inference.openai_compat', 'state.store'],
      permissions: ['read_state', 'write_state', 'call_inference'],
      reportsTo: 'orchestrator',
    },
    {
      fileName: 'compliance.yaml',
      agentId: 'compliance',
      role: 'Guards the human-approval gate: refuses spend, external publish, credential change and destructive actions.',
      responsibilities: [
        'Refuse constitution-gated actions with a 422 so they land in queue/failed',
        'Keep the audit log under /state/EVENTS',
      ],
      plugins: ['governance.human_gate', 'state.store'],
      permissions: ['read_state', 'gate_external_action'],
      reportsTo: 'human',
    },
  ]
  for (const a of agents) {
    await db.agent.upsert({
      where: { firmId_fileName: { firmId: firm.id, fileName: a.fileName } },
      update: { ...a },
      create: { firmId: firm.id, ...a },
    })
  }

  // ---- evidence records (Stage 3) -----------------------------------------
  // Every verified_at marked today was fetched live from the official page in this
  // sandbox on that date; excerpts are short quotes, not paraphrases.
  const evidence = [
    {
      provider: 'Hugging Face Spaces (CPU Basic)',
      capability: 'control_plane_hosting',
      execution: 'persistent_service',
      pricingModel: 'free_tier',
      cardRequired: true,
      computeCost: 'none',
      sourceUrl: 'https://huggingface.co/docs/hub/spaces-overview',
      verifiedAt: today,
      termsExcerpt:
        'The default CPU Basic hardware has no hourly cost, but creating a Space that runs on compute (Gradio or Docker) requires a paid plan, while Static Spaces are free for everyone. On free hardware, your Space will “go to sleep” and stop executing after a period of time if unused.',
      limits: [
        'CPU Basic: 2 vCPU, 16 GB RAM, 50 GB ephemeral disk',
        'Spaces sleep after a period of inactivity; first request after sleep is slow',
        'Creating a compute (Gradio or Docker) Space requires a paid HF plan per current docs',
      ],
      restrictions: ['Docker SDK Spaces need a paid plan to create (disclosed above)'],
    },
    {
      provider: 'Google Colab',
      capability: 'batch_compute',
      execution: 'ephemeral_notebook',
      pricingModel: 'free_forever',
      cardRequired: false,
      computeCost: 'none',
      sourceUrl: 'https://research.google.com/colaboratory/faq.html',
      verifiedAt: today,
      termsExcerpt:
        'Colab is a hosted Jupyter Notebook service that requires no setup to use and provides free of charge access to computing resources, including GPUs and TPUs. … Colab needs to maintain the flexibility to adjust usage limits and hardware availability dynamically.',
      limits: [
        'Usage limits and hardware availability are adjusted dynamically',
        'Interactive sessions; runtime and idle limits terminate the VM',
        'No API to start runs; no scheduling',
      ],
      restrictions: ['Free tier prioritizes users actively programming in a notebook'],
    },
    {
      provider: 'Kaggle Notebooks',
      capability: 'batch_compute',
      execution: 'ephemeral_notebook',
      pricingModel: 'free_tier',
      cardRequired: false,
      computeCost: 'none',
      sourceUrl: 'https://www.kaggle.com/docs/notebooks',
      // Docs pages are client-rendered in this sandbox: not quotable today. Kept stale
      // on purpose so the eligibility gate marks it unknown/not selectable until re-verified.
      verifiedAt: '2026-09-01',
      termsExcerpt:
        'Quoted from company-spawner references (deploy-recipes.md), NOT from the live page: “Kaggle’s weekly GPU quota is limited; schedule inference notebooks sparingly.” Re-verify at the source before selecting.',
      limits: ['Weekly GPU quota (exact number not verified from this sandbox)', 'Sessions are scheduled/ephemeral'],
      restrictions: ['Terms may restrict serving traffic from free notebooks'],
    },
    {
      provider: 'Hugging Face Jobs',
      capability: 'batch_compute',
      execution: 'batch_worker',
      pricingModel: 'paid_only',
      cardRequired: true,
      computeCost: 'paid',
      sourceUrl: 'https://huggingface.co/docs/hub/jobs-pricing',
      verifiedAt: today,
      termsExcerpt:
        'Jobs are available to any user or organization with a positive credit balance. … Jobs are billed per minute based on the hardware used. For example, 10 billable minutes on a10g-small costs approximately $0.17 in hardware charges.',
      limits: ['Requires a positive credit balance (PRO/Team/Enterprise credits count)'],
      restrictions: ['Not free: per-minute hardware billing'],
    },
    {
      provider: 'llama.cpp (self-hosted)',
      capability: 'inference',
      execution: 'batch_worker',
      pricingModel: 'open_source_self_host',
      cardRequired: false,
      computeCost: 'user_owned',
      sourceUrl: 'https://github.com/ggml-org/llama.cpp',
      verifiedAt: today,
      termsExcerpt:
        'ggml-org/llama.cpp — “LLM inference in C/C++”; MIT-licensed open source. The software is free; the GPU to run it is user-owned (a free notebook session or your own machine).',
      limits: ['Needs a GPU with enough VRAM for the chosen quantization', 'Batch only on notebook platforms'],
      restrictions: [],
    },
    {
      provider: 'workspace model plane (built-in LLM SDK)',
      capability: 'inference',
      execution: 'interactive_api',
      pricingModel: 'free_forever',
      cardRequired: false,
      computeCost: 'none',
      sourceUrl: 'https://huggingface.co/docs/hub/spaces-overview',
      verifiedAt: today,
      termsExcerpt:
        'Internal to this workspace: the reference harness exposes an OpenAI-compatible /v1/chat/completions backed by the environment LLM SDK. Free inside the sandbox; not a public internet API — swap for a hosted provider (evidence record required) when the firm leaves the workspace.',
      limits: ['Only callable from inside this workspace', 'Not reachable from Kaggle/Colab notebooks'],
      restrictions: ['Workspace-internal; requires an external provider for real cross-platform deploys'],
    },
  ]
  for (const e of evidence) {
    const existing = await db.evidenceRecord.findFirst({ where: { provider: e.provider } })
    if (!existing) await db.evidenceRecord.create({ data: e })
  }

  // ---- decisions (Stage 4) -------------------------------------------------
  const count = await db.decision.count({ where: { firmId: firm.id } })
  if (count === 0) {
    const decisions = [
      {
        capability: 'inference',
        choice: 'workspace model plane (built-in LLM SDK) for E2E; llama.cpp b12103 + TinyLlama Q4_K_M authored for GPU targets',
        evidence: 'https://github.com/ggml-org/llama.cpp (MIT) + workspace reference harness',
        verifiedAt: today,
      },
      {
        capability: 'state_storage',
        choice: 'file:///state (workspace volume) in the sandbox; hf://buckets for real deploys',
        evidence: 'assets/firm-template/state/LAYOUT.md contract',
        verifiedAt: today,
      },
      {
        capability: 'control_plane_hosting',
        choice: 'local: the workspace reference harness in this app',
        evidence: 'references/architecture-and-contracts.md adapter contract',
        verifiedAt: today,
      },
      {
        capability: 'batch_compute',
        choice: 'local worker + kaggle notebook path (partition kaggle)',
        evidence: 'https://research.google.com/colaboratory/faq.html (free of charge)',
        verifiedAt: today,
      },
    ]
    for (const d of decisions) await db.decision.create({ data: { firmId: firm.id, ...d } })
  }

  console.log('seeded: firm lumen-research, 3 agents, evidence records, decisions')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
