"use client";

import { useEffect, useMemo, useState } from "react";

type Run = { runId: string; lastTimestamp: string; events: number; status: string };
type Event = { runId: string; timestamp: string; elapsedMs?: number; stage: string; event: string; level: string; data?: Record<string, unknown> };

function fmtTime(value: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function dataValue(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return value === undefined || value === null ? "—" : typeof value === "string" ? value : JSON.stringify(value);
}

export default function AtlasRunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadRuns() {
    setLoading(true);
    const response = await fetch("/api/atlas-runs", { cache: "no-store" });
    const json = await response.json();
    setRuns(json.runs || []);
    setLoading(false);
  }

  async function loadRun(runId: string) {
    setSelected(runId);
    const response = await fetch(`/api/atlas-runs?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
    const json = await response.json();
    setEvents(json.events || []);
  }

  useEffect(() => { loadRuns(); }, []);

  const stageStats = useMemo(() => {
    const map = new Map<string, { total: number; errors: number; warnings: number }>();
    for (const event of events) {
      const row = map.get(event.stage) || { total: 0, errors: 0, warnings: 0 };
      row.total += 1;
      if (event.level === "error") row.errors += 1;
      if (event.level === "warn") row.warnings += 1;
      map.set(event.stage, row);
    }
    return [...map.entries()];
  }, [events]);

  const sfxEvents = events.filter((e) => e.stage === "SFX_DIRECTOR");
  const errors = events.filter((e) => e.level === "error");
  const warnings = events.filter((e) => e.level === "warn");

  return (
    <main style={{ minHeight: "100vh", background: "#09090b", color: "#f4f4f5", fontFamily: "Inter, system-ui, sans-serif", padding: 28 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 2, color: "#a1a1aa", fontWeight: 700 }}>ATLAS</div>
            <h1 style={{ margin: "4px 0", fontSize: 30 }}>Run Diagnostics Board</h1>
            <div style={{ color: "#a1a1aa", fontSize: 14 }}>Every run. Every stage. Every decision.</div>
          </div>
          <button onClick={loadRuns} style={{ border: "1px solid #3f3f46", background: "#18181b", color: "#fff", borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>Refresh</button>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 18 }}>
          <aside style={{ border: "1px solid #27272a", borderRadius: 14, background: "#111113", padding: 14, minHeight: 620 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Runs</div>
            {loading && <div style={{ color: "#71717a", padding: 10 }}>Loading…</div>}
            {!loading && !runs.length && <div style={{ color: "#71717a", padding: 10 }}>No recorded runs yet.</div>}
            {runs.map((run) => (
              <button key={run.runId} onClick={() => loadRun(run.runId)} style={{ width: "100%", textAlign: "left", marginBottom: 8, padding: 11, borderRadius: 10, border: selected === run.runId ? "1px solid #71717a" : "1px solid #27272a", background: selected === run.runId ? "#27272a" : "#18181b", color: "#fff", cursor: "pointer" }}>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>{run.runId}</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 11, color: run.status === "ERROR" ? "#fca5a5" : run.status === "COMPLETE" ? "#a7f3d0" : "#fde68a" }}>
                  <span>{run.status}</span><span>{run.events} events</span>
                </div>
                <div style={{ color: "#71717a", fontSize: 10, marginTop: 5 }}>{fmtTime(run.lastTimestamp)}</div>
              </button>
            ))}
          </aside>

          <section>
            {!selected && <div style={{ border: "1px dashed #3f3f46", borderRadius: 14, padding: 50, color: "#71717a", textAlign: "center" }}>Select an ATLAS run to inspect it.</div>}
            {selected && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
                  {[['Events', events.length], ['SFX events', sfxEvents.length], ['Warnings', warnings.length], ['Errors', errors.length]].map(([label, value]) => (
                    <div key={String(label)} style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 12, padding: 14 }}><div style={{ color: "#71717a", fontSize: 11 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div></div>
                  ))}
                </div>

                <div style={{ border: "1px solid #27272a", borderRadius: 14, background: "#111113", padding: 16, marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, marginBottom: 12 }}>Pipeline</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{stageStats.map(([stage, stats]) => <div key={stage} style={{ border: "1px solid #27272a", borderRadius: 9, padding: "9px 11px", background: "#18181b" }}><b>{stage}</b><span style={{ color: "#71717a", marginLeft: 8 }}>{stats.total}</span>{stats.errors > 0 && <span style={{ color: "#fca5a5", marginLeft: 8 }}>✕ {stats.errors}</span>}</div>)}</div>
                </div>

                {sfxEvents.length > 0 && <div style={{ border: "1px solid #27272a", borderRadius: 14, background: "#111113", padding: 16, marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, marginBottom: 12 }}>SFX Inspector</div>
                  <div style={{ display: "grid", gap: 8 }}>{sfxEvents.map((event, i) => <div key={i} style={{ border: "1px solid #27272a", borderRadius: 10, padding: 11, background: "#0f0f11" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><b>{event.event}</b><span style={{ color: "#71717a", fontSize: 11 }}>{fmtTime(event.timestamp)}</span></div><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#a1a1aa", fontSize: 11, margin: "8px 0 0" }}>{JSON.stringify(event.data || {}, null, 2)}</pre></div>)}</div>
                </div>}

                {(errors.length > 0 || warnings.length > 0) && <div style={{ border: "1px solid #27272a", borderRadius: 14, background: "#111113", padding: 16, marginBottom: 14 }}><div style={{ fontWeight: 700, marginBottom: 10 }}>Errors & Warnings</div>{[...errors, ...warnings].map((event, i) => <div key={i} style={{ borderLeft: `3px solid ${event.level === "error" ? "#ef4444" : "#eab308"}`, padding: "8px 10px", marginBottom: 7, background: "#18181b" }}><b>{event.level.toUpperCase()} · {event.stage} · {event.event}</b><pre style={{ whiteSpace: "pre-wrap", color: "#a1a1aa", fontSize: 11 }}>{JSON.stringify(event.data || {}, null, 2)}</pre></div>)}</div>}

                <div style={{ border: "1px solid #27272a", borderRadius: 14, background: "#111113", padding: 16 }}><div style={{ fontWeight: 700, marginBottom: 10 }}>Full Event Trace</div><div style={{ maxHeight: 520, overflow: "auto" }}>{events.map((event, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 140px 120px 1fr", gap: 8, padding: "8px 0", borderBottom: "1px solid #1f1f22", fontSize: 11 }}><span style={{ color: "#71717a" }}>{new Date(event.timestamp).toLocaleTimeString()}</span><b>{event.stage}</b><span style={{ color: event.level === "error" ? "#fca5a5" : event.level === "warn" ? "#fde68a" : "#a1a1aa" }}>{event.event}</span><code style={{ color: "#71717a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{JSON.stringify(event.data || {})}</code></div>)}</div></div>
              </>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
