#!/usr/bin/env -S deno run --allow-net --allow-env
interface SessionMeta {
    token: string;
    game: string;
    url?: string;
    viewerCount?: number;
}
interface Args {
    server: string;
    json: boolean;
    list: boolean;
    repl: boolean;
    token: string;
}
function trimBase(url: string): string {
    return url.replace(/\/+$/, "");
}
function parseArgs(argv: string[]): Args {
    const out: Args = {
        server: Deno.env.get("PREX_SERVER") ?? "http://localhost:8000",
        json: false,
        list: false,
        repl: false,
        token: "",
    };
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--server")
            out.server = argv[++i];
        else if (a === "--json")
            out.json = true;
        else if (a === "--list")
            out.list = true;
        else if (a === "--repl")
            out.repl = true;
        else
            rest.push(a);
    }
    out.token = rest[0] ?? "";
    return out;
}
async function listSessions(server: string, adminKey: string): Promise<void> {
    const res = await fetch(`${trimBase(server)}/api/sessions`, { headers: { Authorization: `Bearer ${adminKey}` } });
    const data = await res.json();
    if (!res.ok || !data.ok) {
        console.error(`failed to list sessions: ${data.error ?? res.status}`);
        Deno.exit(1);
    }
    const sessions = data.sessions as SessionMeta[];
    if (sessions.length === 0) {
        console.log("no active sessions");
        return;
    }
    for (const s of sessions) {
        console.log(`${s.token}  ${s.game.padEnd(10)} ${s.url ?? ""}  viewers=${s.viewerCount ?? 0}`);
    }
}
type AnyMsg = any;
function wsUrlFor(server: string, token: string, adminKey: string): string {
    return `${trimBase(server).replace(/^http/, "ws")}/ws/view/${token}?key=${encodeURIComponent(adminKey)}`;
}
function formatLine(msg: AnyMsg, ts: number): string | null {
    const time = new Date(ts).toLocaleTimeString();
    switch (msg.type) {
        case "console":
            return `${time} console.${msg.level} ${msg.args.map((a: unknown) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`;
        case "event":
            return `${time} event:${msg.name} ${JSON.stringify(msg.data)}`;
        case "prexy-connected":
            return `${time} prexy connected: ${msg.meta.game} @ ${msg.meta.url ?? ""}`;
        case "prexy-disconnected":
            return `${time} prexy disconnected`;
        case "trigger-fired":
            return `${time} ⚡ trigger [${msg.action}] ${msg.match} → ${msg.ok ? "ok" : "failed"}${msg.detail ? ` (${msg.detail})` : ""}`;
        case "trigger-changed":
            return `${time} trigger ${msg.op}: ${msg.triggerId}${msg.trigger ? ` (${msg.trigger.match})` : ""}`;
        default:
            return null;
    }
}
function tail(server: string, adminKey: string, token: string, json: boolean): Promise<void> {
    return new Promise((resolve) => {
        const ws = new WebSocket(wsUrlFor(server, token, adminKey));
        ws.onopen = () => console.error(`[connected: token ${token}]`);
        ws.onerror = () => console.error("[ws error]");
        ws.onclose = () => {
            console.error("[disconnected]");
            resolve();
        };
        ws.onmessage = (event) => {
            let msg: AnyMsg;
            try {
                msg = JSON.parse(event.data as string);
            }
            catch {
                return;
            }
            const ts = Date.now();
            if (json) {
                console.log(JSON.stringify({ ts, ...msg }));
                return;
            }
            const line = formatLine(msg, ts);
            if (line)
                console.log(line);
        };
    });
}
const PROMPT = "> ";
async function* readStdinLines(): AsyncGenerator<string> {
    const reader = Deno.stdin.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n")) >= 0) {
                yield buffer.slice(0, idx).replace(/\r$/, "");
                buffer = buffer.slice(idx + 1);
            }
        }
        if (buffer)
            yield buffer;
    }
    finally {
        reader.releaseLock();
    }
}
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
function runRepl(server: string, adminKey: string, token: string): Promise<void> {
    return new Promise((resolve) => {
        const ws = new WebSocket(wsUrlFor(server, token, adminKey));
        let viewerId: string | null = null;
        let stdinIter: AsyncGenerator<string> | null = null;
        async function pumpStdin() {
            stdinIter = readStdinLines();
            for await (const line of stdinIter) {
                if (ws.readyState !== WebSocket.OPEN)
                    break;
                if (line.trim())
                    ws.send(JSON.stringify({ type: "eval", code: line }));
                else
                    Deno.stdout.writeSync(new TextEncoder().encode(PROMPT));
            }
        }
        ws.onopen = () => {
            console.error(`[connected: token ${token}: type JS, Enter to run, Ctrl+D to quit]`);
            Deno.stdout.writeSync(new TextEncoder().encode(PROMPT));
            pumpStdin();
        };
        ws.onerror = () => console.error("[ws error]");
        ws.onclose = () => {
            console.error("\n[disconnected]");
            resolve();
        };
        ws.onmessage = (event) => {
            let msg: AnyMsg;
            try {
                msg = JSON.parse(event.data as string);
            }
            catch {
                return;
            }
            if (msg.type === "viewer-welcome") {
                viewerId = msg.viewerId;
                return;
            }
            if (msg.type === "eval") {
                if (msg.from && msg.from !== viewerId)
                    console.log(`\n[${msg.from}] > ${msg.code}`);
                return;
            }
            if (msg.type === "result") {
                console.log(msg.ok ? formatValue(msg.value) : `error: ${msg.error}`);
                Deno.stdout.writeSync(new TextEncoder().encode(PROMPT));
            }
        };
    });
}
const args = parseArgs(Deno.args);
const adminKey = Deno.env.get("PREX_ADMIN_KEY");
if (!adminKey) {
    console.error("set PREX_ADMIN_KEY first");
    Deno.exit(1);
}
if (args.list) {
    await listSessions(args.server, adminKey);
}
else if (!args.token) {
    console.error("usage: cli.ts <token> [--json | --repl] [--server <url>] | cli.ts --list");
    Deno.exit(1);
}
else if (args.repl) {
    await runRepl(args.server, adminKey, args.token);
}
else {
    await tail(args.server, adminKey, args.token, args.json);
}
