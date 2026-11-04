'use client'

import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Tag/chips input. Values are stored as a string[] — Enter or comma commits a
 * chip, Backspace on an empty input removes the last one.
 */
export function ChipsInput({
  values,
  onChange,
  placeholder,
  validate,
  hint,
  invalidMessage,
  className,
  ariaLabel,
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  validate?: (value: string) => boolean
  hint?: ReactNode
  invalidMessage?: string
  className?: string
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function commit(raw: string) {
    const value = raw.trim().replace(/,+$/, '')
    if (!value) return
    if (values.includes(value)) {
      setError('already added')
      return
    }
    if (validate && !validate(value)) {
      setError(invalidMessage ?? 'invalid value')
      return
    }
    setError(null)
    onChange([...values, value])
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(draft)
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className={cn('w-full', className)}>
      <div
        className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2 py-1.5 shadow-xs focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 dark:border-stone-700 dark:bg-stone-950"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded border border-amber-700/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 dark:border-amber-800/50 dark:text-amber-300"
          >
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              className="rounded p-0.5 text-stone-500 hover:bg-amber-500/20 hover:text-red-600 focus-visible:outline focus-visible:outline-amber-500"
              onClick={() => onChange(values.filter((v) => v !== value))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => draft && commit(draft)}
          placeholder={values.length === 0 ? placeholder : ''}
          aria-label={ariaLabel ?? 'Add value'}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 font-mono text-xs text-stone-800 outline-none placeholder:text-stone-400 dark:text-stone-200"
        />
      </div>
      {error ? (
        <p className="mt-1 font-mono text-[11px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {hint && !error ? (
        <p className="mt-1 text-[11px] leading-relaxed text-stone-500 dark:text-stone-500">{hint}</p>
      ) : null}
    </div>
  )
}
