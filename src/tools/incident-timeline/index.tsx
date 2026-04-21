import { useEffect, useRef, useState } from "preact/hooks";
import type { ToolMeta } from "../index";

export const meta: ToolMeta = {
  slug: "incident-timeline",
  title: "Incident timeline",
  blurb:
    "keyboard-driven incident log. capture observations, actions, decisions, and comms. state lives in the URL, export as markdown.",
  tags: ["incident", "sre", "timeline"],
};

type EntryType = "OBS" | "ACT" | "DEC" | "COMM";
type Severity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
type Entry = { ts: string; type: EntryType; text: string };
type State = {
  v: 1;
  title: string;
  severity: Severity;
  services: string;
  ic: string;
  started: string | null;
  entries: Entry[];
};

type EditTarget = { kind: "new" } | { kind: "edit"; index: number };
type Tone = "ok" | "warn" | "err";
type Toast = { text: string; tone: Tone };

const SEVERITIES: Severity[] = ["SEV1", "SEV2", "SEV3", "SEV4"];

const PLACEHOLDERS: Record<EntryType, string> = {
  OBS: "what you see or measure",
  ACT: "command executed, change made",
  DEC: "choice made, not yet executed (or a decision not to act)",
  COMM: "message sent to stakeholders",
};

const URL_WARN_BYTES = 1800;
const URL_LIMIT_BYTES = 2048;
const HASH_DEBOUNCE_MS = 300;
const TOAST_MS = 1800;

function emptyState(): State {
  return {
    v: 1,
    title: "",
    severity: "SEV2",
    services: "",
    ic: "",
    started: null,
    entries: [],
  };
}

// ---------- URL state: #t=<urlencode(title)>&d=<base64url(gzip(compact))> ----------
//
// Title is carried in plaintext for readability in the address bar.
// Everything else goes through a compact schema (numeric severity, delta
// seconds from `started`, numeric entry type) then gzip + base64url. Sizes
// measured ~45% smaller than the previous lz-string whole-state scheme.

const IDX_TO_TYPE: EntryType[] = ["OBS", "ACT", "DEC", "COMM"];
const TYPE_TO_IDX: Record<EntryType, number> = { OBS: 0, ACT: 1, DEC: 2, COMM: 3 };
const IDX_TO_SEV: Record<number, Severity> = { 1: "SEV1", 2: "SEV2", 3: "SEV3", 4: "SEV4" };
const SEV_TO_IDX: Record<Severity, number> = { SEV1: 1, SEV2: 2, SEV3: 3, SEV4: 4 };
const DEFAULT_SEVERITY: Severity = "SEV2";

type CompactEntry = [number, number, string];
type Compact = {
  v: 2;
  s?: number;
  sv?: string;
  ic?: string;
  st?: string;
  e?: CompactEntry[];
};

function stateToCompact(state: State): Compact {
  const out: Compact = { v: 2 };
  if (state.severity !== DEFAULT_SEVERITY) out.s = SEV_TO_IDX[state.severity];
  if (state.services) out.sv = state.services;
  if (state.ic) out.ic = state.ic;
  if (state.started) out.st = state.started;
  if (state.started && state.entries.length > 0) {
    const startedMs = Date.parse(state.started);
    out.e = state.entries.map((e) => [
      Math.round((Date.parse(e.ts) - startedMs) / 1000),
      TYPE_TO_IDX[e.type],
      e.text,
    ]);
  }
  return out;
}

function isCompactEntry(e: unknown): e is CompactEntry {
  return (
    Array.isArray(e) &&
    e.length === 3 &&
    typeof e[0] === "number" &&
    Number.isFinite(e[0]) &&
    typeof e[1] === "number" &&
    IDX_TO_TYPE[e[1]] !== undefined &&
    typeof e[2] === "string"
  );
}

function parseCompact(raw: unknown): Compact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 2) return null;
  if (r.s !== undefined && (typeof r.s !== "number" || !IDX_TO_SEV[r.s])) return null;
  if (r.sv !== undefined && typeof r.sv !== "string") return null;
  if (r.ic !== undefined && typeof r.ic !== "string") return null;
  if (r.st !== undefined) {
    if (typeof r.st !== "string" || Number.isNaN(Date.parse(r.st))) return null;
  }
  if (r.e !== undefined) {
    if (!Array.isArray(r.e) || !r.e.every(isCompactEntry)) return null;
  }
  return r as Compact;
}

