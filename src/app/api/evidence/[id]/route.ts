import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toEvidenceDef, validateEvidenceInput } from '@/lib/firm-forge/helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/evidence/[id] body partial EvidenceInput → { record }. */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const existing = await db.evidenceRecord.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: `evidence record not found: ${id}` }, { status: 404 })
  const body = await req.json().catch(() => null)
  const { issues, data } = validateEvidenceInput(body, true)
  if (issues.length > 0) {
    return NextResponse.json({ error: issues.map((i) => `${i.field}: ${i.message}`).join('; ') }, { status: 400 })
  }
  const record = await db.evidenceRecord.update({ where: { id }, data })
  return NextResponse.json({ record: toEvidenceDef(record) })
}

/** DELETE /api/evidence/[id] → { ok }. */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const existing = await db.evidenceRecord.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: `evidence record not found: ${id}` }, { status: 404 })
  await db.evidenceRecord.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
