import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SKILL_DIR } from '@/lib/firm-forge/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REFERENCE_FILES = [
  'architecture-and-contracts.md',
  'credentials.md',
  'deploy-recipes.md',
  'provider-discovery.md',
  'validation-and-recovery.md',
]

/** GET /api/playbook → { skill, references } — pure text passthrough of SKILL.md + the five references. */
export async function GET() {
  let skill = ''
  try {
    skill = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
  } catch {
    skill = ''
  }
  const references = REFERENCE_FILES.map((name) => {
    let content = ''
    try {
      content = readFileSync(path.join(SKILL_DIR, 'references', name), 'utf8')
    } catch {
      content = ''
    }
    return { name, content }
  })
  return NextResponse.json({ skill, references })
}
