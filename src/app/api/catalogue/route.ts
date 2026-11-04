import { NextResponse } from 'next/server'
import { loadCatalogue } from '@/lib/firm-forge/catalogue'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/catalogue → Catalogue (images, plugins, capabilities, rules). */
export async function GET() {
  return NextResponse.json(loadCatalogue())
}
