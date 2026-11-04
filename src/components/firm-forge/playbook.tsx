'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePlaybook } from './queries'
import { Markdown } from './markdown'
import { SectionTitle, forgeCard, monoCls } from './section-title'
import { ConnectingNote } from './empty-state'

export function PlaybookPanel() {
  const { data, isLoading, isError, error, refetch } = usePlaybook()
  const docs = data?.docs ?? []
  const [selected, setSelected] = useState<string | null>(null)

  // selection is only set by the user; invalid/missing falls back to the first doc
  const doc = docs.find((d) => d.name === selected) ?? docs[0] ?? null

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="the skill, verbatim"
        title="Playbook"
        description="SKILL.md and its five references, passed through unmodified — read each only when you reach its stage."
      />

      {isLoading ? (
        <Card className={forgeCard}>
          <CardContent className="py-10 text-center text-sm text-stone-500">Loading the playbook…</CardContent>
        </Card>
      ) : isError ? (
        <ConnectingNote error={error} onRetry={() => refetch()} hint="Playbook unavailable — the backend reads firm-spawner/ text files." />
      ) : docs.length === 0 ? (
        <Card className={forgeCard}>
          <CardContent className="py-10 text-center text-sm text-stone-500">No documents returned.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* doc picker */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="lg:hidden">
              <Select value={selected ?? undefined} onValueChange={setSelected}>
                <SelectTrigger className="h-11 w-full" aria-label="Pick a document">
                  <SelectValue placeholder="Pick a document" />
                </SelectTrigger>
                <SelectContent>
                  {docs.map((d) => (
                    <SelectItem key={d.name} value={d.name}>
                      <span className={monoCls}>{d.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Card className={`hidden ${forgeCard} lg:block`}>
              <CardContent className="p-3">
                <p className="mb-2 flex items-center gap-2 px-2 font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500 dark:text-stone-500">
                  <BookOpen className="size-3.5" /> firm-spawner
                </p>
                <nav aria-label="Playbook documents">
                  <ul className="space-y-1">
                    {docs.map((d) => {
                      const active = d.name === selected
                      return (
                        <li key={d.name}>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setSelected(d.name)}
                            aria-current={active ? 'page' : undefined}
                            className={`h-auto w-full justify-start whitespace-normal px-2 py-2 text-left ${monoCls} ${
                              active
                                ? 'border border-amber-700/50 bg-amber-500/10 text-amber-800 dark:border-amber-600/40 dark:text-amber-300'
                                : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200'
                            }`}
                          >
                            <FileText className="mr-1.5 size-3.5 shrink-0" />
                            {d.label}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </nav>
              </CardContent>
            </Card>
          </div>

          {/* document */}
          <motion.article
            key={doc?.name}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`rounded-xl p-4 sm:p-6 ${forgeCard}`}
            aria-live="polite"
          >
            <ScrollArea className="max-h-[calc(100vh-16rem)] pr-3">
              <Markdown content={doc?.content ?? ''} />
            </ScrollArea>
          </motion.article>
        </div>
      )}
    </div>
  )
}
