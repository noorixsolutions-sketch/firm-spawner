import { NextResponse } from 'next/server'
import { runTask } from '@/lib/firm-forge/harness'
import type { TaskRecord } from '@/lib/firm-forge/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ firmId: string }> }

/**
 * POST /api/harness/firms/[firmId]/v1/tasks/run — the worker adapter contract.
 * body = task JSON {id, type, payload, ...}. Governance gate FIRST: payload.action in the
 * constitution's human_approval_required_for → 422 (the reason rides in the HTTP status line
 * so urllib HTTPError strings carry it into queue/failed last_error).
 */
export async function POST(req: Request, { params }: Params) {
  const { firmId } = await params
  const body = await req.json().catch(() => null)
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).id !== 'string' ||
    typeof (body as Record<string, unknown>).type !== 'string'
  ) {
    return NextResponse.json({ error: 'invalid task JSON: expected {id, type, payload}' }, { status: 400 })
  }
  const task = body as unknown as TaskRecord
  const res = await runTask(firmId, task)
  if (res.statusText) {
    // NextResponse.json drops custom reason phrases; build the Response directly.
    return new NextResponse(JSON.stringify(res.body), {
      status: res.code,
      statusText: res.statusText,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return NextResponse.json(res.body, { status: res.code })
}
