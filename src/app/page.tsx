"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  GoalRoute,
  FilterMode,
  SlotResult,
  ActiveWatch,
  WatchCondition,
  SlotHint,
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
}

// ---------------------------------------------------------------------------
// Group flat routes into per-slot results
// ---------------------------------------------------------------------------
function groupRoutes(
  routes: GoalRoute[],
  hintsBySlot: Record<string, SlotHint[]>,
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
        hints: [],
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

  // Attach hints to each slot
  for (const slot of map.values()) {
    slot.hints = hintsBySlot[slot.slotName] ?? [];
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
}: {
  watches: ActiveWatch[];
  onDeleted: (id: string) => void;
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

  const condLabel = (c: WatchCondition) =>
    c.type === "item" ? c.item : `🍓 ≥ ${c.count}`;

  return (
    <div className="watch-list">
      {watches.map((w) => (
        <div key={w.id} className={`watch-item ${w.allMet ? "all-met" : ""}`}>
          <div className="watch-header-row">
            <span className="watch-for-label">watching</span>
            <span className={`watch-slot-name ${w.allMet ? "met" : ""}`}>
              {w.watchSlot}
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
                    {condLabel(c)}
                  </span>
                ))}
                {w.andMet.map((c, i) => (
                  <span key={i} className="watch-cond-chip met">
                    {condLabel(c)}
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
                    {condLabel(c)}
                  </span>
                ))}
                {w.orMet.map((c, i) => (
                  <span key={i} className="watch-cond-chip met">
                    {condLabel(c)}
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
// Slot hints
// ---------------------------------------------------------------------------
function SlotHints({ hints }: { hints: SlotHint[] }) {
  if (hints.length === 0) return null;

  const formatSlot = (slot: string, alias: string | null) =>
    alias ? `${alias} (${slot})` : slot;

  return (
    <div className="slot-hints">
      <div className="slot-hints-label">hints</div>
      {hints.map((h, i) => (
        <div key={i} className="hint-row">
          <span className="hint-item">{h.item}</span>
          <span className="hint-arrow">→</span>
          <span className="hint-location">{h.location}</span>
          <span className="hint-in">in</span>
          <span className="hint-finder">
            {formatSlot(h.findingSlot, h.findingAlias)}
          </span>
        </div>
      ))}
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
  onWatchAdded,
  onWatchDeleted,
}: {
  slot: SlotResult; // slot.hints carries the hint data
  note: string;
  watches: ActiveWatch[];
  allSlots: string[];
  allItems: string[];
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
        </span>
        <span className="best-count">
          {slot.bestCount === 0 ? "✓" : `${slot.bestCount} min`}
        </span>
      </div>
      <div className="route-list">
        {sortedRoutes.map((r, i) => (
          <RoutePill key={i} route={r} />
        ))}
      </div>
      <SlotHints hints={slot.hints} />
      <WatchList watches={watches} onDeleted={onWatchDeleted} />
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

  const grouped = data ? groupRoutes(data.routes, data.hintsBySlot ?? {}) : [];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:        #0a0b0f;
          --surface:   #111318;
          --surface2:  #181b22;
          --border:    #252830;
          --pink:      #e8325a;
          --pink-dim:  #8c1f37;
          --teal:      #3de8c8;
          --gold:      #f5c842;
          --text:      #e4e6f0;
          --muted:     #6b7280;
          --count-0:   #3de8c8;
          --count-1:   #3de8c8;
          --count-2:   #a3e635;
          --count-3:   #f5c842;
          --count-4:   #fb923c;
          --count-5:   #e8325a;
          --radius:    8px;
          --mono:      'Space Mono', monospace;
          --sans:      'DM Sans', sans-serif;
        }

        html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--sans); }

        .app {
          min-height: 100vh;
          display: grid;
          grid-template-rows: auto 1fr;
        }

        /* Header */
        .header {
          border-bottom: 1px solid var(--border);
          padding: 20px 32px;
          display: flex;
          align-items: baseline;
          gap: 16px;
          background: var(--surface);
        }
        .header h1 {
          font-family: var(--mono);
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--pink);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .header-sub {
          font-size: 0.8rem;
          color: var(--muted);
          font-family: var(--mono);
        }

        /* Layout — sidebar on desktop, filter bar on top for mobile */
        .body {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .sidebar {
          border-bottom: 1px solid var(--border);
          padding: 16px 20px;
          background: var(--surface);
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 12px;
        }
        .filter-section {
          flex: 1;
          min-width: 180px;
        }
        .sidebar-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-self: flex-end;
        }

        @media (min-width: 640px) {
          .body {
            display: grid;
            grid-template-columns: 280px 1fr;
            grid-template-rows: 1fr;
            min-height: 0;
            flex-direction: unset;
          }
          .sidebar {
            border-bottom: none;
            border-right: 1px solid var(--border);
            padding: 24px 20px;
            flex-direction: column;
            flex-wrap: nowrap;
            align-items: stretch;
            gap: 24px;
            overflow-y: auto;
          }
          .filter-section {
            flex: unset;
            min-width: unset;
          }
          .results {
            overflow-y: auto;
          }
          .sidebar-actions {
            align-self: unset;
          }
        }

        .filter-section label {
          display: block;
          font-size: 0.7rem;
          font-family: var(--mono);
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 10px;
        }

        .mode-tabs {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 4px;
          margin-bottom: 14px;
        }
        .mode-tab {
          background: var(--surface2);
          border: 1px solid var(--border);
          color: var(--muted);
          font-family: var(--mono);
          font-size: 0.65rem;
          padding: 6px 4px;
          cursor: pointer;
          border-radius: var(--radius);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          transition: all 0.15s;
          text-align: center;
        }
        .mode-tab.active {
          background: var(--pink-dim);
          border-color: var(--pink);
          color: var(--text);
        }
        .mode-tab:hover:not(.active) {
          border-color: var(--muted);
          color: var(--text);
        }

        .filter-input {
          width: 100%;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 9px 12px;
          color: var(--text);
          font-family: var(--sans);
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s;
        }
        .filter-input:focus {
          border-color: var(--pink);
        }
        input[type=number].filter-input {
          font-family: var(--mono);
        }

        .dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0; right: 0;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          max-height: 260px;
          overflow-y: auto;
          z-index: 100;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        }
        .dropdown-item {
          padding: 8px 12px;
          font-size: 0.85rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.1s;
        }
        .dropdown-item:hover, .dropdown-item.active {
          background: var(--surface);
          color: var(--pink);
        }
        .dropdown-empty {
          padding: 10px 12px;
          color: var(--muted);
          font-size: 0.8rem;
        }
        .check {
          font-family: var(--mono);
          color: var(--teal);
          width: 1em;
          display: inline-block;
        }

        .apply-btn {
          width: 100%;
          background: var(--pink);
          border: none;
          border-radius: var(--radius);
          padding: 10px;
          color: #fff;
          font-family: var(--mono);
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .apply-btn:hover { opacity: 0.85; }
        .apply-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .result-count {
          font-family: var(--mono);
          font-size: 0.7rem;
          color: var(--muted);
          padding-top: 8px;
          border-top: 1px solid var(--border);
        }
        .result-count span { color: var(--teal); }

        /* Results */
        .results {
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .state-msg {
          color: var(--muted);
          font-family: var(--mono);
          font-size: 0.85rem;
          padding: 48px 0;
          text-align: center;
        }
        .state-msg.error { color: var(--pink); }

        /* Slot card */
        .slot-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          overflow: hidden;
          transition: border-color 0.15s;
        }
        .slot-card:hover {
          border-color: #353840;
        }

        .slot-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--surface2);
        }
        .goal-badge {
          font-family: var(--mono);
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          background: var(--pink-dim);
          color: var(--pink);
          border: 1px solid var(--pink-dim);
          border-radius: 4px;
          padding: 2px 7px;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }
        .slot-name {
          flex: 1;
          font-size: 0.9rem;
          font-weight: 500;
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .alias {
          color: var(--teal);
          font-weight: 600;
        }
        .slot-sub {
          color: var(--muted);
          font-family: var(--mono);
          font-size: 0.75rem;
        }
        .loc-count {
          color: var(--muted);
          font-family: var(--mono);
          font-size: 0.7rem;
        }
        .best-count {
          font-family: var(--mono);
          font-size: 0.7rem;
          color: var(--muted);
        }

        .route-list {
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .route-pill {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 6px 0;
        }
        .route-count {
          font-family: var(--mono);
          font-size: 0.8rem;
          font-weight: 700;
          min-width: 22px;
          height: 22px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .count-0 { background: color-mix(in srgb, var(--count-0) 20%, transparent); color: var(--count-0); }
        .count-1 { background: color-mix(in srgb, var(--count-1) 20%, transparent); color: var(--count-1); }
        .count-2 { background: color-mix(in srgb, var(--count-2) 20%, transparent); color: var(--count-2); }
        .count-3 { background: color-mix(in srgb, var(--count-3) 20%, transparent); color: var(--count-3); }
        .count-4 { background: color-mix(in srgb, var(--count-4) 20%, transparent); color: var(--count-4); }
        .count-5 { background: color-mix(in srgb, var(--count-5) 20%, transparent); color: var(--count-5); }

        .route-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .route-via {
          font-size: 0.7rem;
          color: var(--muted);
          font-family: var(--mono);
        }
        .route-ready {
          font-size: 0.8rem;
          color: var(--teal);
          font-weight: 600;
        }
        .route-items {
          font-size: 0.8rem;
          color: var(--text);
          line-height: 1.4;
          word-break: break-word;
        }

        /* Notes */
        .note-wrap {
          padding: 0 14px 10px;
        }
        .note-input {
          width: 100%;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 8px 10px;
          color: var(--text);
          font-family: var(--sans);
          font-size: 0.8rem;
          line-height: 1.5;
          resize: vertical;
          outline: none;
          transition: border-color 0.15s, opacity 0.15s;
        }
        .note-input::placeholder { color: var(--muted); }
        .note-input:focus { border-color: var(--gold); }
        .note-input.saving { opacity: 0.5; }

        /* Watches */
        .watch-add-btn {
          display: block;
          width: calc(100% - 28px);
          margin: 0 14px 10px;
          background: none;
          border: 1px dashed var(--border);
          border-radius: var(--radius);
          color: var(--muted);
          font-family: var(--mono);
          font-size: 0.7rem;
          padding: 6px;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
          text-align: center;
        }
        .watch-add-btn:hover { border-color: var(--pink); color: var(--pink); }

        .watch-form {
          margin: 0 14px 10px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .watch-form-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .watch-form-label {
          font-family: var(--mono);
          font-size: 0.65rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          white-space: nowrap;
          width: 60px;
          flex-shrink: 0;
        }
        .watch-cond-add {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          color: var(--teal);
          font-size: 1rem;
          width: 28px;
          height: 28px;
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .watch-cond-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .watch-cond-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 0.75rem;
          color: var(--text);
        }
        .watch-cond-chip.met {
          border-color: var(--teal);
          color: var(--teal);
          text-decoration: line-through;
          opacity: 0.6;
        }
        .watch-cond-chip.unmet { border-color: var(--gold); color: var(--gold); }
        .watch-cond-chip button {
          background: none;
          border: none;
          color: var(--muted);
          cursor: pointer;
          font-size: 0.9rem;
          line-height: 1;
          padding: 0;
        }
        .watch-cond-chip button:hover { color: var(--pink); }
        .cond-builder {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .watch-form-actions {
          display: flex;
          gap: 6px;
        }
        .watch-cancel-btn {
          background: none;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          color: var(--muted);
          font-family: var(--mono);
          font-size: 0.7rem;
          padding: 8px 12px;
          cursor: pointer;
        }
        .watch-cancel-btn:hover { border-color: var(--muted); color: var(--text); }

        .watch-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin: 0 14px 6px;
        }
        .watch-item {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-left: 3px solid var(--gold);
          border-radius: var(--radius);
          padding: 7px 10px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .watch-item.all-met {
          border-left-color: var(--teal);
        }
        .watch-condition-group {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .watch-group-label {
          font-family: var(--mono);
          font-size: 0.6rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .watch-header-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .watch-for-label {
          font-family: var(--mono);
          font-size: 0.65rem;
          color: var(--muted);
          text-transform: uppercase;
        }
        .watch-slot-name {
          font-family: var(--mono);
          font-size: 0.8rem;
          color: var(--gold);
          flex: 1;
        }
        .watch-slot-name.met {
          color: var(--teal);
        }
        .watch-delete {
          background: none;
          border: none;
          color: var(--muted);
          cursor: pointer;
          font-size: 1rem;
          padding: 0;
          line-height: 1;
        }
        .watch-delete:hover { color: var(--pink); }
        .watch-conditions {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        /* Hints */
        .slot-hints {
          margin: 0 14px 8px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .slot-hints-label {
          font-family: var(--mono);
          font-size: 0.6rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 2px;
        }
        .hint-row {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 4px;
          font-size: 0.78rem;
          line-height: 1.4;
        }
        .hint-item {
          color: var(--teal);
          font-weight: 500;
        }
        .hint-arrow {
          color: var(--muted);
          font-family: var(--mono);
          font-size: 0.7rem;
        }
        .hint-location {
          color: var(--text);
        }
        .hint-in {
          color: var(--muted);
          font-size: 0.7rem;
          font-family: var(--mono);
        }
        .hint-finder {
          color: var(--gold);
          font-family: var(--mono);
          font-size: 0.72rem;
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
      `}</style>

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
                  onWatchAdded={(w) => setWatches((ws) => [...ws, w])}
                  onWatchDeleted={(id) =>
                    setWatches((ws) => ws.filter((w) => w.id !== id))
                  }
                />
              ))}
          </main>
        </div>
      </div>
    </>
  );
}
