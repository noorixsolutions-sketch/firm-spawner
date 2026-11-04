// Firm Forge — in-memory pub/sub used by the Overview "Run full E2E" CTA to
// switch to the E2E Lab tab AND start the run there. Requests carry a token so
// the lab can fire each one exactly once; a pending request covers the mount
// race (navigate then run).

export interface E2ERunRequest {
  token: number
  firmDbId: string | null
}

type Listener = (request: E2ERunRequest) => void

const listeners = new Set<Listener>()
let pending: E2ERunRequest | null = null
let counter = 0

export function subscribeE2ERun(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function requestE2ERun(firmDbId: string | null): E2ERunRequest {
  const request: E2ERunRequest = { token: ++counter, firmDbId }
  pending = request
  listeners.forEach((fn) => fn(request))
  return request
}

export function consumePendingE2ERun(): E2ERunRequest | null {
  const request = pending
  pending = null
  return request
}
