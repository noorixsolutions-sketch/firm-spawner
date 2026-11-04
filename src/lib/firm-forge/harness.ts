// Firm Forge — the workspace REFERENCE HARNESS (adapter contract implementation).
// Server-only. Serves /api/harness/firms/<slug>/* : health, v1/tasks/run, v1/chat/completions.
// The harness reads its config from STATE_DIR/constitution (seeded by the E2E), refuses
// constitution-gated actions with 422, and answers jobs through the workspace LLM (z-ai SDK).
// Never logs or returns secret values (secrets are names only and are not stored here at all).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { stateDir, workspaceDir } from './paths'
import { asBoolean, asString, asStringArray } from './helpers'
import type { Firm } from '@prisma/client'
import type { TaskRecord } from './types'

// ---------- z-ai LLM (module-level singleton, retries, thinking disabled) ----------

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>
let zaiPromise: Promise<ZAIInstance> | null = null

async function getZai(): Promise<ZAIInstance> {
  if (!zaiPromise) {
    zaiPromise = ZAI.create().catch((err: unknown) => {
      zaiPromise = null // allow a later retry after config failures
      throw err
    })
  }
  return zaiPromise
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * One chat completion through the workspace model plane.
 * 1 initial attempt + 2 retries; thinking disabled. Throws the last error.
 */
export async function llmComplete(messages: LlmMessage[], attempts = 3): Promise<string> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const zai = await getZai()
      const completion = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      })
      const text = completion.choices?.[0]?.message?.content
      if (typeof text === 'string' && text.trim() !== '') return text
      lastError = new Error('model plane returned empty content')
    } catch (err) {
      lastError = err
    }
    if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/\s+/g, ' ').slice(0, 300)
}

// ---------- firm lookup (by SLUG) ----------

export async function getFirmBySlug(firmId: string): Promise<Firm | null> {
  return db.firm.findUnique({ where: { firmId } })
}

// ---------- constitution (from STATE_DIR/constitution) ----------

export interface ConstitutionAgent {
  fileName: string
  id: string
  role: string
  reportsTo: string
  plugins: string[]
}

export interface Constitution {
  firmId: string
  name: string
  purpose: string
  owner: string
  runtime: string
  stateBucket: string
  allowPaid: boolean
  humanApprovalRequiredFor: string[]
  agents: ConstitutionAgent[]
}

/** Load the seeded constitution + agent roster. null when state is not seeded. */
export function loadConstitution(firmId: string): Constitution | null {
  const conPath = path.join(stateDir(firmId), 'constitution', 'constitution.yaml')
  if (!existsSync(conPath)) return null
  let doc: Record<string, unknown>
  try {
    doc = (parseYaml(readFileSync(conPath, 'utf8')) ?? {}) as Record<string, unknown>
  } catch {
    return null
  }
  const policy = (doc.policy && typeof doc.policy === 'object' ? doc.policy : {}) as Record<string, unknown>
  const agentsDir = path.join(stateDir(firmId), 'constitution', 'agents')
  const agents: ConstitutionAgent[] = []
  if (existsSync(agentsDir)) {
    for (const name of readdirSync(agentsDir).filter((n) => n.endsWith('.yaml')).sort()) {
      try {
        const a = (parseYaml(readFileSync(path.join(agentsDir, name), 'utf8')) ?? {}) as Record<string, unknown>
        agents.push({
          fileName: name,
          id: asString(a.id),
          role: asString(a.role),
          reportsTo: asString(a.reports_to, 'human'),
          plugins: asStringArray(a.plugins),
        })
      } catch {
        /* skip malformed agent file */
      }
    }
  }
  return {
    firmId: asString(doc.firm_id, firmId),
    name: asString(doc.name),
    purpose: asString(doc.purpose),
    owner: asString(doc.owner),
    runtime: asString(doc.runtime),
    stateBucket: asString(doc.state_bucket),
    allowPaid: asBoolean(policy.allow_paid),
    humanApprovalRequiredFor: asStringArray(policy.human_approval_required_for),
    agents,
  }
}

function constitutionSystemPrompt(con: Constitution): string {
  const roster = con.agents
    .map((a) => `- ${a.id} — ${a.role} (reports to ${a.reportsTo})`)
    .join('\n')
  return [
    `You are the model plane of firm "${con.name}" (${con.firmId}).`,
    `Purpose: ${con.purpose}`,
    `Owner: ${con.owner}. Harness runtime: ${con.runtime}.`,
    `Agent roster:`,
    roster,
    'Answer as this firm\'s harness on behalf of its agents: concise, factual, honest. Refuse anything its constitution gates behind human approval.',
  ].join('\n')
}

function nowIso(): string {
  return new Date().toISOString()
}

// ---------- health ----------

export interface HarnessResponse {
  code: number
  body: Record<string, unknown>
  statusText?: string
}

