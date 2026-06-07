export interface Route {
  requires: string[];
  unless?: string[];
  if_keysanity?: boolean;
  is_dts?: boolean;
}

export interface Room {
  room_name: string;
  routes: Route[];
}

export interface Checkpoint {
  item: string | null;
  rooms: Room[];
}

export interface GoalDef {
  checkpoints: Checkpoint[];
}

export type GoalCheckpoints = Record<string, GoalDef>;

// What the API returns per slot
export interface GoalRoute {
  slotName: string;
  goalArea: string; // internal code e.g. "7a", "10b"
  goalDisplay: string; // human label e.g. "7a", "Farewell"
  alias: string | null;
  checkpointItem: string | null;
  missingItems: string[];
  isDts: boolean;
  checkedLocations: number;
  totalLocations: number;
}

// Grouped by slot for the UI
export interface SlotResult {
  slotName: string;
  goalArea: string;
  goalDisplay: string;
  alias: string | null;
  routes: GoalRoute[];
  bestCount: number; // length of shortest route, for sorting
  checkedLocations: number;
  totalLocations: number;
  hints: SlotHint[];
  inventory: InventoryCategories | null;
}

// Tracker shape (subset we care about)
export interface TrackerPlayerItems {
  player: number;
  items: [number, number, number, number][]; // [item_id, location_id, sending_player, flags]
}

export interface TrackerAlias {
  player: number;
  alias: string;
}

export interface TrackerPlayerHintEntry {
  player: number;
  team: number;
  hints: [
    number, // receiving_player (1-indexed)
    number, // finding_player (1-indexed)
    number, // location_id
    number, // item_id
    boolean, // found
    string, // entrance (ignored)
    number, // item_flags (ignored)
    number, // status (ignored)
  ][];
}

export interface Tracker {
  player_items_received: TrackerPlayerItems[];
  player_checks_done: { locations: number[] }[]; // 0-based array, index = player - 1
  hints: TrackerPlayerHintEntry[];
  aliases: TrackerAlias[];
}

// slot_data.json shape — array indexed 0..N-1
export interface SlotData {
  slot_data: {
    goal_area?: string;
    checkpointsanity?: number | boolean;
    keysanity?: number | boolean;
    strawberries_required?: number;
  };
}

// datapackage.json shape
export interface Datapackage {
  item_name_to_id: Record<string, number>;
  location_name_to_id: Record<string, number>;
}

export interface StaticTracker {
  player_locations_total: {
    player: number;
    team: number;
    total_locations: number;
  }[];
  // other fields omitted
}

export interface InventoryCategories {
  items: string[]; // gameplay mechanics
  keysAndGems: string[]; // keys and collectible gems
  checkpoints: string[]; // chapter checkpoint unlocks
}

// Item finder entry — who has this item and where
export interface ItemFinder {
  item: string;
  findingSlot: string;
  findingAlias: string | null;
  location: string;
  receivingSlot: string;
  receivingAlias: string | null;
}

// A resolved hint for display against a slot
export interface SlotHint {
  receivingSlot: string; // e.g. "Celeste518"
  receivingAlias: string | null;
  findingSlot: string; // e.g. "Celeste78"
  findingAlias: string | null;
  item: string;
  location: string;
}

export type FilterMode = "threshold" | "alias" | "slots" | "goal";

export interface Filter {
  mode: FilterMode;
  threshold?: number;
  alias?: string;
  slots?: string[];
  goal?: string; // GOAL_DISPLAY value e.g. "7a", "Farewell"
}

// ---------------------------------------------------------------------------
// Watches — dependent slot tracking
// ---------------------------------------------------------------------------

export type WatchCondition =
  | { type: "item"; item: string }
  | { type: "strawberries"; count: number };

export interface Watch {
  id: string; // uuid
  watchSlot: string; // dependent slot being watched, e.g. "Celeste42"
  forSlot: string; // slot you're trying to goal, e.g. "Celeste696"
  conditions: WatchCondition[]; // ALL must be met
  orConditions: WatchCondition[]; // ANY ONE must be met (empty = no or requirement)
}

// Resolved at page load
export interface ActiveWatch extends Watch {
  andMet: WatchCondition[]; // AND conditions already satisfied
  andUnmet: WatchCondition[]; // AND conditions still blocking
  orMet: WatchCondition[]; // OR conditions already satisfied
  orUnmet: WatchCondition[]; // OR conditions not yet satisfied
  allMet: boolean; // true when both AND and OR groups are satisfied
  strawberriesHave: number;
}
