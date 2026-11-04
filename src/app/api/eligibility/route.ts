import { NextResponse } from 'next/server'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@/lib/db'
import { NEEDS, validateEvidenceInput } from '@/lib/firm-forge/helpers'
import { SKILL_DIR } from '@/lib/firm-forge/paths'
import { runPythonJson } from '@/lib/firm-forge/python'
import type { EvidenceInput } from '@/lib/firm-forge/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ScriptResult {
  results?: {
    provider: string | null
    capability: string | null
    execution: string | null
    status: string
    selectable: boolean
    disclosures: string[]
    reasons: string[]
    source_url: string
    verified_at: string | null
  }[]
  selectable?: string[]
  error?: string
}

function toScriptRecord(rec: {
  provider: string
  capability: string
  execution: string
  pricingModel: string
  cardRequired?: boolean
  computeCost?: string
  sourceUrl: string
  verifiedAt: string
  termsExcerpt: string
  limits?: string[]
  restrictions?: string[]
}): Record<string, unknown> {
  return {
    provider: rec.provider,
    capability: rec.capability,
    execution: rec.execution,
    pricing_model: rec.pricingModel,
    card_required: rec.cardRequired ?? false,
    compute_cost: rec.computeCost ?? 'none',
    source_url: rec.sourceUrl,
    verified_at: rec.verifiedAt,
    terms_excerpt: rec.termsExcerpt,
    limits: rec.limits ?? [],
    restrictions: rec.restrictions ?? [],
  }
}

/**
 * POST /api/eligibility body { records?: EvidenceInput[], need?: string } →
 * { results: EligibilityResult[], selectable: string[] }.
 * Runs the skill's scripts/eligibility.py on the given (or all DB) records.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const need = typeof body.need === 'string' && body.need !== '' ? body.need : undefined
  if (need && !(NEEDS as readonly string[]).includes(need)) {
    return NextResponse.json(
      { error: `need must be one of ${NEEDS.join(' | ')} (or omitted)` },
      { status: 400 },
    )
  }

  let records: ReturnType<typeof toScriptRecord>[] = []
  if (Array.isArray(body.records)) {
    const inputs: EvidenceInput[] = []
    const issues: string[] = []
    body.records.forEach((r, i) => {
      const { issues: recIssues, data } = validateEvidenceInput(r, false)
      if (recIssues.length > 0) issues.push(`records[${i}]: ${recIssues.map((x) => `${x.field}: ${x.message}`).join(', ')}`)
      else inputs.push(data as EvidenceInput)
    })
    if (issues.length > 0) return NextResponse.json({ error: issues.join('; ') }, { status: 400 })
    records = inputs.map(toScriptRecord)
  } else {
    const dbRecords = await db.evidenceRecord.findMany({ orderBy: { createdAt: 'asc' } })
    records = dbRecords.map((r) =>
      toScriptRecord({
        provider: r.provider,
        capability: r.capability,
        execution: r.execution,
        pricingModel: r.pricingModel,
        cardRequired: r.cardRequired,
        computeCost: r.computeCost,
        sourceUrl: r.sourceUrl,
        verifiedAt: r.verifiedAt,
        termsExcerpt: r.termsExcerpt,
        limits: typeof r.limits === 'string' ? [r.limits] : Array.isArray(r.limits) ? (r.limits as string[]) : [],
        restrictions: typeof r.restrictions === 'string' ? [r.restrictions] : Array.isArray(r.restrictions) ? (r.restrictions as string[]) : [],
      }),
    )
  }
  if (records.length === 0) {
    return NextResponse.json({ error: 'no evidence records to evaluate' }, { status: 400 })
  }

  const tmp = mkdtempSync(path.join(tmpdir(), 'firm-elig-'))
  try {
    const evidencePath = path.join(tmp, 'records.json')
    writeFileSync(evidencePath, JSON.stringify(records))
    const today = new Date().toISOString().slice(0, 10)
    const args = [
      path.join(SKILL_DIR, 'scripts', 'eligibility.py'),
      '--evidence',
      evidencePath,
      '--today',
      today,
    ]
    if (need) args.push('--need', need)
    const res = await runPythonJson<ScriptResult>(args, { timeoutMs: 60_000 })
    if (res.code === 2 || !res.json) {
      const err = res.json?.error ?? res.stderr.trim().slice(0, 300) ?? 'eligibility.py failed'
      return NextResponse.json({ error: `eligibility gate rejected the input: ${err}` }, { status: 400 })
    }
    return NextResponse.json({
      results: res.json.results ?? [],
      selectable: res.json.selectable ?? [],
    })
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* best-effort temp cleanup */
    }
  }
}
