import { NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { db } from '@/lib/db'
import { renderedDir, workspaceDir } from '@/lib/firm-forge/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ dbId: string }> }

/**
 * GET /api/firms/[dbId]/download → tar.gz stream of rendered/
 * (spawn `tar -czf - -C <ws> rendered`). 404 when the firm was never built.
 */
export async function GET(_req: Request, { params }: Params) {
  const { dbId } = await params
  const firm = await db.firm.findUnique({ where: { id: dbId } })
  if (!firm) return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
  const ws = workspaceDir(firm.firmId)
  if (!existsSync(renderedDir(firm.firmId))) {
    return NextResponse.json({ error: 'firm not built yet — run a build first' }, { status: 404 })
  }
  // --exclude=.git: the E2E's notebook-bootstrap simulation inits a git repo inside
  // rendered/; its internals must not ship with the firm repo archive.
  const child = spawn('tar', ['-czf', '-', '--exclude=.git', '-C', ws, 'rendered'], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.on('error', () => {
    child.stdout.destroy()
  })
  const body = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  return new Response(body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="firm-${firm.firmId}.tar.gz"`,
    },
  })
}
