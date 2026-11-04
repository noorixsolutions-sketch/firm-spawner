// Firm Forge — catalogue loader: parses the skill's three catalogue YAML files.
// Server-only. capabilities.yaml uses a top-level MAP (id → entry) which is converted
// to an array with the id inlined, plus a `rules` list.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { CATALOGUE_DIR } from './paths'
import { asString, asStringArray } from './helpers'
import type { Catalogue, CatalogueCapability, CatalogueImage, CataloguePlugin } from './types'

let cache: { mtimes: string; value: Catalogue } | null = null

function mtimes(): string {
  const files = ['images.yaml', 'plugins.yaml', 'capabilities.yaml']
  return files
    .map((f) => {
      try {
        return statSync(path.join(CATALOGUE_DIR, f)).mtimeMs.toString()
      } catch {
        return 'missing'
      }
    })
    .join('|')
}

function loadImages(): CatalogueImage[] {
  const raw = parseYaml(readFileSync(path.join(CATALOGUE_DIR, 'images.yaml'), 'utf8')) as Record<string, unknown> | null
  const list = Array.isArray(raw?.images) ? raw.images : []
  return list
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i) => {
      const status = i.status === 'authored' || i.status === 'verified' || i.status === 'unverified' ? i.status : 'unverified'
      return {
        id: asString(i.id),
        status,
        source: asString(i.source),
        architectures: asStringArray(i.architectures),
        capabilities: asStringArray(i.capabilities),
        deploys_to: asStringArray(i.deploys_to),
        env_required: asStringArray(i.env_required),
        env_optional: asStringArray(i.env_optional),
        secrets: asStringArray(i.secrets),
        health: asString(i.health),
        state_mount: asString(i.state_mount) || undefined,
        gpu: asString(i.gpu) || undefined,
      }
    })
}

function loadPlugins(): CataloguePlugin[] {
  const raw = parseYaml(readFileSync(path.join(CATALOGUE_DIR, 'plugins.yaml'), 'utf8')) as Record<string, unknown> | null
  const list = Array.isArray(raw?.plugins) ? raw.plugins : []
  return list
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({
      id: asString(p.id),
      version: asString(p.version),
      requires_capabilities: asStringArray(p.requires_capabilities),
      permissions: asStringArray(p.permissions),
      secret_refs: asStringArray(p.secret_refs),
      health: asString(p.health),
    }))
}

function loadCapabilities(): { capabilities: CatalogueCapability[]; rules: string[] } {
  const raw = parseYaml(readFileSync(path.join(CATALOGUE_DIR, 'capabilities.yaml'), 'utf8')) as Record<string, unknown> | null
  const capabilities: CatalogueCapability[] = []
  const capMap = raw?.capabilities
  if (capMap && typeof capMap === 'object' && !Array.isArray(capMap)) {
    for (const [id, entry] of Object.entries(capMap as Record<string, unknown>)) {
      const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
      const impls = Array.isArray(e.implementations) ? e.implementations : []
      capabilities.push({
        id,
        contract: asString(e.contract),
        implementations: impls
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
          .map((x) => ({
            kind: asString(x.kind),
            execution: asString(x.execution),
            note: asString(x.note),
          })),
      })
    }
  }
  return { capabilities, rules: asStringArray(raw?.rules) }
}

/** Load the infrastructure catalogue (cached by file mtime — the skill dir is read-only). */
export function loadCatalogue(): Catalogue {
  const stamp = mtimes()
  if (cache && cache.mtimes === stamp) return cache.value
  const value: Catalogue = {
    images: loadImages(),
    plugins: loadPlugins(),
    ...loadCapabilities(),
  }
  cache = { mtimes: stamp, value }
  return value
}

// Re-export for convenience so routes can validate plugin bindings against the catalogue.
export function pluginIds(): string[] {
  return loadCatalogue().plugins.map((p) => p.id)
}

export function imageDeploysTo(imageId: string): string[] {
  return loadCatalogue().images.find((i) => i.id === imageId)?.deploys_to ?? []
}
