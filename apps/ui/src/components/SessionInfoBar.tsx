import { useEffect, useState } from "preact/hooks";
import { useStore } from "../store";
function formatDuration(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}
function formatActivityAgo(ms: number): string {
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    return formatDuration(ms);
}
function lastActivityAgo(entries: {
    ts: number;
}[]): number | null {
    const last = entries[entries.length - 1];
    return last ? Date.now() - last.ts : null;
}
export function SessionInfoBar() {
    const activeToken = useStore((s) => s.activeToken);
    const prexyOnline = useStore((s) => s.prexyOnline);
    const prexyMeta = useStore((s) => s.prexyMeta);
    const sessions = useStore((s) => s.sessions);
    const entries = useStore((s) => s.entries);
    const [, forceTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => forceTick((n) => n + 1), 5000);
        return () => clearInterval(id);
    }, []);
    const [, fastTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => fastTick((n) => n + 1), 200);
        return () => clearInterval(id);
    }, []);
    if (!activeToken)
        return null;
    const activityAgo = lastActivityAgo(entries);
    const fallback = sessions.find((s) => s.token === activeToken) ?? null;
    const meta = prexyMeta ?? fallback;
    const online = prexyMeta ? prexyOnline : Boolean(fallback?.connectedAt);
    return (<div class="flex items-center gap-x-4 overflow-hidden border-b border-neutral-800 bg-neutral-900 px-3 py-1.5 text-[11px]">
      <span class="flex shrink-0 items-center gap-1.5">
        <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? "bg-emerald-500" : "bg-neutral-600"}`}/>
        <span class={online ? "text-emerald-400" : "text-neutral-500"}>{online ? "online" : "offline"}</span>
      </span>
      <span class="shrink-0 text-neutral-500">
        game <span class="text-neutral-200">{meta?.game ?? "\u2014"}</span>
      </span>
      {meta?.url && (<span class="min-w-0 max-w-[340px] truncate text-neutral-500" title={meta.url}>
          url <span class="text-neutral-200">{meta.url}</span>
        </span>)}
      {meta?.origin && (<span class="min-w-0 max-w-[200px] truncate text-neutral-500" title={meta.origin}>
          origin <span class="text-neutral-200">{meta.origin}</span>
        </span>)}
      {online && meta?.connectedAt && (<span class="shrink-0 text-neutral-500">
          up <span class="text-neutral-200">{formatDuration(Date.now() - meta.connectedAt)}</span>
        </span>)}
      <span class="shrink-0 text-neutral-500">
        viewers <span class="text-neutral-200">{meta?.viewerCount ?? 0}</span>
      </span>
      {activityAgo != null && (<span class="shrink-0 text-neutral-500" title="Time since the last message of any kind from this session: free, derived from what's already received">
          last activity <span class="text-neutral-200">{formatActivityAgo(activityAgo)} ago</span>
        </span>)}
      <button type="button" class="ml-auto shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200" onClick={() => {
            navigator.clipboard.writeText(activeToken).catch(() => { });
        }} title="Copy session token">
        copy token
      </button>
    </div>);
}
