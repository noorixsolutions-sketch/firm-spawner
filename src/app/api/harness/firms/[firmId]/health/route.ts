import { NextResponse } from 'next/server'
import { harnessHealth } from '@/lib/firm-forge/harness'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ firmId: string }> }

/**
 * GET /api/harness/firms/[firmId]/health — firmId is the FIRM SLUG.
 * 200 {status:'ok', firm_id, name, runtime, agents, ts} when the constitution is seeded;
 * 503 {status:'unready', reason} otherwise.
 */
export async function GET(_req: Request, { params }: Params) {
  const { firmId } = await params
  const res = await harnessHealth(firmId)
  return NextResponse.json(res.body, { status: res.code })
}