function compactToState(c: Compact, title: string): State {
  const severity: Severity = c.s !== undefined ? IDX_TO_SEV[c.s] : DEFAULT_SEVERITY;
  const started = c.st ?? null;
  const entries: Entry[] =
    started && c.e
      ? c.e.map(([delta, ti, text]) => ({
          ts: new Date(Date.parse(started) + delta * 1000).toISOString(),
          type: IDX_TO_TYPE[ti],
          text,
        }))
      : [];
  return {
    v: 1,
    title,
    severity,
    services: c.sv ?? "",
    ic: c.ic ?? "",
    started,
    entries,
  };
}

function base64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const norm = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(norm);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function gzipToBase64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  return base64urlEncode(compressed);
}

async function gunzipFromBase64url(b64: string): Promise<string> {
  const bytes = base64urlDecode(b64);
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  void writer.write(bytes as unknown as Uint8Array<ArrayBuffer>);
  void writer.close();
  return await new Response(ds.readable).text();
}

function parseHashSegments(raw: string): { t: string; d: string } {
  let t = "";
  let d = "";
  for (const seg of raw.split("&")) {
    if (seg.startsWith("t=")) {
      try {
        t = decodeURIComponent(seg.slice(2));
      } catch {
        // leave t empty on bad encoding
      }
    } else if (seg.startsWith("d=")) {
      d = seg.slice(2);
    }
  }
  return { t, d };
}

function compactHasData(c: Compact): boolean {
  return (
    c.s !== undefined ||
    !!c.sv ||
    !!c.ic ||
    !!c.st ||
    (Array.isArray(c.e) && c.e.length > 0)
  );
}

async function encodeStateToHash(state: State): Promise<string> {
  const title = state.title.trim();
  const t = title ? encodeURIComponent(title) : "";
  const compact = stateToCompact(state);
  const d = compactHasData(compact) ? await gzipToBase64url(JSON.stringify(compact)) : "";
  const parts: string[] = [];
  if (t) parts.push(`t=${t}`);
  if (d) parts.push(`d=${d}`);
  return parts.join("&");
}

async function decodeStateFromHash(raw: string): Promise<State | null> {
  const { t, d } = parseHashSegments(raw);
  if (!t && !d) return null;
  let compact: Compact = { v: 2 };
  if (d) {
    try {
      const json = await gunzipFromBase64url(d);
      const parsed = parseCompact(JSON.parse(json));
      if (!parsed) return null;
      compact = parsed;
    } catch {
      return null;
    }
  }
  return compactToState(compact, t);
}

