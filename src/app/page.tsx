"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  GoalRoute,
  FilterMode,
  SlotResult,
  ActiveWatch,
  WatchCondition,
  SlotHint,
  InventoryCategories,
  ItemFinder,
} from "@/lib/types";

const GOAL_OPTIONS = [
  "7a",
  "7b",
  "7c",
  "8a",
  "8b",
  "8c",
  "Empty Space",
  "Farewell",
] as const;

// ---------------------------------------------------------------------------
// Types for API response
// ---------------------------------------------------------------------------
interface ApiResponse {
  routes: GoalRoute[];
  allAliases: string[];
  allSlots: string[];
  notes: Record<string, string>;
  activeWatches: ActiveWatch[];
  allWatchItems: string[];
  hintsBySlot: Record<string, SlotHint[]>;
  slotAliasMap: Record<string, string>;
  inventoryBySlot: Record<string, InventoryCategories>;
  itemFinders: Record<string, ItemFinder[]>;
}

// ---------------------------------------------------------------------------
// Group flat routes into per-slot results
// ---------------------------------------------------------------------------
function groupRoutes(
  routes: GoalRoute[],
  hintsBySlot: Record<string, SlotHint[]>,
  inventoryBySlot: Record<string, InventoryCategories>,
  omitSupersets: boolean = false,
): SlotResult[] {
  const map = new Map<string, SlotResult>();
  for (const r of routes) {
    if (!map.has(r.slotName)) {
      map.set(r.slotName, {
        slotName: r.slotName,
        goalArea: r.goalArea,
        goalDisplay: r.goalDisplay,
        alias: r.alias,
        routes: [],
        bestCount: Infinity,
        checkedLocations: r.checkedLocations,
        totalLocations: r.totalLocations,
        hintsAvailable: r.hintsAvailable,
        hints: [],
        inventory: null,
      });
    }
    const slot = map.get(r.slotName)!;
    slot.routes.push(r);
    slot.bestCount = Math.min(slot.bestCount, r.missingItems.length);
  }

  // Dedupe routes with identical missing-item sets by merging their via labels
  for (const slot of map.values()) {
    const deduped = new Map<string, GoalRoute & { viaLabels: string[] }>();
    for (const r of slot.routes) {
      const key = [...r.missingItems].sort().join("\0");
      if (deduped.has(key)) {
        const existing = deduped.get(key)!;
        const label = viaLabel(r);
        if (label && !existing.viaLabels.includes(label))
          existing.viaLabels.push(label);
      } else {
        deduped.set(key, { ...r, viaLabels: [viaLabel(r)] });
      }
    }
    slot.routes = [...deduped.values()].map(
      ({ viaLabels, ...r }) =>
        ({
          ...r,
          // Store merged via labels back on the route for the UI to consume
          _viaLabels: viaLabels,
        }) as GoalRoute & { _viaLabels: string[] },
    );
  }

  // Attach hints and inventory to each slot
  for (const slot of map.values()) {
    slot.hints = hintsBySlot[slot.slotName] ?? [];
    slot.inventory = inventoryBySlot[slot.slotName] ?? null;
  }

  // Optionally remove routes that are strict supersets of cheaper routes
  if (omitSupersets) {
    for (const slot of map.values()) {
      slot.routes = slot.routes.filter((candidate) => {
        const candidateSet = new Set(candidate.missingItems);
        return !slot.routes.some((other) => {
          if (other === candidate) return false;
          const otherSet = new Set(other.missingItems);
          if (otherSet.size >= candidateSet.size) return false;
          return [...otherSet].every((item) => candidateSet.has(item));
        });
      });
      slot.bestCount = Math.min(
        ...slot.routes.map((r) => r.missingItems.length),
        Infinity,
      );
    }
  }

  return [...map.values()].sort((a, b) => a.bestCount - b.bestCount);
}

function viaLabel(r: GoalRoute): string {
  const parts: string[] = [];
  if (r.checkpointItem) parts.push(r.checkpointItem);
  if (r.isDts) parts.push("DTS");
  return parts.length > 0 ? parts.join(", ") : "Start";
}

