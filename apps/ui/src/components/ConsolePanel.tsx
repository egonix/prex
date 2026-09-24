import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";
import type { ServerToViewer } from "../protocol";
import { groupKeyOf } from "../watch";
const LEVEL_STYLE: Record<string, string> = {
    log: "text-neutral-300",
    warn: "text-amber-400",
    error: "text-red-400",
};
function formatArg(arg: unknown): string {
    if (typeof arg === "string")
        return arg;
    try {
        return JSON.stringify(arg);
    }
    catch {
        return String(arg);
    }
}
function entryText(msg: ServerToViewer): string {
    switch (msg.type) {
        case "console":
            return `console ${msg.level} ${msg.args.map(formatArg).join(" ")}`;
        case "event":
            return `event ${msg.name} ${formatArg(msg.data)}`;
        case "prexy-connected":
            return `prexy connected ${msg.meta.game} ${msg.meta.url ?? ""}`;
        case "prexy-disconnected":
            return "prexy disconnected";
        case "trigger-fired":
            return `trigger ${msg.action} ${msg.match} ${msg.triggerId} ${msg.detail ?? ""} ${msg.ok ? "ok" : "failed"}`;
        case "trigger-changed":
            return `trigger-changed ${msg.op} ${msg.triggerId} ${msg.from ?? ""}`;
        default:
            return "";
    }
}
function nameOf(msg: ServerToViewer): string {
    switch (msg.type) {
        case "console":
            return "console";
        case "event":
            return msg.name;
        case "prexy-connected":
            return "connected";
        case "prexy-disconnected":
            return "disconnected";
        case "trigger-fired":
            return "trigger";
        case "trigger-changed":
            return "trigger-changed";
        default:
            return "";
    }
}
const TYPE_ALIASES: Record<string, string> = {
    connected: "prexy-connected",
    disconnected: "prexy-disconnected",
    trigger: "trigger-fired",
};
interface ParsedFilter {
    type: string | null;
    name: string | null;
    text: string;
}
function parseFilter(input: string): ParsedFilter {
    let type: string | null = null;
    let name: string | null = null;
    const textParts: string[] = [];
    for (const token of input.trim().split(/\s+/).filter(Boolean)) {
        const m = token.match(/^(type|name):(.+)$/i);
        if (m) {
            const [, key, rawValue] = m;
            const value = rawValue.toLowerCase();
            if (key.toLowerCase() === "type")
                type = TYPE_ALIASES[value] ?? value;
            else
                name = value;
            continue;
        }
        textParts.push(token);
    }
    return { type, name, text: textParts.join(" ").toLowerCase() };
}
function matchesFilter(msg: ServerToViewer, parsed: ParsedFilter): boolean {
    if (parsed.type && msg.type !== parsed.type)
        return false;
    if (parsed.name && !nameOf(msg).toLowerCase().includes(parsed.name))
        return false;
    if (parsed.text && !entryText(msg).toLowerCase().includes(parsed.text))
        return false;
    return true;
}
function matchForEntry(msg: ServerToViewer): string | null {
    switch (msg.type) {
        case "console":
            return `console.${msg.level}`;
        case "event":
            return `event:${msg.name}`;
        case "prexy-connected":
            return "prexy-connected";
        case "prexy-disconnected":
            return "prexy-disconnected";
        default:
            return null;
    }
}
function TimeTravelQuickAction({ ts }: {
    ts: number;
}) {
    const setStateCursor = useStore((s) => s.setStateCursor);
    const cursor = useStore((s) => s.stateCursor);
    const active = cursor === ts;
    return (<button type="button" class={`mr-1 ${active ? "text-amber-400" : "text-neutral-700 hover:text-amber-400"}`} title={`Reconstruct the page's state as of ${new Date(ts).toLocaleTimeString()}`} onClick={() => setStateCursor(ts)}>
      ⏱
    </button>);
}
function TriggerQuickAction({ msg }: {
    msg: ServerToViewer;
}) {
    const setTriggerDraft = useStore((s) => s.setTriggerDraft);
    const match = matchForEntry(msg);
    if (!match)
        return null;
    return (<button type="button" class="mr-1 text-neutral-700 hover:text-violet-400" title={`Create a trigger matching "${match}"`} onClick={() => setTriggerDraft({ match })}>
      ⚡
    </button>);
}
function WatchQuickAction({ msg }: {
    msg: ServerToViewer;
}) {
    const setWatchDraft = useStore((s) => s.setWatchDraft);
    const groupKey = groupKeyOf(msg);
    if (!groupKey)
        return null;
    return (<button type="button" class="mr-1 text-neutral-700 hover:text-sky-400" title={`Add a watch for "${groupKey}"`} onClick={() => setWatchDraft({ groupKey })}>
      👁
    </button>);
}
function dataForEntry(msg: ServerToViewer): unknown {
    switch (msg.type) {
        case "console":
            return msg.args.length === 1 ? msg.args[0] : msg.args;
        case "event":
            return msg.data;
        case "prexy-connected":
        case "prexy-disconnected":
            return msg.meta;
        default:
            return msg;
    }
}
function InspectQuickAction({ msg }: {
    msg: ServerToViewer;
}) {
    const sendEval = useStore((s) => s.sendEval);
    return (<button type="button" class="mr-1 font-mono text-neutral-700 hover:text-emerald-400" title="Save this entry's data to `tmp` on the page, for use in the REPL" onClick={() => {
            try {
                sendEval(`tmp = ${JSON.stringify(dataForEntry(msg))};`);
            }
            catch {
            }
        }}>
      ›_
    </button>);
}
function WorkbenchQuickAction({ msg }: {
    msg: ServerToViewer;
}) {
    const setWorkbenchInput = useStore((s) => s.setWorkbenchInput);
    return (<button type="button" class="mr-1 text-neutral-700 hover:text-sky-400" title="Examine this entry's data in the Workbench" onClick={() => setWorkbenchInput({ value: dataForEntry(msg), identity: null, label: nameOf(msg) })}>
      🔍
    </button>);
}
function downloadLog(entries: {
    ts: number;
    msg: ServerToViewer;
}[]): void {
    const data = entries.map((e) => ({ ts: new Date(e.ts).toISOString(), ...e.msg }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prex-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
export function ConsolePanel() {
    const entries = useStore((s) => s.entries);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [filter, setFilter] = useState("");
    const [follow, setFollow] = useState(true);
    const visible = entries.filter((e) => e.msg.type === "console" ||
        e.msg.type === "event" ||
        e.msg.type === "prexy-connected" ||
        e.msg.type === "prexy-disconnected" ||
        e.msg.type === "trigger-fired" ||
        e.msg.type === "trigger-changed");
    const parsedFilter = parseFilter(filter);
    const filterActive = parsedFilter.type !== null || parsedFilter.name !== null || parsedFilter.text !== "";
    const filtered = filterActive ? visible.filter((e) => matchesFilter(e.msg, parsedFilter)) : visible;
    useEffect(() => {
        if (follow)
            bottomRef.current?.scrollIntoView({ block: "end" });
    }, [filtered, follow]);
    return (<div class="flex h-full w-full flex-col bg-neutral-950 text-xs">
      <div class="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
        <span class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Console & events</span>
        <input class="ml-2 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-200 outline-none focus:border-violet-500" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} placeholder="filter… (try name:ws, name:console, or type:event)" title={"Plain text matches anywhere. \"type:\" filters by message kind (console, event, connected, disconnected, trigger). \"name:\" filters every row's name \u2014 an event's own name (ws, http, ...) for event rows, or console/connected/disconnected/trigger for the rest. All tokens AND together."} spellcheck={false}/>
        {filterActive && (<span class="shrink-0 text-neutral-600">
            {filtered.length} / {visible.length}
          </span>)}
        <button type="button" onClick={() => downloadLog(filtered)} disabled={filtered.length === 0} class="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" title="Download the currently shown entries as JSON">
          Download
        </button>
        <button type="button" onClick={() => setFollow((f) => !f)} class={`shrink-0 rounded border px-2 py-0.5 ${follow
            ? "border-violet-700 bg-violet-900/40 text-violet-200"
            : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`} title={follow ? "Auto-scrolling \u2014 click to pause" : "Paused \u2014 click to auto-scroll again"}>
          {follow ? "Follow: on" : "Follow: off"}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        {filtered.length === 0 && <div class="text-neutral-600">{filterActive ? "No matches" : "Nothing yet"}</div>}
        {filtered.map((entry) => {
            const { msg } = entry;
            const time = new Date(entry.ts).toLocaleTimeString();
            if (msg.type === "console") {
                return (<div key={entry.key} class={`whitespace-pre-wrap break-words ${LEVEL_STYLE[msg.level]}`}>
                <TimeTravelQuickAction ts={entry.ts}/>
                <TriggerQuickAction msg={msg}/>
                <InspectQuickAction msg={msg}/>
                <WorkbenchQuickAction msg={msg}/>
                <span class="text-neutral-600">{time} </span>
                <span class="text-neutral-500">console</span> {msg.args.map(formatArg).join(" ")}
              </div>);
            }
            if (msg.type === "event") {
                return (<div key={entry.key} class="whitespace-pre-wrap break-words text-violet-300">
                <TimeTravelQuickAction ts={entry.ts}/>
                <TriggerQuickAction msg={msg}/>
                <WatchQuickAction msg={msg}/>
                <InspectQuickAction msg={msg}/>
                <WorkbenchQuickAction msg={msg}/>
                <span class="text-neutral-600">{time} </span>
                <span class="text-violet-400">{msg.name}</span> {formatArg(msg.data)}
              </div>);
            }
            if (msg.type === "prexy-connected") {
                return (<div key={entry.key} class="text-emerald-400">
                <TriggerQuickAction msg={msg}/>
                <InspectQuickAction msg={msg}/>
                <WorkbenchQuickAction msg={msg}/>
                <span class="text-neutral-600">{time} </span>
                prexy connected: {msg.meta.game} @ {msg.meta.url}
              </div>);
            }
            if (msg.type === "trigger-fired") {
                return (<div key={entry.key} class={msg.ok ? "text-emerald-400" : "text-red-400"}>
                <InspectQuickAction msg={msg}/>
                <WorkbenchQuickAction msg={msg}/>
                <span class="text-neutral-600">{time} </span>⚡ trigger [{msg.action}] {msg.match}
                {" \u2192 "}
                {msg.ok ? "ok" : "failed"}
                {msg.detail ? ` (${msg.detail})` : ""}
              </div>);
            }
            if (msg.type === "trigger-changed") {
                return (<div key={entry.key} class="text-sky-400">
                <InspectQuickAction msg={msg}/>
                <WorkbenchQuickAction msg={msg}/>
                <span class="text-neutral-600">{time} </span>trigger {msg.op}: {msg.triggerId}
                {msg.trigger ? ` (${msg.trigger.match})` : ""}
                {msg.from ? ` [from: ${msg.from}]` : ""}
              </div>);
            }
            return (<div key={entry.key} class="text-neutral-500">
              <TriggerQuickAction msg={msg}/>
              <InspectQuickAction msg={msg}/>
                <WorkbenchQuickAction msg={msg}/>
              <span class="text-neutral-600">{time} </span>
              prexy disconnected
            </div>);
        })}
        <div ref={bottomRef}/>
      </div>
    </div>);
}
