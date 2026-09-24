import { type GameModule, type PrexyAgent, PREXY_CONTROL_SOCKET } from "../core.ts";
import { createCaptureLog, hookNamedDispatch, hookWebSocketSend, readGlobal, type WsCaptureEntry } from "./lib/capture.ts";
import { discoverInScripts, type ScriptMatch } from "./lib/discover.ts";
const LIB_KEY = "libihs";
interface SavedActionRecipe {
    savedAt: number;
    type: string;
    payload?: unknown;
    note?: string;
}
interface Lib {
    version: number;
    actions: Record<string, SavedActionRecipe>;
}
function loadLib(): Lib {
    try {
        const raw = localStorage.getItem(LIB_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Object.assign({ version: 1, actions: {} }, parsed ?? {});
    }
    catch {
        return { version: 1, actions: {} };
    }
}
function saveLib(lib: Lib): void {
    try {
        localStorage.setItem(LIB_KEY, JSON.stringify(lib));
    }
    catch (err) {
        console.error("[ihs] failed to save libihs", err);
    }
}
function saveActionRecipe(name: string, type: string, payload?: unknown, note?: string): void {
    const lib = loadLib();
    lib.actions ??= {};
    lib.actions[name] = { savedAt: Date.now(), type, payload, note };
    saveLib(lib);
}
function deleteActionRecipe(name: string): void {
    const lib = loadLib();
    delete lib.actions?.[name];
    saveLib(lib);
}
function listActionRecipes(): Record<string, SavedActionRecipe> {
    return loadLib().actions ?? {};
}
const KNOWN_STATE_GLOBALS = ["currentPlayer", "hackingState", "combatLog", "equipmentData", "marketplaceState", "currentSyndicate", "recentLossStreaks", "homelabInfo"] as const;
function getState(name?: string): unknown {
    if (name)
        return readGlobal(name);
    const out: Record<string, unknown> = {};
    for (const key of KNOWN_STATE_GLOBALS)
        out[key] = readGlobal(key);
    return out;
}
function discoverActionTypes(): Promise<ScriptMatch[]> {
    return discoverInScripts(/type\s*:\s*["']([A-Z][A-Z0-9_]*)["']/, { filter: (url) => url.includes("/static/js/") });
}
function sendAction(type: string, payload?: unknown): boolean {
    const socket = readGlobal<WebSocket>("ws");
    if (!socket || socket.readyState !== WebSocket.OPEN)
        return false;
    socket.send(JSON.stringify(payload === undefined ? { type } : { type, payload }));
    return true;
}
function runActionRecipe(name: string, overridePayload?: unknown): boolean {
    const recipe = loadLib().actions?.[name];
    if (!recipe)
        return false;
    return sendAction(recipe.type, overridePayload !== undefined ? overridePayload : recipe.payload);
}
export interface SendActionResult {
    sent: boolean;
    newEntries: WsCaptureEntry[];
}
export interface IhsApi {
    log: WsCaptureEntry[];
    sendAction: typeof sendAction;
    sendActionAndWait: (type: string, payload?: unknown, timeoutMs?: number) => Promise<SendActionResult>;
    getState: typeof getState;
    discoverActionTypes: typeof discoverActionTypes;
    saveActionRecipe: typeof saveActionRecipe;
    deleteActionRecipe: typeof deleteActionRecipe;
    listActionRecipes: typeof listActionRecipes;
    runActionRecipe: typeof runActionRecipe;
    actions: Record<string, (payload?: unknown) => Promise<SendActionResult>>;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
}
function buildActionWrappers(sendActionAndWait: (type: string, payload?: unknown, timeoutMs?: number) => Promise<SendActionResult>): Record<string, (payload?: unknown) => Promise<SendActionResult>> {
    const wrappers: Record<string, (payload?: unknown) => Promise<SendActionResult>> = {};
    for (const [name, recipe] of Object.entries(listActionRecipes())) {
        wrappers[name] = (payload) => sendActionAndWait(recipe.type, payload !== undefined ? payload : recipe.payload);
    }
    return wrappers;
}
function registerRecipesWithPrexycp(): void {
    const prexycp = (window as unknown as {
        __prexycp?: {
            updateCapability(defJson: string, adapterJson: string): string;
        };
    }).__prexycp;
    if (!prexycp)
        return;
    for (const [name, recipe] of Object.entries(listActionRecipes())) {
        prexycp.updateCapability(JSON.stringify({
            name: `ihs.${name}`,
            description: recipe.note ?? `ihs action: ${recipe.type}`,
            inputSchema: { type: "object" },
        }), JSON.stringify({ kind: "declarative", js_ref: `ihs.actions.${name}`, args_mapping: ["payload"] }));
    }
}
const ihsModule: GameModule = {
    name: "ihs",
    init(agent: PrexyAgent) {
        const capture = createCaptureLog<WsCaptureEntry>(agent);
        agent.registerCaptureLog(capture.log);
        const isControlSocket = (ws: WebSocket) => !!(ws as unknown as Record<symbol, boolean>)[PREXY_CONTROL_SOCKET];
        hookWebSocketSend(capture.push, { isControlSocket });
        hookNamedDispatch("handleMessage", capture.push);
        function sendActionAndWait(type: string, payload?: unknown, timeoutMs = 2000): Promise<SendActionResult> {
            const beforeTs = capture.log[0]?.ts ?? 0;
            const sent = sendAction(type, payload);
            if (!sent)
                return Promise.resolve({ sent: false, newEntries: [] });
            return new Promise((resolve) => {
                setTimeout(() => {
                    const newEntries = capture.log.filter((e) => e.ts > beforeTs).reverse();
                    resolve({ sent: true, newEntries });
                }, timeoutMs);
            });
        }
        const api: IhsApi = {
            log: capture.log,
            sendAction,
            sendActionAndWait,
            getState,
            discoverActionTypes,
            saveActionRecipe,
            deleteActionRecipe,
            listActionRecipes,
            runActionRecipe,
            actions: buildActionWrappers(sendActionAndWait),
            pause: capture.pause,
            resume: capture.resume,
            isPaused: capture.isPaused,
        };
        (window as unknown as {
            ihs: IhsApi;
        }).ihs = api;
        registerRecipesWithPrexycp();
        agent.event("ihs-ready", {});
    },
};
export default ihsModule;
