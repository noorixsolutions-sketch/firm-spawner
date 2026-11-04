import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { defaultAgents, toFirmDef, validateFirmInput } from '@/lib/firm-forge/helpers'
import { defaultStateBucket } from '@/lib/firm-forge/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/firms → { firms: FirmDef[] } (with agents, decisions, lastRun). */
export async function GET() {
  const firms = await db.firm.findMany({
    include: {
      agents: true,
      decisions: true,
      runs: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ firms: firms.map((f) => toFirmDef(f, f.runs[0] ?? null)) })
}

/** POST /api/firms body FirmInput → { firm } (201). Creates default agents when none passed. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const { issues, data, agents } = validateFirmInput(body, 'create')
  if (issues.length > 0) {
    return NextResponse.json({ error: issues.map((i) => `${i.field}: ${i.message}`).join('; ') }, { status: 400 })
  }
  const firmId = data.firmId as string
  const existing = await db.firm.findUnique({ where: { firmId } })
  if (existing) {
    return NextResponse.json({ error: `firmId already exists: ${firmId}` }, { status: 409 })
  }
  const firm = await db.firm.create({
    data: {
      firmId,
      name: data.name as string,
      purpose: data.purpose as string,
      ownerGmail: data.ownerGmail as string,
      repo: data.repo as string,
      stateBucket: defaultStateBucket(firmId),
      inferenceEnabled: data.inferenceEnabled ?? true,
      modelRepo: data.modelRepo ?? 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
      modelFile: data.modelFile ?? 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
      llamaCppRef: data.llamaCppRef ?? 'b12103',
      ctx: data.ctx ?? 8192,
      modelBackends: data.modelBackends ?? ['workspace-llm'],
      harnessRuntime: data.harnessRuntime ?? 'prime-agent',
      controlTarget: data.controlTarget ?? 'local',
      workerTargets: data.workerTargets ?? ['local', 'kaggle'],
      kaggleWorkers: data.kaggleWorkers ?? 1,
      colabWorkers: data.colabWorkers ?? 0,
      kaggleSchedule: data.kaggleSchedule ?? '0 */6 * * *',
      hfSpaceHardware: data.hfSpaceHardware ?? 'cpu-basic',
      idleExitSeconds: data.idleExitSeconds ?? 900,
      pluginBindings: data.pluginBindings ?? ['state.store', 'inference.openai_compat', 'governance.human_gate'],
      secretsRequired: data.secretsRequired ?? ['HF_TOKEN'],
    },
  })
  const agentList = agents && agents.length > 0 ? agents : defaultAgents()
  await db.agent.createMany({
    data: agentList.map((a) => ({
      firmId: firm.id,
      fileName: a.fileName,
      agentId: a.agentId,
      role: a.role,
      responsibilities: a.responsibilities,
      plugins: a.plugins,
      permissions: a.permissions,
      reportsTo: a.reportsTo,
    })),
  })
  const full = await db.firm.findUnique({
    where: { id: firm.id },
    include: { agents: true, decisions: true },
  })
  return NextResponse.json({ firm: toFirmDef(full!) }, { status: 201 })
}
