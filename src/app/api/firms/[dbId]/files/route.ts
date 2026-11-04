import { NextResponse } from 'next/server'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { renderedDir, stateDir, workspaceDir } from '@/lib/firm-forge/paths'
import type { FileNode } from '@/lib/firm-forge/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ dbId: string }> }

const SKIP_DIRS = new Set(['.git', '__pycache__', 'node_modules'])

function listDir(abs: string, rel: string): FileNode[] {
  const nodes: FileNode[] = []
  let entries
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return nodes
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    const childAbs = path.join(abs, entry.name)
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: childRel, type: 'dir', children: listDir(childAbs, childRel) })
    } else if (entry.isFile()) {
      let size = 0
      try {
        size = statSync(childAbs).size
      } catch {
        /* ignore */
      }
      nodes.push({ name: entry.name, path: childRel, type: 'file', size })
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return nodes
}

/** GET /api/firms/[dbId]/files → { tree: FileNode[] } (rendered/ + state/, dirs first). */
export async function GET(_req: Request, { params }: Params) {
  const { dbId } = await params
  const firm = await db.firm.findUnique({ where: { id: dbId } })
  if (!firm) return NextResponse.json({ error: `firm not found: ${dbId}` }, { status: 404 })
  const ws = workspaceDir(firm.firmId)
  if (!existsSync(ws)) return NextResponse.json({ tree: [] })
  const nodes: FileNode[] = []
  for (const [dir, rel] of [
    [renderedDir(firm.firmId), 'rendered'],
    [stateDir(firm.firmId), 'state'],
  ] as const) {
    if (existsSync(dir)) {
      nodes.push({ name: rel, path: rel, type: 'dir', children: listDir(dir, rel) })
    }
  }
  // top-level workspace files worth browsing (values input + E2E manifest)
  for (const name of ['values.yaml', 'manifest.json']) {
    const p = path.join(ws, name)
    if (existsSync(p) && statSync(p).isFile()) {
      nodes.push({ name, path: name, type: 'file', size: statSync(p).size })
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return NextResponse.json({ tree: nodes })
}
