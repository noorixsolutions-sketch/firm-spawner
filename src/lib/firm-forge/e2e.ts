// Firm Forge — build pipeline + the 9-step golden-path E2E.
// Server-only. Uses the skill's REAL python scripts (render/validate/scan_secrets),
// the REAL worker.py (container + bare/notebook code paths), the REAL reference harness
// over HTTP, and the REAL workspace LLM. Logs are secret-free by construction.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@/lib/db'
import { FirmNotFoundError, asString, toAgentDef } from './helpers'
import {
  CATALOGUE_DIR,
  PROJECT_ROOT,
  SKILL_DIR,
  TEMPLATE_DIR,
  ensureWorkspace,
  harnessBaseUrl,
  renderedDir,
  stateDir,
  valuesPath,
  workspaceDir,
} from './paths'
import { runPython, runPythonJson, spawnCapture } from './python'
import { agentYamlFromDef, generateValuesYaml } from './values'
import type { BuildResult, E2EResult, E2EStep, Manifest, TaskRecord } from './types'

const nowIso = (): string => new Date().toISOString()

// =====================================================================
// BUILD PIPELINE (POST /api/firms/[dbId]/build, reused by the E2E step 1)
// =====================================================================

export async function buildFirm(dbId: string): Promise<BuildResult> {
  const firm = await db.firm.findUnique({ where: { id: dbId }, include: { agents: true, decisions: true } })
  if (!firm) throw new FirmNotFoundError(dbId)
  ensureWorkspace(firm.firmId)
  const ws = workspaceDir(firm.firmId)
  const out = renderedDir(firm.firmId)
  const agentFiles = firm.agents.map((a) => a.fileName)

  // 1. values.yaml (exact generator shape; render.py is the authority on the schema)
  writeFileSync(valuesPath(firm.firmId), generateValuesYaml(firm, agentFiles))

  const steps: E2EStep[] = []

  // 2. render.py
  let t0 = Date.now()
  const renderRes = await runPythonJson<{ ok: boolean; out?: string; files_rendered?: number; errors?: string[] }>([
    path.join(SKILL_DIR, 'scripts', 'render.py'),
    '--template',
    TEMPLATE_DIR,
    '--values',
    valuesPath(firm.firmId),
    '--out',
    out,
  ])
  const renderOk = renderRes.code === 0 && renderRes.json?.ok === true
  const renderErrors = renderOk ? [] : renderRes.json?.errors ?? [renderRes.stderr.trim() || `render.py exited ${renderRes.code}`]
  const filesRendered = renderRes.json?.files_rendered ?? 0
  steps.push({
    name: 'render',
    status: renderOk ? 'pass' : 'fail',
    detail: renderOk
      ? `render.py: ${filesRendered} files rendered to ${out}`
      : `render.py: ${renderErrors.join('; ')}`,
    ms: Date.now() - t0,
  })

  let validateOk = false
  let validateErrors: string[] = ['skipped: render failed']
  let validateWarnings: string[] = []
  let scanOk = false
  let scanFindings = 0
  let scanDetails: string[] = ['skipped: render failed']

  if (renderOk) {
    // 3. compose agents + decisions.jsonl on top of the rendered template
    const agentsDir = path.join(out, 'constitution', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    const keep = new Set(agentFiles)
    for (const agent of firm.agents) {
      writeFileSync(path.join(agentsDir, agent.fileName), agentYamlFromDef(toAgentDef(agent)))
    }
    for (const name of readdirSync(agentsDir)) {
      if (name.endsWith('.yaml') && !keep.has(name)) {
        rmSync(path.join(agentsDir, name)) // template examples
      }
    }
    const decisionLines = firm.decisions.map((d) =>
      JSON.stringify({
        capability: d.capability,
        choice: d.choice,
        evidence: d.evidence,
        verified_at: d.verifiedAt,
        decided_at: d.decidedAt.toISOString(),
      }),
    )
    writeFileSync(path.join(out, 'decisions.jsonl'), decisionLines.length > 0 ? decisionLines.join('\n') + '\n' : '')

    // 4. validate.py
    t0 = Date.now()
    const validateRes = await runPythonJson<{ ok: boolean; errors?: string[]; warnings?: string[] }>([
      path.join(SKILL_DIR, 'scripts', 'validate.py'),
      '--rendered',
      out,
      '--template',
      TEMPLATE_DIR,
      '--catalogue',
      CATALOGUE_DIR,
    ])
    validateOk = validateRes.code === 0 && validateRes.json?.ok === true
    validateErrors = validateRes.json?.errors ?? (validateOk ? [] : [validateRes.stderr.trim() || `validate.py exited ${validateRes.code}`])
    validateWarnings = validateRes.json?.warnings ?? []
    steps.push({
      name: 'validate',
      status: validateOk ? 'pass' : 'fail',
      detail: validateOk
        ? `validate.py: ok${validateWarnings.length > 0 ? ` (${validateWarnings.length} warning(s))` : ''}`
        : `validate.py: ${validateErrors.join('; ')}`,
      ms: Date.now() - t0,
    })

    // 5. scan_secrets.py
    t0 = Date.now()
    const scanRes = await runPython([path.join(SKILL_DIR, 'scripts', 'scan_secrets.py'), out])
    const scanLines = scanRes.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    const summary = scanLines.find((l) => l.startsWith('secret scan:')) ?? ''
    const m = /secret scan: (\d+) finding/.exec(summary)
    scanFindings = m ? Number(m[1]) : scanRes.code === 0 ? 0 : -1
    scanDetails = scanLines.filter((l) => !l.startsWith('secret scan:'))
    scanOk = scanRes.code === 0 && scanFindings === 0
    steps.push({
      name: 'scan',
      status: scanOk ? 'pass' : 'fail',
      detail: scanOk
        ? 'scan_secrets.py: 0 findings'
        : `scan_secrets.py: ${scanFindings < 0 ? `exited ${scanRes.code}` : `${scanFindings} finding(s)`}${scanDetails.length > 0 ? ` — ${scanDetails.slice(0, 5).join('; ')}` : ''}`,
      ms: Date.now() - t0,
    })
  } else {
    steps.push({ name: 'validate', status: 'skip', detail: 'skipped: render failed', ms: 0 })
    steps.push({ name: 'scan', status: 'skip', detail: 'skipped: render failed', ms: 0 })
  }

  const ok = renderOk && validateOk && scanOk
  await db.testRun.create({
    data: {
      firmDbId: firm.id,
      kind: 'build',
      status: ok ? 'pass' : 'fail',
      steps,
      summary: `${filesRendered} files rendered; validate ${validateOk ? 'ok' : 'failed'}; secret scan ${Math.max(0, scanFindings)} finding(s)`,
    },
  })

  return {
    ok,
    render: { ok: renderOk, filesRendered: renderOk ? filesRendered : undefined, errors: renderOk ? undefined : renderErrors },
    validate: { ok: validateOk, errors: validateErrors, warnings: validateWarnings },
    scan: { ok: scanOk, findings: scanFindings < 0 ? 0 : scanFindings, details: scanDetails },
    workspace: ws,
  }
}

// =====================================================================
// E2E (POST /api/firms/[dbId]/e2e) — the golden path, 9 steps
// =====================================================================

/** dependencies between E2E steps (step name → steps it requires to be green) */
const STEP_DEPS: Record<string, string[]> = {
  build: [],
  'seed state': ['build'],
  'harness health': ['seed state'],
  'enqueue tasks': ['seed state'],
  'worker (container)': ['enqueue tasks', 'harness health'],
  'governance gate': ['enqueue tasks', 'harness health'],
  'worker (bare / notebook)': ['enqueue tasks', 'harness health'],
  persistence: ['worker (container)'],
  manifest: [],
}

function readTaskFile(dir: string, id: string): TaskRecord | null {
  const p = path.join(dir, `${id}.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as TaskRecord
  } catch {
    return null
  }
}

function taskField(task: TaskRecord | null, key: string): unknown {
  const result = task?.result
  if (result && typeof result === 'object' && key in (result as Record<string, unknown>)) {
    return (result as Record<string, unknown>)[key]
  }
  return undefined
}

function answerOf(task: TaskRecord | null): string {
  const v = taskField(task, 'answer')
  return typeof v === 'string' ? v : ''
}

function completionContentOf(task: TaskRecord | null): string {
  const choices = taskField(task, 'choices')
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const message = (choices[0] as Record<string, unknown>).message
    if (message && typeof message === 'object') {
      const content = (message as Record<string, unknown>).content
      if (typeof content === 'string') return content
    }
  }
  return ''
}

function healthModeOf(st: string): string {
  const p = path.join(st, 'HEALTH', 'worker.json')
  if (!existsSync(p)) return ''
  try {
    return asString((JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>).mode)
  } catch {
    return ''
  }
}

function jsonFileCount(dir: string): number {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.json')).length
  } catch {
    return 0
  }
}

function lineCount(p: string): number {
  try {
    return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim() !== '').length
  } catch {
    return 0
  }
}

export async function runE2e(dbId: string): Promise<E2EResult> {
  const firm = await db.firm.findUnique({ where: { id: dbId }, include: { agents: true } })
  if (!firm) throw new FirmNotFoundError(dbId)
  const firmId = firm.firmId
  const ws = workspaceDir(firmId)
  const out = renderedDir(firmId)
  const st = stateDir(firmId)
  const harnessUrl = harnessBaseUrl(firmId)

  const steps: E2EStep[] = []
  const logs: string[] = []
  const notGreen = new Set<string>()
  let current = ''

  const record = (name: string, status: E2EStep['status'], detail: string, ms: number) => {
    steps.push({ name, status, detail, ms })
    if (status !== 'pass') notGreen.add(name)
    logs.push(`[${status}] ${name} (${ms}ms): ${detail}`)
  }

  const canRun = (name: string): boolean => (STEP_DEPS[name] ?? []).every((dep) => !notGreen.has(dep))

  let build: BuildResult | null = null
  let commitSha = ''
  let harnessHealthCode = 'unreachable'

  // ---- step 1: build --------------------------------------------------
  let t0 = Date.now()
  current = 'build'
  if (canRun(current)) {
    try {
      build = await buildFirm(dbId)
      if (build.ok) {
        record(current, 'pass', `render ${build.render.filesRendered ?? 0} files; validate ok; secret scan 0 findings`, Date.now() - t0)
      } else {
        const why =
          !build.render.ok
            ? `render: ${(build.render.errors ?? []).join('; ')}`
            : !build.validate.ok
              ? `validate: ${build.validate.errors.join('; ')}`
              : `scan: ${build.scan.details.join('; ')}`
        record(current, 'fail', why, Date.now() - t0)
      }
    } catch (err) {
      record(current, 'fail', `build threw: ${err instanceof Error ? err.message : String(err)}`, Date.now() - t0)
    }
  } else record(current, 'skip', 'skipped: build failed', 0)

  // ---- step 2: seed state ---------------------------------------------
  t0 = Date.now()
  current = 'seed state'
  if (canRun(current)) {
    try {
      rmSync(st, { recursive: true, force: true })
      cpSync(path.join(out, 'constitution'), path.join(st, 'constitution'), { recursive: true })
      mkdirSync(path.join(st, 'constitution', 'plugins'), { recursive: true })
      cpSync(path.join(out, 'plugins', 'bindings.yaml'), path.join(st, 'constitution', 'plugins', 'bindings.yaml'))
      cpSync(path.join(out, 'state', 'LAYOUT.md'), path.join(st, 'constitution', 'LAYOUT.md'))
      for (const d of [
        'queue/pending/kaggle',
        'queue/claimed',
        'queue/done',
        'queue/failed',
        'HEALTH',
        'RUNS',
        'EVENTS',
        'MEMORY',
        'ROUTING',
        'ENDPOINTS',
      ]) {
        mkdirSync(path.join(st, d), { recursive: true })
      }
      // byte-for-byte readback of constitution + first agent
      const conSrc = readFileSync(path.join(out, 'constitution', 'constitution.yaml'))
      const conBack = readFileSync(path.join(st, 'constitution', 'constitution.yaml'))
      const agentName = firm.agents[0]?.fileName
      let agentsEqual = true
      if (agentName) {
        const aSrc = readFileSync(path.join(out, 'constitution', 'agents', agentName))
        const aBack = readFileSync(path.join(st, 'constitution', 'agents', agentName))
        agentsEqual = aSrc.equals(aBack)
      }
      if (!conSrc.equals(conBack) || !agentsEqual) throw new Error('state readback differs from rendered source')
      record(current, 'pass', `constitution + ${firm.agents.length} agent(s) seeded; queue/HEALTH/RUNS/EVENTS laid out; byte-identical readback`, Date.now() - t0)
    } catch (err) {
      record(current, 'fail', `seed failed: ${err instanceof Error ? err.message : String(err)}`, Date.now() - t0)
    }
  } else record(current, 'skip', 'skipped: build failed', 0)

  // ---- step 3: harness health (real HTTP probe) ------------------------
  t0 = Date.now()
  current = 'harness health'
  if (canRun(current)) {
    try {
      const res = await fetch(`${harnessUrl}/health`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      harnessHealthCode = String(res.status)
      if (res.status === 200 && body.status === 'ok') {
        const agents = Array.isArray(body.agents) ? body.agents.length : 0
        record(current, 'pass', `HTTP ${res.status}; firm "${String(body.name ?? firmId)}"; ${agents} agent(s) in roster`, Date.now() - t0)
        logs.push(`$ GET ${harnessUrl}/health → ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
      } else {
        record(current, 'fail', `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`, Date.now() - t0)
      }
    } catch (err) {
      record(current, 'fail', `probe failed: ${err instanceof Error ? err.message : String(err)}`, Date.now() - t0)
    }
  } else record(current, 'skip', 'skipped: state not seeded', 0)

  // ---- step 4: enqueue tasks -------------------------------------------
  t0 = Date.now()
  current = 'enqueue tasks'
  if (canRun(current)) {
    try {
      const created = nowIso()
      const pending = path.join(st, 'queue', 'pending')
      const tasks: Record<string, unknown> = {
        'verify-1': {
          id: 'verify-1',
          type: 'job',
          payload: { query: 'In two sentences: what is the firm-worker claim-then-execute contract?' },
          attempts: 0,
          created,
        },
        'verify-2': {
          id: 'verify-2',
          type: 'inference',
          payload: { messages: [{ role: 'user', content: 'Reply with exactly one word: operational' }] },
          attempts: 0,
          created,
        },
        'verify-gov': {
          id: 'verify-gov',
          type: 'job',
          payload: { action: 'spend', amount: 100, note: 'governance gate test' },
          attempts: 0,
          created,
        },
      }
      for (const [id, task] of Object.entries(tasks)) {
        writeFileSync(path.join(pending, `${id}.json`), JSON.stringify(task) + '\n')
      }
      record(current, 'pass', 'verify-1 (job/LLM), verify-2 (inference/chat), verify-gov (job/action spend) enqueued', Date.now() - t0)
    } catch (err) {
      record(current, 'fail', `enqueue failed: ${err instanceof Error ? err.message : String(err)}`, Date.now() - t0)
    }
  } else record(current, 'skip', 'skipped: state not seeded', 0)

  // ---- step 5: worker — container code path -----------------------------
  t0 = Date.now()
  current = 'worker (container)'
  let containerRan = false
  if (canRun(current)) {
    const workerPy = path.join(out, 'images', 'worker', 'worker.py')
    const w = await spawnCapture(
      'python3',
      [workerPy, '--state-dir', st, '--worker-id', `${firmId}-local`, '--harness-url', harnessUrl, '--once', '--poll', '1'],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          STATE_DIR: st,
          HARNESS_BASE_URL: harnessUrl,
          INFERENCE_URL: harnessUrl,
          FIRM_WORKER_ID: `${firmId}-local`,
          RUN_MODE: 'container',
          FIRM_MAX_ATTEMPTS: '3',
        },
        timeoutMs: 300_000,
      },
    )
    containerRan = true
    logs.push(`$ python3 ${workerPy} --state-dir ${st} --worker-id ${firmId}-local --harness-url ${harnessUrl} --once --poll 1  (RUN_MODE=container)`)
    if (w.stdout.trim()) logs.push(`  worker stdout: ${w.stdout.trim().split('\n').slice(0, 20).join('\n  ')}`)
    if (w.stderr.trim()) logs.push(`  worker stderr: ${w.stderr.trim().split('\n').slice(0, 20).join('\n  ')}`)
    logs.push(`  worker exited ${w.code}${w.timedOut ? ' (TIMEOUT)' : ''} in ${Date.now() - t0}ms`)

    const jobTask = readTaskFile(path.join(st, 'queue', 'done'), 'verify-1')
    const inferenceTask = readTaskFile(path.join(st, 'queue', 'done'), 'verify-2')
    const answer = answerOf(jobTask)
    const completion = completionContentOf(inferenceTask)
    const claimedCount = jsonFileCount(path.join(st, 'queue', 'claimed'))
    const mode = healthModeOf(st)
    const runsCount = jsonFileCount(path.join(st, 'RUNS'))
    logs.push(`  verify-1 done: answer ${answer.length} chars; verify-2 done: completion ${completion.length} chars; claimed ${claimedCount}; HEALTH mode=${mode}; RUNS ${runsCount} file(s)`)

    const problems: string[] = []
    if (w.code !== 0) problems.push(`worker exited ${w.code}${w.timedOut ? ' (timeout)' : ''}`)
    if (!jobTask) problems.push('verify-1 not in queue/done')
    else if (answer.trim() === '') problems.push('verify-1 result.answer is empty')
    if (!inferenceTask) problems.push('verify-2 not in queue/done')
    else if (completion.trim() === '') problems.push('verify-2 result.choices[0].message.content is empty')
    if (claimedCount > 0) problems.push(`queue/claimed not empty (${claimedCount} file(s))`)
    if (mode !== 'container') problems.push(`HEALTH/worker.json mode=${mode || 'missing'} (expected container)`)
    if (runsCount < 1) problems.push('no records in state/RUNS')

    record(
      current,
      problems.length === 0 ? 'pass' : 'fail',
      problems.length === 0
        ? `verify-1 answered (${answer.length} chars), verify-2 completion (${completion.length} chars), claimed empty, HEALTH mode=container, ${runsCount} RUNS record(s)`
        : problems.join('; '),
      Date.now() - t0,
    )
  } else record(current, 'skip', 'skipped: enqueue/health not green', 0)

  // ---- step 6: governance gate ------------------------------------------
  t0 = Date.now()
  current = 'governance gate'
  if (canRun(current) && containerRan) {
    const gov = readTaskFile(path.join(st, 'queue', 'failed'), 'verify-gov')
    const attempts = gov?.attempts ?? 0
    const lastError = gov?.last_error ?? ''
    if (gov && attempts >= 1 && lastError.toLowerCase().includes('human approval required')) {
      record(current, 'pass', `refused after ${attempts} attempt(s): ${lastError}`, Date.now() - t0)
    } else {
      record(
        current,
        'fail',
        gov
          ? `verify-gov in queue/failed but wrong shape (attempts=${attempts}, last_error="${lastError}")`
          : 'verify-gov is not in queue/failed',
        Date.now() - t0,
      )
    }
  } else record(current, 'skip', containerRan ? 'skipped: enqueue/health not green' : 'skipped: container worker did not run', 0)

  // ---- step 7: worker — bare / notebook code path ------------------------
  t0 = Date.now()
  current = 'worker (bare / notebook)'
  let bareTask: TaskRecord | null = null
  if (canRun(current)) {
    let tmpBase = ''
    try {
      // enqueue verify-3 in the kaggle partition
      writeFileSync(
        path.join(st, 'queue', 'pending', 'kaggle', 'verify-3.json'),
        JSON.stringify({ id: 'verify-3', type: 'echo', payload: { note: 'bare mode notebook path' }, attempts: 0, created: nowIso() }) + '\n',
      )

      // notebook bootstrap: git init + add + commit (tolerate existing repo by re-committing)
      const gitId = ['-c', 'user.email=firm-forge@localhost', '-c', 'user.name=Firm Forge']
      if (!existsSync(path.join(out, '.git'))) {
        await spawnCapture('git', [...gitId, 'init'], { cwd: out, timeoutMs: 30_000 })
      }
      await spawnCapture('git', [...gitId, 'add', '-A'], { cwd: out, timeoutMs: 60_000 })
      const commitRes = await spawnCapture('git', [...gitId, 'commit', '-m', 'firm'], { cwd: out, timeoutMs: 60_000 })
      const head = await spawnCapture('git', ['rev-parse', 'HEAD'], { cwd: out, timeoutMs: 30_000 })
      commitSha = head.stdout.trim()
      if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error(`no commit sha (rev-parse: ${head.stdout.trim().slice(0, 40) || head.stderr.trim().slice(0, 80)})`)
      logs.push(`$ git init/add/commit in ${out} → ${commitSha}${commitRes.code !== 0 ? ` (commit exit ${commitRes.code}: nothing new — reused HEAD)` : ''}`)

      // clone + checkout (what a notebook does to fetch worker code)
      tmpBase = mkdtempSync(path.join(tmpdir(), 'firm-e2e-'))
      const clone = path.join(tmpBase, 'firm-clone')
      const cloneRes = await spawnCapture('git', ['clone', out, clone], { cwd: tmpBase, timeoutMs: 60_000 })
      if (cloneRes.code !== 0) throw new Error(`git clone failed: ${cloneRes.stderr.trim().slice(0, 160)}`)
      const checkoutRes = await spawnCapture('git', ['-C', clone, 'checkout', commitSha], { cwd: tmpBase, timeoutMs: 30_000 })
      if (checkoutRes.code !== 0) throw new Error(`git checkout failed: ${checkoutRes.stderr.trim().slice(0, 160)}`)
      logs.push(`$ git clone + checkout ${commitSha.slice(0, 12)} → ${clone}`)

      // run the worker exactly like the notebook cell does
      const run = await spawnCapture('sh', [path.join(clone, 'images', 'worker', 'run.sh')], {
        cwd: clone,
        env: {
          ...process.env,
          RUN_MODE: 'bare',
          STATE_DIR: st,
          HARNESS_BASE_URL: harnessUrl,
          FIRM_PARTITION: 'kaggle',
          FIRM_WORKER_ID: `${firmId}-kaggle`,
          FIRM_IDLE_EXIT: '5',
        },
        timeoutMs: 120_000,
      })
      logs.push(`$ sh ${clone}/images/worker/run.sh  (RUN_MODE=bare, FIRM_PARTITION=kaggle, FIRM_IDLE_EXIT=5)`)
      if (run.stdout.trim()) logs.push(`  worker stdout: ${run.stdout.trim().split('\n').slice(0, 20).join('\n  ')}`)
      if (run.stderr.trim()) logs.push(`  worker stderr: ${run.stderr.trim().split('\n').slice(0, 20).join('\n  ')}`)
      logs.push(`  worker exited ${run.code}${run.timedOut ? ' (TIMEOUT)' : ''} in ${Date.now() - t0}ms`)

      bareTask = readTaskFile(path.join(st, 'queue', 'done'), 'verify-3')
      const mode = healthModeOf(st)
      logs.push(`  verify-3 done: ${bareTask ? 'echo ok' : 'missing'}; HEALTH mode=${mode}`)

      const problems: string[] = []
      if (run.code !== 0) problems.push(`run.sh exited ${run.code}${run.timedOut ? ' (timeout)' : ''}`)
      if (!bareTask) problems.push('verify-3 not in queue/done')
      if (mode !== 'bare') problems.push(`HEALTH/worker.json mode=${mode || 'missing'} (expected bare)`)
      record(
        current,
        problems.length === 0 ? 'pass' : 'fail',
        problems.length === 0
          ? `verify-3 echoed from the kaggle partition; HEALTH mode flipped to bare; commit ${commitSha.slice(0, 12)}`
          : problems.join('; '),
        Date.now() - t0,
      )
    } catch (err) {
      record(current, 'fail', `bare path failed: ${err instanceof Error ? err.message : String(err)}`, Date.now() - t0)
    } finally {
      if (tmpBase) {
        try {
          rmSync(tmpBase, { recursive: true, force: true })
        } catch {
          /* best-effort temp cleanup */
        }
      }
    }
  } else record(current, 'skip', 'skipped: enqueue/health not green', 0)

  // ---- step 8: persistence ----------------------------------------------
  t0 = Date.now()
  current = 'persistence'
  if (canRun(current) && containerRan) {
    const p1 = existsSync(path.join(st, 'queue', 'done', 'verify-1.json'))
    const p2 = existsSync(path.join(st, 'queue', 'done', 'verify-2.json'))
    const events = path.join(st, 'EVENTS', 'tasks.jsonl')
    const p3 = existsSync(events)
    if (p1 && p2 && p3) {
      record(current, 'pass', `verify-1 and verify-2 still in queue/done; EVENTS/tasks.jsonl holds ${lineCount(events)} line(s)`, Date.now() - t0)
    } else {
      record(
        current,
        'fail',
        `verify-1 done=${p1}, verify-2 done=${p2}, EVENTS/tasks.jsonl=${p3}`,
        Date.now() - t0,
      )
    }
  } else record(current, 'skip', containerRan ? 'skipped: container worker not green' : 'skipped: container worker did not run', 0)

  // ---- step 9: manifest ---------------------------------------------------
  t0 = Date.now()
  current = 'manifest'
  const jobTask = readTaskFile(path.join(st, 'queue', 'done'), 'verify-1')
  const inferenceTask = readTaskFile(path.join(st, 'queue', 'done'), 'verify-2')
  const governanceTask = readTaskFile(path.join(st, 'queue', 'failed'), 'verify-gov')
  if (bareTask === null) bareTask = readTaskFile(path.join(st, 'queue', 'done'), 'verify-3')
  const manifest: Manifest = {
    firm_id: firmId,
    verified_at: nowIso(),
    commit: /^[0-9a-f]{40}$/.test(commitSha) ? commitSha : 'workspace (not published)',
    assets: [
      {
        name: 'harness',
        target: 'local (reference impl)',
        endpoint: harnessUrl,
        health: harnessHealthCode,
      },
      { name: 'worker-local', target: 'local', result: jobTask ? 'done' : 'not completed' },
      { name: 'worker-bare', target: 'kaggle partition (notebook code path)', result: bareTask ? 'done' : 'not completed' },
      { name: 'inference-model-plane', target: 'workspace-llm', result: inferenceTask ? 'real chat completion' : 'not exercised' },
      { name: 'firm-inference (llama.cpp)', target: 'authored image sources', result: 'not exercised: no GPU/Docker in sandbox' },
    ],
    end_to_end: { task: 'verify-1', result: jobTask ? 'done' : 'failed' },
    limits: ['workspace model plane is internal to this sandbox', 'Kaggle/Colab/HF deploys are operator-gated'],
    mocked: ["firm-harness is the workspace reference implementation, not the operator's Synapses-Firm harness"],
  }
  writeFileSync(path.join(ws, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  logs.push(`$ manifest written → ${path.join(ws, 'manifest.json')}`)
  record(current, 'pass', `manifest.json written (commit ${manifest.commit === 'workspace (not published)' ? 'n/a' : manifest.commit.slice(0, 12)})`, Date.now() - t0)

  // ---- persist + return ---------------------------------------------------
  const passedCount = steps.filter((s) => s.status === 'pass').length
  const ok = steps.every((s) => s.status === 'pass')
  const run = await db.testRun.create({
    data: {
      firmDbId: firm.id,
      kind: 'e2e',
      status: ok ? 'pass' : 'fail',
      steps,
      manifest,
      summary: `${passedCount}/${steps.length} steps passed`,
    },
  })

  logs.unshift(`Firm Forge E2E — ${firmId} — ${nowIso()}`)
  logs.push(`summary: ${passedCount}/${steps.length} steps passed${build ? `; build render=${build.render.filesRendered ?? 0} files` : ''}`)

  return {
    ok,
    runId: run.id,
    steps,
    manifest,
    results: { jobTask, inferenceTask, governanceTask, bareTask },
    logs: logs.join('\n'),
  }
}
