import { useEffect, useRef, useState } from "preact/hooks";
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
interface PerfSnapshot {
    uptimeMs: number;
    memory: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
    } | null;
    longTasks: {
        count: number;
        totalMs: number;
    } | null;
    resources: {
        count: number;
        totalBytes: number;
    };
    entrypoint?: string | null;
    visibility?: {
        state: "visible" | "hidden";
        sinceMs: number;
    };
}
function basename(url: string): string {
    try {
        return new URL(url).pathname.split("/").pop() || url;
    }
    catch {
        return url;
    }
}
function mb(n: number): string {
    return `${(n / 1048576).toFixed(1)} MB`;
}
const PERF_POLL_MS = 5000;
function usePerfSnapshot(active: boolean) {
    const evalSilent = useStore((s) => s.evalSilent);
    const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const evalSilentRef = useRef(evalSilent);
    evalSilentRef.current = evalSilent;
    useEffect(() => {
        if (!active)
            return;
        let cancelled = false;
        async function poll() {
            const result = await evalSilentRef.current("window.__prexy.getPerfSnapshot()");
            if (cancelled)
                return;
            if (result.ok) {
                setSnapshot(result.value as PerfSnapshot);
                setError(null);
            }
            else {
                setError(result.error);
            }
        }
        poll();
        const id = setInterval(poll, PERF_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [active]);
    return { snapshot, error };
}
export function PerfPanel() {
    const activeToken = useStore((s) => s.activeToken);
    const { snapshot: perf, error: perfError } = usePerfSnapshot(Boolean(activeToken));
    if (!activeToken) {
        return <div class="px-3 pt-2 text-neutral-600">No session selected</div>;
    }
    return (<div class="flex flex-col gap-y-1 px-3 py-2 text-[11px] text-neutral-500">
      {perfError ? (<span class="text-red-400" title={perfError}>
          perf: {perfError.includes("getPerfSnapshot") ? "target page needs a reload to pick up perf support" : perfError}
        </span>) : !perf ? (<span>loading…</span>) : (<>
          <span>
            uptime <span class="text-neutral-200">{formatDuration(perf.uptimeMs)}</span>
          </span>
          {perf.memory && (<span>
              heap <span class="text-neutral-200">{mb(perf.memory.usedJSHeapSize)}</span> / {mb(perf.memory.totalJSHeapSize)}
            </span>)}
          <span>
            long tasks{" "}
            <span class="text-neutral-200">
              {perf.longTasks ? `${perf.longTasks.count} (${(perf.longTasks.totalMs / 1000).toFixed(1)}s)` : "unsupported"}
            </span>
          </span>
          <span title="Capped at the browser's own resource-timing buffer (250 in Chromium): a recent window, not a lifetime total. transferSize is often 0 for cached/no-timing-allow-origin resources, so this can undercount.">
            resources <span class="text-neutral-200">{perf.resources.count} ({mb(perf.resources.totalBytes)})</span>
          </span>
          {perf.visibility && (<span title="Rendering/rAF pause while hidden, but WS delivery and everything else in this row keeps working: a reading taken while hidden isn't stale, just note long tasks read lower there (less rendering work is even attempted, not necessarily less JS work).">
              tab <span class={perf.visibility.state === "hidden" ? "text-amber-400" : "text-emerald-400"}>{perf.visibility.state}</span>{" "}
              <span class="text-neutral-200">({formatDuration(perf.visibility.sinceMs)})</span>
            </span>)}
          {perf.entrypoint && (<span class="min-w-0 truncate" title={perf.entrypoint}>
              entry <span class="text-neutral-200">{basename(perf.entrypoint)}</span>
            </span>)}
        </>)}
    </div>);
}