export async function harnessHealth(firmId: string): Promise<HarnessResponse> {
  const firm = await getFirmBySlug(firmId)
  if (!firm) return { code: 404, body: { status: 'error', error: `unknown firm: ${firmId}` } }
  const con = loadConstitution(firmId)
  if (!con) {
    return {
      code: 503,
      body: {
        status: 'unready',
        reason: 'constitution not seeded — run the E2E or seed state first',
      },
    }
  }
  return {
    code: 200,
    body: {
      status: 'ok',
      firm_id: con.firmId,
      name: con.name,
      runtime: con.runtime,
      agents: con.agents.map((a) => ({ id: a.id, role: a.role, reports_to: a.reportsTo })),
      ts: nowIso(),
    },
  }
}

// ---------- task execution (worker adapter contract) ----------

function recordTaskReceipt(firmId: string, task: TaskRecord): void {
  const st = stateDir(firmId)
  try {
    const eventsDir = path.join(st, 'EVENTS')
    mkdirSync(eventsDir, { recursive: true })
    appendFileSync(
      path.join(eventsDir, 'tasks.jsonl'),
      JSON.stringify({ ts: nowIso(), event: 'task.received', task_id: task.id, type: task.type }) + '\n',
    )
    const runsDir = path.join(st, 'RUNS')
    mkdirSync(runsDir, { recursive: true })
    writeFileSync(
      path.join(runsDir, `${task.id}.harness.json`),
      JSON.stringify({ task_id: task.id, type: task.type, ts: nowIso(), mode: 'reference-harness' }, null, 2),
    )
  } catch {
    /* state dir not writable — the audit trail is best-effort */
  }
}

/**
 * POST /v1/tasks/run implementation.
 * Governance gate FIRST (422 → worker retries → queue/failed), then job/inference/echo routing.
 */
export async function runTask(firmId: string, task: TaskRecord): Promise<HarnessResponse> {
  const firm = await getFirmBySlug(firmId)
  if (!firm) return { code: 404, body: { error: `unknown firm: ${firmId}` } }
  const con = loadConstitution(firmId)
  if (!con) {
    return {
      code: 503,
      body: { status: 'unready', reason: 'constitution not seeded — run the E2E or seed state first' },
    }
  }
  recordTaskReceipt(firmId, task)

  // Governance gate: constitution human_approval_required_for.
  const payload = (task.payload && typeof task.payload === 'object' ? task.payload : {}) as Record<string, unknown>
  const action = typeof payload.action === 'string' ? payload.action : null
  if (action && con.humanApprovalRequiredFor.includes(action)) {
    return {
      code: 422,
      // The reason phrase rides along in the HTTP status line so the worker's
      // urllib HTTPError string carries it into queue/failed last_error.
      statusText: `human approval required for action: ${action}`,
      body: { error: `human approval required for action: ${action}` },
    }
  }

  if (task.type === 'echo') {
    return { code: 200, body: { result: { echo: task.payload, task_id: task.id } } }
  }

  // job (and any other type) — treated like job
  const query = typeof payload.query === 'string' ? payload.query.trim() : ''
  if (!query) {
    return { code: 200, body: { result: { echo: task.payload, firm_id: con.firmId, task_id: task.id } } }
  }
  try {
    const answer = await llmComplete([
      { role: 'system', content: constitutionSystemPrompt(con) },
      { role: 'user', content: query },
    ])
    return {
      code: 200,
      body: {
        result: {
          answer,
          firm_id: con.firmId,
          task_id: task.id,
          worker_model: 'workspace-llm',
          agents: con.agents.map((a) => a.id),
        },
      },
    }
  } catch (err) {
    return { code: 502, body: { error: `model plane unavailable: ${errorText(err)}` } }
  }
}

// ---------- chat completions (model plane, OpenAI-shaped) ----------

export interface ChatCompletionsBody {
  model?: string
  messages: { role: string; content: string }[]
  temperature?: number
}

export async function chatCompletions(firmId: string, body: ChatCompletionsBody): Promise<HarnessResponse> {
  const firm = await getFirmBySlug(firmId)
  if (!firm) return { code: 404, body: { error: `unknown firm: ${firmId}` } }
  const con = loadConstitution(firmId)
  const messages: LlmMessage[] = []
  if (con && !body.messages.some((m) => m.role === 'system')) {
    messages.push({ role: 'system', content: constitutionSystemPrompt(con) })
  }
  for (const m of body.messages) {
    const role: LlmMessage['role'] = m.role === 'system' || m.role === 'assistant' ? m.role : 'user'
    messages.push({ role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') })
  }
  try {
    const content = await llmComplete(messages)
    return { code: 200, body: openAiCompletion(body.model ?? 'workspace-llm', content) }
  } catch (err) {
    return { code: 502, body: { error: `model plane unavailable: ${errorText(err)}` } }
  }
}

export function openAiCompletion(model: string, content: string): Record<string, unknown> {
  const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  return {
    id: `chatcmpl-${rand}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

/** Absolute workspace path (used by routes that need it after a slug lookup). */
export function workspaceOf(firm: Firm): string {
  return workspaceDir(firm.firmId)
}
