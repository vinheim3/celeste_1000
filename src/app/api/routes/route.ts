import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const kv = Redis.fromEnv();

import { readFileSync } from "fs";
import { join } from "path";
import type {
  Tracker,
  SlotData,
  Datapackage,
  StaticTracker,
  Filter,
  Watch,
  ActiveWatch,
  SlotHint,
} from "@/lib/types";
import { enumerateAllRoutes, resolveWatches } from "@/lib/enumerate";
import { GOAL_CHECKPOINTS } from "@/lib/goals";
import { WATCH_ITEM_EXCLUDES } from "@/lib/Watchitemexcludes";

const TRACKER_ID = process.env.ARCHIPELAGO_TRACKER_ID!;

function buildSlotHints(
  tracker: Tracker,
  datapackage: Datapackage,
  aliasMap: Map<number, string>,
): Map<string, SlotHint[]> {
  const idToItem = Object.fromEntries(
    Object.entries(datapackage.item_name_to_id).map(([k, v]) => [v, k]),
  );
  const idToLocation = Object.fromEntries(
    Object.entries(datapackage.location_name_to_id).map(([k, v]) => [v, k]),
  );

  // Map: receivingSlot -> hints where that slot is the receiver
  const hintsBySlot = new Map<string, SlotHint[]>();

  for (const playerHints of tracker.hints) {
    for (const hint of playerHints.hints) {
      const [receivingIdx, findingIdx, locationId, itemId, found] = hint;
      if (found) continue;
      if (receivingIdx !== playerHints.player) continue;

      const receivingSlot = `Celeste${receivingIdx}`;
      const findingSlot = `Celeste${findingIdx}`;
      const item = idToItem[itemId] ?? `Item#${itemId}`;
      const location = idToLocation[locationId] ?? `Location#${locationId}`;

      const slotHint: SlotHint = {
        receivingSlot,
        receivingAlias: aliasMap.get(receivingIdx) ?? null,
        findingSlot,
        findingAlias: aliasMap.get(findingIdx) ?? null,
        item,
        location,
      };

      if (!hintsBySlot.has(receivingSlot)) hintsBySlot.set(receivingSlot, []);
      hintsBySlot.get(receivingSlot)!.push(slotHint);
    }
  }

  return hintsBySlot;
}

// No Next.js data cache — the 7MB tracker response exceeds its 2MB limit.
// Instead we keep a module-level in-process cache with a 60s TTL.
// The serverless function stays warm between requests so this works reliably.
const TRACKER_TTL_MS = 60_000;
let trackerCache: { data: Tracker; fetchedAt: number } | null = null;

async function getTracker(): Promise<Tracker> {
  const now = Date.now();
  if (trackerCache && now - trackerCache.fetchedAt < TRACKER_TTL_MS) {
    return trackerCache.data;
  }
  const res = await fetch(`https://archipelago.gg/api/tracker/${TRACKER_ID}`);
  if (!res.ok) throw new Error(`Tracker fetch failed: ${res.status}`);
  const data: Tracker = await res.json();
  trackerCache = { data, fetchedAt: now };
  return data;
}

// Read static files once at module load (they never change at runtime)
const DATA_DIR = join(process.cwd(), "data");

const slotDataList: SlotData[] = JSON.parse(
  readFileSync(join(DATA_DIR, "slot_data.json"), "utf-8"),
);
const datapackage: Datapackage = JSON.parse(
  readFileSync(join(DATA_DIR, "datapackage.json"), "utf-8"),
);
const goalCheckpointsanityList: boolean[] = JSON.parse(
  readFileSync(join(DATA_DIR, "goal_checkpointsanity.json"), "utf-8"),
);
const staticTracker: StaticTracker = JSON.parse(
  readFileSync(join(DATA_DIR, "static_tracker.json"), "utf-8"),
);

// Sorted, filtered item list derived from the datapackage — computed once at module load
const allWatchItems: string[] = Object.keys(datapackage.item_name_to_id)
  .filter((name) => !WATCH_ITEM_EXCLUDES.has(name))
  .sort();

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // --- Parse filter ---
  const filterMode = searchParams.get("filter") ?? "threshold";
  let filter: Filter;

  if (filterMode === "alias") {
    const alias = searchParams.get("alias");
    if (!alias)
      return NextResponse.json(
        { error: "alias param required" },
        { status: 400 },
      );
    filter = { mode: "alias", alias };
  } else if (filterMode === "slots") {
    const slots = searchParams.getAll("slot");
    if (!slots.length)
      return NextResponse.json(
        { error: "slot param required" },
        { status: 400 },
      );
    filter = { mode: "slots", slots };
  } else if (filterMode === "goal") {
    const goal = searchParams.get("goal") ?? "";
    filter = { mode: "goal", goal };
  } else {
    filter = {
      mode: "threshold",
      threshold: Number(searchParams.get("threshold") ?? 4),
    };
  }

  // --- Fetch tracker and notes in parallel ---
  let tracker: Tracker;
  let notes: Record<string, string>;
  let rawWatches: Record<string, Watch>;
  try {
    [tracker, notes, rawWatches] = await Promise.all([
      getTracker(),
      kv.hgetall<Record<string, string>>("slot-notes").then((r) => r ?? {}),
      kv.hgetall<Record<string, Watch>>("slot-watches").then((r) => r ?? {}),
    ]);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 502 },
    );
  }

  // Resolve watches — auto-clear any whose conditions are all met
  const allWatches: Watch[] = Object.values(rawWatches);
  const { active: activeWatches } = resolveWatches(
    allWatches,
    tracker,
    datapackage,
  );

  // --- Build alias map from tracker ---
  const aliasMap = new Map<number, string>(
    tracker.aliases.map((a) => [a.player, a.alias]),
  );

  // --- Build hint map ---
  const hintsBySlot = buildSlotHints(tracker, datapackage, aliasMap);

  // --- Run enumeration ---
  const routes = enumerateAllRoutes(
    tracker,
    slotDataList,
    datapackage,
    staticTracker,
    goalCheckpointsanityList,
    aliasMap,
    filter,
  );

  // --- Build available filter options for the UI ---
  // These come from the full unfiltered slot data so the dropdowns are always complete
  const allAliases = [
    ...new Set([...aliasMap.values()].filter(Boolean)),
  ].sort();

  const allSlots = slotDataList
    .map((_, i) => `Celeste${i + 1}`)
    .filter((_, i) => {
      const area = slotDataList[i]?.slot_data?.goal_area;
      return area && GOAL_CHECKPOINTS[area];
    })
    // Numeric sort: Celeste1 < Celeste2 < ... < Celeste1000
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.replace("Celeste", ""), 10);
      return n(a) - n(b);
    });

  const hintsBySlotObj = Object.fromEntries(hintsBySlot);
  const slotAliasMap = Object.fromEntries(
    [...aliasMap.entries()]
      .filter(([, alias]) => alias)
      .map(([player, alias]) => [`Celeste${player}`, alias]),
  );
  return NextResponse.json({
    routes,
    allAliases,
    allSlots,
    notes,
    activeWatches,
    allWatchItems,
    hintsBySlot: hintsBySlotObj,
    slotAliasMap,
  });
}
