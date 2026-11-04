import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { FirmNotFoundError } from '@/lib/firm-forge/helpers'
import { runE2e } from '@/lib/firm-forge/e2e'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

type Params = { params: Promise<{ dbId: string }> }

/**
 * POST /api/firms/[dbId]/e2e → E2EResult (synchronous, 60–120s typical).
 * The 9-step golden path: build → seed state → harness health (real HTTP) → enqueue →
 * worker.py container path → governance refusal → bare/notebook path (git + run.sh) →
 * persistence → manifest. On a hard step failure dependents are skipped but independent
 * steps still run, and the TestRun is always persisted.
 */
export async function POST(_req: Request, { params }: Params) {
  const { dbId } = await params
  try {
    const result = await runE2e(dbId)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof FirmNotFoundError) {
      return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `e2e failed: ${message}` }, { status: 500 })
  }
}
