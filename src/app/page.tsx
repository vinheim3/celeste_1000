"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { GoalRoute, FilterMode, SlotResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types for API response
// ---------------------------------------------------------------------------
interface ApiResponse {
  routes: GoalRoute[];
  allAliases: string[];
  allSlots: string[];
  notes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Group flat routes into per-slot results
// ---------------------------------------------------------------------------
function groupRoutes(routes: GoalRoute[]): SlotResult[] {
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
      });
    }
    const slot = map.get(r.slotName)!;
    slot.routes.push(r);
    slot.bestCount = Math.min(slot.bestCount, r.missingItems.length);
  }
  return [...map.values()].sort((a, b) => a.bestCount - b.bestCount);
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

// ---------------------------------------------------------------------------
// Route pill
// ---------------------------------------------------------------------------
function RoutePill({ route }: { route: GoalRoute }) {
  const count = route.missingItems.length;
  const via: string[] = [];
  if (route.checkpointItem) via.push(route.checkpointItem);
  if (route.isDts) via.push("DTS");

  return (
    <div className="route-pill">
      <span className={`route-count count-${Math.min(count, 5)}`}>
        {count === 0 ? "✓" : count}
      </span>
      <div className="route-body">
        {via.length > 0 && (
          <span className="route-via">via {via.join(", ")}</span>
        )}
        {count === 0 ? (
          <span className="route-ready">Ready to goal</span>
        ) : (
          <span className="route-items">{route.missingItems.join(", ")}</span>
        )}
      </div>
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
        rows={2}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot card
// ---------------------------------------------------------------------------
function SlotCard({ slot, note }: { slot: SlotResult; note: string }) {
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
      <SlotNote slotName={slot.slotName} initial={note} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function Page() {
  const [mode, setMode] = useState<FilterMode>("threshold");
  const [threshold, setThreshold] = useState(4);
  const [alias, setAlias] = useState("");
  const [slots, setSlots] = useState<string[]>([]);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (mode === "threshold") {
        params.set("filter", "threshold");
        params.set("threshold", String(threshold));
      } else if (mode === "alias") {
        params.set("filter", "alias");
        params.set("alias", alias);
      } else {
        params.set("filter", "slots");
        for (const s of slots) params.append("slot", s);
      }
      const res = await fetch(`/api/routes?${params}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setData(json);
      setNotes(json.notes ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [mode, threshold, alias, slots]);

  // Initial load
  useEffect(() => {
    fetchRoutes();
  }, []);

  const grouped = data ? groupRoutes(data.routes) : [];

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

        /* Layout */
        .body {
          display: grid;
          grid-template-columns: 280px 1fr;
          min-height: 0;
        }

        /* Sidebar */
        .sidebar {
          border-right: 1px solid var(--border);
          padding: 24px 20px;
          background: var(--surface);
          display: flex;
          flex-direction: column;
          gap: 24px;
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
          grid-template-columns: repeat(3, 1fr);
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
          padding: 24px 28px;
          overflow-y: auto;
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
                {(["threshold", "alias", "slots"] as FilterMode[]).map((m) => (
                  <button
                    key={m}
                    className={`mode-tab ${mode === m ? "active" : ""}`}
                    onClick={() => setMode(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {mode === "threshold" && (
                <input
                  type="number"
                  className="filter-input"
                  min={1}
                  max={30}
                  value={threshold}
                  onChange={(e) =>
                    setThreshold(Math.max(1, Number(e.target.value)))
                  }
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
            </div>

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
                />
              ))}
          </main>
        </div>
      </div>
    </>
  );
}
