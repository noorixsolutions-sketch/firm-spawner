import { NextResponse } from 'next/server'
import { chatCompletions } from '@/lib/firm-forge/harness'
import type { ChatCompletionsBody } from '@/lib/firm-forge/harness'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ firmId: string }> }

/**
 * POST /api/harness/firms/[firmId]/v1/chat/completions — OpenAI-shaped model plane
 * backed by the workspace LLM. 502 when the model plane is unavailable.
 */
export async function POST(req: Request, { params }: Params) {
  const { firmId } = await params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'invalid body: expected {model?, messages: [{role, content}], temperature?}' }, { status: 400 })
  }
  const messages: { role: string; content: string }[] = []
  for (const m of body.messages) {
    if (!m || typeof m !== 'object' || typeof (m as Record<string, unknown>).role !== 'string') {
      return NextResponse.json({ error: 'messages must be {role, content} objects' }, { status: 400 })
    }
    const content = (m as Record<string, unknown>).content
    messages.push({
      role: (m as Record<string, unknown>).role as string,
      content: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
    })
  }
  const parsed: ChatCompletionsBody = {
    model: typeof body.model === 'string' ? body.model : undefined,
    messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
  }
  const res = await chatCompletions(firmId, parsed)
  return NextResponse.json(res.body, { status: res.code })
}
