import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toTestRunDef } from '@/lib/firm-forge/helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ dbId: string }> }

/** GET /api/firms/[dbId]/runs → { runs: TestRunDef[] } (latest first, cap 20). */
export async function GET(_req: Request, { params }: Params) {
  const { dbId } = await params
  const firm = await db.firm.findUnique({ where: { id: dbId }, select: { id: true } })
  if (!firm) return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
  const runs = await db.testRun.findMany({
    where: { firmDbId: dbId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return NextResponse.json({ runs: runs.map(toTestRunDef) })
}
