import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useStore, type LogEntry } from "../store";
import { diffValues, groupKeyOf, rootValueFor, valueAtPath, type LeafChange, type WatchDef } from "../watch";
import { FormattedValue, FormattedText } from "./FormattedValue";
import { useFormattedDelta } from "../formatting";
function fieldPath(base: string, relative: string): string {
    if (!relative)
        return base;
    return base ? `${base}.${relative}` : relative;
}
function formatWatchValue(v: unknown): string {
    if (v === undefined)
        return "\u2014";
    if (v === null)
        return "null";
    if (typeof v === "number")
        return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 3 });
    if (typeof v === "string")
        return v;
    if (typeof v === "boolean")
        return String(v);
    if (Array.isArray(v))
        return `[${v.length} item${v.length === 1 ? "" : "s"}]`;
    if (typeof v === "object") {
        const n = Object.keys(v as object).length;
        return `{${n} key${n === 1 ? "" : "s"}}`;
    }
    return String(v);
}
function formatDelta(delta: number): string {
    const s = delta.toLocaleString(undefined, { maximumFractionDigits: 3 });
    return delta > 0 ? `+${s}` : s;
}
function useWatchSample(watch: WatchDef) {
    const entries = useStore((s) => s.entries);
    return useMemo(() => {
        let current: LogEntry | undefined;
        let previous: LogEntry | undefined;
        for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i];
            if (groupKeyOf(e.msg) !== watch.groupKey)
                continue;
            if (!current)
                current = e;
            else {
                previous = e;
                break;
            }
        }
        const currentValue = current ? valueAtPath(rootValueFor(current.msg), watch.path) : undefined;
        const previousValue = previous ? valueAtPath(rootValueFor(previous.msg), watch.path) : undefined;
        const changes = current && previous ? diffValues(previousValue, currentValue) : [];
        return { current, previous, currentValue, changes };
    }, [entries, watch.groupKey, watch.path]);
}
function ChangeRow({ groupKey, basePath, change }: {
    groupKey: string;
    basePath: string;
    change: LeafChange;
}) {
    const path = fieldPath(basePath, change.path);
    const delta = change.delta ?? 0;
    const formattedDelta = useFormattedDelta(groupKey, path, change.current, delta, formatDelta(delta));
    return (<div class="flex min-w-0 items-baseline gap-1">
      <span class="shrink-0 text-neutral-500">{change.path || "(value)"}:</span>
      <FormattedValue group={groupKey} path={path} value={change.previous} raw={formatWatchValue(change.previous)} class="min-w-0 flex-1 text-neutral-500" pickable={false}/>
      <span class="shrink-0 text-neutral-600">→</span>
      <FormattedValue group={groupKey} path={path} value={change.current} raw={formatWatchValue(change.current)} class="min-w-0 flex-1 text-neutral-200"/>
      {change.kind === "number" && change.delta != null && (<FormattedText formatted={formattedDelta} class={`shrink-0 ${change.delta > 0 ? "text-emerald-400" : "text-red-400"}`}/>)}
      {change.kind === "added" && <span class="shrink-0 text-emerald-400">(added)</span>}
      {change.kind === "removed" && <span class="shrink-0 text-red-400">(removed)</span>}
    </div>);
}
function WatchRow({ watch }: {
    watch: WatchDef;
}) {
    const removeWatch = useStore((s) => s.removeWatch);
    const { current, previous, currentValue, changes } = useWatchSample(watch);
    return (<li class="rounded border border-neutral-800 p-2">
      <div class="flex items-center justify-between gap-2">
        <span class="truncate font-medium text-violet-300" title={watch.groupKey}>
          {watch.groupKey}
        </span>
        <button type="button" class="shrink-0 text-neutral-500 hover:text-red-400" onClick={() => removeWatch(watch.id)}>
          delete
        </button>
      </div>
      <div class="truncate text-neutral-500" title={watch.path || "(whole payload)"}>
        {watch.path || "(whole payload)"}
      </div>

      {!current ? (<div class="mt-1 text-neutral-600">No data yet</div>) : (<div class="mt-1 space-y-0.5">
          <div class="flex items-baseline gap-1">
            <span class="text-neutral-500">current:</span>
            <FormattedValue group={watch.groupKey} path={watch.path} value={currentValue} raw={formatWatchValue(currentValue)} class="min-w-0 flex-1 text-neutral-200"/>
          </div>
          {!previous ? (<div class="text-neutral-600">Only one sample so far</div>) : changes.length === 0 ? (<div class="text-neutral-600">No change since previous sample</div>) : (changes.map((c) => <ChangeRow key={c.path} groupKey={watch.groupKey} basePath={watch.path} change={c}/>))}
        </div>)}
    </li>);
}
export function WatchPanel() {
    const activeToken = useStore((s) => s.activeToken);
    const watches = useStore((s) => s.watches);
    const addWatch = useStore((s) => s.addWatch);
    const watchDraft = useStore((s) => s.watchDraft);
    const setWatchDraft = useStore((s) => s.setWatchDraft);
    const [groupKey, setGroupKey] = useState("");
    const [path, setPath] = useState("");
    const [formError, setFormError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    useEffect(() => {
        if (!watchDraft)
            return;
        setGroupKey(watchDraft.groupKey);
        setWatchDraft(null);
        formRef.current?.scrollIntoView({ block: "nearest" });
    }, [watchDraft]);
    function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (!groupKey.trim()) {
            setFormError("type is required, e.g. ws:partyTick");
            return;
        }
        addWatch(groupKey.trim(), path.trim());
        setFormError(null);
        setPath("");
    }
    return (<>
      {!activeToken && <div class="px-3 pt-2 text-neutral-600">No session selected</div>}

      {activeToken && (<>
          <ul class="flex-1 space-y-2 overflow-y-auto px-2">
            {watches.length === 0 && <div class="px-1 text-neutral-600">No watches yet</div>}
            {watches.map((w) => (<WatchRow key={w.id} watch={w}/>))}
          </ul>

          <form ref={formRef} onSubmit={handleSubmit} class="space-y-2 border-t border-neutral-800 p-3">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">New watch</div>
            <input class="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" value={groupKey} onInput={(e) => setGroupKey(e.currentTarget.value)} placeholder="type, e.g. &quot;ws:partyTick&quot;" spellcheck={false}/>
            <input class="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" value={path} onInput={(e) => setPath(e.currentTarget.value)} placeholder="path (optional), e.g. &quot;hpPots.medium&quot;: blank = whole payload" spellcheck={false}/>
            {formError && <div class="text-red-400">{formError}</div>}
            <button type="submit" class="w-full rounded border border-violet-700 bg-violet-900/40 px-2 py-1 text-neutral-100 hover:bg-violet-900/60">
              Add watch
            </button>
          </form>
        </>)}
    </>);
}
