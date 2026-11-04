'use client'

import { useQuery } from '@tanstack/react-query'
import { api, post } from './api'
import type {
  Catalogue,
  DecisionDef,
  EvidenceDef,
  FirmDef,
  FileNode,
  TestRunDef,
  WorkspaceHealth,
} from '@/lib/firm-forge/types'

export const qk = {
  health: ['health'] as const,
  firms: ['firms'] as const,
  files: (dbId: string) => ['firm-files', dbId] as const,
  file: (dbId: string, path: string) => ['firm-file', dbId, path] as const,
  runs: (dbId: string) => ['firm-runs', dbId] as const,
  evidence: ['evidence'] as const,
  decisions: (dbId: string) => ['decisions', dbId] as const,
  catalogue: ['catalogue'] as const,
  playbook: ['playbook'] as const,
}

// Read queries: one retry, then surface a friendly error (backend may still be booting).
const readQuery = {
  retry: 1 as const,
  retryDelay: 1500,
  refetchOnWindowFocus: false,
  staleTime: 10_000,
}

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => api<WorkspaceHealth>('/api/health'),
    refetchInterval: 30_000,
    ...readQuery,
  })
}

export function useFirms() {
  return useQuery({
    queryKey: qk.firms,
    queryFn: () => api<{ firms: FirmDef[] }>('/api/firms'),
    ...readQuery,
  })
}

export function useFirmFiles(dbId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.files(dbId ?? ''),
    queryFn: () => api<{ tree: FileNode[] }>(`/api/firms/${dbId}/files`),
    enabled: !!dbId && enabled,
    ...readQuery,
  })
}

export interface FirmFile {
  path: string
  content: string
  size: number
  truncated: boolean
}

export function useFirmFile(dbId: string | null | undefined, path: string | null) {
  return useQuery({
    queryKey: qk.file(dbId ?? '', path ?? ''),
    queryFn: () => api<FirmFile>(`/api/firms/${dbId}/file?path=${encodeURIComponent(path as string)}`),
    enabled: !!dbId && !!path,
    ...readQuery,
  })
}

export function useRuns(dbId: string | null | undefined) {
  return useQuery({
    queryKey: qk.runs(dbId ?? ''),
    queryFn: () => api<{ runs: TestRunDef[] }>(`/api/firms/${dbId}/runs`),
    enabled: !!dbId,
    ...readQuery,
  })
}

export function useEvidence() {
  return useQuery({
    queryKey: qk.evidence,
    queryFn: () => api<{ records: EvidenceDef[] }>('/api/evidence'),
    ...readQuery,
  })
}

export function useDecisions(firmDbId: string | null | undefined) {
  return useQuery({
    queryKey: qk.decisions(firmDbId ?? ''),
    queryFn: () => api<{ decisions: DecisionDef[] }>(`/api/decisions?firmId=${firmDbId}`),
    enabled: !!firmDbId,
    ...readQuery,
  })
}

export function useCatalogue() {
  return useQuery({
    queryKey: qk.catalogue,
    queryFn: () => api<Catalogue>('/api/catalogue'),
    ...readQuery,
  })
}

export interface PlaybookDoc {
  name: string
  label: string
  content: string
}

export function usePlaybook() {
  return useQuery({
    queryKey: qk.playbook,
    queryFn: async () => {
      const data = await api<{ skill: string; references: { name: string; content: string }[] }>('/api/playbook')
      const docs: PlaybookDoc[] = [{ name: 'SKILL.md', label: 'SKILL.md', content: data.skill }]
      for (const ref of data.references ?? []) {
        docs.push({ name: ref.name, label: ref.name.replace(/\.md$/, ''), content: ref.content })
      }
      return { docs }
    },
    ...readQuery,
    staleTime: 5 * 60_000,
  })
}

export function runSelfTest() {
  return post<{ ok: boolean; passed: number; failed: number; output: string }>('/api/selftest')
}
