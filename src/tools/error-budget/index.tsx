import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ToolMeta } from "../index";

export const meta: ToolMeta = {
  slug: "error-budget",
  title: "Error budget tracker",
  blurb:
    "Plug in your SLO and past incidents. See budget consumed, how it recovers as incidents age out, and how much further outage you can still absorb.",
  tags: ["slo", "sre", "error-budget"],
};

type Incident = {
  id: string;
  start: string;
  durationMin: number;
  impact: number;
  note?: string;
};

type State = {
  target: number;
  windowDays: 7 | 28 | 30;
  incidents: Incident[];
};

const DEFAULT_TARGET = 99.9;
const DEFAULT_WINDOW = 28 as const;
const STORAGE_STATE = "eb:state";
const STORAGE_SEEN = "eb:seen";

const MS_DAY = 86_400_000;
const MS_MIN = 60_000;

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function parseFloatLoose(raw: string): number {
  return parseFloat(raw.replace(",", "."));
}

function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+(?:[.,]\d+)?)\s*m?)?\s*$/);
  if (!m) return null;
  const h = m[1] ? parseFloatLoose(m[1]) : 0;
  const mm = m[2] ? parseFloatLoose(m[2]) : 0;
  const total = h * 60 + mm;
  if (!isFinite(total) || total <= 0) return null;
  return total;
}

