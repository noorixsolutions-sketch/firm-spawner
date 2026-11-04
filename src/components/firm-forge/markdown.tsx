'use client'

import ReactMarkdown from 'react-markdown'

// Minimal dark-friendly markdown styles (no @tailwindcss/typography dependency).
// Amber headings, stone body, bordered code blocks and tables.

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body max-w-none text-sm leading-relaxed text-stone-700 dark:text-stone-300">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mb-4 mt-8 border-b border-stone-200 pb-2 text-xl font-bold text-amber-700 first:mt-0 dark:border-amber-900/40 dark:text-amber-400">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-3 mt-7 border-b border-stone-200 pb-1.5 text-lg font-semibold text-amber-700 dark:border-amber-900/40 dark:text-amber-400">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-5 text-base font-semibold text-stone-900 dark:text-stone-100">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-stone-700 dark:text-stone-200">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-amber-700 underline decoration-amber-600/40 underline-offset-2 hover:decoration-amber-500 dark:text-amber-400"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-4 border-l-2 border-amber-600/70 bg-amber-500/5 py-1 pl-4 text-stone-600 italic dark:text-stone-400">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-stone-200 dark:border-stone-800" />,
          strong: ({ children }) => <strong className="font-semibold text-stone-900 dark:text-stone-100">{children}</strong>,
          table: ({ children }) => (
            <div className="mb-4 overflow-x-auto rounded-lg border border-stone-300 dark:border-stone-700">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-stone-100 text-left dark:bg-stone-800/80 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:text-stone-700 dark:[&_th]:text-stone-300">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="[&_td]:border-t [&_td]:border-stone-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top dark:[&_td]:border-stone-800">
              {children}
            </tbody>
          ),
          tr: ({ children }) => <tr>{children}</tr>,
          code: ({ className, children }) => {
            const isBlock = typeof className === 'string' && className.includes('language-')
            if (isBlock) {
              return <code className="block font-mono text-xs leading-relaxed">{children}</code>
            }
            return (
              <code className="rounded border border-amber-900/30 bg-amber-950/20 px-1 py-0.5 font-mono text-[11px] text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300">
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-4 overflow-x-auto rounded-lg border border-stone-800 bg-stone-950 p-3 text-stone-300 dark:border-amber-900/40">
              {children}
            </pre>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
