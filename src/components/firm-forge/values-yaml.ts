import type { FirmInput } from '@/lib/firm-forge/types'

// Client-side values.yaml preview — mirrors the backend generator 1:1
// (MASTER_SPEC "values.yaml generator"): same keys, same order, same escaping.
// The backend remains the authority; this is only the live preview.

const YAML_UNSAFE = /["\\\n\r]|\{\{|\}\}/g

function s(value: string | undefined | null): string {
  return (value ?? '')
    .replace(YAML_UNSAFE, (m) => (m === '\n' || m === '\r' ? ' ' : m === '"' || m === '\\' ? '' : ''))
    .trim()
}

/** Emit a scalar string the way the backend serializer does: plain unless it
 *  contains flow/alias indicators (: , * # etc.), then single-quoted. */
function scalar(value: string): string {
  if (value === '') return '""'
  if (/^$|^[\s]|[\s]$/.test(value) || /[:,*#&!|>{}[\]%'"]/u.test(value)) {
    return `'${value.replace(/'/g, "''")}'`
  }
  return value
}

function num(value: number | undefined | null, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function list(items: string[] | undefined | null): string {
  const clean = (items ?? []).map((item) => s(item)).filter(Boolean)
  return clean.length ? `[${clean.join(', ')}]` : '[]'
}

export function defaultStateBucket(firmId: string): string {
  return `file:///home/z/my-project/workspaces/${s(firmId) || '<firmId>'}/state`
}

export function generateValuesYaml(input: FirmInput): string {
  const firmId = s(input.firmId) || '<firmId>'
  const stateBucket = s(input.stateBucket) || defaultStateBucket(firmId)
  const workerTargets = (input.workerTargets ?? ['local']).filter((t) =>
    ['kaggle', 'colab', 'hf-job', 'local'].includes(t),
  )
  const agentFiles = (input.agents ?? [])
    .map((a) => s(a?.fileName))
    .filter(Boolean)

  const lines: string[] = [
    'firm:',
    `  id: ${scalar(firmId)}`,
    `  name: ${scalar(s(input.name) || '<name>')}`,
    `  purpose: ${scalar(s(input.purpose) || '<purpose>')}`,
    `  owner_gmail: ${scalar(s(input.ownerGmail) || '<owner-gmail>')}`,
    `  repo: ${scalar(s(input.repo) || '<owner/firm-repo>')}`,
    '  commit: main',
    'policy:',
    '  allow_paid: false',
    'state:',
    `  state_bucket: ${scalar(stateBucket)}`,
    '  models_bucket: ""',
    'inference:',
    `  enabled: ${input.inferenceEnabled === false ? 'false' : 'true'}`,
    '  backend: llama.cpp',
    `  model_repo: ${scalar(s(input.modelRepo) || 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF')}`,
    `  model_file: ${scalar(s(input.modelFile) || 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf')}`,
    `  llama_cpp_ref: ${scalar(s(input.llamaCppRef) || 'b12103')}`,
    `  ctx: ${num(input.ctx, 8192)}`,
    'model_plane:',
    `  backends: ${list(input.modelBackends ?? ['workspace-llm'])}`,
    'harness:',
    `  runtime: ${scalar(s(input.harnessRuntime) || 'prime-agent')}`,
    `  base_url: ${scalar(`http://localhost:3000/api/harness/firms/${firmId}`)}`,
    'deploy:',
    `  control_target: ${input.controlTarget === 'hf-space' ? 'hf-space' : 'local'}`,
    `  worker_targets: ${list(workerTargets.length ? workerTargets : ['local'])}`,
    `  colab_workers: ${num(input.colabWorkers, 0)}`,
    `  kaggle_workers: ${num(input.kaggleWorkers, 1)}`,
    `  kaggle_schedule: ${scalar(s(input.kaggleSchedule) || '0 */6 * * *')}`,
    `  hf_space_hardware: ${scalar(s(input.hfSpaceHardware) || 'cpu-basic')}`,
    `  idle_exit_seconds: ${num(input.idleExitSeconds, 900)}`,
    'agents:',
    `  files: ${list(agentFiles)}`,
    'plugins:',
    `  bindings: ${list(input.pluginBindings ?? ['state.store', 'inference.openai_compat', 'governance.human_gate'])}`,
    'secrets:',
    `  required: ${list(input.secretsRequired)}`,
  ]

  return lines.join('\n') + '\n'
}
