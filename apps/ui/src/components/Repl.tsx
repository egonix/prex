import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";
import type { LogEntry } from "../store";
const PROMPT = "\u001B[36m> \u001B[0m";
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
function formatValue(value: unknown): string {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value, null, 2) ?? "undefined";
    }
    catch {
        return String(value);
    }
}
function splitForCompletion(buffer: string): {
    objExpr: string;
    prefix: string;
} | null {
    const word = buffer.match(/[a-zA-Z0-9_$.[\]'"]*$/)?.[0] ?? "";
    const m = word.match(/^(?:([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*|\[[^[\]]*\])*)\.)?([a-zA-Z0-9_$]*)$/);
    if (!m)
        return null;
    return { objExpr: m[1] ?? "", prefix: m[2] ?? "" };
}
function buildCompletionLookup(objExpr: string, prefix: string): string {
    const target = objExpr || "window";
    return `(() => {
    const t = (${target});
    const p = ${JSON.stringify(prefix)};
    const out = [];
    for (const k in t) { if (typeof k === "string" && k.indexOf(p) === 0) out.push(k); }
    return out.sort().slice(0, 50);
  })()`;
}
export function Repl() {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const lineRef = useRef("");
    const cursorPosRef = useRef(0);
    const historyRef = useRef<string[]>([]);
    const historyIndexRef = useRef(0);
    const processedKeyRef = useRef<string | null>(null);
    const autocompleteRef = useRef(true);
    const [autocomplete, setAutocomplete] = useState(true);
    useEffect(() => {
        autocompleteRef.current = autocomplete;
    }, [autocomplete]);
    const entries = useStore((s) => s.entries);
    const activeToken = useStore((s) => s.activeToken);
    const viewerId = useStore((s) => s.viewerId);
    const sendEval = useStore((s) => s.sendEval);
    const evalSilent = useStore((s) => s.evalSilent);
    useEffect(() => {
        if (!containerRef.current)
            return;
        const term = new Terminal({
            convertEol: true,
            fontSize: 13,
            fontFamily: "ui-monospace, SF Mono, Consolas, monospace",
            theme: { background: "#0a0a0a", foreground: "#e5e5e5" },
            cursorBlink: true,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(containerRef.current);
        fit.fit();
        term.writeln(DIM("prex REPL \u2014 pick a session, type JS, press Enter"));
        term.write(PROMPT);
        termRef.current = term;
        const resizeObserver = new ResizeObserver(() => fit.fit());
        resizeObserver.observe(containerRef.current);
        function redrawLine() {
            term.write(`\r\x1b[K${PROMPT}${lineRef.current}`);
            const back = lineRef.current.length - cursorPosRef.current;
            if (back > 0)
                term.write(`\x1b[${back}D`);
        }
        function handleTab() {
            if (!autocompleteRef.current)
                return;
            const bufferAtRequest = lineRef.current;
            const split = splitForCompletion(bufferAtRequest);
            if (!split)
                return;
            const { objExpr, prefix } = split;
            evalSilent(buildCompletionLookup(objExpr, prefix)).then((result) => {
                if (lineRef.current !== bufferAtRequest)
                    return;
                if (!result.ok || !Array.isArray(result.value) || result.value.length === 0)
                    return;
                const matches = result.value as string[];
                if (matches.length === 1) {
                    const completion = matches[0].slice(prefix.length);
                    if (completion) {
                        lineRef.current += completion;
                        cursorPosRef.current = lineRef.current.length;
                        term.write(completion);
                    }
                    return;
                }
                term.write(`\r\n${matches.join("  ")}\r\n${PROMPT}${lineRef.current}`);
                cursorPosRef.current = lineRef.current.length;
            });
        }
        term.onData((data) => {
            if (data === "\t") {
                handleTab();
                return;
            }
            if (data === "\r") {
                const code = lineRef.current;
                term.write("\r\n");
                lineRef.current = "";
                cursorPosRef.current = 0;
                if (code.trim()) {
                    historyRef.current.push(code);
                    historyIndexRef.current = historyRef.current.length;
                    sendEval(code);
                }
                else {
                    term.write(PROMPT);
                }
                return;
            }
            if (data === "") {
                const pos = cursorPosRef.current;
                if (pos > 0) {
                    const wasAtEnd = pos === lineRef.current.length;
                    lineRef.current = lineRef.current.slice(0, pos - 1) + lineRef.current.slice(pos);
                    cursorPosRef.current = pos - 1;
                    if (wasAtEnd) {
                        term.write("\b \b");
                    }
                    else {
                        redrawLine();
                    }
                }
                return;
            }
            if (data === "\u001B[3~") {
                const pos = cursorPosRef.current;
                if (pos < lineRef.current.length) {
                    lineRef.current = lineRef.current.slice(0, pos) + lineRef.current.slice(pos + 1);
                    redrawLine();
                }
                return;
            }
            if (data === "\u0003") {
                lineRef.current = "";
                cursorPosRef.current = 0;
                term.write("^C\r\n" + PROMPT);
                return;
            }
            if (data === "\u001B[D") {
                if (cursorPosRef.current > 0) {
                    cursorPosRef.current -= 1;
                    term.write("\u001B[D");
                }
                return;
            }
            if (data === "\u001B[C") {
                if (cursorPosRef.current < lineRef.current.length) {
                    cursorPosRef.current += 1;
                    term.write("\u001B[C");
                }
                return;
            }
            if (data === "\u001B[H" || data === "\u001BOH") {
                const pos = cursorPosRef.current;
                if (pos > 0) {
                    term.write(`\x1b[${pos}D`);
                    cursorPosRef.current = 0;
                }
                return;
            }
            if (data === "\u001B[F" || data === "\u001BOF") {
                const pos = cursorPosRef.current;
                const len = lineRef.current.length;
                if (pos < len) {
                    term.write(`\x1b[${len - pos}C`);
                    cursorPosRef.current = len;
                }
                return;
            }
            if (data === "\u001B[A") {
                if (historyIndexRef.current > 0) {
                    historyIndexRef.current -= 1;
                    lineRef.current = historyRef.current[historyIndexRef.current] ?? "";
                    cursorPosRef.current = lineRef.current.length;
                    redrawLine();
                }
                return;
            }
            if (data === "\u001B[B") {
                if (historyIndexRef.current < historyRef.current.length) {
                    historyIndexRef.current += 1;
                    lineRef.current = historyRef.current[historyIndexRef.current] ?? "";
                    cursorPosRef.current = lineRef.current.length;
                    redrawLine();
                }
                return;
            }
            if (data.charCodeAt(0) < 32)
                return;
            const pos = cursorPosRef.current;
            if (pos === lineRef.current.length) {
                lineRef.current += data;
                cursorPosRef.current += data.length;
                term.write(data);
            }
            else {
                lineRef.current = lineRef.current.slice(0, pos) + data + lineRef.current.slice(pos);
                cursorPosRef.current = pos + data.length;
                redrawLine();
            }
        });
        return () => {
            resizeObserver.disconnect();
            term.dispose();
            termRef.current = null;
        };
    }, []);
    useEffect(() => {
        processedKeyRef.current = null;
        const term = termRef.current;
        if (!term)
            return;
        term.reset();
        term.writeln(DIM(activeToken ? `— attached to ${activeToken}:` : "\u2014 no session selected \u2014"));
        term.write(PROMPT);
    }, [activeToken]);
    useEffect(() => {
        const term = termRef.current;
        if (!term)
            return;
        const lastKey = processedKeyRef.current;
        const startIdx = lastKey === null ? 0 : entries.findIndex((e) => e.key === lastKey) + 1;
        const fresh = entries.slice(startIdx);
        if (fresh.length > 0)
            processedKeyRef.current = fresh[fresh.length - 1].key;
        for (const entry of fresh) {
            printEntry(term, entry, viewerId);
        }
    }, [entries, viewerId]);
    return (<div class="flex h-full w-full flex-col">
      <div class="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-1.5 text-xs">
        <span class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">REPL</span>
        <button type="button" onClick={() => setAutocomplete((v) => !v)} class={`ml-auto rounded border px-2 py-0.5 ${autocomplete
            ? "border-violet-700 bg-violet-900/40 text-violet-200"
            : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`} title={autocomplete
            ? "Tab fires one eval round-trip to the page per press \u2014 click to disable"
            : "Tab-complete disabled \u2014 click to enable"}>
          {autocomplete ? "Tab-complete: on" : "Tab-complete: off"}
        </button>
      </div>
      <div ref={containerRef} class="min-h-0 min-w-0 flex-1 px-2 py-1"/>
    </div>);
}
function printEntry(term: Terminal, entry: LogEntry, viewerId: string | null): void {
    const { msg } = entry;
    if (msg.type === "eval") {
        if (msg.from && msg.from !== viewerId) {
            term.writeln(DIM(`[${msg.from}] > ${msg.code}`));
        }
        return;
    }
    if (msg.type === "result") {
        if (msg.ok) {
            term.writeln(GREEN(formatValue(msg.value)));
        }
        else {
            term.writeln(RED(msg.error));
        }
        term.write(PROMPT);
    }
}
