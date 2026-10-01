import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FieldIdentity } from "./format/store";
import type { Recipe } from "./format/recipe";
export interface WorkbenchInput {
    value: unknown;
    identity: FieldIdentity | null;
    label: string;
    recipe?: Recipe;
}
import type { CreateTrigger, ServerToViewer, SessionMeta, Trigger } from "./protocol";
import type { WatchDef } from "./watch";
import type { FoldedState } from "./state";
export interface LogEntry {
    key: string;
    ts: number;
    msg: ServerToViewer;
}
export interface StoredTrigger extends CreateTrigger {
    savedId: string;
}
export function triggerContentEquals(a: CreateTrigger, b: CreateTrigger): boolean {
    if (a.match !== b.match)
        return false;
    if ((a.filter ?? "") !== (b.filter ?? ""))
        return false;
    if ((a.rateLimitMs ?? null) !== (b.rateLimitMs ?? null))
        return false;
    if (a.action.type !== b.action.type)
        return false;
    if (a.action.type === "webhook" && b.action.type === "webhook")
        return a.action.url === b.action.url;
    if (a.action.type === "eval" && b.action.type === "eval")
        return a.action.code === b.action.code;
    return false;
}
export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";
interface AppState {
    serverUrl: string;
    adminKey: string;
    setServerUrl(url: string): void;
    setAdminKey(key: string): void;
    sessions: SessionMeta[];
    sessionsError: string | null;
    refreshSessions(): Promise<void>;
    activeToken: string | null;
    viewerId: string | null;
    prexyOnline: boolean;
    prexyMeta: SessionMeta | null;
    connectionState: ConnectionState;
    entries: LogEntry[];
    connect(token: string): void;
    disconnect(): void;
    sendEval(code: string): void;
    evalSilent(code: string): Promise<{
        ok: true;
        value: unknown;
    } | {
        ok: false;
        error: string;
    }>;
    stateCursor: number | null;
    stateAtCursor: FoldedState | null;
    stateLoading: boolean;
    stateError: string | null;
    setStateCursor(ts: number | null): void;
    triggers: Trigger[];
    triggersLoaded: boolean;
    triggersError: string | null;
    refreshTriggers(): Promise<void>;
    createTrigger(input: CreateTrigger): Promise<{
        ok: boolean;
        error?: string;
    }>;
    deleteTrigger(id: string): Promise<void>;
    updateTrigger(id: string, input: CreateTrigger): Promise<{
        ok: boolean;
        error?: string;
    }>;
    savedTriggers: Record<string, StoredTrigger[]>;
    restoreSavedTrigger(saved: StoredTrigger): Promise<{
        ok: boolean;
        error?: string;
    }>;
    dbgModuleCode: string;
    setDbgModuleCode(code: string): void;
    dbgModuleAutoLoad: boolean;
    setDbgModuleAutoLoad(v: boolean): void;
    loadPastedModule(): void;
    triggerDraft: Partial<CreateTrigger> | null;
    setTriggerDraft(draft: Partial<CreateTrigger> | null): void;
    workbenchInput: WorkbenchInput | null;
    setWorkbenchInput(input: WorkbenchInput | null): void;
    watches: WatchDef[];
    addWatch(groupKey: string, path: string): void;
    removeWatch(id: string): void;
    watchDraft: {
        groupKey: string;
    } | null;
    setWatchDraft(draft: {
        groupKey: string;
    } | null): void;
}
const MAX_ENTRIES = 500;
let socket: WebSocket | null = null;
let entrySeq = 0;
function trimBase(url: string): string {
    return url.replace(/\/+$/, "");
}
function buildLoadModuleEval(code: string): string {
    return `(async () => {
    const code = ${JSON.stringify(code)};
    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const mod = await import(url);
    await mod.default?.init?.(window.__prexy);
    return mod.default?.name ?? "(pasted module)";
  })()`;
}
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
export const useStore = create<AppState>()(persist((set, get) => {
    function openViewerSocket(token: string): void {
        set({ connectionState: "connecting" });
        const wsBase = trimBase(get().serverUrl).replace(/^http/, "ws");
        const ws = new WebSocket(`${wsBase}/ws/view/${token}?key=${encodeURIComponent(get().adminKey)}`);
        socket = ws;
        ws.onopen = () => {
            if (socket !== ws)
                return;
            reconnectDelay = 1000;
            set({ connectionState: "open" });
        };
        ws.onclose = () => {
            if (socket !== ws)
                return;
            set({ connectionState: "closed" });
            reconnectTimer = setTimeout(() => openViewerSocket(token), reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 15000);
        };
        ws.onerror = () => {
            if (socket !== ws)
                return;
            set({ connectionState: "error" });
        };
        ws.onmessage = (event) => {
            if (socket !== ws)
                return;
            let msg: ServerToViewer;
            try {
                msg = JSON.parse(event.data);
            }
            catch {
                return;
            }
            set((state) => {
                const entries = [...state.entries, { key: `e${entrySeq++}`, ts: Date.now(), msg }];
                if (entries.length > MAX_ENTRIES)
                    entries.splice(0, entries.length - MAX_ENTRIES);
                if (msg.type === "viewer-welcome")
                    return { ...state, entries, viewerId: msg.viewerId };
                if (msg.type === "prexy-connected") {
                    return { ...state, entries, prexyOnline: true, prexyMeta: msg.meta };
                }
                if (msg.type === "prexy-disconnected") {
                    return { ...state, entries, prexyOnline: false, prexyMeta: msg.meta };
                }
                return { ...state, entries };
            });
            if (msg.type === "trigger-changed")
                void get().refreshTriggers();
            if (msg.type === "prexy-connected") {
                const { dbgModuleAutoLoad, dbgModuleCode, sendEval: send } = get();
                if (dbgModuleAutoLoad && dbgModuleCode.trim())
                    send(buildLoadModuleEval(dbgModuleCode));
            }
        };
    }
    return {
        serverUrl: "http://localhost:8000",
        adminKey: "",
        setServerUrl: (serverUrl) => set({ serverUrl }),
        setAdminKey: (adminKey) => set({ adminKey }),
        sessions: [],
        sessionsError: null,
        async refreshSessions() {
            try {
                const res = await fetch(`${trimBase(get().serverUrl)}/api/sessions`, {
                    headers: { Authorization: `Bearer ${get().adminKey}` },
                });
                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                set({ sessions: data.sessions ?? [], sessionsError: null });
            }
            catch (err) {
                set({ sessionsError: String(err) });
            }
        },
        activeToken: null,
        viewerId: null,
        prexyOnline: false,
        prexyMeta: null,
        connectionState: "idle",
        entries: [],
        connect(token) {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            reconnectDelay = 1000;
            socket?.close();
            socket = null;
            set({
                activeToken: token,
                entries: [],
                prexyOnline: false,
                prexyMeta: null,
                viewerId: null,
                triggers: [],
                triggersLoaded: false,
                triggersError: null,
            });
            openViewerSocket(token);
            void get().refreshTriggers();
        },
        disconnect() {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            socket?.close();
            socket = null;
            set({ connectionState: "idle", activeToken: null, prexyOnline: false, prexyMeta: null, viewerId: null });
        },
        sendEval(code) {
            if (socket && socket.readyState === WebSocket.OPEN) {
                const command: import("./protocol").ViewerToServer = { type: "eval", code };
                socket.send(JSON.stringify(command));
            }
        },
        async evalSilent(code) {
            const token = get().activeToken;
            if (!token)
                return { ok: false, error: "no active session" };
            try {
                const res = await fetch(`${trimBase(get().serverUrl)}/api/sessions/${token}/command`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${get().adminKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ code, silent: true }),
                });
                const data = await res.json();
                if (!res.ok)
                    return { ok: false, error: data.error ?? `HTTP ${res.status}` };
                return data;
            }
            catch (err) {
                return { ok: false, error: String(err) };
            }
        },
        stateCursor: null,
        stateAtCursor: null,
        stateLoading: false,
        stateError: null,
        setStateCursor(ts) {
            set({ stateCursor: ts, stateLoading: true, stateError: null });
            const token = get().activeToken;
            if (!token) {
                set({ stateLoading: false, stateAtCursor: null });
                return;
            }
            const at = ts ?? Date.now();
            fetch(`${trimBase(get().serverUrl)}/api/sessions/${token}/state?at=${at}`, {
                headers: { Authorization: `Bearer ${get().adminKey}` },
            })
                .then((res) => res.json())
                .then((data) => {
                if (!data.ok)
                    throw new Error(data.error ?? "failed");
                if (get().stateCursor !== ts)
                    return;
                set({ stateAtCursor: data.state, stateLoading: false, stateError: null });
            })
                .catch((err) => {
                if (get().stateCursor !== ts)
                    return;
                set({ stateError: String(err), stateLoading: false, stateAtCursor: null });
            });
        },
        triggers: [],
        triggersLoaded: false,
        triggersError: null,
        async refreshTriggers() {
            const token = get().activeToken;
            if (!token)
                return;
            try {
                const res = await fetch(`${trimBase(get().serverUrl)}/api/sessions/${token}/triggers`, {
                    headers: { Authorization: `Bearer ${get().adminKey}` },
                });
                const data = await res.json();
                if (!res.ok || !data.ok)
                    throw new Error(data.error ?? `HTTP ${res.status}`);
                set({ triggers: data.triggers ?? [], triggersLoaded: true, triggersError: null });
            }
            catch (err) {
                set({ triggersError: String(err) });
            }
        },
        async createTrigger(input) {
            const token = get().activeToken;
            if (!token)
                return { ok: false, error: "no active session" };
            if (get().triggers.some((t) => triggerContentEquals(t, input))) {
                return { ok: true };
            }
            try {
                const res = await fetch(`${trimBase(get().serverUrl)}/api/sessions/${token}/triggers`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${get().adminKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify(input),
                });
                const data = await res.json();
                if (!res.ok || !data.ok)
                    return { ok: false, error: data.error ?? `HTTP ${res.status}` };
                set((state) => {
                    const existing = state.savedTriggers[token] ?? [];
                    if (existing.some((t) => triggerContentEquals(t, input)))
                        return state;
                    const saved: StoredTrigger = { ...input, savedId: crypto.randomUUID() };
                    return { savedTriggers: { ...state.savedTriggers, [token]: [...existing, saved] } };
                });
                await get().refreshTriggers();
                return { ok: true };
            }
            catch (err) {
                return { ok: false, error: String(err) };
            }
        },
        async deleteTrigger(id) {
            const token = get().activeToken;
            if (!token)
                return;
            const live = get().triggers.find((t) => t.id === id);
            try {
                await fetch(`${trimBase(get().serverUrl)}/api/sessions/${token}/triggers/${id}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${get().adminKey}` },
                });
            }
            catch {
            }
            if (live) {
                set((state) => ({
                    savedTriggers: {
                        ...state.savedTriggers,
                        [token]: (state.savedTriggers[token] ?? []).filter((t) => !triggerContentEquals(t, live)),
                    },
                }));
            }
            await get().refreshTriggers();
        },
        async updateTrigger(id, input) {
            const token = get().activeToken;
            if (!token)
                return { ok: false, error: "no active session" };
            const before = get().triggers.find((t) => t.id === id);
            try {
                const res = await fetch(`${trimBase(get().serverUrl)}/api/sessions/${token}/triggers/${id}`, {
                    method: "PATCH",
                    headers: { Authorization: `Bearer ${get().adminKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ ...input, filter: input.filter ?? "", rateLimitMs: input.rateLimitMs ?? null }),
                });
                const data = await res.json();
                if (!res.ok || !data.ok)
                    return { ok: false, error: data.error ?? `HTTP ${res.status}` };
                if (before) {
                    set((state) => ({
                        savedTriggers: {
                            ...state.savedTriggers,
                            [token]: (state.savedTriggers[token] ?? []).map((t) => triggerContentEquals(t, before) ? { ...input, savedId: t.savedId } : t),
                        },
                    }));
                }
                await get().refreshTriggers();
                return { ok: true };
            }
            catch (err) {
                return { ok: false, error: String(err) };
            }
        },
        savedTriggers: {},
        restoreSavedTrigger(saved) {
            const { savedId: _savedId, ...input } = saved;
            return get().createTrigger(input);
        },
        dbgModuleCode: "",
        setDbgModuleCode: (dbgModuleCode) => set({ dbgModuleCode }),
        dbgModuleAutoLoad: false,
        setDbgModuleAutoLoad: (dbgModuleAutoLoad) => set({ dbgModuleAutoLoad }),
        loadPastedModule() {
            const code = get().dbgModuleCode;
            if (!code.trim())
                return;
            get().sendEval(buildLoadModuleEval(code));
        },
        triggerDraft: null,
        setTriggerDraft: (draft) => set({ triggerDraft: draft }),
        workbenchInput: null,
        setWorkbenchInput: (input) => set({ workbenchInput: input }),
        watches: [],
        addWatch(groupKey, path) {
            const watch: WatchDef = { id: crypto.randomUUID(), groupKey, path };
            set((state) => ({ watches: [...state.watches, watch] }));
        },
        removeWatch(id) {
            set((state) => ({ watches: state.watches.filter((w) => w.id !== id) }));
        },
        watchDraft: null,
        setWatchDraft: (draft) => set({ watchDraft: draft }),
    };
}, {
    name: "prex-ui-settings",
    partialize: (state) => ({
        serverUrl: state.serverUrl,
        adminKey: state.adminKey,
        watches: state.watches,
        savedTriggers: state.savedTriggers,
        dbgModuleCode: state.dbgModuleCode,
        dbgModuleAutoLoad: state.dbgModuleAutoLoad,
    }),
}));
