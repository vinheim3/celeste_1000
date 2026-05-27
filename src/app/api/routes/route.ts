import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Tracker, SlotData, Datapackage, Filter } from '@/lib/types'
import { enumerateAllRoutes } from '@/lib/enumerate'
import { GOAL_CHECKPOINTS } from '@/lib/goals'

const TRACKER_ID = process.env.ARCHIPELAGO_TRACKER_ID!

// No Next.js data cache — the 7MB tracker response exceeds its 2MB limit.
// Instead we keep a module-level in-process cache with a 60s TTL.
// The serverless function stays warm between requests so this works reliably.
const TRACKER_TTL_MS = 60_000
let trackerCache: { data: Tracker; fetchedAt: number } | null = null

async function getTracker(): Promise<Tracker> {
  const now = Date.now()
  if (trackerCache && now - trackerCache.fetchedAt < TRACKER_TTL_MS) {
    return trackerCache.data
  }
  const res = await fetch(`https://archipelago.gg/api/tracker/${TRACKER_ID}`)
  if (!res.ok) throw new Error(`Tracker fetch failed: ${res.status}`)
  const data: Tracker = await res.json()
  trackerCache = { data, fetchedAt: now }
  return data
}

// Read static files once at module load (they never change at runtime)
const DATA_DIR = join(process.cwd(), 'data')

const slotDataList: SlotData[] = JSON.parse(
  readFileSync(join(DATA_DIR, 'slot_data.json'), 'utf-8')
)
const datapackage: Datapackage = JSON.parse(
  readFileSync(join(DATA_DIR, 'datapackage.json'), 'utf-8')
)
const goalCheckpointsanityList: boolean[] = JSON.parse(
  readFileSync(join(DATA_DIR, 'goal_checkpointsanity.json'), 'utf-8')
)


export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  // --- Parse filter ---
  const filterMode = searchParams.get('filter') ?? 'threshold'
  let filter: Filter

  if (filterMode === 'alias') {
    const alias = searchParams.get('alias')
    if (!alias) return NextResponse.json({ error: 'alias param required' }, { status: 400 })
    filter = { mode: 'alias', alias }
  } else if (filterMode === 'slots') {
    const slots = searchParams.getAll('slot')
    if (!slots.length) return NextResponse.json({ error: 'slot param required' }, { status: 400 })
    filter = { mode: 'slots', slots }
  } else {
    filter = { mode: 'threshold', threshold: Number(searchParams.get('threshold') ?? 4) }
  }

  // --- Fetch tracker (in-process cache, 60s TTL) ---
  let tracker: Tracker
  try {
    tracker = await getTracker()
  } catch {
    return NextResponse.json({ error: 'Failed to fetch tracker' }, { status: 502 })
  }

  // --- Build alias map from tracker ---
  const aliasMap = new Map<number, string>(
    tracker.aliases.map(a => [a.player, a.alias])
  )

  // --- Run enumeration ---
  const routes = enumerateAllRoutes(
    tracker, slotDataList, datapackage,
    goalCheckpointsanityList, aliasMap, filter
  )

  // --- Build available filter options for the UI ---
  // These come from the full unfiltered slot data so the dropdowns are always complete
  const allAliases = [...new Set(
    [...aliasMap.values()].filter(Boolean)
  )].sort()

  const allSlots = slotDataList
    .map((_, i) => `Celeste${i + 1}`)
    .filter((_, i) => {
      const area = slotDataList[i]?.slot_data?.goal_area
      return area && GOAL_CHECKPOINTS[area]
    })
    // Numeric sort: Celeste1 < Celeste2 < ... < Celeste1000
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.replace('Celeste', ''), 10)
      return n(a) - n(b)
    })

  return NextResponse.json({ routes, allAliases, allSlots })
}
