import { type GameModule, type PrexyAgent, PREXY_CONTROL_SOCKET } from "../core.ts";
const LIB_KEY = "libvidle";
const LOG_MAX = 400;
interface LogEntryHttp {
    key?: string;
    kind: "http";
    method: string;
    path: string;
    status: number;
    reqBody?: unknown;
    resBody?: unknown;
    error?: string;
    ts: number;
}
interface LogEntryWs {
    key?: string;
    kind: "ws";
    dir: "in" | "out" | "sys";
    type: string;
    payload: unknown;
    ts: number;
}
type LogEntry = LogEntryHttp | LogEntryWs;
interface Snapshot {
    savedAt: number;
    method: string;
    path: string;
    data: unknown;
}
interface Lib {
    version: number;
    snapshots: Record<string, Snapshot>;
}
function loadLib(): Lib {
    try {
        const raw = localStorage.getItem(LIB_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Object.assign({ version: 1, snapshots: {} }, parsed ?? {});
    }
    catch {
        return { version: 1, snapshots: {} };
    }
}
function saveLib(lib: Lib): void {
    try {
        localStorage.setItem(LIB_KEY, JSON.stringify(lib));
    }
    catch (err) {
        console.error("[vidle] failed to save libvidle", err);
    }
}
function saveSnapshot(name: string, method: string, path: string, data: unknown): void {
    const lib = loadLib();
    lib.snapshots ??= {};
    lib.snapshots[name] = { savedAt: Date.now(), method, path, data };
    saveLib(lib);
}
function deleteSnapshot(name: string): void {
    const lib = loadLib();
    delete lib.snapshots?.[name];
    saveLib(lib);
}
function listSnapshots(): Record<string, Snapshot> {
    return loadLib().snapshots ?? {};
}
function getAuthToken(): string {
    return sessionStorage.getItem("authToken") || localStorage.getItem("authToken") || "";
}
function nativeFetch(): typeof fetch {
    const current = window.fetch as typeof fetch & {
        __vidleOrig?: typeof fetch;
    };
    return current.__vidleOrig ?? current;
}
async function apiCall(method: string, path: string, body?: unknown) {
    const token = getAuthToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token)
        headers.Authorization = `Bearer ${token}`;
    const opts: RequestInit = { method, headers };
    if (body !== undefined && body !== "" && method !== "GET") {
        opts.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const fullPath = cleanPath.startsWith("/api") ? cleanPath : `/api${cleanPath}`;
    const res = await nativeFetch()(fullPath, opts);
    const text = await res.text();
    let data: unknown;
    try {
        data = JSON.parse(text);
    }
    catch {
        data = text;
    }
    return { status: res.status, ok: res.ok, path: fullPath, method, data };
}
const log: LogEntry[] = [];
let logPaused = false;
function pushLog(entry: LogEntry, agent: PrexyAgent): void {
    if (logPaused)
        return;
    entry.ts = Date.now();
    entry.key = agent.nextActivityKey();
    log.unshift(entry);
    if (log.length > LOG_MAX)
        log.length = LOG_MAX;
    agent.event(entry.kind, entry);
}
function messageType(parsed: unknown): string {
    if (parsed && typeof parsed === "object" && "type" in parsed) {
        return String((parsed as {
            type: unknown;
        }).type);
    }
    return "?";
}
function hookFetch(agent: PrexyAgent): void {
    const push = (entry: LogEntryHttp) => pushLog(entry, agent);
    const currentFetch = window.fetch as typeof fetch & {
        __vidleHooked?: boolean;
        __vidlePush?: typeof push;
    };
    if (currentFetch.__vidleHooked) {
        currentFetch.__vidlePush = push;
        return;
    }
    const orig = currentFetch.bind(window);
    const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = (init?.method ?? (input instanceof Request ? input.method : undefined) ?? "GET").toUpperCase();
        const promise = orig(input, init);
        if (url.indexOf("/api/") !== -1) {
            let reqBody: unknown;
            const rawBody = init?.body;
            if (typeof rawBody === "string") {
                try {
                    reqBody = JSON.parse(rawBody);
                }
                catch {
                    reqBody = rawBody;
                }
            }
            promise
                .then((res) => {
                res
                    .clone()
                    .text()
                    .then((text) => {
                    let data: unknown;
                    try {
                        data = JSON.parse(text);
                    }
                    catch {
                        data = text;
                    }
                    wrapped.__vidlePush?.({ kind: "http", method, path: url.replace(/^[^?]*\/api/, ""), status: res.status, reqBody, resBody: data, ts: 0 });
                })
                    .catch(() => { });
            })
                .catch((err) => {
                wrapped.__vidlePush?.({ kind: "http", method, path: url, status: 0, reqBody, error: String((err as Error)?.message ?? err), ts: 0 });
            });
        }
        return promise;
    }) as typeof fetch & {
        __vidleHooked?: boolean;
        __vidlePush?: typeof push;
        __vidleOrig?: typeof fetch;
    };
    wrapped.__vidleHooked = true;
    wrapped.__vidlePush = push;
    wrapped.__vidleOrig = orig;
    window.fetch = wrapped;
}
function hookWebSocket(agent: PrexyAgent): void {
    const push = (entry: LogEntryWs) => pushLog(entry, agent);
    const current = window.WebSocket as typeof WebSocket & {
        __vidleHooked?: boolean;
        __vidlePush?: typeof push;
    };
    if (current.__vidleHooked) {
        current.__vidlePush = push;
        return;
    }
    const NativeWS = current;
    type PatchedWS = {
        (this: unknown, url: string | URL, protocols?: string | string[]): WebSocket;
        prototype: WebSocket;
        __vidlePush?: typeof push;
    };
    const origSend = NativeWS.prototype.send;
    NativeWS.prototype.send = function (this: WebSocket, data: string) {
        if ((this as unknown as Record<symbol, boolean>)[PREXY_CONTROL_SOCKET]) {
            return origSend.call(this, data);
        }
        try {
            let parsed: unknown;
            try {
                parsed = JSON.parse(data);
            }
            catch {
                parsed = data;
            }
            (WrappedWS as PatchedWS).__vidlePush?.({ kind: "ws", dir: "out", type: messageType(parsed), payload: parsed, ts: 0 });
        }
        catch {
        }
        return origSend.call(this, data);
    };
    function WrappedWS(this: unknown, url: string | URL, protocols?: string | string[]): WebSocket {
        const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
        const isControlSocket = () => !!(ws as unknown as Record<symbol, boolean>)[PREXY_CONTROL_SOCKET];
        ws.addEventListener("message", (ev: MessageEvent) => {
            if (isControlSocket())
                return;
            let parsed: unknown;
            try {
                parsed = JSON.parse(ev.data);
            }
            catch {
                parsed = ev.data;
            }
            const type = messageType(parsed);
            if (type === "pong")
                return;
            (WrappedWS as PatchedWS).__vidlePush?.({ kind: "ws", dir: "in", type, payload: parsed, ts: 0 });
        });
        ws.addEventListener("close", (ev: CloseEvent) => {
            if (isControlSocket())
                return;
            (WrappedWS as PatchedWS).__vidlePush?.({ kind: "ws", dir: "sys", type: "close", payload: { code: ev.code, reason: ev.reason }, ts: 0 });
        });
        return ws;
    }
    WrappedWS.prototype = NativeWS.prototype;
    Object.assign(WrappedWS, {
        CONNECTING: NativeWS.CONNECTING,
        OPEN: NativeWS.OPEN,
        CLOSING: NativeWS.CLOSING,
        CLOSED: NativeWS.CLOSED,
        __vidleHooked: true,
        __vidlePush: push,
    });
    window.WebSocket = WrappedWS as unknown as typeof WebSocket;
}
export interface VidleApi {
    log: LogEntry[];
    apiCall: typeof apiCall;
    saveSnapshot: typeof saveSnapshot;
    deleteSnapshot: typeof deleteSnapshot;
    listSnapshots: typeof listSnapshots;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
}
const VIDLE_SCHEMA = {
    game: "vidle",
    version: 1,
    messages: [
        {
            match: { kind: "ws", type: "partyTick" },
            anchorWhen: { absent: "delta" },
            fields: {
                level: ["hp", "mana", "maxHp", "maxMana", "playerGold", "playerLevel", "playerXp", "lifetimeXp", "xpToNextLevel", "zerkCharge", "partySize", "tier", "attackSpeed"],
                event: ["xpGained", "xpFloat", "goldGained", "killThisTick", "killedEnemyName", "dmgToEnemy", "playerHit", "playerCrit", "enemyCrit", "leveledUp"],
                sporadic: ["killedChampion", "materialDrops", "imbueProc", "abilitiesFired", "autoSalvaged", "spiritShards"],
            },
            retention: "1h",
        },
        { match: { kind: "http" }, retention: "7d" },
    ],
    defaultRetention: "30d",
};
const vidleModule: GameModule = {
    name: "vidle",
    init(agent: PrexyAgent) {
        hookFetch(agent);
        hookWebSocket(agent);
        agent.registerCaptureLog(log);
        const api: VidleApi = {
            log,
            apiCall,
            saveSnapshot,
            deleteSnapshot,
            listSnapshots,
            pause: () => {
                logPaused = true;
            },
            resume: () => {
                logPaused = false;
            },
            isPaused: () => logPaused,
        };
        (window as unknown as {
            vidle: VidleApi;
        }).vidle = api;
        agent.event("game-schema", VIDLE_SCHEMA);
        agent.event("vidle-ready", { snapshots: Object.keys(listSnapshots()) });
    },
};
export default vidleModule;
