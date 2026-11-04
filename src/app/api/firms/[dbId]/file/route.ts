import { NextResponse } from 'next/server'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { workspaceDir } from '@/lib/firm-forge/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ dbId: string }> }

const MAX_BYTES = 200 * 1024

/**
 * GET /api/firms/[dbId]/file?path=rendered/values.yaml →
 * { path, content, size, truncated }. Path-traversal guarded; text only, capped at 200KB;
 * .ipynb files are JSON-parsed and pretty-printed with 2-space indent.
 */
export async function GET(req: Request, { params }: Params) {
  const { dbId } = await params
  const firm = await db.firm.findUnique({ where: { id: dbId } })
  if (!firm) return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
  const rel = new URL(req.url).searchParams.get('path') ?? ''
  if (rel.trim() === '') return NextResponse.json({ error: 'missing ?path=' }, { status: 400 })
  const ws = workspaceDir(firm.firmId)
  const abs = path.resolve(ws, rel)
  if (abs !== ws && !abs.startsWith(ws + path.sep)) {
    return NextResponse.json({ error: `path escapes the workspace: ${rel}` }, { status: 400 })
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return NextResponse.json({ error: `file not found: ${rel}` }, { status: 404 })
  }
  const buf = readFileSync(abs)
  let content = buf.toString('utf8')
  if (rel.endsWith('.ipynb')) {
    try {
      content = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      /* fall back to raw text */
    }
  }
  const truncated = content.length > MAX_BYTES
  if (truncated) content = content.slice(0, MAX_BYTES)
  return NextResponse.json({ path: rel, content, size: buf.byteLength, truncated })
}