function fmtDuration(mins: number): string {
  const total = Math.round(mins);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtShortDuration(mins: number): string {
  if (mins < 1) {
    const s = Math.round(mins * 60);
    return `${s}s`;
  }
  return fmtDuration(mins);
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDate(d)} ${hh}:${mm}`;
}

function nowFloor(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
}

function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ParsedIncident = { startMs: number; endMs: number; impactRatio: number } | null;

function parseIncidents(incidents: Incident[]): ParsedIncident[] {
  return incidents.map((i) => {
    const startMs = Date.parse(i.start);
    if (!isFinite(startMs)) return null;
    return {
      startMs,
      endMs: startMs + i.durationMin * MS_MIN,
      impactRatio: i.impact / 100,
    };
  });
}

function clipParsed(p: NonNullable<ParsedIncident>, anchorMs: number, windowDays: number): number {
  const winStart = anchorMs - windowDays * MS_DAY;
  const s = Math.max(p.startMs, winStart);
  const e = Math.min(p.endMs, anchorMs);
  return Math.max(0, (e - s) / MS_MIN);
}

function consumedAt(parsed: ParsedIncident[], anchorMs: number, windowDays: number): number {
  let acc = 0;
  for (const p of parsed) {
    if (p) acc += clipParsed(p, anchorMs, windowDays) * p.impactRatio;
  }
  return acc;
}

function budgetTotal(state: State): number {
  return state.windowDays * 24 * 60 * (1 - state.target / 100);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function axisTransform(leftPct: number): string {
  if (leftPct <= 0) return "none";
  if (leftPct >= 100) return "translateX(-100%)";
  return "translateX(-50%)";
}

const EPOCH_MIN = Math.floor(Date.UTC(2020, 0, 1) / 60_000);

function startToB36(iso: string): string {
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return "0";
  const m = Math.max(0, Math.floor(ms / 60_000) - EPOCH_MIN);
  return m.toString(36);
}

function b36ToStart(code: string): string {
  const m = parseInt(code, 36);
  if (!isFinite(m) || m < 0) return "";
  return isoLocal(new Date((m + EPOCH_MIN) * 60_000));
}

function encNote(n: string): string {
  return encodeURIComponent(n).replace(/%20/g, "+");
}
function decNote(n: string): string {
  return decodeURIComponent(n.replace(/\+/g, " "));
}

function encodeState(s: State): string {
  const incs = s.incidents
    .map((i) =>
      [
        startToB36(i.start),
        i.durationMin.toString(36),
        String(i.impact),
        encNote(i.note || ""),
      ].join(":"),
    )
    .join(",");
  return `a;${s.target};${s.windowDays};${incs}`;
}

function decodeState(hashBody: string): State | null {
  try {
    if (!hashBody.startsWith("a;")) return null;
    const parts = hashBody.slice(2).split(";");
    if (parts.length < 3) return null;
    const target = parseFloat(parts[0]);
    const windowDays = parseInt(parts[1], 10);
    if (!isFinite(target)) return null;
    if (windowDays !== 7 && windowDays !== 28 && windowDays !== 30) return null;
    const iStr = parts.slice(2).join(";");
    const incidents: Incident[] = iStr
      ? iStr
          .split(",")
          .filter(Boolean)
          .map((raw): Incident | null => {
            const fields = raw.split(":");
            if (fields.length < 3) return null;
            const start = b36ToStart(fields[0]);
            const durationMin = parseInt(fields[1] || "0", 36) || 0;
            const impact = clamp(parseInt(fields[2] || "0", 10) || 0, 0, 100);
            const note =
              fields.length > 3 ? decNote(fields.slice(3).join(":")) : undefined;
            if (!start || durationMin <= 0) return null;
            return { id: uid(), start, durationMin, impact, note: note || undefined };
          })
          .filter((x): x is Incident => x !== null)
      : [];
    return {
      target: clamp(target, 0, 100),
      windowDays: windowDays as 7 | 28 | 30,
      incidents,
    };
  } catch {
    return null;
  }
}

function buildDemo(): State {
  const base = nowFloor();
  const at = (daysAgo: number, hours: number, minutes: number) => {
    const d = new Date(base.getTime() - daysAgo * MS_DAY);
    d.setHours(hours, minutes, 0, 0);
    return isoLocal(d);
  };
  return {
    target: DEFAULT_TARGET,
    windowDays: DEFAULT_WINDOW,
    incidents: [
      { id: uid(), start: at(18, 14, 3), durationMin: 12, impact: 100, note: "db failover loop" },
      { id: uid(), start: at(10, 8, 22), durationMin: 47, impact: 25, note: "eu-west-1 degraded" },
      { id: uid(), start: at(2, 22, 10), durationMin: 4, impact: 100, note: "bad deploy rolled back" },
    ],
  };
}

function emptyState(): State {
  return { target: DEFAULT_TARGET, windowDays: DEFAULT_WINDOW, incidents: [] };
}

type Draft = {
  editingId: string | null;
  start: string;
  durationRaw: string;
  impactRaw: string;
  note: string;
  err: string | null;
};

function emptyDraft(): Draft {
  return {
    editingId: null,
    start: isoLocal(nowFloor()),
    durationRaw: "",
    impactRaw: "100",
    note: "",
    err: null,
  };
}

function useCopy(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return [copied, copy];
}

export default function ErrorBudget() {
  const [state, setState] = useState<State>(() => emptyState());
  const [mounted, setMounted] = useState<boolean>(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [targetRaw, setTargetRaw] = useState<string>(() => String(DEFAULT_TARGET));
  const [shareCopied, copyShareText] = useCopy();
  const [summaryCopied, copySummaryText] = useCopy();

  useEffect(() => {
    const hash = typeof location !== "undefined" ? location.hash : "";
    if (hash.length > 1) {
      const decoded = decodeState(hash.slice(1));
      if (decoded) {
        setState(decoded);
        setMounted(true);
        return;
      }
    }
    try {
      const raw = localStorage.getItem(STORAGE_STATE);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        if (parsed && Array.isArray(parsed.incidents)) {
          setState(parsed);
          setMounted(true);
          return;
        }
      }
    } catch {}
    setState(buildDemo());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (parseFloatLoose(targetRaw) !== state.target) {
      setTargetRaw(String(state.target));
    }
  }, [state.target]);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
    } catch {}
    const encoded = encodeState(state);
    const url = `${location.pathname}${location.search}#${encoded}`;
    history.replaceState(null, "", url);
  }, [state, mounted]);

  const mark = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_SEEN, "1");
    } catch {}
  }, []);

  const patch = useCallback(
    (p: Partial<State>) => {
      setState((s) => ({ ...s, ...p }));
      mark();
    },
    [mark],
  );

  const nowMs = useMemo(() => nowFloor().getTime(), [mounted]);
  const parsedIncidents = useMemo(() => parseIncidents(state.incidents), [state.incidents]);
  const budget = useMemo(() => budgetTotal(state), [state]);
  const consumed = useMemo(
    () => consumedAt(parsedIncidents, nowMs, state.windowDays),
    [parsedIncidents, nowMs, state.windowDays],
  );
  const remaining = Math.max(0, budget - consumed);
  const pctConsumed = budget > 0 ? (consumed / budget) * 100 : 0;
  const pctRemaining = Math.max(0, 100 - pctConsumed);

  const perIncidentUsed = useMemo(
    () =>
      state.incidents.map((i, idx) => ({
        i,
        used: parsedIncidents[idx]
          ? clipParsed(parsedIncidents[idx], nowMs, state.windowDays) * parsedIncidents[idx].impactRatio
          : 0,
      })),
    [state.incidents, parsedIncidents, state.windowDays, nowMs],
  );

  const forecast = useMemo(() => {
    const stops: { label: string; offsetDays: number }[] = [
      { label: "now", offsetDays: 0 },
      { label: `+${Math.round(state.windowDays * 0.25)}d`, offsetDays: state.windowDays * 0.25 },
      { label: `+${Math.round(state.windowDays * 0.5)}d`, offsetDays: state.windowDays * 0.5 },
      { label: `+${state.windowDays}d`, offsetDays: state.windowDays },
    ];
    return stops.map((s) => {
      const anchor = nowMs + s.offsetDays * MS_DAY;
      const c = consumedAt(parsedIncidents, anchor, state.windowDays);
      const r = Math.max(0, budget - c);
      const pct = budget > 0 ? (r / budget) * 100 : 100;
      const over = Math.max(0, c - budget);
      return { label: s.label, remaining: r, pct, over };
    });
  }, [parsedIncidents, state.windowDays, nowMs, budget]);

  const healthyUntil = useMemo(() => {
    if (pctRemaining < 50) return null;
    for (let d = 0; d <= state.windowDays; d += 0.25) {
      const anchor = nowMs + d * MS_DAY;
      const r = Math.max(0, budget - consumedAt(parsedIncidents, anchor, state.windowDays));
      const pct = budget > 0 ? (r / budget) * 100 : 100;
      if (pct < 50) {
        return new Date(anchor);
      }
    }
    return null;
  }, [parsedIncidents, state.windowDays, nowMs, budget, pctRemaining]);

  const policy = pctRemaining >= 50
    ? { class: "healthy", label: "healthy" }
    : pctRemaining >= 25
      ? { class: "risk", label: "at risk" }
      : { class: "freeze", label: "freeze" };

  const startAdd = () => setDraft(emptyDraft());
  const startEdit = (i: Incident) => {
    if (draft?.editingId === i.id) {
      setDraft(null);
      return;
    }
    setDraft({
      editingId: i.id,
      start: i.start,
      durationRaw: fmtDuration(i.durationMin),
      impactRaw: String(i.impact),
      note: i.note || "",
      err: null,
    });
  };
  const cancelDraft = () => setDraft(null);
  const updateDraft = (p: Partial<Draft>) =>
    setDraft((d) => (d ? { ...d, err: null, ...p } : d));

  const saveDraft = () => {
    if (!draft) return;
    const dur = parseDuration(draft.durationRaw);
    if (dur == null) {
      setDraft({ ...draft, err: "invalid duration (try 90m, 1h, 1h30m, 1.5h)" });
      return;
    }
    const impact = clamp(parseFloatLoose(draft.impactRaw) || 0, 0, 100);
    if (impact <= 0) {
      setDraft({ ...draft, err: "impact must be > 0%" });
      return;
    }
    if (!draft.start || isNaN(Date.parse(draft.start))) {
      setDraft({ ...draft, err: "invalid start datetime" });
      return;
    }
    const next: Incident = {
      id: draft.editingId || uid(),
      start: draft.start,
      durationMin: Math.round(dur),
      impact,
      note: draft.note.trim() || undefined,
    };
    setState((s) => {
      const incidents = draft.editingId
        ? s.incidents.map((x) => (x.id === draft.editingId ? next : x))
        : [...s.incidents, next];
      incidents.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      return { ...s, incidents };
    });
    mark();
    setDraft(null);
  };

  const deleteDraft = () => {
    if (!draft || !draft.editingId) return;
    setState((s) => ({ ...s, incidents: s.incidents.filter((x) => x.id !== draft.editingId) }));
    mark();
    setDraft(null);
  };

  const resetDemo = () => {
    setState(buildDemo());
    try {
      localStorage.removeItem(STORAGE_SEEN);
    } catch {}
  };
  const clearAll = () => {
    setState((s) => ({ ...s, incidents: [] }));
    mark();
  };

  const shareUrl = useMemo(() => {
    if (!mounted) return "";
    return `${location.origin}${location.pathname}#${encodeState(state)}`;
  }, [state, mounted]);

  const copyShare = () => copyShareText(shareUrl);

  const truncateUrl = (u: string, max: number): string =>
    u.length <= max ? u : u.slice(0, max - 1) + "…";

  const summary = useMemo((): { display: string; copy: string } => {
    if (!mounted) return { display: "", copy: "" };
    const dateStr = fmtDate(new Date(nowMs));
    const remStr =
      consumed > budget
        ? `exhausted (−${fmtShortDuration(consumed - budget)} over)`
        : `${fmtShortDuration(remaining)} (${pctRemaining.toFixed(1)}%)`;
    const pad = (s: string) => s.padEnd(16);
    const shared = [
      `error budget snapshot · ${dateStr}`,
      "─".repeat(48),
      `${pad("slo target")}${state.target}%`,
      `${pad("window")}rolling ${state.windowDays} days`,
      `${pad("total budget")}${fmtShortDuration(budget)}`,
      `${pad("consumed")}${fmtShortDuration(consumed)} (${pctConsumed.toFixed(1)}%)`,
      `${pad("remaining")}${remStr}`,
      `${pad("status")}${policy.label}`,
      `${pad("incidents")}${state.incidents.length} tracked in this window`,
      "",
      "full interactive view at",
    ];
    return {
      display: [...shared, truncateUrl(shareUrl, 55)].join("\n"),
      copy: [...shared, shareUrl].join("\n"),
    };
  }, [
    mounted,
    nowMs,
    state,
    budget,
    consumed,
    remaining,
    pctRemaining,
    pctConsumed,
    policy.label,
    shareUrl,
  ]);

  const copySummary = () => copySummaryText(summary.copy);

  const axisStops = useMemo(() => {
    const w = state.windowDays;
    return [
      { label: `-${w}d`, leftPct: 0 },
      { label: "now", leftPct: 50 },
      { label: `+${Math.round(w * 0.25)}d`, leftPct: 62.5 },
      { label: `+${Math.round(w * 0.5)}d`, leftPct: 75 },
      { label: `+${w}d`, leftPct: 100 },
    ];
  }, [state.windowDays]);

  const sparkMarks = useMemo(() => {
    const windowMs = state.windowDays * MS_DAY;
    const startMs = nowMs - windowMs;
    const endMs = nowMs + windowMs;
    return state.incidents
      .map((inc, idx) => {
        const t = Date.parse(inc.start);
        if (!isFinite(t) || t < startMs || t > endMs) return null;
        const leftPct = ((t - startMs) / (endMs - startMs)) * 100;
        const tooltip = `${fmtDateTime(inc.start)} · ${fmtDuration(inc.durationMin)} · ${inc.impact}%${inc.note ? " · " + inc.note : ""}`;
        return { id: inc.id, leftPct, num: idx + 1, tooltip };
      })
      .filter(
        (x): x is { id: string; leftPct: number; num: number; tooltip: string } =>
          x !== null,
      );
  }, [state.incidents, state.windowDays, nowMs]);

  return (
    <>
      <div class="danger-zone">
        <div class="danger-zone-title">{"// "}danger zone</div>
        <div class="danger-zone-actions">
          <button class="btn" onClick={resetDemo}>reset to demo data</button>
          <button
            class="btn danger"
            onClick={() => {
              if (typeof window !== "undefined" && window.confirm("wipe all incidents?")) {
                clearAll();
              }
            }}
          >
            clear all
          </button>
        </div>
      </div>

      <div class="section-head">
        <span class="section-title">{"// "}config</span>
      </div>
      <div class="section-sub">
        your slo target and the rolling window you're tracking against.
      </div>
      <div class="card eb-config">
        <div class="eb-config-pair">
          <label for="eb-target">target</label>
          <div class="input-suffix narrow">
            <input
              id="eb-target"
              inputMode="decimal"
              value={targetRaw}
              onInput={(e) => {
                const raw = (e.target as HTMLInputElement).value;
                setTargetRaw(raw);
                const v = parseFloatLoose(raw);
                if (isFinite(v)) patch({ target: clamp(v, 0, 100) });
              }}
              onBlur={() => {
                if (parseFloatLoose(targetRaw) !== state.target) {
                  setTargetRaw(String(state.target));
                }
              }}
            />
            <span class="dim">%</span>
          </div>
        </div>
        <div class="eb-config-pair">
          <label for="eb-window">window</label>
          <select
            id="eb-window"
            value={state.windowDays}
            onChange={(e) => {
              const v = parseInt((e.target as HTMLSelectElement).value, 10);
              if (v === 7 || v === 28 || v === 30) patch({ windowDays: v });
            }}
          >
            <option value={7}>7 days</option>
            <option value={28}>28 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
        <div class="eb-config-derived">
          <span class="dim">→ budget</span>
          <span class="accent">{fmtShortDuration(budget)}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">{"// "}incidents</span>
          {!draft && (
            <button class="link-btn" onClick={startAdd}>
              [ + add ]
            </button>
          )}
        </div>
        <div class="section-sub">
          click a row to edit, click again to close. add as many as you've had.
        </div>

        {state.incidents.length === 0 && !draft && (
          <div class="empty-state">
            no incidents yet.{" "}
            <button class="link-btn inline" onClick={startAdd}>
              [ + add incident ]
            </button>
          </div>
        )}

        {state.incidents.length > 0 && (
          <div class="t-table">
            <div class="t-table-head eb-incidents-table">
              <span>#</span>
              <span>when</span>
              <span>duration</span>
              <span>impact</span>
              <span>used</span>
            </div>
            {perIncidentUsed.map(({ i, used }, idx) => (
              <button
                key={i.id}
                class={"t-table-row eb-incidents-table" + (draft?.editingId === i.id ? " editing" : "")}
                onClick={() => startEdit(i)}
              >
                <span class="dim">{idx + 1}</span>
                <span>
                  {fmtDateTime(i.start)}
                  {i.note ? <span class="eb-note">{" "}· {i.note}</span> : null}
                </span>
                <span>{fmtDuration(i.durationMin)}</span>
                <span>{i.impact}%</span>
                <span class="accent">{fmtShortDuration(used)}</span>
              </button>
            ))}
            <div class="t-table-foot eb-incidents-foot">
              <span class="dim">total consumed</span>
              <span class="accent">{fmtShortDuration(consumed)}</span>
            </div>
          </div>
        )}

        {draft && (
          <div class="form">
            <label for="eb-start">start</label>
            <input
              id="eb-start"
              type="datetime-local"
              value={draft.start}
              onInput={(e) => updateDraft({ start: (e.target as HTMLInputElement).value })}
            />
            <label for="eb-dur">duration</label>
            <div class="input-with-presets">
              <input
                id="eb-dur"
                value={draft.durationRaw}
                placeholder="90m · 1h · 1h30m · 1.5h"
                onInput={(e) => updateDraft({ durationRaw: (e.target as HTMLInputElement).value })}
              />
              <div class="preset-btns">
                {["15m", "1h", "4h"].map((p) => (
                  <button key={p} type="button" onClick={() => updateDraft({ durationRaw: p })}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <label for="eb-impact">impact</label>
            <div class="input-with-presets">
              <div class="input-suffix narrow">
                <input
                  id="eb-impact"
                  inputMode="decimal"
                  value={draft.impactRaw}
                  onInput={(e) => updateDraft({ impactRaw: (e.target as HTMLInputElement).value })}
                />
                <span class="dim">%</span>
              </div>
              <div class="preset-btns">
                {[10, 25, 50, 100].map((p) => (
                  <button key={p} type="button" onClick={() => updateDraft({ impactRaw: String(p) })}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <label for="eb-note">note</label>
            <input
              id="eb-note"
              value={draft.note}
              placeholder="optional"
              onInput={(e) => updateDraft({ note: (e.target as HTMLInputElement).value })}
            />

            {draft.err && <div class="form-err">{draft.err}</div>}

            <div class="form-actions">
              {draft.editingId && (
                <button class="btn danger" onClick={deleteDraft}>
                  delete
                </button>
              )}
              <span class="form-spacer"></span>
              <button class="btn" onClick={cancelDraft}>
                cancel
              </button>
              <button class="btn primary" onClick={saveDraft}>
                save
              </button>
            </div>
          </div>
        )}
      </div>

      <div class="section">
        <div class="section-title">{"// "}status · {fmtDate(new Date(nowMs))}</div>
        <div class="section-sub">
          today's math: budget you had, how much you've burned, what's left.
        </div>
        <div class="cell-grid cols-3">
          <div class="cell">
            <span class="cell-label">budget</span>
            <span class="cell-value">{fmtShortDuration(budget)}</span>
          </div>
          <div class="cell">
            <span class="cell-label">consumed</span>
            <span class="cell-value">
              {fmtShortDuration(consumed)}{" "}
              <span class="dim">({pctConsumed.toFixed(1)}%)</span>
            </span>
            <span class="bar">
              <span class="bar-fill" style={{ width: `${clamp(pctConsumed, 0, 100)}%` }}></span>
            </span>
          </div>
          <div class={"cell" + (consumed > budget ? " exhausted" : "")}>
            <span class="cell-label">remaining</span>
            {consumed > budget ? (
              <>
                <span class="cell-value accent">exhausted</span>
                <span class="cell-sub">−{fmtShortDuration(consumed - budget)} over</span>
              </>
            ) : (
              <span class="cell-value accent">
                {fmtShortDuration(remaining)}{" "}
                <span class="dim">({pctRemaining.toFixed(1)}%)</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">{"// "}budget over rolling window</span>
          <span class="section-legend">
            <span class="eb-axis-mark">#n</span> = incident, matches list above
          </span>
        </div>
        <div class="section-sub">
          y = % of error budget remaining · x = time. past incidents eat budget; it recovers as they age out.
        </div>
        <div class="eb-sparkline-wrap">
          <Sparkline
            parsedIncidents={parsedIncidents}
            windowDays={state.windowDays}
            budget={budget}
            nowMs={nowMs}
            marks={sparkMarks}
          />
          <div class="eb-spark-ylabels">
            <span style={{ top: "18px" }}>100%</span>
            <span style={{ top: "70px" }}>50%</span>
            <span style={{ top: "96px" }}>25%</span>
            <span style={{ top: "122px" }}>0%</span>
          </div>
        </div>
        <div class="eb-sparkline-axis">
          {axisStops.map((s) => (
            <span
              key={s.label}
              style={{ left: `${s.leftPct}%`, transform: axisTransform(s.leftPct) }}
            >
              {s.label}
            </span>
          ))}
          {sparkMarks.map((m) => (
            <span
              key={m.id}
              class="eb-axis-mark"
              title={m.tooltip}
              style={{ left: `${m.leftPct}%`, transform: axisTransform(m.leftPct) }}
            >
              #{m.num}
            </span>
          ))}
        </div>
      </div>

      <div class="section">
        <div class="section-title">{"// "}forecast (no new incidents)</div>
        <div class="section-sub">
          budget at future dates, assuming no new incidents happen.
        </div>
        <div class="cell-grid cols-4">
          {forecast.map((f) => (
            <div key={f.label} class={"cell eb-forecast-cell" + (f.over > 0 ? " exhausted" : "")}>
              <span class="cell-label">{f.label}</span>
              <span class="cell-value">
                {f.over > 0 ? "exhausted" : `${f.pct.toFixed(1)}%`}
              </span>
              <span class="bar">
                <span class="bar-fill" style={{ width: `${clamp(f.pct, 0, 100)}%` }}></span>
              </span>
              {f.over > 0 && (
                <span class="cell-sub">−{fmtShortDuration(f.over)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div class="section">
        <div class="section-title">{"// "}what can you still absorb</div>
        <div class="section-sub">
          how long an outage of a given severity you could take from here.
        </div>
        <div class="cell-grid cols-3">
          {[
            { label: "full outage", sub: "100% of traffic", factor: 1 },
            { label: "partial", sub: "50% of traffic", factor: 0.5 },
            { label: "degraded", sub: "10% of traffic", factor: 0.1 },
          ].map((row) => (
            <div key={row.label} class="cell eb-absorbable-cell">
              <span class="cell-label">{row.label}</span>
              <span class="cell-value">{fmtShortDuration(remaining / row.factor)}</span>
              <span class="cell-sub">{row.sub}</span>
            </div>
          ))}
        </div>
      </div>

      <div class="section">
        <div class="section-title">{"// "}policy</div>
        <div class="legend">
          <div>
            healthy <span class="dim">≥ 50%</span> · at risk <span class="dim">25–50%</span> · freeze <span class="dim">&lt; 25%</span>
          </div>
          <div class="dim">
            "freeze" = convention to pause risky releases while budget is low.
          </div>
        </div>
        <div class={`eb-policy ${policy.class}`}>
          <span class="eb-policy-dot" aria-hidden="true"></span>
          <span class="eb-policy-label">{policy.label}</span>
          <span class="eb-policy-sub">
            {policy.class === "healthy"
              ? healthyUntil
                ? `healthy until ${fmtDate(healthyUntil)}`
                : "(≥ 50% remaining)"
              : policy.class === "risk"
                ? "(< 50% remaining)"
                : "(< 25% remaining)"}
          </span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">{"// "}summary</div>
        <div class="section-sub">
          self-contained snapshot. paste anywhere — reads without the tool.
        </div>
        <div class="pre-block">
          <pre>{summary.display}</pre>
          <div class="pre-block-actions">
            <button
              class={"btn" + (summaryCopied ? " copied" : "")}
              onClick={copySummary}
            >
              {summaryCopied ? "✓ copied" : "copy summary"}
            </button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">{"// "}share</div>
        <div class="section-sub">
          permalink that restores this exact state. send it anywhere.
        </div>
        <div class="eb-share">
          <input readOnly value={shareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
          <button class={"btn" + (shareCopied ? " copied" : "")} onClick={copyShare}>
            {shareCopied ? "✓ copied" : "copy"}
          </button>
        </div>
      </div>
    </>
  );
}

type SparkMark = { id: string; leftPct: number; num: number; tooltip: string };

function Sparkline({
  parsedIncidents,
  windowDays,
  budget,
  nowMs,
  marks,
}: {
  parsedIncidents: ParsedIncident[];
  windowDays: number;
  budget: number;
  nowMs: number;
  marks: SparkMark[];
}) {
  const W = 1000;
  const H = 120;
  const PADY_TOP = 8;
  const PADY_BOT = 8;
  const chartBot = H - PADY_BOT;
  const windowMs = windowDays * MS_DAY;
  const startMs = nowMs - windowMs;
  const endMs = nowMs + windowMs;
  const totalMs = endMs - startMs;

  const samples = 240;
  const pts: { x: number; y: number; past: boolean }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = startMs + (totalMs * i) / samples;
    const c = consumedAt(parsedIncidents, t, windowDays);
    const r = Math.max(0, budget - c);
    const pct = budget > 0 ? (r / budget) * 100 : 100;
    const x = ((t - startMs) / totalMs) * W;
    const y = PADY_TOP + (1 - pct / 100) * (chartBot - PADY_TOP);
    pts.push({ x, y, past: t <= nowMs });
  }

  const pastPts = pts.filter((p) => p.past);
  const futPts = pts.filter((p) => !p.past);
  const toPath = (arr: { x: number; y: number }[]): string => {
    if (arr.length === 0) return "";
    return arr.reduce((acc, p, i) => acc + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`), "");
  };

  const nowX = ((nowMs - startMs) / totalMs) * W;

  const futureTicks = [0.25, 0.5].map((f) => {
    const t = nowMs + windowDays * f * MS_DAY;
    return { x: ((t - startMs) / totalMs) * W, label: `+${Math.round(windowDays * f)}d` };
  });

  const fillPath = (() => {
    if (pastPts.length === 0) return "";
    const first = pastPts[0];
    const last = pastPts[pastPts.length - 1];
    return `M ${first.x} ${chartBot} L ${pastPts.map((p) => `${p.x} ${p.y}`).join(" L ")} L ${last.x} ${chartBot} Z`;
  })();

  const chartHeight = chartBot - PADY_TOP;

  return (
    <div class="eb-sparkline">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="budget over rolling window">
        <rect x="0" y={PADY_TOP} width={W} height={chartHeight} class="eb-spark-frame" />
        <path d={fillPath} class="eb-spark-fill" />
        <path d={toPath(pastPts)} class="eb-spark-past" />
        <path d={toPath(futPts)} class="eb-spark-future" />
        <line x1={nowX} x2={nowX} y1={PADY_TOP} y2={chartBot} class="eb-spark-now" />
        <line x1="0" x2={W} y1={PADY_TOP + chartHeight * 0.5} y2={PADY_TOP + chartHeight * 0.5} class="eb-spark-grid" />
        <line x1="0" x2={W} y1={PADY_TOP + chartHeight * 0.75} y2={PADY_TOP + chartHeight * 0.75} class="eb-spark-grid" />
        {futureTicks.map((t) => (
          <line
            key={t.label}
            x1={t.x}
            x2={t.x}
            y1={PADY_TOP}
            y2={chartBot}
            class="eb-spark-tick"
          />
        ))}
        {marks.map((m) => {
          const x = (m.leftPct / 100) * W;
          return (
            <line
              key={m.id}
              x1={x}
              x2={x}
              y1={PADY_TOP}
              y2={chartBot}
              class="eb-spark-incident"
            >
              <title>{m.tooltip}</title>
            </line>
          );
        })}
      </svg>
    </div>
  );
}
