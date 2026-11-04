import { NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnCapture } from '@/lib/firm-forge/python'
import { HARNESS_BASE, SKILL_DIR, WORKSPACES_DIR } from '@/lib/firm-forge/paths'
import type { WorkspaceHealth } from '@/lib/firm-forge/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ---------- lazy pytest cache (run at most once per 60s, in the background) ----------

let pytestCache: { at: number; passed: number; failed: number } | null = null
let pytestInFlight: Promise<void> | null = null

async function runSelftestPytest(): Promise<{ passed: number; failed: number }> {
  const res = await spawnCapture('python3', ['-m', 'pytest', 'tests', '-q'], {
    cwd: SKILL_DIR,
    timeoutMs: 180_000,
  })
  const text = res.stdout + res.stderr
  const passed = /(\d+) passed/.exec(text)
  const failed = /(\d+) failed/.exec(text)
  return {
    passed: passed ? Number(passed[1]) : 0,
    failed: failed ? Number(failed[1]) : 0,
  }
}

function refreshPytestIfNeeded(): void {
  const fresh = pytestCache && Date.now() - pytestCache.at < 60_000
  if (!fresh && !pytestInFlight) {
    pytestInFlight = runSelftestPytest()
      .then((r) => {
        pytestCache = { at: Date.now(), ...r }
      })
      .catch(() => {
        /* probe failure → keep reporting the last known result (or null) */
      })
      .finally(() => {
        pytestInFlight = null
      })
  }
}

// ---------- probes ----------

async function probeVersion(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const res = await spawnCapture(cmd, args, { timeoutMs: 8000 })
  return { ok: res.code === 0, out: (res.stdout + res.stderr).trim() }
}

/** GET /api/health → WorkspaceHealth. */
export async function GET() {
  refreshPytestIfNeeded()
  const [pythonV, yamlV, pytestV, gitV, dockerV, harness] = await Promise.all([
    probeVersion('python3', ['--version']),
    probeVersion('python3', ['-c', 'import yaml']),
    probeVersion('python3', ['-m', 'pytest', '--version']),
    probeVersion('git', ['--version']),
    probeVersion('docker', ['--version']),
    fetch(`${HARNESS_BASE}/api/harness/firms/lumen-research/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => ({ ok: r.ok, status: r.status }))
      .catch(() => ({ ok: false, status: 0 })),
  ])
  const skillPresent = existsSync(path.join(SKILL_DIR, 'SKILL.md'))
  const pythonVersion = pythonV.out.replace(/^Python\s*/i, '')
  const health: WorkspaceHealth = {
    ok: pythonV.ok && yamlV.ok && pytestV.ok && skillPresent && gitV.ok,
    python: {
      version: pythonV.ok ? pythonVersion : '',
      yaml: yamlV.ok,
      pytest: pytestV.ok,
    },
    skill: {
      present: skillPresent,
      tests: pytestCache ? { passed: pytestCache.passed, failed: pytestCache.failed } : null,
    },
    harness: {
      up: harness.ok,
      url: `${HARNESS_BASE}/api/harness/firms/lumen-research/health`,
      firmId: 'lumen-research',
    },
    docker: dockerV.ok,
    git: gitV.ok,
    workspacesDir: WORKSPACES_DIR,
    time: new Date().toISOString(),
  }
  return NextResponse.json(health)
}
