'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Boxes, Cpu, Layers, Plug, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { CatalogueImage } from '@/lib/firm-forge/types'
import { useCatalogue } from './queries'
import { SectionTitle, forgeCard, monoCls } from './section-title'
import { StatusBadge, type Tone } from './status-badge'
import { StatChip } from './stat-chip'
import { ConnectingNote, EmptyState } from './empty-state'

function imageStatusTone(status: CatalogueImage['status']): Tone {
  if (status === 'authored') return 'warn'
  if (status === 'verified') return 'ok'
  return 'muted'
}

export function CataloguePanel() {
  const { data, isLoading, isError, error, refetch } = useCatalogue()

  const images = useMemo(() => data?.images ?? [], [data])
  const plugins = useMemo(() => data?.plugins ?? [], [data])
  const capabilities = useMemo(() => data?.capabilities ?? [], [data])

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className={`h-16 animate-pulse rounded-xl ${forgeCard}`} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`h-40 animate-pulse rounded-xl ${forgeCard}`} />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return <ConnectingNote error={error} onRetry={() => refetch()} hint="Catalogue unavailable — the backend parses firm-spawner/catalogue/*.yaml." />
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="stage 0 · inventory"
        title="Catalogue"
        description="The only images, plugins and capabilities a firm may use — parsed straight from firm-spawner/catalogue. Anything not listed is rejected by validate.py."
      />

      {/* images */}
      <section aria-label="Images" className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
          <Boxes className="size-4 text-amber-600 dark:text-amber-500" /> Images ({images.length})
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {images.map((image) => (
            <motion.article
              key={image.id}
              whileHover={{ y: -3 }}
              className={`flex flex-col gap-3 rounded-xl p-4 ${forgeCard}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={`truncate font-mono text-sm font-semibold text-amber-700 dark:text-amber-400`}>
                  {image.id}
                </p>
                <StatusBadge tone={imageStatusTone(image.status)}>{image.status}</StatusBadge>
              </div>
              <p className={`break-all ${monoCls} text-stone-500 dark:text-stone-400`}>{image.source}</p>
              <div className="flex flex-wrap gap-1">
                {image.deploys_to.map((target) => (
                  <StatChip key={target} label="deploys" value={target} mono />
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {image.env_required.map((env) => (
                  <StatChip key={env} label="env" value={env} mono tone="warn" />
                ))}
              </div>
              <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">{image.health}</p>
              {image.gpu ? (
                <StatChip label="gpu" value={image.gpu} mono tone="muted" icon={<Cpu />} />
              ) : null}
              {image.architectures?.length ? (
                <p className={`text-[11px] text-stone-400 ${monoCls}`}>{image.architectures.join(' · ')}</p>
              ) : null}
            </motion.article>
          ))}
        </div>
      </section>

      {/* plugins */}
      <section aria-label="Plugins" className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
          <Plug className="size-4 text-amber-600 dark:text-amber-500" /> Plugins ({plugins.length})
        </h3>
        <Card className={forgeCard}>
          <CardContent className="overflow-x-auto">
            {plugins.length === 0 ? (
              <EmptyState icon={<Plug />} title="No plugins listed" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>id</TableHead>
                    <TableHead>version</TableHead>
                    <TableHead>permissions</TableHead>
                    <TableHead>secret refs</TableHead>
                    <TableHead>requires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plugins.map((plugin) => (
                    <TableRow key={plugin.id}>
                      <TableCell className={`font-medium ${monoCls} text-amber-700 dark:text-amber-400`}>
                        {plugin.id}
                      </TableCell>
                      <TableCell className={monoCls}>{plugin.version}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {plugin.permissions.map((p) => (
                            <StatusBadge key={p} tone="accent">{p}</StatusBadge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {plugin.secret_refs.length ? (
                          <div className="flex flex-wrap gap-1">
                            {plugin.secret_refs.map((s) => (
                              <StatusBadge key={s} tone="warn">{s}</StatusBadge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400">none</span>
                        )}
                      </TableCell>
                      <TableCell className={monoCls}>{plugin.requires_capabilities.join(', ')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {plugins.map((plugin) => (
            <p key={`${plugin.id}-health`} className={`rounded-lg px-3 py-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400 ${forgeCard}`}>
              <span className="font-mono text-amber-700 dark:text-amber-400">{plugin.id}</span> — {plugin.health}
            </p>
          ))}
        </div>
      </section>

      {/* capabilities */}
      <section aria-label="Capabilities" className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
          <Layers className="size-4 text-amber-600 dark:text-amber-500" /> Capabilities ({capabilities.length})
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {capabilities.map((cap) => (
            <motion.article
              key={cap.id}
              whileHover={{ y: -2 }}
              className={`space-y-3 rounded-xl p-4 ${forgeCard}`}
            >
              <p className={`font-mono text-sm font-semibold text-amber-700 dark:text-amber-400`}>{cap.id}</p>
              <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-400">{cap.contract}</p>
              {cap.implementations?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>kind</TableHead>
                      <TableHead>execution</TableHead>
                      <TableHead>note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cap.implementations.map((impl, i) => (
                      <TableRow key={i}>
                        <TableCell className={monoCls}>{impl.kind}</TableCell>
                        <TableCell className={monoCls}>{impl.execution}</TableCell>
                        <TableCell className="text-xs text-stone-500 dark:text-stone-400">{impl.note}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </motion.article>
          ))}
        </div>
      </section>

      {/* rules */}
      {data?.rules?.length ? (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-300">
          <ShieldCheck className="size-4" />
          <AlertTitle>Catalogue rules</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-400/90">
              {data.rules.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {images.length === 0 && plugins.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="Catalogue empty"
          description="firm-spawner/catalogue should list images, plugins and capabilities."
        />
      ) : null}
    </div>
  )
}
