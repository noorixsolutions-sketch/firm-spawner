'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { scrollbarCls } from './section-title'

export function CodeBlock({
  code,
  className,
  maxHeight = 'max-h-[560px]',
  showCopy = true,
  label,
}: {
  code: string
  className?: string
  maxHeight?: string
  showCopy?: boolean
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div
      className={cn(
        'relative rounded-lg border border-stone-800 bg-stone-950 dark:border-amber-900/40',
        className,
      )}
    >
      {showCopy ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copy}
          aria-label="Copy to clipboard"
          className="absolute right-1.5 top-1.5 z-10 h-8 w-8 border border-stone-700 bg-stone-900/80 p-0 text-stone-400 hover:text-amber-400 hover:bg-stone-800"
        >
          {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
        </Button>
      ) : null}
      {label ? (
        <p className="border-b border-stone-800 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
          {label}
        </p>
      ) : null}
      <pre
        className={cn(
          'overflow-auto p-3 font-mono text-xs leading-relaxed text-stone-300',
          maxHeight,
          scrollbarCls,
        )}
      >
        {code}
      </pre>
    </div>
  )
}
