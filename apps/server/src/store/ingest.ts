import { insertRows, storeEnabled } from "./client.ts";
import { envInt } from "./tuning.ts";
import type { Session } from "../sessions/registry.ts";
import { sessionIdOf } from "../sessions/registry.ts";
const MAX_QUEUE = envInt("PREX_INGEST_QUEUE_MAX", 20000, { min: 1000, max: 1000000 });
const BATCH = 2000;
const DROP_CHUNK = 1000;
const FLUSH_INTERVAL_MS = envInt("PREX_FLUSH_INTERVAL_MS", 60000, { min: 250, max: 600000 });
interface Queued {
    session: Session;
    episodeId: number;
    ts: number;
    kind: string;
    type: string;
    dir: string;
    activityKey: string;
    game: string;
    raw: string;
}
const queue: Queued[] = [];
let flushing = false;
let timer: ReturnType<typeof setInterval> | undefined;
let consoleSeq = 0;
function str(v: unknown, fallback = ""): string {
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}
function describe(parsed: {
    type: string;
    [k: string]: unknown;
}): Omit<Queued, "session" | "episodeId" | "raw" | "game"> | null {
    if (parsed.type === "console") {
        consoleSeq++;
        return {
            ts: Date.now(),
            kind: "console",
            type: str(parsed.level, "log"),
            dir: "",
            activityKey: `c${consoleSeq}`,
        };
    }
    if (parsed.type === "event") {
        const data = parsed.data;
        const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
        return {
            ts: typeof d.ts === "number" ? d.ts : Date.now(),
            kind: str(d.kind) || str(parsed.name, "event"),
            type: str(d.type) || str(d.method) || str(parsed.name),
            dir: str(d.dir),
            activityKey: str(d.key) || `e${++consoleSeq}`,
        };
    }
    return null;
}
export function enqueue(session: Session, parsed: {
    type: string;
    [k: string]: unknown;
}, raw: string): void {
    if (!storeEnabled())
        return;
    const d = describe(parsed);
    if (!d)
        return;
    if (queue.length >= MAX_QUEUE) {
        const dropped = queue.splice(0, DROP_CHUNK);
        noteGap(dropped, "queue_full");
    }
    queue.push({ ...d, session, episodeId: session.episodeId, game: session.game, raw });
}
function rowFor(q: Queued, sessionId: string): string {
    return JSON.stringify({
        session_id: sessionId,
        episode_id: q.episodeId,
        ts: q.ts,
        kind: q.kind,
        type: q.type,
        dir: q.dir,
        activity_key: q.activityKey,
        game: q.game,
        payload: q.raw,
    });
}
async function flush(): Promise<void> {
    if (flushing || queue.length === 0)
        return;
    flushing = true;
    try {
        while (queue.length > 0) {
            const batch = queue.splice(0, BATCH);
            const bySession = new Map<Session, Queued[]>();
            for (const q of batch) {
                const list = bySession.get(q.session);
                if (list)
                    list.push(q);
                else
                    bySession.set(q.session, [q]);
            }
            const rows: string[] = [];
            for (const [session, items] of bySession) {
                const sessionId = await sessionIdOf(session);
                if (!sessionId)
                    continue;
                for (const q of items)
                    rows.push(rowFor(q, sessionId));
            }
            try {
                await insertRows("activity", rows);
            }
            catch (err) {
                noteGap(batch, "flush_failed");
                logOutageOnce(err);
                return;
            }
        }
        outageLogged = false;
    }
    finally {
        flushing = false;
    }
}
let outageLogged = false;
function logOutageOnce(err: unknown): void {
    if (outageLogged)
        return;
    outageLogged = true;
    console.warn(`[prex] activity store unavailable, dropping activity and recording gaps: ${err}`);
}
function noteGap(items: Queued[], reason: string): void {
    if (items.length === 0)
        return;
    const session = items[0].session;
    let from = items[0].ts;
    let to = items[0].ts;
    for (const q of items) {
        if (q.ts < from)
            from = q.ts;
        if (q.ts > to)
            to = q.ts;
    }
    void recordGapFor(session, from, to, items.length, reason);
}
async function recordGapFor(session: Session, from: number, to: number, count: number, reason: string): Promise<void> {
    const sessionId = await sessionIdOf(session).catch(() => "");
    if (!sessionId)
        return;
    await recordGap(sessionId, from, to, count, reason).catch(() => { });
}
export async function recordGap(sessionId: string, from: number, to: number, droppedCount: number, reason: string): Promise<void> {
    await insertRows("gaps", [
        JSON.stringify({
            session_id: sessionId,
            from_ts: from,
            to_ts: to,
            dropped_count: droppedCount,
            reason,
        }),
    ]);
}
export function startIngest(): void {
    if (!storeEnabled() || timer !== undefined)
        return;
    timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
}
export function queueDepth(): number {
    return queue.length;
}
export const __testing = { queue, flush, MAX_QUEUE, BATCH, DROP_CHUNK };
