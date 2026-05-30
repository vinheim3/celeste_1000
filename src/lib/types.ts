export interface Route {
  requires: string[];
  unless?: string[];
  if_keysanity?: boolean;
  is_dts?: boolean;
}

export interface Checkpoint {
  item: string | null;
  rooms: Route[][];
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
}

// Grouped by slot for the UI
export interface SlotResult {
  slotName: string;
  goalArea: string;
  goalDisplay: string;
  alias: string | null;
  routes: GoalRoute[];
  bestCount: number; // length of shortest route, for sorting
}

// Tracker shape (subset we care about)
export interface TrackerPlayerItems {
  player: number;
  items: [number, number, number, number][]; // [item_id, location_id, sending_player, flags]
}

export interface TrackerPlayerHints {
  player: number;
  hints: unknown[];
}

export interface TrackerAlias {
  player: number;
  alias: string;
}

export interface Tracker {
  player_items_received: TrackerPlayerItems[];
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

export type FilterMode = "threshold" | "alias" | "slots";

export interface Filter {
  mode: FilterMode;
  threshold?: number;
  alias?: string;
  slots?: string[];
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
  conditions: WatchCondition[];
}

// Resolved at page load — watches whose conditions are not yet met
export interface ActiveWatch extends Watch {
  metConditions: WatchCondition[]; // conditions already satisfied
  unmetConditions: WatchCondition[]; // conditions still blocking
}
