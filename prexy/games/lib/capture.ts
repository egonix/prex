import type { PrexyAgent } from "../../core.ts";
export interface CaptureLogEntry {
    key?: string;
    kind: string;
    ts: number;
    [key: string]: unknown;
}
export interface CaptureLog<T extends CaptureLogEntry = CaptureLogEntry> {
    log: T[];
    push(entry: T): void;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
}
export function createCaptureLog<T extends CaptureLogEntry = CaptureLogEntry>(agent: PrexyAgent, max = 400): CaptureLog<T> {
    const log: T[] = [];
    let paused = false;
    function push(entry: T): void {
        if (paused)
            return;
        if (!entry.ts)
            entry.ts = Date.now();
        entry.key = agent.nextActivityKey();
        log.unshift(entry);
        if (log.length > max)
            log.length = max;
        agent.event(entry.kind, entry);
    }
    return {
        log,
        push,
        pause: () => {
            paused = true;
        },
        resume: () => {
            paused = false;
        },
        isPaused: () => paused,
    };
}
export function messageType(parsed: unknown): string {
    if (parsed && typeof parsed === "object") {
        const o = parsed as Record<string, unknown>;
        if ("type" in o && (typeof o.type === "string" || typeof o.type === "number"))
            return String(o.type);
        if ("event" in o && (typeof o.event === "string" || typeof o.event === "number"))
            return String(o.event);
    }
    return "?";
}
export function readGlobal<T = unknown>(name: string): T | undefined {
    try {
        return new Function(`return typeof ${name} !== "undefined" ? ${name} : undefined;`)() as T | undefined;
    }
    catch {
        return undefined;
    }
}
export interface HttpCaptureEntry extends CaptureLogEntry {
    kind: "http";
    method: string;
    url: string;
    status: number;
    reqBody?: unknown;
    resBody?: unknown;
    error?: string;
}
export function hookFetch(push: (entry: HttpCaptureEntry | SseCaptureEntry) => void, opts: {
    filter?: (url: string, method: string) => boolean;
} = {}): void {
    const currentFetch = window.fetch as typeof fetch & {
        __prexFetchHooked?: boolean;
        __prexFetchPush?: typeof push;
    };
    if (currentFetch.__prexFetchHooked) {
        currentFetch.__prexFetchPush = push;
        return;
    }
    const orig = currentFetch.bind(window);
    const filter = opts.filter ?? (() => true);
    const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = (init?.method ?? (input instanceof Request ? input.method : undefined) ?? "GET").toUpperCase();
        const promise = orig(input, init);
        if (filter(url, method)) {
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
                if (isEventStream(res.headers.get("content-type"))) {
                    wrapped.__prexFetchPush?.({ kind: "http", method, url, status: res.status, reqBody, resBody: EVENT_STREAM_BODY, ts: 0 });
                    readEventStream(res.clone().body, url, (entry) => wrapped.__prexFetchPush?.(entry));
                    return;
                }
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
                    wrapped.__prexFetchPush?.({ kind: "http", method, url, status: res.status, reqBody, resBody: data, ts: 0 });
                })
                    .catch(() => { });
            })
                .catch((err) => {
                wrapped.__prexFetchPush?.({ kind: "http", method, url, status: 0, reqBody, error: String((err as Error)?.message ?? err), ts: 0 });
            });
        }
        return promise;
    }) as typeof fetch & {
        __prexFetchHooked?: boolean;
        __prexFetchPush?: typeof push;
        __prexOrigFetch?: typeof fetch;
    };
    wrapped.__prexFetchHooked = true;
    wrapped.__prexFetchPush = push;
    wrapped.__prexOrigFetch = orig;
    window.fetch = wrapped;
}
export function nativeFetch(): typeof fetch {
    const current = window.fetch as typeof fetch & {
        __prexOrigFetch?: typeof fetch;
    };
    return current.__prexOrigFetch ?? current;
}
export interface WsCaptureEntry extends CaptureLogEntry {
    kind: "ws";
    dir: "in" | "out" | "sys";
    type: string;
    payload: unknown;
}
export function hookWebSocketSend(push: (entry: WsCaptureEntry) => void, opts: {
    isControlSocket?: (ws: WebSocket) => boolean;
} = {}): void {
    const NativeWS = window.WebSocket as typeof WebSocket & {
        __prexWsSendHooked?: boolean;
        __prexWsSendPush?: typeof push;
    };
    if (NativeWS.__prexWsSendHooked) {
        NativeWS.__prexWsSendPush = push;
        return;
    }
    const isControlSocket = opts.isControlSocket ?? (() => false);
    const origSend = NativeWS.prototype.send;
    NativeWS.prototype.send = function (this: WebSocket, data: string) {
        if (isControlSocket(this))
            return origSend.call(this, data);
        try {
            let parsed: unknown;
            try {
                parsed = JSON.parse(data);
            }
            catch {
                parsed = data;
            }
            NativeWS.__prexWsSendPush?.({ kind: "ws", dir: "out", type: messageType(parsed), payload: parsed, ts: 0 });
        }
        catch {
        }
        return origSend.call(this, data);
    };
    NativeWS.__prexWsSendHooked = true;
    NativeWS.__prexWsSendPush = push;
}
export function hookWebSocketFull(push: (entry: WsCaptureEntry) => void, opts: {
    isControlSocket?: (ws: WebSocket) => boolean;
} = {}): void {
    const current = window.WebSocket as typeof WebSocket & {
        __prexWsFullHooked?: boolean;
        __prexWsFullPush?: typeof push;
    };
    if (current.__prexWsFullHooked) {
        current.__prexWsFullPush = push;
        return;
    }
    const NativeWS = current;
    const isControlSocket = opts.isControlSocket ?? (() => false);
    const preCoversIncoming = prehook()?.wrapsWebSocket === true;
    type PatchedWS = {
        (this: unknown, url: string | URL, protocols?: string | string[]): WebSocket;
        prototype: WebSocket;
        __prexWsFullPush?: typeof push;
    };
    const origSend = NativeWS.prototype.send;
    NativeWS.prototype.send = function (this: WebSocket, data: string) {
        if (isControlSocket(this))
            return origSend.call(this, data);
        try {
            let parsed: unknown;
            try {
                parsed = JSON.parse(data);
            }
            catch {
                parsed = data;
            }
            (WrappedWS as PatchedWS).__prexWsFullPush?.({ kind: "ws", dir: "out", type: messageType(parsed), payload: parsed, ts: 0 });
        }
        catch {
        }
        return origSend.call(this, data);
    };
    function WrappedWS(this: unknown, url: string | URL, protocols?: string | string[]): WebSocket {
        const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
        ws.addEventListener("message", (ev: MessageEvent) => {
            if (isControlSocket(ws))
                return;
            let parsed: unknown;
            try {
                parsed = JSON.parse(ev.data);
            }
            catch {
                parsed = ev.data;
            }
            (WrappedWS as PatchedWS).__prexWsFullPush?.({ kind: "ws", dir: "in", type: messageType(parsed), payload: parsed, ts: 0 });
        });
        ws.addEventListener("close", (ev: CloseEvent) => {
            if (isControlSocket(ws))
                return;
            (WrappedWS as PatchedWS).__prexWsFullPush?.({ kind: "ws", dir: "sys", type: "close", payload: { code: ev.code, reason: ev.reason }, ts: 0 });
        });
        return ws;
    }
    WrappedWS.prototype = NativeWS.prototype;
    Object.assign(WrappedWS, {
        CONNECTING: NativeWS.CONNECTING,
        OPEN: NativeWS.OPEN,
        CLOSING: NativeWS.CLOSING,
        CLOSED: NativeWS.CLOSED,
        __prexWsFullHooked: true,
        __prexWsFullPush: push,
    });
    if (!preCoversIncoming)
        window.WebSocket = WrappedWS as unknown as typeof WebSocket;
}
export function hookXHR(push: (entry: HttpCaptureEntry | SseCaptureEntry) => void, opts: {
    filter?: (url: string, method: string) => boolean;
} = {}): void {
    const Native = window.XMLHttpRequest as typeof XMLHttpRequest & {
        __prexXhrHooked?: boolean;
        __prexXhrPush?: typeof push;
    };
    if (Native.__prexXhrHooked) {
        Native.__prexXhrPush = push;
        return;
    }
    const filter = opts.filter ?? (() => true);
    const META = Symbol.for("prex-xhr-meta");
    type Meta = {
        method: string;
        url: string;
        reqBody?: unknown;
    };
    const origOpen = Native.prototype.open;
    const origSend = Native.prototype.send;
    Native.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
        try {
            (this as unknown as Record<symbol, Meta>)[META] = { method: String(method ?? "GET").toUpperCase(), url: String(url) };
        }
        catch {
        }
        return (origOpen as any).call(this, method, url, ...rest);
    };
    Native.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        try {
            const meta = (this as unknown as Record<symbol, Meta>)[META];
            if (meta && filter(meta.url, meta.method)) {
                if (typeof body === "string") {
                    try {
                        meta.reqBody = JSON.parse(body);
                    }
                    catch {
                        meta.reqBody = body;
                    }
                }
                let stream: {
                    feed: (text: string) => void;
                    events: () => number;
                } | null = null;
                let seen = 0;
                const feedNew = () => {
                    const text = this.responseText;
                    stream?.feed(text.slice(seen));
                    seen = text.length;
                };
                this.addEventListener("readystatechange", () => {
                    try {
                        if (stream || this.readyState !== this.HEADERS_RECEIVED)
                            return;
                        if (this.responseType !== "" && this.responseType !== "text")
                            return;
                        if (!isEventStream(this.getResponseHeader("content-type")))
                            return;
                        stream = sseFeeder(meta.url, (entry) => Native.__prexXhrPush?.(entry));
                        Native.__prexXhrPush?.({
                            kind: "http",
                            method: meta.method,
                            url: meta.url,
                            status: this.status,
                            reqBody: meta.reqBody,
                            resBody: EVENT_STREAM_BODY,
                            ts: 0,
                        });
                    }
                    catch {
                    }
                });
                this.addEventListener("progress", () => {
                    try {
                        if (stream)
                            feedNew();
                    }
                    catch {
                    }
                });
                this.addEventListener("loadend", () => {
                    try {
                        if (stream) {
                            feedNew();
                            const aborted = this.status === 0;
                            Native.__prexXhrPush?.({
                                kind: "sse",
                                dir: "sys",
                                type: aborted ? "error" : "close",
                                url: meta.url,
                                payload: aborted ? { events: stream.events(), error: "network error or aborted" } : { events: stream.events() },
                                ts: 0,
                            });
                            return;
                        }
                        let data: unknown;
                        if (this.responseType === "" || this.responseType === "text") {
                            try {
                                data = JSON.parse(this.responseText);
                            }
                            catch {
                                data = this.responseText;
                            }
                        }
                        else if (this.responseType === "json") {
                            data = this.response;
                        }
                        else {
                            data = `[${this.responseType}]`;
                        }
                        const entry: HttpCaptureEntry = {
                            kind: "http",
                            method: meta.method,
                            url: meta.url,
                            status: this.status,
                            reqBody: meta.reqBody,
                            resBody: data,
                            ts: 0,
                        };
                        if (this.status === 0)
                            entry.error = "network error or aborted";
                        Native.__prexXhrPush?.(entry);
                    }
                    catch {
                    }
                });
            }
        }
        catch {
        }
        return origSend.call(this, body as XMLHttpRequestBodyInit | null);
    };
    Native.__prexXhrHooked = true;
    Native.__prexXhrPush = push;
}
export interface SseCaptureEntry extends CaptureLogEntry {
    kind: "sse";
    dir: "in" | "sys";
    type: string;
    url: string;
    payload: unknown;
}
export function hookEventSource(push: (entry: SseCaptureEntry) => void): void {
    const current = window.EventSource as (typeof EventSource & {
        __prexSseHooked?: boolean;
        __prexSsePush?: typeof push;
    }) | undefined;
    if (!current)
        return;
    if (prehook()?.wrapsEventSource === true)
        return;
    if (current.__prexSseHooked) {
        current.__prexSsePush = push;
        return;
    }
    const NativeES = current;
    type PatchedES = {
        (this: unknown, url: string | URL, init?: EventSourceInit): EventSource;
        prototype: EventSource;
        __prexSsePush?: typeof push;
    };
    function WrappedES(this: unknown, url: string | URL, init?: EventSourceInit): EventSource {
        const es = init !== undefined ? new NativeES(url, init) : new NativeES(url);
        const href = String(url);
        const report = (type: string, raw: unknown, dir: "in" | "sys" = "in") => {
            let parsed: unknown = raw;
            if (typeof raw === "string") {
                try {
                    parsed = JSON.parse(raw);
                }
                catch {
                    parsed = raw;
                }
            }
            (WrappedES as PatchedES).__prexSsePush?.({ kind: "sse", dir, type, url: href, payload: parsed, ts: 0 });
        };
        es.addEventListener("message", (ev: MessageEvent) => report("message", ev.data));
        es.addEventListener("error", () => report("error", { readyState: es.readyState }, "sys"));
        const origAdd = es.addEventListener.bind(es);
        (es as any).addEventListener = function (type: string, listener: any, options?: any) {
            if (type !== "message" && type !== "error" && type !== "open") {
                origAdd(type, ((ev: MessageEvent) => report(type, ev.data)) as EventListener);
            }
            return origAdd(type, listener, options);
        };
        return es;
    }
    WrappedES.prototype = NativeES.prototype;
    Object.assign(WrappedES, {
        CONNECTING: NativeES.CONNECTING,
        OPEN: NativeES.OPEN,
        CLOSED: NativeES.CLOSED,
        __prexSseHooked: true,
        __prexSsePush: push,
    });
    window.EventSource = WrappedES as unknown as typeof EventSource;
}
const EVENT_STREAM_BODY = "[text/event-stream]";
function isEventStream(contentType: string | null): boolean {
    return contentType?.split(";")[0].trim().toLowerCase() === "text/event-stream";
}
export interface SseEvent {
    type: string;
    data: string;
}
export function createSseParser(onEvent: (ev: SseEvent) => void): (text: string) => void {
    let pending = "";
    let afterCr = false;
    let type = "";
    let data: string[] | null = null;
    const line = (l: string) => {
        if (l === "") {
            if (data)
                onEvent({ type: type || "message", data: data.join("\n") });
            type = "";
            data = null;
            return;
        }
        if (l[0] === ":")
            return;
        const colon = l.indexOf(":");
        const field = colon === -1 ? l : l.slice(0, colon);
        let value = colon === -1 ? "" : l.slice(colon + 1);
        if (value[0] === " ")
            value = value.slice(1);
        if (field === "event")
            type = value;
        else if (field === "data")
            (data ??= []).push(value);
    };
    return (text: string) => {
        if (text === "")
            return;
        if (afterCr && text[0] === "\n")
            text = text.slice(1);
        afterCr = false;
        const from = pending.length;
        pending += text;
        let start = 0;
        for (let i = from; i < pending.length; i++) {
            const c = pending[i];
            if (c !== "\n" && c !== "\r")
                continue;
            line(pending.slice(start, i));
            if (c === "\r") {
                if (i + 1 === pending.length)
                    afterCr = true;
                else if (pending[i + 1] === "\n")
                    i++;
            }
            start = i + 1;
        }
        pending = pending.slice(start);
    };
}
function sseFeeder(url: string, push: (entry: SseCaptureEntry) => void): {
    feed: (text: string) => void;
    events: () => number;
} {
    let events = 0;
    const feed = createSseParser((ev) => {
        events++;
        let payload: unknown;
        try {
            payload = JSON.parse(ev.data);
        }
        catch {
            payload = ev.data;
        }
        push({ kind: "sse", dir: "in", type: ev.type, url, payload, ts: 0 });
    });
    return { feed, events: () => events };
}
async function readEventStream(body: ReadableStream<Uint8Array> | null, url: string, push: (entry: SseCaptureEntry) => void): Promise<void> {
    if (!body)
        return;
    const stream = sseFeeder(url, push);
    const decoder = new TextDecoder();
    try {
        const reader = body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            stream.feed(decoder.decode(value, { stream: true }));
        }
        stream.feed(decoder.decode());
        push({ kind: "sse", dir: "sys", type: "close", url, payload: { events: stream.events() }, ts: 0 });
    }
    catch (err) {
        push({ kind: "sse", dir: "sys", type: "error", url, payload: { events: stream.events(), error: String((err as Error)?.message ?? err) }, ts: 0 });
    }
}
export interface BeaconCaptureEntry extends CaptureLogEntry {
    kind: "beacon";
    method: "POST";
    url: string;
    reqBody?: unknown;
}
export function hookSendBeacon(push: (entry: BeaconCaptureEntry) => void): void {
    const nav = navigator as Navigator & {
        __prexBeaconHooked?: boolean;
        __prexBeaconPush?: typeof push;
    };
    if (nav.__prexBeaconHooked) {
        nav.__prexBeaconPush = push;
        return;
    }
    if (typeof nav.sendBeacon !== "function")
        return;
    const orig = nav.sendBeacon.bind(nav);
    nav.sendBeacon = function (url: string | URL, data?: BodyInit | null): boolean {
        try {
            let body: unknown = undefined;
            if (typeof data === "string") {
                try {
                    body = JSON.parse(data);
                }
                catch {
                    body = data;
                }
            }
            else if (data !== undefined && data !== null) {
                body = `[${(data as object).constructor?.name ?? typeof data}]`;
            }
            nav.__prexBeaconPush?.({ kind: "beacon", method: "POST", url: String(url), reqBody: body, ts: 0 });
        }
        catch {
        }
        return orig(url, data);
    };
    nav.__prexBeaconHooked = true;
    nav.__prexBeaconPush = push;
}
interface PrehookFrame {
    transport: "ws" | "sse";
    dir: "in" | "sys";
    type: string | null;
    url: string;
    data: unknown;
    ts: number;
}
interface PrehookSurface {
    version: number;
    wrapsWebSocket?: boolean;
    wrapsEventSource?: boolean;
    drain(onFrame?: (f: PrehookFrame) => void): {
        frames: PrehookFrame[];
        dropped: number;
    };
    readonly dropped: number;
    readonly pending: number;
}
function prehook(): PrehookSurface | undefined {
    const p = (window as unknown as {
        __prexPrehook?: PrehookSurface;
    }).__prexPrehook;
    return p && typeof p.drain === "function" ? p : undefined;
}
export function drainPrehook(push: (entry: CaptureLogEntry) => void): number {
    const pre = prehook();
    if (!pre)
        return 0;
    const emit = (f: PrehookFrame) => {
        let parsed: unknown = f.data;
        if (typeof f.data === "string") {
            try {
                parsed = JSON.parse(f.data);
            }
            catch {
                parsed = f.data;
            }
        }
        if (f.transport === "sse") {
            push({ kind: "sse", dir: f.dir, type: f.type ?? "message", url: f.url, payload: parsed, ts: f.ts } as CaptureLogEntry);
        }
        else {
            push({ kind: "ws", dir: f.dir, type: f.type ?? messageType(parsed), payload: parsed, ts: f.ts } as CaptureLogEntry);
        }
    };
    let drained: {
        frames: PrehookFrame[];
        dropped: number;
    };
    try {
        drained = pre.drain(emit);
    }
    catch {
        return 0;
    }
    for (const f of drained.frames)
        emit(f);
    if (drained.dropped > 0) {
        push({ kind: "ws", dir: "sys", type: "prehook-overflow", payload: { dropped: drained.dropped }, ts: Date.now() } as CaptureLogEntry);
    }
    return drained.frames.length;
}
export function hookNamedDispatch(name: string, push: (entry: WsCaptureEntry) => void): boolean {
    const current = readGlobal<((msg: unknown) => unknown) & {
        __prexDispatchHookedName?: string;
        __prexDispatchPush?: typeof push;
    }>(name);
    if (!current)
        return false;
    if (current.__prexDispatchHookedName === name) {
        current.__prexDispatchPush = push;
        return true;
    }
    const original = current;
    const wrapped = ((msg: unknown) => {
        wrapped.__prexDispatchPush?.({ kind: "ws", dir: "in", type: messageType(msg), payload: msg, ts: 0 });
        return original(msg);
    }) as ((msg: unknown) => unknown) & {
        __prexDispatchHookedName?: string;
        __prexDispatchPush?: typeof push;
    };
    wrapped.__prexDispatchHookedName = name;
    wrapped.__prexDispatchPush = push;
    try {
        (window as unknown as Record<string, unknown>)[name] = wrapped;
        return (window as unknown as Record<string, unknown>)[name] === wrapped;
    }
    catch {
        return false;
    }
}