function utcHMS(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
function formatHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function escapeCell(s: string): string {
  return s.replace(/\r\n|\n/g, " ").replace(/\|/g, "\\|").trimEnd();
}

function buildExport(state: State, now: number): string {
  const permalink = typeof location !== "undefined" ? location.href : "";
  const started = state.started;
  const counts = { obs: 0, act: 0, dec: 0, comm: 0 };
  for (const e of state.entries) {
    if (e.type === "OBS") counts.obs++;
    else if (e.type === "ACT") counts.act++;
    else if (e.type === "DEC") counts.dec++;
    else counts.comm++;
  }

  const duration = started ? formatHMS(now - Date.parse(started)) : "00:00:00";

  const rows = state.entries.map((e) => {
    const tPlus = started ? formatHMS(Date.parse(e.ts) - Date.parse(started)) : "00:00:00";
    return [escapeCell(utcHMS(e.ts)), escapeCell(tPlus), escapeCell(e.type), escapeCell(e.text)];
  });
  const header = ["Time (UTC)", "T+", "Type", "Entry"].map(escapeCell);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const pad = (s: string, w: number) => s + " ".repeat(w - s.length);
  const renderRow = (r: string[]) => `| ${r.map((c, i) => pad(c, widths[i])).join(" | ")} |`;
  const separator = `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`;

  const titleLine = state.title.trim() || "untitled incident";
  const fm = [
    "---",
    `title: ${titleLine}`,
    `severity: ${state.severity}`,
    `services: ${state.services.trim()}`,
    `incident_commander: ${state.ic.trim()}`,
    `started: ${started ?? ""}`,
    `duration: ${duration}`,
    "entries:",
    `  total: ${state.entries.length}`,
    `  obs: ${counts.obs}`,
    `  act: ${counts.act}`,
    `  dec: ${counts.dec}`,
    `  comm: ${counts.comm}`,
    `permalink: ${permalink}`,
    "---",
    "",
    `# Incident timeline — ${titleLine}`,
    "",
    renderRow(header),
    separator,
    ...rows.map(renderRow),
    "",
  ];
  return fm.join("\n");
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function IncidentTimeline() {
  const [state, setState] = useState<State>(emptyState);
  const [viewing, setViewing] = useState(false);
  const [inputMode, setInputMode] = useState<EntryType>("OBS");
  const [inputText, setInputText] = useState("");
  const [editTarget, setEditTarget] = useState<EditTarget>({ kind: "new" });
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [mounted, setMounted] = useState(false);

  const [urlBytes, setUrlBytes] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stateRef = useRef<State>(state);
  const hashTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const writeSeqRef = useRef(0);
  const pendingWriteRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const showToast = (text: string, tone: Tone = "ok") => {
    if (toastTimerRef.current != null) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ text, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_MS);
  };

  const writeHashOf = (next: State): Promise<void> => {
    if (hashTimerRef.current != null) {
      clearTimeout(hashTimerRef.current);
      hashTimerRef.current = null;
    }
    const seq = ++writeSeqRef.current;
    const p = (async () => {
      const hash = await encodeStateToHash(next);
      if (seq !== writeSeqRef.current) return;
      const url = hash
        ? `${location.pathname}${location.search}#${hash}`
        : `${location.pathname}${location.search}`;
      history.replaceState(null, "", url);
      setUrlBytes(hash ? new TextEncoder().encode(hash).length : 0);
    })();
    pendingWriteRef.current = p;
    return p;
  };
  const writeHashNow = () => writeHashOf(stateRef.current);
  const writeHashDebounced = () => {
    if (hashTimerRef.current != null) {
      clearTimeout(hashTimerRef.current);
    }
    hashTimerRef.current = window.setTimeout(() => {
      hashTimerRef.current = null;
      void writeHashOf(stateRef.current);
    }, HASH_DEBOUNCE_MS);
  };

  const applyState = (next: State) => {
    stateRef.current = next;
    setState(next);
    void writeHashOf(next);
  };

  useEffect(() => {
    setMounted(true);
    const raw = location.hash.slice(1);
    if (!raw) return;
    let cancelled = false;
    (async () => {
      const parsed = await decodeStateFromHash(raw);
      if (cancelled) return;
      if (!parsed) {
        history.replaceState(null, "", `${location.pathname}${location.search}`);
        showToast("couldn't read incident from URL — starting fresh", "err");
        return;
      }
      setState(parsed);
      stateRef.current = parsed;
      setViewing(true);
      setUrlBytes(new TextEncoder().encode(raw).length);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.started || viewing) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state.started, viewing]);

  useEffect(() => {
    if (!mounted) return;
    inputRef.current?.focus();
  }, [mounted]);

  const commitEntry = (rawText: string, type: EntryType) => {
    const text = rawText.trim();
    if (!text) return;

    const prev = stateRef.current;
    let next: State;
    if (editTarget.kind === "edit") {
      const idx = editTarget.index;
      if (idx < 0 || idx >= prev.entries.length) return;
      const existing = prev.entries[idx];
      const entries = prev.entries.slice();
      entries[idx] = { ts: existing.ts, type: existing.type, text };
      next = { ...prev, entries };
    } else {
      const ts = new Date().toISOString();
      const nextStarted = prev.started ?? ts;
      const entries = prev.entries.concat({ ts, type, text });
      next = { ...prev, started: nextStarted, entries };
    }

    applyState(next);
    setEditTarget({ kind: "new" });
    setInputMode("OBS");
    setInputText("");
    setViewing(false);
  };

  const startEditLast = () => {
    const last = state.entries[state.entries.length - 1];
    if (!last) {
      showToast("no entries yet", "warn");
      return;
    }
    setEditTarget({ kind: "edit", index: state.entries.length - 1 });
    setInputMode(last.type);
    setInputText(last.text);
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditTarget({ kind: "new" });
    setInputMode("OBS");
    setInputText("");
  };

  const doExport = async () => {
    await writeHashNow();
    const markdown = buildExport(stateRef.current, Date.now());
    const ok = await copyToClipboard(markdown);
    showToast(ok ? "markdown copied to clipboard" : "clipboard blocked — copy manually", ok ? "ok" : "err");
  };

  const doCopyUrl = async () => {
    await writeHashNow();
    const ok = await copyToClipboard(location.href);
    showToast(ok ? "url copied to clipboard" : "clipboard blocked — copy manually", ok ? "ok" : "err");
  };

  const doReset = () => {
    if (hashTimerRef.current != null) {
      clearTimeout(hashTimerRef.current);
      hashTimerRef.current = null;
    }
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    const fresh = emptyState();
    setState(fresh);
    stateRef.current = fresh;
    setEditTarget({ kind: "new" });
    setInputMode("OBS");
    setInputText("");
    setViewing(false);
    inputRef.current?.focus();
    showToast("reset", "warn");
  };

  useEffect(() => {
    const isInputFocused = () => document.activeElement === inputRef.current;

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();

        if (k === "a" && isInputFocused()) {
          e.preventDefault();
          setInputMode("ACT");
          return;
        }
        if (k === "d" && isInputFocused()) {
          e.preventDefault();
          setInputMode("DEC");
          return;
        }
        if (k === "c" && isInputFocused()) {
          const pageSel = window.getSelection()?.toString() ?? "";
          const el = inputRef.current;
          const inputSelCollapsed =
            !el || el.selectionStart == null || el.selectionEnd == null
              ? true
              : el.selectionStart === el.selectionEnd;
          if (pageSel === "" && inputSelCollapsed) {
            e.preventDefault();
            setInputMode("COMM");
          }
          return;
        }
        if (k === "k") {
          e.preventDefault();
          startEditLast();
          return;
        }
        if (k === "e") {
          e.preventDefault();
          void doExport();
          return;
        }
      }

      if (e.key === "Escape") {
        if (editTarget.kind === "edit") {
          e.preventDefault();
          cancelEdit();
        } else if (inputMode !== "OBS") {
          e.preventDefault();
          setInputMode("OBS");
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editTarget, inputMode, state.entries.length]);

  const urlKb = (urlBytes / 1024).toFixed(1);
  const urlOverWarn = urlBytes >= URL_WARN_BYTES;
  const urlOverLimit = urlBytes >= URL_LIMIT_BYTES;

  const timerText = (() => {
    if (!state.started) return "00:00:00";
    const startedMs = Date.parse(state.started);
    if (viewing) {
      const last = state.entries[state.entries.length - 1];
      const endMs = last ? Date.parse(last.ts) : startedMs;
      return formatHMS(endMs - startedMs);
    }
    return formatHMS(now - startedMs);
  })();
  const startedText = state.started ? `${utcHMS(state.started)} UTC` : "pending — starts on first entry";

  const onInputKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      commitEntry(inputText, inputMode);
    }
  };

  const onMetaChange = (patch: Partial<State>) => {
    if (viewing) return;
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
    writeHashDebounced();
  };
  const onSeverityChange = (severity: Severity) => {
    if (viewing) return;
    applyState({ ...stateRef.current, severity });
  };

  return (
    <div class={`tl-root${viewing ? " viewing" : ""}`}>
      <div class="tl-header">
        <div class="tl-header-title">
          {"// incident timeline"}
          {viewing ? <span class="tl-viewing-badge">· viewing — add an entry to take over</span> : null}
        </div>
        <div class="tl-header-actions">
          <button class="btn" onClick={doExport}>export</button>
          <button class="btn" onClick={doCopyUrl}>copy url</button>
          <button class="btn" onClick={doReset}>reset</button>
        </div>
      </div>

      <div class="tl-meta">
        <div class="tl-meta-grid">
          <div class="tl-meta-row">
            <label class="tl-meta-label">title</label>
            {viewing ? (
              <span class={`tl-meta-value${state.title ? "" : " empty"}`}>{state.title || "—"}</span>
            ) : (
              <input
                class="tl-meta-input"
                type="text"
                value={state.title}
                placeholder="incident title"
                onInput={(e) => onMetaChange({ title: (e.currentTarget as HTMLInputElement).value })}
              />
            )}
          </div>
          <div class="tl-meta-row">
            <label class="tl-meta-label">severity</label>
            {viewing ? (
              <span class="tl-meta-value">{state.severity}</span>
            ) : (
              <select
                class="tl-meta-input tl-meta-select"
                value={state.severity}
                onChange={(e) => onSeverityChange((e.currentTarget as HTMLSelectElement).value as Severity)}
              >
                {SEVERITIES.map((s) => (
                  <option value={s}>{s}</option>
                ))}
              </select>
            )}
          </div>
          <div class="tl-meta-row">
            <label class="tl-meta-label">services</label>
            {viewing ? (
              <span class={`tl-meta-value${state.services ? "" : " empty"}`}>{state.services || "—"}</span>
            ) : (
              <input
                class="tl-meta-input"
                type="text"
                value={state.services}
                placeholder="comma-separated"
                onInput={(e) => onMetaChange({ services: (e.currentTarget as HTMLInputElement).value })}
              />
            )}
          </div>
          <div class="tl-meta-row">
            <label class="tl-meta-label">ic</label>
            {viewing ? (
              <span class={`tl-meta-value${state.ic ? "" : " empty"}`}>{state.ic || "—"}</span>
            ) : (
              <input
                class="tl-meta-input"
                type="text"
                value={state.ic}
                placeholder="incident commander"
                onInput={(e) => onMetaChange({ ic: (e.currentTarget as HTMLInputElement).value })}
              />
            )}
          </div>
        </div>

        <div class="tl-timer-row">
          <div class="tl-timer-started">
            <span class="tl-meta-label">started</span>
            <span class="tl-timer-started-value">{startedText}</span>
          </div>
          <div class="tl-timer">T+ {timerText}</div>
        </div>
      </div>

      {state.entries.length === 0 ? (
        <div class="tl-section-hint">
          {"// "}type an entry below and press enter. the timer starts on the first entry.
        </div>
      ) : null}

      <div class="tl-entries">
        {state.entries.map((e, i) => {
          const isEditing = editTarget.kind === "edit" && editTarget.index === i;
          return (
            <div class={`tl-entry${isEditing ? " editing" : ""}`}>
              <span class="tl-entry-ts">{utcHMS(e.ts)}</span>
              <span class={`tl-entry-type ${e.type.toLowerCase()}`}>{e.type}</span>
              <span class="tl-entry-text">{e.text}</span>
            </div>
          );
        })}

        <div class="tl-type-pills" role="group" aria-label="entry type">
          {(["OBS", "ACT", "DEC", "COMM"] as const).map((t) => (
            <button
              type="button"
              class={`tl-pill ${t.toLowerCase()}${inputMode === t ? " active" : ""}`}
              onClick={() => {
                setInputMode(t);
                inputRef.current?.focus();
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div class="tl-input-row">
          <span class="tl-prompt">&gt;</span>
          <span class={`tl-input-mode ${inputMode.toLowerCase()}`}>{inputMode}</span>
          <input
            ref={inputRef}
            class="tl-input"
            type="text"
            value={inputText}
            placeholder={PLACEHOLDERS[inputMode]}
            onInput={(e) => setInputText((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onInputKeyDown}
            spellcheck={false}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
          />
          {editTarget.kind === "edit" ? (
            <span class="tl-edit-hint">editing last · esc cancel</span>
          ) : null}
        </div>
      </div>

      <div class="tl-footer">
        <div class="tl-kbd-hints">
          ctrl+a act · ctrl+d dec · ctrl+c comm · ctrl+k edit last · ctrl+e export · esc cancel
        </div>
        <div class={`tl-url-size${urlOverWarn ? " warn" : ""}${urlOverLimit ? " limit" : ""}`}>
          url: {urlKb}KB / 2KB
        </div>
      </div>

      {toast ? <div class={`tl-toast ${toast.tone}`}>{toast.text}</div> : null}
    </div>
  );
}
