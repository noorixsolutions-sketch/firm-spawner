// Firm Forge — shared contract types (single source of truth for API + UI).
// Both the API routes and the page components import from here.

// ---------- firm ----------
export interface AgentDef {
  id: string
  fileName: string
  agentId: string
  role: string
  responsibilities: string[]
  plugins: string[]
  permissions: string[]
  reportsTo: string
}

export interface FirmDef {
  id: string
  firmId: string
  name: string
  purpose: string
  ownerGmail: string
  repo: string
  stateBucket: string
  inferenceEnabled: boolean
  modelRepo: string
  modelFile: string
  llamaCppRef: string
  ctx: number
  modelBackends: string[]
  harnessRuntime: string
  controlTarget: 'hf-space' | 'local'
  workerTargets: string[] // subset of kaggle | colab | hf-job | local
  kaggleWorkers: number
  colabWorkers: number
  kaggleSchedule: string
  hfSpaceHardware: string
  idleExitSeconds: number
  pluginBindings: string[]
  secretsRequired: string[]
  createdAt: string
  updatedAt: string
  agents: AgentDef[]
  decisions: DecisionDef[]
  lastRun?: TestRunDef | null
}

export interface FirmInput {
  firmId: string
  name: string
  purpose: string
  ownerGmail: string
  repo: string
  stateBucket?: string
  inferenceEnabled?: boolean
  modelRepo?: string
  modelFile?: string
  llamaCppRef?: string
  ctx?: number
  modelBackends?: string[]
  harnessRuntime?: string
  controlTarget?: 'hf-space' | 'local'
  workerTargets?: string[]
  kaggleWorkers?: number
  colabWorkers?: number
  kaggleSchedule?: string
  hfSpaceHardware?: string
  idleExitSeconds?: number
  pluginBindings?: string[]
  secretsRequired?: string[]
  agents?: AgentDef[]
}

// ---------- build ----------
export interface BuildResult {
  ok: boolean
  render: { ok: boolean; filesRendered?: number; errors?: string[] }
  validate: { ok: boolean; errors: string[]; warnings: string[] }
  scan: { ok: boolean; findings: number; details: string[] }
  workspace: string
}

// ---------- e2e ----------
export interface E2EStep {
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
  ms: number
}

export interface ManifestAsset {
  name: string
  target: string
  endpoint?: string
  health?: string
  result?: string
}

export interface Manifest {
  firm_id: string
  verified_at: string
  commit: string
  assets: ManifestAsset[]
  end_to_end: { task: string; result: string }
  limits: string[]
  mocked: string[]
}

export interface TaskRecord {
  id: string
  type: string
  payload: Record<string, unknown> & { messages?: { role: string; content: string }[]; query?: string }
  attempts?: number
  result?: unknown
  worker?: string
  finished?: string
  last_error?: string
}

export interface E2EResult {
  ok: boolean
  runId: string
  steps: E2EStep[]
  manifest: Manifest
  results: {
    jobTask: TaskRecord | null
    inferenceTask: TaskRecord | null
    governanceTask: TaskRecord | null
    bareTask: TaskRecord | null
  }
  logs: string
}

export interface TestRunDef {
  id: string
  kind: 'e2e' | 'selftest' | 'build'
  status: 'pass' | 'fail'
  steps: E2EStep[]
  manifest?: Manifest | null
  summary?: string | null
  createdAt: string
}

// ---------- eligibility ----------
export interface EvidenceDef {
  id: string
  provider: string
  capability: string
  execution: string
  pricingModel: string
  cardRequired: boolean
  computeCost: string
  sourceUrl: string
  verifiedAt: string
  termsExcerpt: string
  limits: string[]
  restrictions: string[]
  createdAt: string
}

export interface EvidenceInput {
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
}

export interface EligibilityResult {
  provider: string
  capability: string
  execution: string
  status: string
  selectable: boolean
  disclosures: string[]
  reasons: string[]
  source_url: string
  verified_at: string
}

export interface DecisionDef {
  id: string
  firmId: string
  capability: string
  choice: string
  evidence: string
  verifiedAt: string
  decidedAt: string
}

// ---------- catalogue ----------
export interface CatalogueImage {
  id: string
  status: 'authored' | 'verified' | 'unverified'
  source: string
  architectures: string[]
  capabilities: string[]
  deploys_to: string[]
  env_required: string[]
  env_optional?: string[]
  secrets?: string[]
  health: string
  state_mount?: string
  gpu?: string
}

export interface CataloguePlugin {
  id: string
  version: string
  requires_capabilities: string[]
  permissions: string[]
  secret_refs: string[]
  health: string
}

export interface CatalogueCapability {
  id: string
  contract: string
  implementations: { kind: string; execution: string; note: string }[]
}

export interface Catalogue {
  images: CatalogueImage[]
  plugins: CataloguePlugin[]
  capabilities: CatalogueCapability[]
  rules: string[]
}

// ---------- files ----------
export interface FileNode {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  children?: FileNode[]
}

// ---------- health / misc ----------
export interface WorkspaceHealth {
  ok: boolean
  python: { version: string; yaml: boolean; pytest: boolean }
  skill: { present: boolean; tests: { passed: number; failed: number } | null }
  harness: { up: boolean; url: string; firmId: string }
  docker: boolean
  git: boolean
  workspacesDir: string
  time: string
}

export interface SelfTestResult {
  ok: boolean
  passed: number
  failed: number
  output: string
}
