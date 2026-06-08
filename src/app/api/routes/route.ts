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
  InventoryCategories,
  ItemFinder,
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

// ---------------------------------------------------------------------------
// Item categorisation
// ---------------------------------------------------------------------------

const KEY_PATTERN = / Keys?( \d+)?$/;
const GEM_PATTERN = /- Gem \d+$/;

const CHECKPOINT_ITEMS = new Set([
  "The Summit A - 500 M",
  "The Summit A - 1000 M",
  "The Summit A - 1500 M",
  "The Summit A - 2000 M",
  "The Summit A - 2500 M",
  "The Summit A - 3000 M",
  "The Summit B - 500 M",
  "The Summit B - 1000 M",
  "The Summit B - 1500 M",
  "The Summit B - 2000 M",
  "The Summit B - 2500 M",
  "The Summit B - 3000 M",
  "Core A - Into the Core",
  "Core A - Hot and Cold",
  "Core A - Heart of the Mountain",
  "Core B - Into the Core",
  "Core B - Burning or Freezing",
  "Core B - Heartbeat",
  "Farewell - Singular",
  "Farewell - Power Source",
  "Farewell - Remembered",
  "Farewell - Event Horizon",
  "Farewell - Determination",
  "Farewell - Stubbornness",
  "Farewell - Reconciliation",
  "Farewell - Farewell",
  "Forsaken City A - Crossing",
  "Forsaken City A - Chasm",
  "Forsaken City B - Contraption",
  "Forsaken City B - Scrap Pit",
  "Old Site A - Intervention",
  "Old Site A - Awake",
  "Old Site B - Combination Lock",
  "Old Site B - Dream Altar",
  "Celestial Resort A - Huge Mess",
  "Celestial Resort A - Elevator Shaft",
  "Celestial Resort A - Presidential Suite",
  "Celestial Resort B - Staff Quarters",
  "Celestial Resort B - Library",
  "Celestial Resort B - Rooftop",
  "Golden Ridge A - Shrine",
  "Golden Ridge A - Old Trail",
  "Golden Ridge A - Cliff Face",
  "Golden Ridge B - Stepping Stones",
  "Golden Ridge B - Gusty Canyon",
  "Golden Ridge B - Eye of the Storm",
  "Mirror Temple A - Unravelling",
  "Mirror Temple A - Search",
  "Mirror Temple A - Depths",
  "Mirror Temple A - Rescue",
  "Mirror Temple B - Central Chamber",
  "Mirror Temple B - Through the Mirror",
  "Mirror Temple B - Mix Master",
  "Reflection A - Hollows",
  "Reflection A - Reflection",
  "Reflection A - Rock Bottom",
  "Reflection A - Resolution",
  "Reflection B - Rock Bottom",
  "Reflection B - Reflection",
  "Reflection B - Reprieve",
]);

const EXTRA_KEYS = new Set(["Granny's House Keys"]);

function categoriseItem(name: string): keyof InventoryCategories {
  if (CHECKPOINT_ITEMS.has(name)) return "checkpoints";
  if (KEY_PATTERN.test(name) || GEM_PATTERN.test(name) || EXTRA_KEYS.has(name))
    return "keysAndGems";
  return "items";
}

function buildInventoryMap(
  tracker: Tracker,
  datapackage: Datapackage,
): Map<string, InventoryCategories> {
  const idToName = Object.fromEntries(
    Object.entries(datapackage.item_name_to_id).map(([k, v]) => [v, k]),
  );
  const result = new Map<string, InventoryCategories>();

  for (let i = 0; i < tracker.player_items_received.length; i++) {
    const slotName = `Celeste${i + 1}`;
    const cats: InventoryCategories = {
      items: [],
      keysAndGems: [],
      checkpoints: [],
    };
    const seen = new Set<string>(["Strawberry"]);

    for (const [itemId, , , flags] of tracker.player_items_received[i]?.items ??
      []) {
      if (!(flags & 3)) continue;
      const name = idToName[itemId];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      cats[categoriseItem(name)].push(name);
    }

    cats.items.sort();
    cats.keysAndGems.sort();
    cats.checkpoints.sort();
    result.set(slotName, cats);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Chain traversal data
// ---------------------------------------------------------------------------

/**
 * Reverse hint index: item name → all slots that hold it (as finding slot).
 * Built from all hints regardless of filter so chain can traverse freely.
 */
function buildItemFinders(
  hintsBySlot: Map<string, SlotHint[]>,
): Map<string, ItemFinder[]> {
  const map = new Map<string, ItemFinder[]>();
  for (const hints of hintsBySlot.values()) {
    for (const h of hints) {
      if (!map.has(h.item)) map.set(h.item, []);
      map.get(h.item)!.push({
        item: h.item,
        findingSlot: h.findingSlot,
        findingAlias: h.findingAlias,
        location: h.location,
        receivingSlot: h.receivingSlot,
        receivingAlias: h.receivingAlias,
      });
    }
  }
  return map;
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

  // Count hints spent per receiving slot (hint points are spent by the requester,
  // and found hints still cost points — so we read raw from tracker, not hintsBySlot)
  const hintsSentBySlot = new Map<string, number>();
  for (const playerHints of tracker.hints) {
    for (const hint of playerHints.hints) {
      const [receivingIdx, , , , , , ,] = hint;
      if (receivingIdx !== playerHints.player) continue; // deduplicate
      const receivingSlot = `Celeste${receivingIdx}`;
      hintsSentBySlot.set(
        receivingSlot,
        (hintsSentBySlot.get(receivingSlot) ?? 0) + 1,
      );
    }
  }

  // --- Build inventory map ---
  const inventoryMap = buildInventoryMap(tracker, datapackage);
  const inventoryBySlot = Object.fromEntries(inventoryMap);

  // --- Build hint map ---
  const hintsBySlot = buildSlotHints(tracker, datapackage, aliasMap);
  const itemFinders = buildItemFinders(hintsBySlot);
  // --- Run enumeration ---
  const routes = enumerateAllRoutes(
    tracker,
    slotDataList,
    datapackage,
    staticTracker,
    goalCheckpointsanityList,
    aliasMap,
    filter,
    hintsSentBySlot,
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
    inventoryBySlot,
    itemFinders: Object.fromEntries(itemFinders),
  });
}
