// Firm Forge — filesystem layout for the company-spawner workspace.
// Server-only. All paths are absolute; the per-firm workspace is keyed by the firm SLUG.
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()
/** Absolute project root (the Next.js app + the skill live here). */
export const PROJECT_ROOT = existsSync(path.join(cwd, 'firm-spawner')) ? cwd : '/home/z/my-project'
/** The installed company-spawner skill (read-only at runtime). */
export const SKILL_DIR = path.join(PROJECT_ROOT, 'firm-spawner')
/** Template + catalogue inside the skill. */
export const TEMPLATE_DIR = path.join(SKILL_DIR, 'assets', 'firm-template')
export const CATALOGUE_DIR = path.join(SKILL_DIR, 'catalogue')
/** Root of all per-firm workspaces. */
export const WORKSPACES_DIR = path.join(PROJECT_ROOT, 'workspaces')
/** Base URL of the workspace reference harness (this app, port 3000). */
export const HARNESS_BASE = 'http://localhost:3000'

export function workspaceDir(firmId: string): string {
  return path.join(WORKSPACES_DIR, firmId)
}

export function renderedDir(firmId: string): string {
  return path.join(WORKSPACES_DIR, firmId, 'rendered')
}

export function stateDir(firmId: string): string {
  return path.join(WORKSPACES_DIR, firmId, 'state')
}

export function valuesPath(firmId: string): string {
  return path.join(WORKSPACES_DIR, firmId, 'values.yaml')
}

export function harnessBaseUrl(firmId: string): string {
  return `${HARNESS_BASE}/api/harness/firms/${firmId}`
}

/** Default state bucket recorded in the DB / rendered into values.yaml. */
export function defaultStateBucket(firmId: string): string {
  return `file://${stateDir(firmId)}`
}

/** Create the per-firm workspace dir (idempotent) and return its absolute path. */
export function ensureWorkspace(firmId: string): string {
  const dir = workspaceDir(firmId)
  mkdirSync(dir, { recursive: true })
  return dir
}
