import { useMemo, useState } from "preact/hooks";

const WINDOWS: Record<string, number> = {
  "28 days": 28 * 24 * 60,
  "30 days": 30 * 24 * 60,
  "7 days":  7  * 24 * 60,
};

function fmt(mins: number): string {
  const totalSecs = Math.round(mins * 60);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function SloCalculator() {
  const [target, setTarget] = useState("99.95");
  const [win, setWin] = useState("28 days");
  const [copied, setCopied] = useState(false);

  const { budget, perWeek, perDay, rule } = useMemo(() => {
    const t = Math.min(Math.max(parseFloat(target) || 0, 0), 100);
    const fail = (1 - t / 100);
    const winMin = WINDOWS[win] ?? WINDOWS["28 days"];
    const budget = winMin * fail;
    const perWeek = (7 * 24 * 60) * fail;
    const perDay  = (24 * 60) * fail;
    const rule = `# copy as prometheus rule
- alert: ErrorBudgetBurn
  expr: (1 - sli) > (1 - ${(t/100).toFixed(4)}) * 14.4
  for: 1h`;
    return { budget, perWeek, perDay, rule };
  }, [target, win]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(rule); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <>
      <div class="card">
        <div class="form-grid">
          <label for="target">target</label>
          <input
            id="target"
            value={target}
            onInput={(e) => setTarget((e.target as HTMLInputElement).value)}
            inputMode="decimal"
          />
          <label for="window">window</label>
          <select id="window" value={win} onChange={(e) => setWin((e.target as HTMLSelectElement).value)}>
            {Object.keys(WINDOWS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div class="result">
          <span class="lbl">error budget</span>
          <span class="val accent">{fmt(budget)}</span>
          <span class="lbl">downtime / week</span>
          <span class="val">{fmt(perWeek)}</span>
          <span class="lbl">downtime / day</span>
          <span class="val">{fmt(perDay)}</span>
        </div>
      </div>

      <div class="snippet">
        <div class="snippet-head">
          <span>{"// "}copy as prometheus rule</span>
          <button onClick={copy} class={copied ? "copied" : ""}>
            {copied ? "✓ copied" : "$ copy"}
          </button>
        </div>
        <pre><code>{rule}</code></pre>
      </div>
    </>
  );
}
