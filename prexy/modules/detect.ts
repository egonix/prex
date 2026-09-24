import type { GameModule, PrexyAgent } from "../core.ts";
const WINDOW_MS = 60000;
const MIN_WINDOWS = 10;
const RATE_SIGMA = 2.5;
const RATE_MIN_CV = 0.1;
const COOLDOWN_WINDOWS = 15;
const MAX_CATCHUP_WINDOWS = 5;
const MAX_TRACKED_FIELDS = 64;
const EV_FINDING = "finding";
const EV_SUMMARY = "summary";
const EV_SCHEMA = "game-schema";
type Role = "level" | "event" | "sporadic";
interface Declared {
    roles: Map<string, Map<string, Role>>;
}
function emptyDeclared(): Declared {
    return { roles: new Map() };
}
function parseDeclaration(data: unknown, into: Declared): void {
    const d = data as {
        messages?: unknown;
    } | null;
    if (!d || typeof d !== "object" || !Array.isArray(d.messages))
        return;
    for (const raw of d.messages as unknown[]) {
        const m = raw as {
            match?: {
                kind?: string;
                type?: string;
            };
            fields?: Record<string, unknown>;
        };
        if (!m || !m.match || !m.match.kind)
            continue;
        const id = `${m.match.kind}:${m.match.type ?? "*"}`;
        const map = new Map<string, Role>();
        for (const role of ["level", "event", "sporadic"] as Role[]) {
            const names = m.fields?.[role];
            if (!Array.isArray(names))
                continue;
            for (const n of names)
                if (typeof n === "string")
                    map.set(n, role);
        }
        if (map.size > 0)
            into.roles.set(id, map);
    }
}
function roleOf(decl: Declared, kind: string, type: string, field: string): Role | null {
    return decl.roles.get(`${kind}:${type}`)?.get(field) ??
        decl.roles.get(`${kind}:*`)?.get(field) ?? null;
}
interface FieldAgg {
    role: Role | null;
    min?: number;
    max?: number;
    first?: unknown;
    last?: unknown;
    sum?: number;
    n?: number;
    present: number;
}
interface TypeState {
    kind: string;
    type: string;
    count: number;
    bytes: number;
    completedWindows: number;
    mean: number;
    m2: number;
    keyWindows: Map<string, number>;
    keysThisWindow: Set<string>;
    fields: Map<string, FieldAgg>;
    lastSignal: Map<string, number>;
}
function newTypeState(kind: string, type: string): TypeState {
    return {
        kind,
        type,
        count: 0,
        bytes: 0,
        completedWindows: 0,
        mean: 0,
        m2: 0,
        keyWindows: new Map(),
        keysThisWindow: new Set(),
        fields: new Map(),
        lastSignal: new Map(),
    };
}
function stddev(s: TypeState): number {
    return s.completedWindows > 1 ? Math.sqrt(s.m2 / (s.completedWindows - 1)) : 0;
}
class Detector {
    private agent: PrexyAgent;
    private types = new Map<string, TypeState>();
    private declared = emptyDeclared();
    private declarationsSeen = 0;
    private windowStart = Date.now();
    private windowIndex = 0;
    private episodeHint = 0;
    private tapCalls = 0;
    private tapMs = 0;
    constructor(agent: PrexyAgent) {
        this.agent = agent;
    }
    observe(name: string, data: unknown): void {
        const t0 = performance.now();
        try {
            this.observeInner(name, data);
        }
        catch {
        }
        this.tapCalls++;
        this.tapMs += performance.now() - t0;
    }
    private observeInner(name: string, data: unknown): void {
        const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
        if (name === EV_SCHEMA) {
            parseDeclaration(data, this.declared);
            this.declarationsSeen++;
            if (this.declarationsSeen > 1)
                this.resetForReconnect();
            return;
        }
        const now = Date.now();
        this.advanceWindows(now);
        const kind = typeof d.kind === "string" ? d.kind : name;
        const type = typeof d.type === "string"
            ? d.type
            : typeof d.method === "string"
                ? d.method
                : name;
        const id = `${kind}:${type}`;
        let s = this.types.get(id);
        if (!s) {
            s = newTypeState(kind, type);
            this.types.set(id, s);
        }
        s.count++;
        const payload = this.payloadOf(d);
        if (payload) {
            try {
                s.bytes += JSON.stringify(payload).length;
            }
            catch {
            }
            this.foldPayload(s, payload);
        }
    }
    private payloadOf(d: Record<string, unknown>): Record<string, unknown> | null {
        const p = d.payload ?? d.resBody ?? d;
        return p && typeof p === "object" && !Array.isArray(p) ? p as Record<string, unknown> : null;
    }
    private foldPayload(s: TypeState, payload: Record<string, unknown>): void {
        for (const key in payload) {
            if (!Object.prototype.hasOwnProperty.call(payload, key))
                continue;
            s.keysThisWindow.add(key);
            let agg = s.fields.get(key);
            if (!agg) {
                if (s.fields.size >= MAX_TRACKED_FIELDS)
                    continue;
                agg = { role: roleOf(this.declared, s.kind, s.type, key), present: 0 };
                s.fields.set(key, agg);
            }
            else if (agg.role === null) {
                agg.role = roleOf(this.declared, s.kind, s.type, key);
            }
            agg.present++;
            const v = payload[key];
            if (agg.role === "level" && typeof v === "number") {
                agg.min = agg.min === undefined ? v : Math.min(agg.min, v);
                agg.max = agg.max === undefined ? v : Math.max(agg.max, v);
                if (agg.first === undefined)
                    agg.first = v;
                agg.last = v;
            }
            else if (agg.role === "event" && typeof v === "number") {
                agg.sum = (agg.sum ?? 0) + v;
                agg.n = (agg.n ?? 0) + 1;
            }
        }
    }
    private advanceWindows(now: number): void {
        if (now < this.windowStart + WINDOW_MS)
            return;
        const elapsed = Math.floor((now - this.windowStart) / WINDOW_MS);
        const toClose = Math.min(elapsed, MAX_CATCHUP_WINDOWS);
        const skipped = elapsed - toClose;
        for (let i = 0; i < toClose; i++) {
            this.closeWindow(i === 0, i === toClose - 1 ? skipped : 0);
            this.windowStart += WINDOW_MS;
            this.windowIndex++;
        }
        this.windowStart += skipped * WINDOW_MS;
        this.windowIndex += skipped;
    }
    private closeWindow(observed: boolean, skippedWindows: number): void {
        const windowEnd = this.windowStart + WINDOW_MS;
        for (const s of this.types.values()) {
            if (observed)
                this.evaluate(s, windowEnd);
            this.emitSummary(s, windowEnd, skippedWindows, observed);
            if (observed)
                this.updateBaseline(s);
            s.count = 0;
            s.bytes = 0;
            for (const agg of s.fields.values()) {
                agg.min = agg.max = undefined;
                agg.first = agg.last = undefined;
                agg.sum = agg.n = undefined;
                agg.present = 0;
            }
            s.keysThisWindow.clear();
        }
    }
    private updateBaseline(s: TypeState): void {
        for (const key of s.keysThisWindow) {
            s.keyWindows.set(key, (s.keyWindows.get(key) ?? 0) + 1);
        }
        s.completedWindows++;
        const delta = s.count - s.mean;
        s.mean += delta / s.completedWindows;
        s.m2 += delta * (s.count - s.mean);
    }
    private evaluate(s: TypeState, windowEnd: number): void {
        if (s.completedWindows < MIN_WINDOWS)
            return;
        const sd = stddev(s);
        const sdEff = Math.max(sd, RATE_MIN_CV * s.mean);
        if (s.count === 0 && s.mean > RATE_SIGMA * sdEff) {
            this.signal(s, "silence", windowEnd, { count: 0 }, {
                mean: Number(s.mean.toFixed(2)),
                stddev: Number(sd.toFixed(2)),
                stddevUsed: Number(sdEff.toFixed(2)),
            });
            return;
        }
        if (s.count === 0)
            return;
        if (sdEff > 0 && Math.abs(s.count - s.mean) > RATE_SIGMA * sdEff) {
            this.signal(s, "rate", windowEnd, {
                count: s.count,
                deviationSigma: Number(((s.count - s.mean) / sdEff).toFixed(2)),
            }, {
                mean: Number(s.mean.toFixed(2)),
                stddev: Number(sd.toFixed(2)),
                stddevUsed: Number(sdEff.toFixed(2)),
                floored: sdEff > sd,
            });
        }
        const gained: string[] = [];
        const lost: string[] = [];
        for (const key of s.keysThisWindow) {
            if (!s.keyWindows.has(key))
                gained.push(key);
        }
        for (const [key, seen] of s.keyWindows) {
            if (seen === s.completedWindows && !s.keysThisWindow.has(key))
                lost.push(key);
        }
        if (s.count > 0 && (gained.length > 0 || lost.length > 0)) {
            this.signal(s, "shape", windowEnd, { gained, lost }, {
                stableKeys: s.keyWindows.size,
                windows: s.completedWindows,
            });
        }
    }
    private signal(s: TypeState, condition: string, windowEnd: number, observed: unknown, baseline: unknown): void {
        const last = s.lastSignal.get(condition);
        if (last !== undefined && this.windowIndex - last < COOLDOWN_WINDOWS)
            return;
        s.lastSignal.set(condition, this.windowIndex);
        this.agent.event(EV_FINDING, {
            kind: EV_FINDING,
            type: s.type,
            key: this.agent.nextActivityKey(),
            ts: windowEnd,
            source: "detector",
            condition,
            observedKind: s.kind,
            observed,
            baseline,
            windowMs: WINDOW_MS,
            windowStart: windowEnd - WINDOW_MS,
            windowEnd,
            episodeHint: this.episodeHint,
            evidence: {
                messageKind: s.kind,
                messageType: s.type,
                completedWindows: s.completedWindows,
                cooldownWindows: COOLDOWN_WINDOWS,
            },
        });
    }
    private emitSummary(s: TypeState, windowEnd: number, skippedWindows: number, observed: boolean): void {
        if (s.count === 0 && s.completedWindows === 0)
            return;
        const fields: Record<string, unknown> = {};
        for (const [key, agg] of s.fields) {
            if (agg.present === 0 && agg.role !== "sporadic")
                continue;
            if (agg.role === "level")
                fields[key] = { min: agg.min, max: agg.max, first: agg.first, last: agg.last };
            else if (agg.role === "event")
                fields[key] = { sum: agg.sum ?? 0, count: agg.n ?? 0 };
            else
                fields[key] = { present: agg.present };
        }
        this.agent.event(EV_SUMMARY, {
            kind: EV_SUMMARY,
            type: s.type,
            key: this.agent.nextActivityKey(),
            ts: windowEnd,
            source: "detector",
            observedKind: s.kind,
            windowMs: WINDOW_MS,
            windowStart: windowEnd - WINDOW_MS,
            windowEnd,
            count: s.count,
            bytes: s.bytes,
            episodeHint: this.episodeHint,
            completedWindows: s.completedWindows,
            skippedWindows,
            observed,
            fields,
        });
    }
    private resetForReconnect(): void {
        this.types.clear();
        this.episodeHint++;
        this.windowStart = Date.now();
    }
    stats(): unknown {
        const types: Record<string, unknown> = {};
        for (const [id, s] of this.types) {
            types[id] = {
                count: s.count,
                completedWindows: s.completedWindows,
                mean: Number(s.mean.toFixed(2)),
                stddev: Number(stddev(s).toFixed(2)),
                eligible: s.completedWindows >= MIN_WINDOWS,
                fields: s.fields.size,
            };
        }
        return {
            windowMs: WINDOW_MS,
            windowIndex: this.windowIndex,
            windowStart: this.windowStart,
            episodeHint: this.episodeHint,
            declarationsSeen: this.declarationsSeen,
            trackedTypes: this.types.size,
            tapCalls: this.tapCalls,
            tapTotalMs: Number(this.tapMs.toFixed(3)),
            tapMeanMs: this.tapCalls ? Number((this.tapMs / this.tapCalls).toFixed(5)) : 0,
            types,
        };
    }
}
const SLOT = Symbol.for("prexy-detect-instance");
interface Slot {
    unsubscribe: () => void;
    detector: Detector;
}
const detectModule: GameModule = {
    name: "detect",
    init(agent: PrexyAgent) {
        const w = window as unknown as Record<symbol, Slot | undefined>;
        w[SLOT]?.unsubscribe();
        const detector = new Detector(agent);
        const unsubscribe = agent.tap((name, data) => detector.observe(name, data));
        w[SLOT] = { unsubscribe, detector };
        (window as unknown as {
            __prexDetect: unknown;
        }).__prexDetect = {
            stats: () => detector.stats(),
            unload: () => {
                unsubscribe();
                w[SLOT] = undefined;
            },
        };
    },
};
export default detectModule;
