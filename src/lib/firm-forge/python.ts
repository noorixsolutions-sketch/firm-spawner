// Firm Forge — child_process helpers for the skill's Python scripts, git, tar, sh.
// Server-only. Everything is spawned with an absolute command path resolution via PATH
// and a hard timeout; output is fully captured so logs stay controlled and secret-free.
import { spawn } from 'node:child_process'

export interface SpawnResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface SpawnOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Spawn a command, capture stdout/stderr, kill on timeout.
 * Never throws — failures are reported through { code, stderr, timedOut }.
 */
export function spawnCapture(command: string, args: string[], opts: SpawnOptions = {}): Promise<SpawnResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { cwd: opts.cwd, env: opts.env })
    } catch (err) {
      resolve({ code: 127, stdout: '', stderr: `spawn ${command} failed: ${String(err)}`, timedOut: false })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, timeoutMs)

    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: timedOut ? 124 : code, stdout, stderr, timedOut })
    }

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000)
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000)
    })
    child.on('error', (err) => {
      stderr += `spawn error: ${err.message}`
      finish(127)
    })
    child.on('close', (code) => finish(code ?? -1))
  })
}

export type PythonResult = SpawnResult

/** Run `python3 <args...>` (defaults: cwd = project root, 120s timeout). */
export async function runPython(args: string[], opts: SpawnOptions = {}): Promise<PythonResult> {
  return spawnCapture('python3', args, {
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })
}

export interface PythonJsonResult<T> extends PythonResult {
  json: T | null
}

/**
 * Run python3 and JSON.parse its stdout. Tolerant of trailing/leading noise:
 * slices from the first '{' to the last '}' and parses that. json is null when
 * nothing parseable is found (callers decide how to treat that).
 */
export async function runPythonJson<T>(args: string[], opts: SpawnOptions = {}): Promise<PythonJsonResult<T>> {
  const res = await runPython(args, opts)
  return { ...res, json: extractJson<T>(res.stdout) }
}

/** Find the outermost JSON object in a string and parse it. */
export function extractJson<T>(text: string): T | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
