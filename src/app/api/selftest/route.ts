import { NextResponse } from 'next/server'
import { SKILL_DIR } from '@/lib/firm-forge/paths'
import { runPython } from '@/lib/firm-forge/python'
import type { SelfTestResult } from '@/lib/firm-forge/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 200

/** POST /api/selftest → SelfTestResult: the skill's own pytest suite (~10s). Nothing is stored. */
export async function POST() {
  const res = await runPython(['-m', 'pytest', 'tests', '-q'], {
    cwd: SKILL_DIR,
    timeoutMs: 180_000,
  })
  const text = `${res.stdout}${res.stderr ? (res.stdout.endsWith('\n') ? '' : '\n') + res.stderr : ''}`
  const passed = /(\d+) passed/.exec(text)
  const failed = /(\d+) failed/.exec(text)
  const passedCount = passed ? Number(passed[1]) : 0
  const failedCount = failed ? Number(failed[1]) : 0
  const result: SelfTestResult = {
    ok: res.code === 0 && failedCount === 0 && passedCount > 0,
    passed: passedCount,
    failed: failedCount,
    output: text.trim().slice(-20_000),
  }
  return NextResponse.json(result)
}
