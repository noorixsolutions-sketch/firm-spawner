'use client'

import { useState } from 'react'
import { ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen } from 'lucide-react'
import type { FileNode } from '@/lib/firm-forge/types'
import { cn } from '@/lib/utils'
import { monoCls } from './section-title'

function fileIcon(name: string, selected: boolean) {
  const cls = cn('size-3.5 shrink-0', selected ? 'text-amber-600 dark:text-amber-400' : 'text-stone-400')
  if (name.endsWith('.ipynb') || name.endsWith('.json')) return <FileJson className={cls} />
  if (name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.sh') || name.endsWith('.py'))
    return <FileCode2 className={cls} />
  return <FileText className={cls} />
}

function Node({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: FileNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(depth === 0)

  if (node.type === 'dir') {
    return (
      <li className="select-none">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-8 w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-stone-100 dark:hover:bg-stone-800/70"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <ChevronRight
            className={cn('size-3.5 shrink-0 text-stone-400 transition-transform', open && 'rotate-90')}
          />
          {open ? (
            <FolderOpen className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-stone-400" />
          )}
          <span className={cn('truncate', monoCls, 'text-stone-700 dark:text-stone-300')}>{node.name}/</span>
        </button>
        {open && node.children?.length ? (
          <ul role="group" className="space-y-0.5">
            {node.children.map((child) => (
              <Node
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  const selected = selectedPath === node.path
  return (
    <li className="select-none">
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex min-h-8 w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-stone-100 dark:hover:bg-stone-800/70',
          selected && 'bg-amber-500/15 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
        )}
        style={{ paddingLeft: depth * 12 + 4 + 18 }}
      >
        {fileIcon(node.name, selected)}
        <span className={cn('truncate', monoCls, selected ? 'text-amber-800 dark:text-amber-300' : 'text-stone-600 dark:text-stone-400')}>
          {node.name}
        </span>
        {typeof node.size === 'number' ? (
          <span className="ml-auto shrink-0 pl-2 font-mono text-[10px] text-stone-400">{prettyBytes(node.size)}</span>
        ) : null}
      </button>
    </li>
  )
}

export function FileTree({
  tree,
  selectedPath,
  onSelect,
}: {
  tree: FileNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  if (!tree.length) return null
  return (
    <ul role="tree" aria-label="Rendered firm files" className="space-y-0.5">
      {tree.map((node) => (
        <Node key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </ul>
  )
}

export function prettyBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
