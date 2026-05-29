import type {
  Route,
  GoalRoute,
  Tracker,
  SlotData,
  Datapackage,
  Filter,
} from "./types";
import { GOAL_CHECKPOINTS, GOAL_DISPLAY, GOAL_KEYS } from "./goals";

// ---------------------------------------------------------------------------
// Cartesian product helper (replaces itertools.product)
// ---------------------------------------------------------------------------

function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]],
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

function buildInventory(
  tracker: Tracker,
  datapackage: Datapackage,
  playerIdx: number,
): Map<string, number> {
  const idToName = invertRecord(datapackage.item_name_to_id);
  const inventory = new Map<string, number>();
  const items = tracker.player_items_received[playerIdx]?.items ?? [];
  for (const [itemId, , , flags] of items) {
    if (!(flags & 3)) continue; // skip non-progression/useful
    const name = idToName[itemId];
    if (name) inventory.set(name, (inventory.get(name) ?? 0) + 1);
  }
  return inventory;
}

function invertRecord(record: Record<string, number>): Record<number, string> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [v, k]));
}

// ---------------------------------------------------------------------------
// Route logic
// ---------------------------------------------------------------------------

function routeIsBlocked(
  inventory: Map<string, number>,
  route: Route,
  keysanity: boolean,
): boolean {
  if (route.if_keysanity && !keysanity) return true;
  return (route.unless ?? []).some((item) => inventory.has(item));
}

function missingFromRoute(
  inventory: Map<string, number>,
  route: Route,
  freeItems: Set<string>,
): string[] {
  return route.requires.filter(
    (item) => !inventory.has(item) && !freeItems.has(item),
  );
}

// ---------------------------------------------------------------------------
// Main enumeration — direct translation of enumerate_goal_routes
// ---------------------------------------------------------------------------

export function enumerateGoalRoutes(
  slotName: string,
  goalArea: string,
  inventory: Map<string, number>,
  slotData: SlotData["slot_data"],
  checkpointsanity: boolean,
  goalCheckpointsanity: boolean,
  freeItems: Set<string>,
  keysanity: boolean,
): GoalRoute[] {
  const goalDef = GOAL_CHECKPOINTS[goalArea];
  if (!goalDef) return [];

  const goalDisplay = GOAL_DISPLAY[goalArea] ?? goalArea;

  const strawbCount = Math.max(
    0,
    (slotData.strawberries_required ?? 0) - (inventory.get("Strawberry") ?? 0),
  );
  const strawbItems = Array<string>(strawbCount).fill("Strawberry");

  const results: GoalRoute[] = [];

  for (const cp of goalDef.checkpoints) {
    const cpItem = cp.item;

    if (cpItem !== null && !(checkpointsanity && goalCheckpointsanity))
      continue;

    const cpMissing: string[] =
      checkpointsanity && cpItem !== null && !inventory.has(cpItem)
        ? [cpItem]
        : [];

    const perRoomOptions: Route[][] = cp.rooms.map((roomRoutes) => {
      const valid = roomRoutes.filter(
        (r) => !routeIsBlocked(inventory, r, keysanity),
      );
      return valid.length > 0 ? valid : roomRoutes;
    });

    if (perRoomOptions.length === 0) {
      results.push({
        slotName,
        goalArea,
        goalDisplay,
        alias: null, // filled in by caller
        checkpointItem: cpItem,
        missingItems: [...cpMissing, ...strawbItems],
        isDts: false,
      });
      continue;
    }

    const seen = new Set<string>();

    for (const combo of cartesianProduct(perRoomOptions)) {
      const missingSet = [...cpMissing];
      const dts = combo.some((r) => r.is_dts ?? false);
      for (const route of combo) {
        missingSet.push(...missingFromRoute(inventory, route, freeItems));
      }
      missingSet.push(...strawbItems);

      const key = JSON.stringify([[...new Set(missingSet)].sort(), dts]);
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        slotName,
        goalArea,
        goalDisplay,
        alias: null,
        checkpointItem: cpItem,
        missingItems: missingSet,
        isDts: dts,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Top-level: run enumeration across all slots, apply filter
// ---------------------------------------------------------------------------

export function enumerateAllRoutes(
  tracker: Tracker,
  slotDataList: SlotData[],
  datapackage: Datapackage,
  goalCheckpointsanityList: boolean[],
  aliasMap: Map<number, string>,
  filter: Filter,
): GoalRoute[] {
  const numPlayers = tracker.player_items_received.length;
  const allViable: GoalRoute[] = [];

  for (let i = 0; i < numPlayers; i++) {
    const slotName = `Celeste${i + 1}`;
    const slotData = slotDataList[i]?.slot_data ?? {};
    const goalArea = slotData.goal_area;

    if (!goalArea || !GOAL_CHECKPOINTS[goalArea]) continue;

    const inventory = buildInventory(tracker, datapackage, i);
    const strawbRequired = slotData.strawberries_required ?? 0;
    const strawbHave = inventory.get("Strawberry") ?? 0;
    if (inventory.has("Granny's House Keys") && strawbHave >= strawbRequired)
      continue;

    const alias = aliasMap.get(i + 1) ?? null;

    // Alias filter: skip if alias doesn't match
    if (filter.mode === "alias" && alias !== filter.alias) continue;
    // Slots filter: skip if slot not in list
    if (filter.mode === "slots" && !filter.slots?.includes(slotName)) continue;

    const checkpointsanity = Boolean(slotData.checkpointsanity);
    const goalCheckpointsanity = goalCheckpointsanityList[i] ?? false;
    const keysanity = Boolean(slotData.keysanity);
    const freeItems = new Set<string>(
      keysanity ? [] : (GOAL_KEYS[goalArea] ?? []),
    );

    const routes = enumerateGoalRoutes(
      slotName,
      goalArea,
      inventory,
      slotData,
      checkpointsanity,
      goalCheckpointsanity,
      freeItems,
      keysanity,
    );

    // Apply threshold filter
    const viable =
      filter.mode === "threshold"
        ? routes.filter((r) => r.missingItems.length <= (filter.threshold ?? 4))
        : routes;

    // Attach alias
    for (const r of viable) {
      allViable.push({ ...r, alias });
    }
  }

  return allViable;
}
