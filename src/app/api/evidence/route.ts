import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toEvidenceDef, validateEvidenceInput } from '@/lib/firm-forge/helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/evidence → { records: EvidenceDef[] } */
export async function GET() {
  const records = await db.evidenceRecord.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ records: records.map(toEvidenceDef) })
}

/** POST /api/evidence body EvidenceInput → { record } (201). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const { issues, data } = validateEvidenceInput(body, false)
  if (issues.length > 0) {
    return NextResponse.json({ error: issues.map((i) => `${i.field}: ${i.message}`).join('; ') }, { status: 400 })
  }
  const record = await db.evidenceRecord.create({
    data: {
      provider: data.provider as string,
      capability: data.capability as string,
      execution: data.execution as string,
      pricingModel: data.pricingModel as string,
      cardRequired: data.cardRequired ?? false,
      computeCost: data.computeCost ?? 'none',
      sourceUrl: data.sourceUrl as string,
      verifiedAt: data.verifiedAt as string,
      termsExcerpt: data.termsExcerpt as string,
      limits: data.limits ?? [],
      restrictions: data.restrictions ?? [],
    },
  })
  return NextResponse.json({ record: toEvidenceDef(record) }, { status: 201 })
}
