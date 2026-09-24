import type { PrexyToServer, ServerToPrexy } from "../packages/protocol/mod.ts";
export interface GameModule {
    name: string;
    init(agent: PrexyAgent): void | Promise<void>;
}
export const PREXY_CONTROL_SOCKET = Symbol.for("prexy-control-socket");
const TAP_RESERVED_NAMES = new Set(["finding", "summary"]);
export interface PrexySocketLike {
    readonly readyState: number;
    send(data: string): void;
    close(): void;
    onopen: ((ev: Event) => void) | null;
    onmessage: ((ev: {
        data: string;
    }) => void) | null;
    onclose: ((ev: unknown) => void) | null;
    onerror: ((ev: unknown) => void) | null;
}
export type PrexyTransport = (url: string) => PrexySocketLike;
const defaultTransport: PrexyTransport = (url) => {
    const ws = new WebSocket(url);
    (ws as unknown as Record<symbol, boolean>)[PREXY_CONTROL_SOCKET] = true;
    const socket: PrexySocketLike = {
        get readyState() {
            return ws.readyState;
        },
        send: (data) => ws.send(data),
        close: () => ws.close(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
    };
    ws.onopen = (ev) => socket.onopen?.(ev);
    ws.onmessage = (ev) => socket.onmessage?.(ev);
    ws.onclose = (ev) => socket.onclose?.(ev);
    ws.onerror = (ev) => socket.onerror?.(ev);
    return socket;
};
export type PrexyEvaluator = (code: string) => unknown | Promise<unknown>;
const defaultEvaluator: PrexyEvaluator = (code) => (0, eval)(code);
export type PrexyModuleLoader = (url: string) => Promise<{
    default?: GameModule;
}>;
const defaultModuleLoader: PrexyModuleLoader = (url) => import(url);
export interface ConsoleLogEntry {
    key: string;
    kind: "console";
    level: "log" | "warn" | "error";
    args: unknown[];
    ts: number;
}
const CONSOLE_LOG_MAX = 400;
export interface PerfSnapshot {
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
    entrypoint: string | null;
    visibility: {
        state: DocumentVisibilityState;
        sinceMs: number;
    };
}
export class PrexyAgent {
    private ws: PrexySocketLike | null = null;
    private readonly serverUrl: string;
    private readonly token: string;
    private readonly game: string;
    private readonly transport: PrexyTransport;
    private readonly evaluator: PrexyEvaluator;
    private readonly moduleLoader: PrexyModuleLoader;
    private reconnectDelay = 1000;
    private activityKeySeq = 0;
    private readonly consoleLog: ConsoleLogEntry[] = [];
    private capturedLog: unknown[] | null = null;
    private longTaskCount = 0;
    private longTaskMs = 0;
    private longTaskSupported = false;
    private visibilityChangedAt = performance.now();
    private taps: (((name: string, data: unknown) => void) | null)[] = [];
    private notifyingTaps = false;
    private tapsDirty = false;
    constructor(opts: {
        serverUrl: string;
        token: string;
        game: string;
        transport?: PrexyTransport;
        evaluator?: PrexyEvaluator;
        moduleLoader?: PrexyModuleLoader;
    }) {
        this.serverUrl = opts.serverUrl.replace(/\/$/, "");
        this.token = opts.token;
        this.game = opts.game;
        this.transport = opts.transport ?? defaultTransport;
        this.evaluator = opts.evaluator ?? defaultEvaluator;
        this.moduleLoader = opts.moduleLoader ?? defaultModuleLoader;
        this.hookConsole();
        this.hookLongTasks();
        this.hookVisibility();
    }
    private hookVisibility(): void {
        document.addEventListener("visibilitychange", () => {
            this.visibilityChangedAt = performance.now();
        });
    }
    private hookConsole(): void {
        const native = window.console;
        (["log", "warn", "error"] as const).forEach((level) => {
            const orig = native[level].bind(native);
            native[level] = (...args: unknown[]) => {
                orig(...args);
                try {
                    this.console(level, args);
                }
                catch {
                }
            };
        });
    }
    private hookLongTasks(): void {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.longTaskCount++;
                    this.longTaskMs += entry.duration;
                }
            });
            observer.observe({ type: "longtask", buffered: true });
            this.longTaskSupported = true;
        }
        catch {
        }
    }
    connect(): Promise<void> {
        return new Promise((resolve) => {
            const wsUrl = `${this.serverUrl.replace(/^http/, "ws")}/ws/prexy/${this.token}`;
            const ws = this.transport(wsUrl);
            this.ws = ws;
            ws.onopen = () => {
                this.reconnectDelay = 1000;
                this.send({
                    type: "hello",
                    game: this.game,
                    url: location.href,
                    origin: location.origin,
                });
                this.reload().finally(resolve);
            };
            ws.onmessage = (event) => {
                let msg: ServerToPrexy;
                try {
                    msg = JSON.parse(event.data);
                }
                catch {
                    return;
                }
                this.handleCommand(msg);
            };
            ws.onclose = () => {
                this.ws = null;
                resolve();
                setTimeout(() => this.connect(), this.reconnectDelay);
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
            };
            ws.onerror = () => ws.close();
        });
    }
    private async handleCommand(msg: ServerToPrexy): Promise<void> {
        if (msg.type === "eval") {
            try {
                const value = await this.evaluator(msg.code);
                this.send({ type: "result", id: msg.id, ok: true, value });
            }
            catch (err) {
                this.send({
                    type: "result",
                    id: msg.id,
                    ok: false,
                    error: String(err),
                });
            }
            return;
        }
        if (msg.type === "load-module") {
            try {
                const value = await this.loadModule(msg.url);
                this.send({ type: "result", id: msg.id, ok: true, value });
            }
            catch (err) {
                this.send({
                    type: "result",
                    id: msg.id,
                    ok: false,
                    error: String(err),
                });
            }
        }
    }
    async loadModule(url: string): Promise<unknown> {
        const bust = url.includes("?") ? "&" : "?";
        const mod = await this.moduleLoader(`${url}${bust}t=${Date.now()}`);
        await mod.default?.init?.(this);
        return mod.default?.name ?? url;
    }
    async reload(): Promise<void> {
        try {
            await this.loadModule(`${this.serverUrl}/prexy/games/${encodeURIComponent(this.game)}.js`);
        }
        catch (err) {
            console.warn(`[prexy] failed to load game module "${this.game}"`, err);
        }
    }
    get connected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
    send(message: PrexyToServer): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
    console(level: "log" | "warn" | "error", args: unknown[]): void {
        this.send({ type: "console", level, args });
        this.consoleLog.unshift({ key: this.nextActivityKey(), kind: "console", level, args, ts: Date.now() });
        if (this.consoleLog.length > CONSOLE_LOG_MAX)
            this.consoleLog.length = CONSOLE_LOG_MAX;
    }
    event(name: string, data: unknown): void {
        this.send({ type: "event", name, data });
        this.notifyTaps(name, data);
    }
    tap(fn: (name: string, data: unknown) => void): () => void {
        this.taps.push(fn);
        let removed = false;
        return () => {
            if (removed)
                return;
            removed = true;
            const i = this.taps.indexOf(fn);
            if (i >= 0) {
                this.taps[i] = null;
                this.tapsDirty = true;
            }
            if (!this.notifyingTaps)
                this.compactTaps();
        };
    }
    private compactTaps(): void {
        if (!this.tapsDirty)
            return;
        this.taps = this.taps.filter((fn) => fn !== null);
        this.tapsDirty = false;
    }
    private notifyTaps(name: string, data: unknown): void {
        if (this.taps.length === 0)
            return;
        if (TAP_RESERVED_NAMES.has(name))
            return;
        this.notifyingTaps = true;
        try {
            for (let i = 0; i < this.taps.length; i++) {
                const fn = this.taps[i];
                if (fn === null)
                    continue;
                try {
                    fn(name, data);
                }
                catch {
                }
            }
        }
        finally {
            this.notifyingTaps = false;
            this.compactTaps();
        }
    }
    nextActivityKey(): string {
        return `k${this.activityKeySeq++}`;
    }
    getConsoleLog(): ConsoleLogEntry[] {
        return this.consoleLog;
    }
    registerCaptureLog(log: unknown[]): void {
        this.capturedLog = log;
    }
    getCaptureLog(): unknown[] {
        return this.capturedLog ?? [];
    }
    getPerfSnapshot(): PerfSnapshot {
        const mem = (performance as any).memory;
        const resourceEntries = performance.getEntriesByType("resource") as {
            transferSize?: number;
        }[];
        const scriptTag = Array.from(document.querySelectorAll("script[type='module'], script[src]")).find((el) => (el as HTMLScriptElement).src && new URL((el as HTMLScriptElement).src).origin === location.origin) as HTMLScriptElement | undefined;
        return {
            uptimeMs: performance.now(),
            memory: mem
                ? { usedJSHeapSize: mem.usedJSHeapSize, totalJSHeapSize: mem.totalJSHeapSize, jsHeapSizeLimit: mem.jsHeapSizeLimit }
                : null,
            longTasks: this.longTaskSupported ? { count: this.longTaskCount, totalMs: this.longTaskMs } : null,
            resources: {
                count: resourceEntries.length,
                totalBytes: resourceEntries.reduce((sum, e) => sum + (e.transferSize || 0), 0),
            },
            entrypoint: scriptTag?.src ?? null,
            visibility: { state: document.visibilityState, sinceMs: performance.now() - this.visibilityChangedAt },
        };
    }
}