// ---------------------------------------------------------------------------
// Combobox (searchable single-select)
// ---------------------------------------------------------------------------
function Combobox({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <input
        className="filter-input"
        value={open ? query : value}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        readOnly={!open}
        style={{ cursor: open ? "text" : "pointer" }}
      />
      {open && (
        <div className="dropdown">
          {filtered.length === 0 ? (
            <div className="dropdown-empty">No matches</div>
          ) : (
            filtered.map((opt) => (
              <div
                key={opt}
                className={`dropdown-item ${opt === value ? "active" : ""}`}
                onMouseDown={() => {
                  onChange(opt);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {opt}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-select combobox
// ---------------------------------------------------------------------------
function MultiCombobox({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (opt: string) => {
    onChange(
      value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt],
    );
  };

  const displayValue =
    value.length === 0
      ? ""
      : value.length === 1
        ? value[0]
        : `${value.length} slots selected`;

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <input
        className="filter-input"
        value={open ? query : displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        readOnly={!open}
        style={{ cursor: open ? "text" : "pointer" }}
      />
      {open && (
        <div className="dropdown">
          {filtered.length === 0 ? (
            <div className="dropdown-empty">No matches</div>
          ) : (
            filtered.map((opt) => (
              <div
                key={opt}
                className={`dropdown-item ${value.includes(opt) ? "active" : ""}`}
                onMouseDown={() => toggle(opt)}
              >
                <span className="check">{value.includes(opt) ? "✓" : " "}</span>
                {opt}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function formatMissingItems(items: string[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .map(([item, n]) => (n > 1 ? `${item} x${n}` : item))
    .join(", ");
}

// ---------------------------------------------------------------------------
// Route pill
// ---------------------------------------------------------------------------
function RoutePill({
  route,
}: {
  route: GoalRoute & { _viaLabels?: string[] };
}) {
  const count = route.missingItems.length;
  const viaLabels = route._viaLabels;

  // If we have merged labels, show them; a null/empty label means "Start" (no checkpoint, no DTS)
  const viaStr = (() => {
    const labels = viaLabels ?? [viaLabel(route)];
    // Only show "Start" if it appears alongside other labels
    const filtered =
      labels.length > 1 ? labels : labels.filter((l) => l !== "Start");
    return filtered.length > 0 ? "via " + filtered.join(", ") : null;
  })();

  return (
    <div className="route-pill">
      <span className={`route-count count-${Math.min(count, 5)}`}>
        {count === 0 ? "✓" : count}
      </span>
      <div className="route-body">
        {viaStr && <span className="route-via">{viaStr}</span>}
        {count === 0 ? (
          <span className="route-ready">Ready to goal</span>
        ) : (
          <span className="route-items">
            {formatMissingItems(route.missingItems)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watch form — add a new watch on a slot
// ---------------------------------------------------------------------------
function ConditionBuilder({
  label,
  conditions,
  onChange,
  allItems,
}: {
  label: string;
  conditions: WatchCondition[];
  onChange: (c: WatchCondition[]) => void;
  allItems: string[];
}) {
  const [newCond, setNewCond] = useState<WatchCondition>({
    type: "item",
    item: "",
  });

  const add = () => {
    if (newCond.type === "item" && !newCond.item.trim()) return;
    if (newCond.type === "strawberries" && !newCond.count) return;
    onChange([...conditions, newCond]);
    setNewCond({ type: "item", item: "" });
  };

  return (
    <div className="cond-builder">
      <div className="watch-form-row">
        <span className="watch-form-label">{label}</span>
        <select
          className="filter-input"
          style={{ flex: "0 0 auto", width: "auto" }}
          value={newCond.type}
          onChange={(e) =>
            setNewCond(
              e.target.value === "item"
                ? { type: "item", item: "" }
                : { type: "strawberries", count: 1 },
            )
          }
        >
          <option value="item">Has item</option>
          <option value="strawberries">Strawberries ≥</option>
        </select>
        {newCond.type === "item" ? (
          <div style={{ flex: 1 }}>
            <Combobox
              options={allItems}
              value={newCond.item}
              onChange={(item) => setNewCond({ type: "item", item })}
              placeholder="Search items…"
            />
          </div>
        ) : (
          <input
            type="number"
            className="filter-input"
            style={{ flex: 1 }}
            min={1}
            value={newCond.count}
            onChange={(e) =>
              setNewCond({
                type: "strawberries",
                count: Number(e.target.value),
              })
            }
          />
        )}
        <button className="watch-cond-add" onClick={add}>
          +
        </button>
      </div>
      {conditions.length > 0 && (
        <div className="watch-cond-list">
          {conditions.map((c, i) => (
            <span key={i} className="watch-cond-chip">
              {c.type === "item" ? c.item : `🍓 ≥ ${c.count}`}
              <button
                onClick={() => onChange(conditions.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AddWatchForm({
  forSlot,
  allSlots,
  allItems,
  onAdded,
}: {
  forSlot: string;
  allSlots: string[];
  allItems: string[];
  onAdded: (w: ActiveWatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [watchSlot, setWatchSlot] = useState("");
  const [conditions, setConditions] = useState<WatchCondition[]>([]);
  const [orConditions, setOrConditions] = useState<WatchCondition[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!watchSlot || (conditions.length === 0 && orConditions.length === 0))
      return;
    setSaving(true);
    const res = await fetch("/api/watches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchSlot, forSlot, conditions, orConditions }),
    });
    const { watch } = await res.json();
    onAdded({
      ...watch,
      andMet: [],
      andUnmet: watch.conditions,
      orMet: [],
      orUnmet: watch.orConditions,
      allMet: false,
    });
    setOpen(false);
    setWatchSlot("");
    setConditions([]);
    setOrConditions([]);
    setSaving(false);
  };

  if (!open)
    return (
      <button className="watch-add-btn" onClick={() => setOpen(true)}>
        + Add watch
      </button>
    );

  return (
    <div className="watch-form">
      <div className="watch-form-row">
        <span className="watch-form-label">Watch slot</span>
        <div style={{ flex: 1 }}>
          <Combobox
            options={allSlots.filter((s) => s !== forSlot)}
            value={watchSlot}
            onChange={setWatchSlot}
            placeholder="Celeste…"
          />
        </div>
      </div>

      <ConditionBuilder
        label="all of"
        conditions={conditions}
        onChange={setConditions}
        allItems={allItems}
      />
      <ConditionBuilder
        label="any of"
        conditions={orConditions}
        onChange={setOrConditions}
        allItems={allItems}
      />

      <div className="watch-form-actions">
        <button className="watch-cancel-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="apply-btn"
          style={{ flex: 1 }}
          disabled={
            !watchSlot ||
            (conditions.length === 0 && orConditions.length === 0) ||
            saving
          }
          onClick={submit}
        >
          {saving ? "Saving…" : "Save watch"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watch list — show active watches on a slot
// ---------------------------------------------------------------------------
function WatchList({
  watches,
  onDeleted,
  slotAliases,
}: {
  watches: ActiveWatch[];
  onDeleted: (id: string) => void;
  slotAliases: Map<string, string>;
}) {
  if (watches.length === 0) return null;

  const deleteWatch = async (id: string) => {
    await fetch("/api/watches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    onDeleted(id);
  };

  const condLabel = (c: WatchCondition, strawberriesHave: number) =>
    c.type === "item" ? c.item : `🍓: ${strawberriesHave}/${c.count}`;

  return (
    <div className="watch-list">
      {watches.map((w) => (
        <div key={w.id} className={`watch-item ${w.allMet ? "all-met" : ""}`}>
          <div className="watch-header-row">
            <span className="watch-for-label">watching</span>
            <span className={`watch-slot-name ${w.allMet ? "met" : ""}`}>
              {slotAliases.get(w.watchSlot) ? (
                <>
                  {slotAliases.get(w.watchSlot)}{" "}
                  <span className="watch-slot-sub">{w.watchSlot}</span>
                </>
              ) : (
                w.watchSlot
              )}
            </span>
            <button className="watch-delete" onClick={() => deleteWatch(w.id)}>
              ×
            </button>
          </div>
          {w.conditions.length > 0 && (
            <div className="watch-condition-group">
              <span className="watch-group-label">all of</span>
              <div className="watch-conditions">
                {w.andUnmet.map((c, i) => (
                  <span key={i} className="watch-cond-chip unmet">
                    {condLabel(c, w.strawberriesHave)}
                  </span>
                ))}
                {w.andMet.map((c, i) => (
                  <span key={i} className="watch-cond-chip met">
                    {condLabel(c, w.strawberriesHave)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {w.orConditions.length > 0 && (
            <div className="watch-condition-group">
              <span className="watch-group-label">any of</span>
              <div className="watch-conditions">
                {w.orUnmet.map((c, i) => (
                  <span key={i} className="watch-cond-chip unmet">
                    {condLabel(c, w.strawberriesHave)}
                  </span>
                ))}
                {w.orMet.map((c, i) => (
                  <span key={i} className="watch-cond-chip met">
                    {condLabel(c, w.strawberriesHave)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chain modal — hint dependency chain traversal
// ---------------------------------------------------------------------------

const MAX_DEPTH = 5;

const formatSlot = (slot: string, alias: string | null) =>
  alias ? `${alias} (${slot})` : slot;

function ChainNodeRow({
  item,
  finder,
  ancestors,
  itemFinders,
  hintsBySlot,
  depth,
}: {
  item: string;
  finder: ItemFinder;
  ancestors: Set<string>;
  itemFinders: Record<string, ItemFinder[]>;
  hintsBySlot: Record<string, SlotHint[]>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCycle = ancestors.has(finder.findingSlot);
  // Children are the hints the finding slot has received themselves
  const childHints = isCycle ? [] : (hintsBySlot[finder.findingSlot] ?? []);
  const canExpand = !isCycle && depth < MAX_DEPTH && childHints.length > 0;
  const nextAncestors = isCycle
    ? ancestors
    : new Set(ancestors).add(finder.findingSlot);

  return (
    <div className="chain-node" style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      <div
        className={`chain-row ${canExpand ? "chain-row-expandable" : ""}`}
        onClick={() => canExpand && setExpanded((e) => !e)}
      >
        <span className="chain-item">{item}</span>
        <span className="chain-arrow">→</span>
        <span className="chain-location">{finder.location}</span>
        <span className="chain-in">in</span>
        <span className="chain-finder">
          {formatSlot(finder.findingSlot, finder.findingAlias)}
        </span>
        {canExpand && (
          <span className="chain-expand-badge">
            {expanded ? "▾ collapse" : "▸ show chain"}
          </span>
        )}
      </div>
      {expanded &&
        childHints.map((childHint, i) =>
          (itemFinders[childHint.item] ?? [])
            .filter((f) => f.receivingSlot === finder.findingSlot)
            .map((childFinder, j) => (
              <ChainNodeRow
                key={`${i}-${j}`}
                item={childHint.item}
                finder={childFinder}
                ancestors={nextAncestors}
                itemFinders={itemFinders}
                hintsBySlot={hintsBySlot}
                depth={depth + 1}
              />
            )),
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory modal
// ---------------------------------------------------------------------------
const INV_TABS = ["Items", "Keys / Gems", "Checkpoints"] as const;
type InvTab = (typeof INV_TABS)[number];

function InventoryModal({
  slot,
  onClose,
}: {
  slot: SlotResult;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<InvTab>("Items");
  const inv = slot.inventory;
  const lists: Record<InvTab, string[]> = {
    Items: inv?.items ?? [],
    "Keys / Gems": inv?.keysAndGems ?? [],
    Checkpoints: inv?.checkpoints ?? [],
  };
  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div className="modal-box" role="dialog" aria-modal="true">
        <div className="modal-header">
          <span className="modal-title">
            {slot.alias ? (
              <>
                {slot.alias}{" "}
                <span className="modal-slot-sub">{slot.slotName}</span>
              </>
            ) : (
              slot.slotName
            )}
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-tabs">
          {INV_TABS.map((t) => (
            <button
              key={t}
              className={`modal-tab ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
              <span className="modal-tab-count">{lists[t].length}</span>
            </button>
          ))}
        </div>
        <div className="modal-body">
          {lists[tab].length === 0 ? (
            <p className="modal-empty">Nothing here yet.</p>
          ) : (
            <ul className="modal-item-list">
              {lists[tab].map((item, i) => (
                <li key={i} className="modal-item">
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot hints
// ---------------------------------------------------------------------------
function SlotHints({
  hints,
  itemFinders,
  hintsBySlot,
}: {
  hints: SlotHint[];
  itemFinders: Record<string, ItemFinder[]>;
  hintsBySlot: Record<string, SlotHint[]>;
}) {
  if (hints.length === 0) return null;

  // Deduplicate hints by item+location+findingSlot — strawberries can appear
  // multiple times in missingItems but represent the same hint
  const seen = new Set<string>();
  const uniqueHints = hints.filter((h) => {
    const key = `${h.item}|${h.location}|${h.findingSlot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="slot-hints">
      <div className="slot-hints-label">hints</div>
      {uniqueHints.map((h, i) => {
        const finders = (itemFinders[h.item] ?? []).filter(
          (f) =>
            f.receivingSlot === h.receivingSlot && f.location === h.location,
        );
        return finders.map((finder, j) => (
          <ChainNodeRow
            key={`${i}-${j}`}
            item={h.item}
            finder={finder}
            ancestors={new Set([h.receivingSlot])}
            itemFinders={itemFinders}
            hintsBySlot={hintsBySlot}
            depth={0}
          />
        ));
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot note
// ---------------------------------------------------------------------------
function SlotNote({
  slotName,
  initial,
}: {
  slotName: string;
  initial: string;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);

  const rows = Math.max(2, initial.split("\n").length);

  const save = async (value: string) => {
    setSaving(true);
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotName, note: value }),
    });
    setSaving(false);
  };

  return (
    <div className="note-wrap">
      <textarea
        className={`note-input ${saving ? "saving" : ""}`}
        value={text}
        placeholder="Add a note…"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        rows={rows}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot card
// ---------------------------------------------------------------------------
function SlotCard({
  slot,
  note,
  watches,
  allSlots,
  allItems,
  slotAliases,
  itemFinders,
  hintsBySlot,
  onViewInventory,
  onWatchAdded,
  onWatchDeleted,
}: {
  slot: SlotResult; // slot.hints carries the hint data
  note: string;
  watches: ActiveWatch[];
  allSlots: string[];
  allItems: string[];
  slotAliases: Map<string, string>;
  itemFinders: Record<string, ItemFinder[]>;
  hintsBySlot: Record<string, SlotHint[]>;
  onViewInventory: (slot: SlotResult) => void;
  onWatchAdded: (w: ActiveWatch) => void;
  onWatchDeleted: (id: string) => void;
}) {
  const sortedRoutes = [...slot.routes].sort(
    (a, b) => a.missingItems.length - b.missingItems.length,
  );

  return (
    <div className="slot-card">
      <div className="slot-header">
        <span className="goal-badge">{slot.goalDisplay}</span>
        <span className="slot-name">
          {slot.alias ? (
            <>
              <span className="alias">{slot.alias}</span>
              <span className="slot-sub">{slot.slotName}</span>
            </>
          ) : (
            slot.slotName
          )}
          <span className="loc-count">
            ({slot.checkedLocations}/{slot.totalLocations})
          </span>
          <span className="hints-available" title="hint points available">
            {slot.hintsAvailable}✦
          </span>
        </span>
        <span className="best-count">
          {slot.bestCount === 0 ? "✓" : `${slot.bestCount} min`}
        </span>
      </div>
      <div className="slot-inv-btn-row">
        <button className="slot-inv-btn" onClick={() => onViewInventory(slot)}>
          View Inventory
        </button>
      </div>
      <div className="route-list">
        {sortedRoutes.map((r, i) => (
          <RoutePill key={i} route={r} />
        ))}
      </div>
      <SlotHints
        hints={slot.hints}
        itemFinders={itemFinders}
        hintsBySlot={hintsBySlot}
      />
      <WatchList
        watches={watches}
        onDeleted={onWatchDeleted}
        slotAliases={slotAliases}
      />
      <AddWatchForm
        forSlot={slot.slotName}
        allSlots={allSlots}
        allItems={allItems}
        onAdded={onWatchAdded}
      />
      <SlotNote slotName={slot.slotName} initial={note} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function Page() {
  const [mode, setMode] = useState<FilterMode>("threshold");
  const [thresholdInput, setThresholdInput] = useState("3");
  const [alias, setAlias] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [goalFilter, setGoalFilter] = useState("");

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [watches, setWatches] = useState<ActiveWatch[]>([]);
  const [inventorySlot, setInventorySlot] = useState<SlotResult | null>(null);
  const [omitSupersets, setOmitSupersets] = useState(true);

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (mode === "threshold") {
        params.set("filter", "threshold");
        const t = thresholdInput === "" ? 0 : parseInt(thresholdInput, 10);
        params.set("threshold", String(isNaN(t) ? 0 : t));
      } else if (mode === "alias") {
        params.set("filter", "alias");
        params.set("alias", alias);
      } else if (mode === "slots") {
        params.set("filter", "slots");
        for (const s of slots) params.append("slot", s);
      } else {
        params.set("filter", "goal");
        params.set("goal", goalFilter);
      }
      const res = await fetch(`/api/routes?${params}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setData(json);
      setNotes(json.notes ?? {});
      setWatches(json.activeWatches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [mode, thresholdInput, alias, slots, goalFilter]);

  // Initial load
  useEffect(() => {
    fetchRoutes();
  }, []);

  const grouped = data
    ? groupRoutes(
        data.routes,
        data.hintsBySlot ?? {},
        data.inventoryBySlot ?? {},
        omitSupersets,
      )
    : [];
  const slotAliases = new Map(Object.entries(data?.slotAliasMap ?? {}));

  return (
    <>
      <div className="app">
        <header className="header">
          <h1>Celeste Goaling</h1>
          <span className="header-sub">1000 async · route finder</span>
        </header>

        <div className="body">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="filter-section">
              <label>Filter mode</label>
              <div className="mode-tabs">
                {(["threshold", "alias", "slots", "goal"] as FilterMode[]).map(
                  (m) => (
                    <button
                      key={m}
                      className={`mode-tab ${mode === m ? "active" : ""}`}
                      onClick={() => setMode(m)}
                    >
                      {m}
                    </button>
                  ),
                )}
              </div>

              {mode === "threshold" && (
                <input
                  type="number"
                  className="filter-input"
                  min={0}
                  max={242}
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                />
              )}

              {mode === "alias" && (
                <Combobox
                  options={data?.allAliases ?? []}
                  value={alias}
                  onChange={setAlias}
                  placeholder="Search alias…"
                />
              )}

              {mode === "slots" && (
                <MultiCombobox
                  options={data?.allSlots ?? []}
                  value={slots}
                  onChange={setSlots}
                  placeholder="Search slots…"
                />
              )}

              {mode === "goal" && (
                <Combobox
                  options={[...GOAL_OPTIONS]}
                  value={goalFilter}
                  onChange={setGoalFilter}
                  placeholder="Select goal…"
                />
              )}
            </div>

            <div className="sidebar-actions">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={omitSupersets}
                  onChange={(e) => setOmitSupersets(e.target.checked)}
                />
                Hide supersets
              </label>
              <button
                className="apply-btn"
                onClick={fetchRoutes}
                disabled={loading}
              >
                {loading ? "Loading…" : "Apply"}
              </button>
              {data && !loading && (
                <div className="result-count">
                  <span>{grouped.length}</span> slot
                  {grouped.length !== 1 ? "s" : ""} ·{" "}
                  <span>{data.routes.length}</span> route
                  {data.routes.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </aside>

          {/* Results */}
          <main className="results">
            {loading && <p className="state-msg">Loading routes…</p>}
            {error && <p className="state-msg error">Error: {error}</p>}
            {!loading && !error && grouped.length === 0 && (
              <p className="state-msg">No slots match the current filter.</p>
            )}
            {!loading &&
              grouped.map((slot) => (
                <SlotCard
                  key={slot.slotName}
                  slot={slot}
                  note={notes[slot.slotName] ?? ""}
                  watches={watches.filter((w) => w.forSlot === slot.slotName)}
                  allSlots={data?.allSlots ?? []}
                  allItems={data?.allWatchItems ?? []}
                  slotAliases={slotAliases}
                  itemFinders={data?.itemFinders ?? {}}
                  hintsBySlot={data?.hintsBySlot ?? {}}
                  onViewInventory={setInventorySlot}
                  onWatchAdded={(w) => setWatches((ws) => [...ws, w])}
                  onWatchDeleted={(id) =>
                    setWatches((ws) => ws.filter((w) => w.id !== id))
                  }
                />
              ))}
          </main>
        </div>
      </div>
      {inventorySlot && (
        <InventoryModal
          slot={inventorySlot}
          onClose={() => setInventorySlot(null)}
        />
      )}
    </>
  );
}
