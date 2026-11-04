// Firm Forge — hand-rolled values.yaml / agent YAML emitters.
// Server-only. The output must satisfy firm-spawner/assets/firm-template/template.yaml
// exactly (render.py rejects unknown keys, unsafe chars, type errors) — the shape below
// mirrors the MASTER_SPEC generator 1:1 and adds nothing outside that schema.
import { asStringArray } from './helpers'
import { defaultStateBucket, harnessBaseUrl } from './paths'
import type { AgentDef } from './types'

/** Structural slice of a Prisma Firm row (Json fields arrive as unknown). */
export interface FirmValuesInput {
  firmId: string
  name: string
  purpose: string
  ownerGmail: string
  repo: string
  inferenceEnabled: boolean
  modelRepo: string
  modelFile: string
  llamaCppRef: string
  ctx: number
  modelBackends: unknown
  harnessRuntime: string
  controlTarget: string
  workerTargets: unknown
  kaggleWorkers: number
  colabWorkers: number
  kaggleSchedule: string
  hfSpaceHardware: string
  idleExitSeconds: number
  pluginBindings: unknown
  secretsRequired: unknown
}

/**
 * Make a string safe for render.py's UNSAFE_CHARS check:
 * strip quotes, backslashes, newlines and double-braces.
 */
export function sanitize(value: string): string {
  return value
    .replace(/"/g, '')
    .replace(/\\/g, '')
    .replace(/[\n\r]+/g, ' ')
    .replace(/\{\{/g, '')
    .replace(/\}\}/g, '')
    .trim()
}

/**
 * Emit a YAML scalar. Plain when unambiguous, single-quoted otherwise
 * (single quotes never appear in render.py's unsafe set — quoting in the FILE
 * is fine, only the parsed VALUE is checked).
 */
export function yamlScalar(value: string): string {
  const s = sanitize(value)
  if (s === '') return '""'
  const plainSafe =
    /^[A-Za-z0-9_]/.test(s) &&
    /^[A-Za-z0-9_./@+ -]*$/.test(s) &&
    !s.includes(':') &&
    !s.includes('#') &&
    !/\s$/.test(s) &&
    !['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'].includes(s.toLowerCase()) &&
    !/^[-+]?[0-9]+(\.[0-9]+)?$/.test(s)
  if (plainSafe) return s
  return `'${s.replace(/'/g, "''")}'`
}

/** Flow-style list of plain string scalars: [a, b, c]. */
export function yamlList(items: string[]): string {
  const cleaned = items.map((i) => sanitize(i)).filter((i) => i !== '')
  if (cleaned.length === 0) return '[]'
  return `[${cleaned.map((i) => yamlScalar(i)).join(', ')}]`
}

/**
 * Generate values.yaml exactly per the MASTER_SPEC generator.
 * state_bucket is resolved to the workspace path at render time (per the data model).
 */
export function generateValuesYaml(firm: FirmValuesInput, agentFileNames: string[]): string {
  const f = (v: string): string => yamlScalar(sanitize(v))
  const lines: string[] = []
  lines.push('firm:')
  lines.push(`  id: ${f(firm.firmId)}`)
  lines.push(`  name: ${f(firm.name)}`)
  lines.push(`  purpose: ${f(firm.purpose)}`)
  lines.push(`  owner_gmail: ${f(firm.ownerGmail)}`)
  lines.push(`  repo: ${f(firm.repo)}`)
  lines.push('  commit: main')
  lines.push('policy:')
  lines.push('  allow_paid: false')
  lines.push('state:')
  lines.push(`  state_bucket: ${f(defaultStateBucket(firm.firmId))}`)
  lines.push('  models_bucket: ""')
  lines.push('inference:')
  lines.push(`  enabled: ${firm.inferenceEnabled ? 'true' : 'false'}`)
  lines.push('  backend: llama.cpp')
  lines.push(`  model_repo: ${f(firm.modelRepo)}`)
  lines.push(`  model_file: ${f(firm.modelFile)}`)
  lines.push(`  llama_cpp_ref: ${f(firm.llamaCppRef)}`)
  lines.push(`  ctx: ${Math.max(0, Math.trunc(firm.ctx))}`)
  lines.push('model_plane:')
  lines.push(`  backends: ${yamlList(asStringArray(firm.modelBackends))}`)
  lines.push('harness:')
  lines.push(`  runtime: ${f(firm.harnessRuntime)}`)
  lines.push(`  base_url: ${f(harnessBaseUrl(firm.firmId))}`)
  lines.push('deploy:')
  lines.push(`  control_target: ${f(firm.controlTarget)}`)
  lines.push(`  worker_targets: ${yamlList(asStringArray(firm.workerTargets))}`)
  lines.push(`  colab_workers: ${Math.max(0, Math.trunc(firm.colabWorkers))}`)
  lines.push(`  kaggle_workers: ${Math.max(0, Math.trunc(firm.kaggleWorkers))}`)
  lines.push(`  kaggle_schedule: ${f(firm.kaggleSchedule)}`)
  lines.push(`  hf_space_hardware: ${f(firm.hfSpaceHardware)}`)
  lines.push(`  idle_exit_seconds: ${Math.max(0, Math.trunc(firm.idleExitSeconds))}`)
  lines.push('agents:')
  lines.push(`  files: ${yamlList(agentFileNames)}`)
  lines.push('plugins:')
  lines.push(`  bindings: ${yamlList(asStringArray(firm.pluginBindings))}`)
  lines.push('secrets:')
  lines.push(`  required: ${yamlList(asStringArray(firm.secretsRequired))}`)
  return lines.join('\n') + '\n'
}

/**
 * Emit an agent definition file (schema enforced by scripts/validate.py:
 * id, role, responsibilities list, plugins list, permissions list, reports_to —
 * every key non-empty).
 */
export function sanitizeAgentYaml(agent: {
  agentId: string
  role: string
  responsibilities: string[]
  plugins: string[]
  permissions: string[]
  reportsTo: string
}): string {
  const lines: string[] = []
  lines.push('# Agent definition — composed by Firm Forge from the workspace DB.')
  lines.push('# Schema validated by firm-spawner/scripts/validate.py.')
  lines.push(`id: ${yamlScalar(sanitize(agent.agentId))}`)
  lines.push(`role: ${yamlScalar(sanitize(agent.role))}`)
  lines.push('responsibilities:')
  const responsibilities = agent.responsibilities.map(sanitize).filter((r) => r !== '')
  if (responsibilities.length === 0) lines.push('  - (undefined)')
  for (const r of responsibilities) lines.push(`  - ${yamlScalar(r)}`)
  lines.push(`plugins: ${yamlList(agent.plugins)}`)
  lines.push(`permissions: ${yamlList(agent.permissions)}`)
  lines.push(`reports_to: ${yamlScalar(sanitize(agent.reportsTo))}`)
  return lines.join('\n') + '\n'
}

/** Convenience: emit an agent file from an AgentDef (as stored in the DB). */
export function agentYamlFromDef(agent: AgentDef): string {
  return sanitizeAgentYaml({
    agentId: agent.agentId,
    role: agent.role,
    responsibilities: agent.responsibilities,
    plugins: agent.plugins,
    permissions: agent.permissions,
    reportsTo: agent.reportsTo,
  })
}
