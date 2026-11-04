import { NextResponse } from 'next/server'
import { appendFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { toDecisionDef } from '@/lib/firm-forge/helpers'
import { renderedDir } from '@/lib/firm-forge/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/decisions?firmId=<dbId> → { decisions: DecisionDef[] } (all when firmId omitted). */
export async function GET(req: Request) {
  const firmId = new URL(req.url).searchParams.get('firmId')
  if (firmId) {
    const firm = await db.firm.findUnique({ where: { id: firmId }, select: { id: true } })
    if (!firm) return NextResponse.json({ error: `firm not found: ${firmId}` }, { status: 404 })
    const decisions = await db.decision.findMany({
      where: { firmId },
      orderBy: { decidedAt: 'asc' },
    })
    return NextResponse.json({ decisions: decisions.map(toDecisionDef) })
  }
  const decisions = await db.decision.findMany({ orderBy: { decidedAt: 'asc' } })
  return NextResponse.json({ decisions: decisions.map(toDecisionDef) })
}

/**
 * POST /api/decisions body { firmId (db id), capability, choice, evidence, verifiedAt } →
 * { decision }. Also appends the line to <ws>/rendered/decisions.jsonl when it exists.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected a JSON object' }, { status: 400 })
  }
  const firmDbId = typeof body.firmId === 'string' ? body.firmId : ''
  const capability = typeof body.capability === 'string' ? body.capability.trim() : ''
  const choice = typeof body.choice === 'string' ? body.choice.trim() : ''
  const evidence = typeof body.evidence === 'string' ? body.evidence.trim() : ''
  const verifiedAt = typeof body.verifiedAt === 'string' ? body.verifiedAt.trim() : ''
  const missing = [
    ['firmId', firmDbId],
    ['capability', capability],
    ['choice', choice],
    ['evidence', evidence],
    ['verifiedAt', verifiedAt],
  ]
    .filter(([, v]) => v === '')
    .map(([k]) => k)
  if (missing.length > 0) {
    return NextResponse.json({ error: `missing required field(s): ${missing.join(', ')}` }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt)) {
    return NextResponse.json({ error: 'verifiedAt must be YYYY-MM-DD' }, { status: 400 })
  }
  const firm = await db.firm.findUnique({ where: { id: firmDbId } })
  if (!firm) return NextResponse.json({ error: `firm not found: ${firmDbId}` }, { status: 404 })
  const decision = await db.decision.create({
    data: { firmId: firmDbId, capability, choice, evidence, verifiedAt },
  })
  const jsonl = path.join(renderedDir(firm.firmId), 'decisions.jsonl')
  if (existsSync(jsonl)) {
    try {
      appendFileSync(
        jsonl,
        JSON.stringify({
          capability,
          choice,
          evidence,
          verified_at: verifiedAt,
          decided_at: decision.decidedAt.toISOString(),
        }) + '\n',
      )
    } catch {
      /* best-effort append */
    }
  }
  return NextResponse.json({ decision: toDecisionDef(decision) }, { status: 201 })
}
