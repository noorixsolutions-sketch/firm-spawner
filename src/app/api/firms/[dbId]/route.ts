import { NextResponse } from 'next/server'
import { rmSync } from 'node:fs'
import { db } from '@/lib/db'
import { toFirmDef, validateFirmInput } from '@/lib/firm-forge/helpers'
import { defaultStateBucket, workspaceDir } from '@/lib/firm-forge/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ dbId: string }> }

/** GET /api/firms/[dbId] → { firm } */
export async function GET(_req: Request, { params }: Params) {
  const { dbId } = await params
  const firm = await db.firm.findUnique({
    where: { id: dbId },
    include: { agents: true, decisions: true, runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!firm) return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
  return NextResponse.json({ firm: toFirmDef(firm, firm.runs[0] ?? null) })
}

/** PATCH /api/firms/[dbId] body FirmInput → { firm }. `agents` (when present) replaces the roster. */
export async function PATCH(req: Request, { params }: Params) {
  const { dbId } = await params
  const firm = await db.firm.findUnique({ where: { id: dbId } })
  if (!firm) return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
  const body = await req.json().catch(() => null)
  const { issues, data, agents } = validateFirmInput(body, 'update')
  if (issues.length > 0) {
    return NextResponse.json({ error: issues.map((i) => `${i.field}: ${i.message}`).join('; ') }, { status: 400 })
  }
  if (data.firmId && data.firmId !== firm.firmId) {
    const clash = await db.firm.findUnique({ where: { firmId: data.firmId } })
    if (clash) return NextResponse.json({ error: `firmId already exists: ${data.firmId}` }, { status: 409 })
  }
  const update: Record<string, unknown> = { ...data }
  if (data.firmId) update.stateBucket = defaultStateBucket(data.firmId)
  await db.$transaction(async (tx) => {
    await tx.firm.update({ where: { id: dbId }, data: update })
    if (agents) {
      await tx.agent.deleteMany({ where: { firmId: dbId } })
      await tx.agent.createMany({
        data: agents.map((a) => ({
          firmId: dbId,
          fileName: a.fileName,
          agentId: a.agentId,
          role: a.role,
          responsibilities: a.responsibilities,
          plugins: a.plugins,
          permissions: a.permissions,
          reportsTo: a.reportsTo,
        })),
      })
    }
  })
  const full = await db.firm.findUnique({
    where: { id: dbId },
    include: { agents: true, decisions: true },
  })
  return NextResponse.json({ firm: toFirmDef(full!) })
}

/** DELETE /api/firms/[dbId] → { ok } + rm -rf the workspace dir. */
export async function DELETE(_req: Request, { params }: Params) {
  const { dbId } = await params
  const firm = await db.firm.findUnique({ where: { id: dbId } })
  if (!firm) return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
  try {
    rmSync(workspaceDir(firm.firmId), { recursive: true, force: true })
  } catch {
    /* workspace may not exist */
  }
  await db.firm.delete({ where: { id: dbId } })
  return NextResponse.json({ ok: true })
}
