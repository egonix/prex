import { insertRows, query, sqlString, storeEnabled } from "./client.ts";
import type { Session } from "../sessions/registry.ts";
import { sessionIdOf } from "../sessions/registry.ts";
import { applyDeclaration, validateDeclaration } from "../sessions/schemas.ts";
import { setGameRetention } from "./retention.ts";
let versionCounter = 0;
function nextVersion(): number {
    versionCounter++;
    return Date.now() * 1000 + (versionCounter % 1000);
}
function ms(at: number): string {
    return String(at);
}
export async function upsertSessionRecord(session: Session): Promise<void> {
    if (!storeEnabled())
        return;
    const sessionId = await sessionIdOf(session);
    if (!sessionId)
        return;
    const now = Date.now();
    const existing = await query<{
        first_seen_ms: number;
    }>(`SELECT toUnixTimestamp64Milli(first_seen) AS first_seen_ms
       FROM sessions FINAL WHERE session_id = ${sqlString(sessionId)} LIMIT 1`).catch(() => []);
    const firstSeen = existing.length ? Number(existing[0].first_seen_ms) : now;
    await insertRows("sessions", [
        JSON.stringify({
            session_id: sessionId,
            game: session.game,
            origin: session.meta.origin ?? "",
            url: session.meta.url ?? "",
            first_seen: ms(firstSeen),
            last_seen: ms(now),
            version: nextVersion(),
        }),
    ]);
}
export interface SessionRecord {
    session_id: string;
    game: string;
    origin: string;
    url: string;
    first_seen: string;
    last_seen: string;
}
export async function getSessionRecord(sessionId: string): Promise<SessionRecord | null> {
    const rows = await query<SessionRecord>(`SELECT session_id, game, origin, url, first_seen, last_seen
       FROM sessions FINAL WHERE session_id = ${sqlString(sessionId)} LIMIT 1`);
    return rows[0] ?? null;
}
export async function openEpisode(session: Session): Promise<void> {
    if (!storeEnabled())
        return;
    const sessionId = await sessionIdOf(session);
    if (!sessionId)
        return;
    const rows = await query<{
        max_id: number;
    }>(`SELECT max(episode_id) AS max_id FROM episodes FINAL WHERE session_id = ${sqlString(sessionId)}`).catch(() => []);
    const episodeId = (rows.length ? Number(rows[0].max_id) : 0) + 1;
    session.episodeId = episodeId;
    await insertRows("episodes", [
        JSON.stringify({
            session_id: sessionId,
            episode_id: episodeId,
            connected_at: ms(Date.now()),
            disconnected_at: null,
            version: nextVersion(),
        }),
    ]);
}
export async function closeEpisode(session: Session): Promise<void> {
    if (!storeEnabled())
        return;
    const sessionId = await sessionIdOf(session);
    if (!sessionId || !session.episodeId)
        return;
    const rows = await query<{
        connected_ms: number;
    }>(`SELECT toUnixTimestamp64Milli(connected_at) AS connected_ms FROM episodes FINAL
      WHERE session_id = ${sqlString(sessionId)} AND episode_id = ${session.episodeId} LIMIT 1`).catch(() => []);
    await insertRows("episodes", [
        JSON.stringify({
            session_id: sessionId,
            episode_id: session.episodeId,
            connected_at: ms(rows.length ? Number(rows[0].connected_ms) : Date.now()),
            disconnected_at: ms(Date.now()),
            version: nextVersion(),
        }),
    ]);
}
export interface OpenEpisode {
    session_id: string;
    episode_id: number;
    last_activity_ms: number;
}
export async function findOpenEpisodes(): Promise<OpenEpisode[]> {
    return await query<OpenEpisode>(`SELECT e.session_id AS session_id,
            e.episode_id AS episode_id,
            toUnixTimestamp64Milli(
              ifNull((SELECT max(a.ingested_at) FROM activity a WHERE a.session_id = e.session_id),
                     e.connected_at)
            ) AS last_activity_ms
       FROM episodes e FINAL
      WHERE e.disconnected_at IS NULL`);
}
export async function closeEpisodeAt(sessionId: string, episodeId: number, at: number): Promise<void> {
    const rows = await query<{
        connected_ms: number;
    }>(`SELECT toUnixTimestamp64Milli(connected_at) AS connected_ms FROM episodes FINAL
      WHERE session_id = ${sqlString(sessionId)} AND episode_id = ${episodeId} LIMIT 1`).catch(() => []);
    await insertRows("episodes", [
        JSON.stringify({
            session_id: sessionId,
            episode_id: episodeId,
            connected_at: ms(rows.length ? Number(rows[0].connected_ms) : at),
            disconnected_at: ms(at),
            version: nextVersion(),
        }),
    ]);
}
export type ConfigKind = "trigger" | "capability" | "declaration";
export async function saveConfig(sessionId: string, kind: ConfigKind, id: string, body: unknown): Promise<void> {
    await insertRows("config", [
        JSON.stringify({
            session_id: sessionId,
            kind,
            id,
            body: JSON.stringify(body),
            deleted: 0,
            version: nextVersion(),
        }),
    ]);
}
export async function deleteConfig(sessionId: string, kind: ConfigKind, id: string): Promise<void> {
    await insertRows("config", [
        JSON.stringify({
            session_id: sessionId,
            kind,
            id,
            body: "",
            deleted: 1,
            version: nextVersion(),
        }),
    ]);
}
export interface ConfigRow {
    kind: ConfigKind;
    id: string;
    body: string;
}
export async function loadConfig(sessionId: string): Promise<ConfigRow[]> {
    return await query<ConfigRow>(`SELECT kind, id, body FROM config FINAL
      WHERE session_id = ${sqlString(sessionId)} AND deleted = 0`);
}
export function restoreSessionConfig(session: Session): void {
    if (!storeEnabled())
        return;
    void (async () => {
        const sessionId = await sessionIdOf(session);
        if (!sessionId)
            return;
        const rows = await loadConfig(sessionId);
        let triggers = 0;
        for (const row of rows) {
            try {
                const parsed = JSON.parse(row.body);
                if (row.kind === "trigger") {
                    if (!session.triggers.has(row.id)) {
                        session.triggers.set(row.id, parsed);
                        triggers++;
                    }
                }
                else if (row.kind === "declaration") {
                    const result = validateDeclaration(session, parsed, { skipGameCheck: true });
                    if (result.ok && result.declaration) {
                        applyDeclaration(session, result.declaration);
                        const decl = result.declaration;
                        const rules = decl.messages
                            .filter((m) => m.retention)
                            .map((m) => ({ game: decl.game, kind: m.match.kind, type: m.match.type, duration: m.retention! }));
                        await setGameRetention(decl.game, rules, decl.defaultRetention).catch(() => { });
                        console.log(`[prex] restored game-schema for ${decl.game}`);
                    }
                    else {
                        console.warn(`[prex] stored declaration no longer valid, ignoring: ${result.error}`);
                    }
                }
            }
            catch {
                console.warn(`[prex] skipping unreadable ${row.kind} config row ${row.id}`);
            }
        }
        if (triggers > 0)
            console.log(`[prex] restored ${triggers} trigger(s) for session ${sessionId}`);
    })().catch((err) => {
        console.warn(`[prex] could not restore session config: ${err}`);
    });
}
export function persistTrigger(session: Session, trigger: {
    id: string;
}): void {
    if (!storeEnabled())
        return;
    void (async () => {
        const sessionId = await sessionIdOf(session);
        if (sessionId)
            await saveConfig(sessionId, "trigger", trigger.id, trigger);
    })().catch((err) => console.warn(`[prex] could not persist trigger ${trigger.id}: ${err}`));
}
export function unpersistTrigger(session: Session, id: string): void {
    if (!storeEnabled())
        return;
    void (async () => {
        const sessionId = await sessionIdOf(session);
        if (sessionId)
            await deleteConfig(sessionId, "trigger", id);
    })().catch((err) => console.warn(`[prex] could not tombstone trigger ${id}: ${err}`));
}
export async function listStoredSessions(): Promise<SessionRecord[]> {
    return await query<SessionRecord>(`SELECT session_id, game, origin, url, first_seen, last_seen
       FROM sessions FINAL ORDER BY last_seen DESC LIMIT 500`);
}
export interface EpisodeRow {
    episode_id: number;
    connected_at: number;
    disconnected_at: number | null;
    activity_count: number;
}
export async function listEpisodes(sessionId: string, limit = 50): Promise<EpisodeRow[]> {
    const rows = await query<{
        episode_id: number;
        connected_ms: string | number;
        disconnected_ms: string | number | null;
        n: string | number;
    }>(`SELECT e.episode_id AS episode_id,
            toUnixTimestamp64Milli(e.connected_at) AS connected_ms,
            toUnixTimestamp64Milli(e.disconnected_at) AS disconnected_ms,
            ifNull(a.n, 0) AS n
       FROM (SELECT episode_id, connected_at, disconnected_at
               FROM episodes FINAL WHERE session_id = ${sqlString(sessionId)}) AS e
       LEFT JOIN (SELECT episode_id, count() AS n
                    FROM activity WHERE session_id = ${sqlString(sessionId)}
                   GROUP BY episode_id) AS a
         ON e.episode_id = a.episode_id
      ORDER BY e.episode_id DESC
      LIMIT ${Math.min(500, Math.max(1, Math.trunc(limit)))}`);
    return rows.map((r) => ({
        episode_id: Number(r.episode_id),
        connected_at: Number(r.connected_ms),
        disconnected_at: r.disconnected_ms === null ? null : Number(r.disconnected_ms),
        activity_count: Number(r.n),
    }));
}
export interface StoredGap {
    from_ts: number;
    to_ts: number;
    dropped_count: number;
    reason: string;
}
export async function queryGaps(sessionId: string, since?: number, until?: number): Promise<StoredGap[]> {
    const clauses = [`session_id = ${sqlString(sessionId)}`];
    if (since !== undefined)
        clauses.push(`to_ts >= fromUnixTimestamp64Milli(${Math.trunc(since)})`);
    if (until !== undefined)
        clauses.push(`from_ts <= fromUnixTimestamp64Milli(${Math.trunc(until)})`);
    const rows = await query<{
        from_ms: string | number;
        to_ms: string | number;
        dropped_count: number;
        reason: string;
    }>(`SELECT toUnixTimestamp64Milli(from_ts) AS from_ms,
            toUnixTimestamp64Milli(to_ts) AS to_ms,
            dropped_count, reason
       FROM gaps WHERE ${clauses.join(" AND ")}
      ORDER BY from_ts DESC LIMIT 500`);
    return rows.map((g) => ({
        from_ts: Number(g.from_ms),
        to_ts: Number(g.to_ms),
        dropped_count: Number(g.dropped_count),
        reason: g.reason,
    }));
}
export interface StoredSessionStats {
    activity_count: number;
    oldest_ts: number | null;
    newest_ts: number | null;
    episode_count: number;
}
export async function storedSessionStats(sessionId: string): Promise<StoredSessionStats> {
    const rows = await query<{
        n: string | number;
        oldest: string | number | null;
        newest: string | number | null;
        eps: string | number;
    }>(`SELECT count() AS n,
            toUnixTimestamp64Milli(min(ts)) AS oldest,
            toUnixTimestamp64Milli(max(ts)) AS newest,
            (SELECT count() FROM episodes FINAL WHERE session_id = ${sqlString(sessionId)}) AS eps
       FROM activity WHERE session_id = ${sqlString(sessionId)}`);
    const r = rows[0];
    return {
        activity_count: r ? Number(r.n) : 0,
        oldest_ts: r?.oldest ? Number(r.oldest) : null,
        newest_ts: r?.newest ? Number(r.newest) : null,
        episode_count: r ? Number(r.eps) : 0,
    };
}
