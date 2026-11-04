import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { FirmNotFoundError } from '@/lib/firm-forge/helpers'
import { buildFirm } from '@/lib/firm-forge/e2e'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

type Params = { params: Promise<{ dbId: string }> }

/**
 * POST /api/firms/[dbId]/build → BuildResult.
 * values.yaml → render.py → agent composition + decisions.jsonl → validate.py → scan_secrets.py.
 */
export async function POST(_req: Request, { params }: Params) {
  const { dbId } = await params
  try {
    const result = await buildFirm(dbId)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof FirmNotFoundError) {
      return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `build failed: ${message}` }, { status: 500 })
  }
}
