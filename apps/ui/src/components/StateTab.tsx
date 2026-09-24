import { useMemo, useState } from "preact/hooks";
import { useStore } from "../store";
import { ROLE_HELP, ROLE_STYLE, type FoldedField, type FoldedState } from "../state";
import { FormattedValue } from "./FormattedValue";
function formatValue(v: unknown): string {
    if (typeof v === "string")
        return v === "" ? "\"\"" : v;
    return JSON.stringify(v) ?? String(v);
}
function formatAge(ms: number): string {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
        return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}
const STATE_GROUP = null;
function FieldRow({ path, field }: {
    path: string;
    field: FoldedField;
}) {
    const [open, setOpen] = useState(false);
    const text = formatValue(field.value);
    const long = text.length > 60;
    return (<div class="border-b border-neutral-850/50 px-2 py-0.5 font-mono text-[11px] leading-tight">
      <div class="flex items-baseline gap-1.5">
        <span class={`shrink-0 ${ROLE_STYLE[field.role]}`} title={ROLE_HELP[field.role]}>
          {field.role === "level" ? "=" : field.role === "event" ? "!" : field.role === "sporadic" ? "?" : "\u00B7"}
        </span>
        <span class="shrink-0 text-neutral-400">{path}</span>
        <span class="flex min-w-0 flex-1 items-baseline" onDblClick={() => long && setOpen((v) => !v)} title={long ? "double-click to expand" : undefined}>
          <FormattedValue group={STATE_GROUP} path={path} value={field.value} raw={text} class="flex-1 text-neutral-200" showText={!open}/>
        </span>
        
        <span class="shrink-0 text-neutral-600" title={`observed ${new Date(field.observedAt).toLocaleTimeString()}, ${formatAge(field.staleMs)} before the cursor`}>
          {formatAge(field.staleMs)}
        </span>
      </div>
      {open && <pre class="mt-1 whitespace-pre-wrap break-words text-neutral-300">{text}</pre>}
    </div>);
}
function downloadState(state: FoldedState, rows: [
    string,
    FoldedField
][]): void {
    const data = {
        at: new Date(state.at).toISOString(),
        episodeId: state.episodeId,
        anchorTs: state.anchorTs === null ? null : new Date(state.anchorTs).toISOString(),
        foldedMessages: state.foldedMessages,
        truncatedAtEpisodeStart: state.truncatedAtEpisodeStart,
        fields: Object.fromEntries(rows.map(([path, f]) => [
            path,
            { value: f.value, role: f.role, observedAt: new Date(f.observedAt).toISOString(), staleMs: f.staleMs },
        ])),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prex-state-${new Date(state.at).toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
export function StateTab() {
    const activeToken = useStore((s) => s.activeToken);
    const cursor = useStore((s) => s.stateCursor);
    const state = useStore((s) => s.stateAtCursor);
    const loading = useStore((s) => s.stateLoading);
    const error = useStore((s) => s.stateError);
    const setStateCursor = useStore((s) => s.setStateCursor);
    const [filter, setFilter] = useState("");
    const rows = useMemo(() => {
        if (!state)
            return [];
        const q = filter.trim().toLowerCase();
        const entries = Object.entries(state.fields) as [
            string,
            FoldedField
        ][];
        return entries
            .filter(([path]) => !q || path.toLowerCase().includes(q))
            .sort((a, b) => a[0].localeCompare(b[0]));
    }, [state, filter]);
    if (!activeToken)
        return <div class="px-3 pt-2 text-neutral-600">No session selected</div>;
    return (<div class="flex flex-1 flex-col overflow-hidden">
      <div class="shrink-0 border-b border-neutral-800 p-2">
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="text-[10px] uppercase tracking-wide text-neutral-500">
            {cursor ? new Date(cursor).toLocaleTimeString() : "now"}
          </span>
          <div class="flex shrink-0 items-center gap-2">
            <button type="button" class="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" onClick={() => state && downloadState(state, rows)} disabled={!state || rows.length === 0} title="Download the currently shown fields as JSON">
              Download
            </button>
            <button type="button" class="text-neutral-500 hover:text-violet-300" onClick={() => setStateCursor(null)} title="Reconstruct state as of now">
              {cursor ? "jump to now" : "refresh"}
            </button>
          </div>
        </div>
        {state && (<div class="text-[10px] text-neutral-600">
            episode {state.episodeId ?? "\u2014"} · folded {state.foldedMessages} msg
            {state.anchorTs ? ` from anchor ${new Date(state.anchorTs).toLocaleTimeString()}` : ""}
          </div>)}
        
        {state?.truncatedAtEpisodeStart && (<div class="mt-1 rounded border border-amber-800/60 bg-amber-950/30 px-1.5 py-1 text-[10px] text-amber-400">
            No full-state message in this connection: folded from the start of the page load, so fields
            never sent since then are missing rather than wrong.
          </div>)}
        <input class="mt-1.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-[11px] text-neutral-200 outline-none focus:border-violet-500" placeholder="filter fields…" value={filter} onInput={(e) => setFilter(e.currentTarget.value)}/>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        {loading && <div class="px-3 pt-2 text-neutral-600">reconstructing…</div>}
        {error && <div class="px-3 pt-2 text-red-400">{error}</div>}
        {!loading && !error && !state && (<div class="px-3 pt-2 leading-relaxed text-neutral-600">
            Press ⏱ on a log line to reconstruct the page's state at that moment, or "refresh" above for now.
          </div>)}
        {!loading && state && rows.length === 0 && (<div class="px-3 pt-2 text-neutral-600">{filter ? "no matching fields" : "no state reconstructed"}</div>)}
        {!loading && rows.map(([path, field]) => <FieldRow key={path} path={path} field={field}/>)}
      </div>
    </div>);
}
