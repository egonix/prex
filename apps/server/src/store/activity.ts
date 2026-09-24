import { query, sqlString } from "./client.ts";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const GAP_LIMIT = 20;
const GAP_FALLBACK_MS = 24 * 60 * 60 * 1000;
export interface StoredActivityItem {
    activity_id: string;
    session_id: string;
    episode_id: number;
    kind: string;
    type: string;
    dir: string;
    ts: number;
    payload: string;
}
export interface GapRecord {
    from_ts: number;
    to_ts: number;
    dropped_count: number;
    reason: string;
}
export interface QueryOpts {
    sessionId: string;
    kind?: string;
    type?: string;
    since?: number;
    until?: number;
    limit?: number;
}
interface Row {
    activity_key: string;
    session_id: string;
    episode_id: number;
    kind: string;
    type: string;
    dir: string;
    ts_ms: string | number;
    payload: string;
}
function whereFor(opts: QueryOpts): string {
    const clauses = [`session_id = ${sqlString(opts.sessionId)}`];
    if (opts.kind && opts.kind !== "all")
        clauses.push(`kind = ${sqlString(opts.kind)}`);
    if (opts.type)
        clauses.push(`type = ${sqlString(opts.type)}`);
    if (opts.since !== undefined)
        clauses.push(`ts >= fromUnixTimestamp64Milli(${Math.trunc(opts.since)})`);
    if (opts.until !== undefined)
        clauses.push(`ts <= fromUnixTimestamp64Milli(${Math.trunc(opts.until)})`);
    return clauses.join(" AND ");
}
export async function queryActivity(opts: QueryOpts): Promise<{
    items: StoredActivityItem[];
    gaps: GapRecord[];
}> {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)));
    const rows = await query<Row>(`SELECT activity_key, session_id, episode_id, kind, type, dir,
            toUnixTimestamp64Milli(ts) AS ts_ms, payload
       FROM activity
      WHERE ${whereFor(opts)}
      ORDER BY ts DESC, activity_key DESC
      LIMIT ${limit}`);
    const items: StoredActivityItem[] = rows.map((r) => ({
        activity_id: r.activity_key,
        session_id: r.session_id,
        episode_id: Number(r.episode_id),
        kind: r.kind,
        type: r.type,
        dir: r.dir,
        ts: Number(r.ts_ms),
        payload: r.payload,
    }));
    const lo = opts.since ?? (items.length ? items[items.length - 1].ts : undefined);
    const hi = opts.until ?? (items.length ? items[0].ts : undefined);
    const gapClauses = [`session_id = ${sqlString(opts.sessionId)}`];
    if (lo !== undefined)
        gapClauses.push(`to_ts >= fromUnixTimestamp64Milli(${Math.trunc(lo)})`);
    if (hi !== undefined)
        gapClauses.push(`from_ts <= fromUnixTimestamp64Milli(${Math.trunc(hi)})`);
    const gapRows = await query<{
        from_ms: string | number;
        to_ms: string | number;
        dropped_count: number;
        reason: string;
    }>(`SELECT toUnixTimestamp64Milli(from_ts) AS from_ms,
            toUnixTimestamp64Milli(to_ts) AS to_ms,
            dropped_count, reason
       FROM gaps WHERE ${gapClauses.join(" AND ")}
      ORDER BY from_ts DESC LIMIT 100`);
    return {
        items,
        gaps: gapRows.map((g) => ({
            from_ts: Number(g.from_ms),
            to_ts: Number(g.to_ms),
            dropped_count: Number(g.dropped_count),
            reason: g.reason,
        })),
    };
}
export interface FindingRecord {
    activity_id: string;
    session_id: string;
    episode_id: number;
    type: string;
    ts: number;
    condition: string | null;
    source: string | null;
    payload: unknown;
}
export async function queryFindings(opts: {
    sessionId: string;
    since?: number;
    until?: number;
    condition?: string;
    limit?: number;
}): Promise<{
    items: FindingRecord[];
    gaps: GapRecord[];
    gaps_window: {
        from_ts: number;
        to_ts: number;
    };
    gaps_truncated: boolean;
}> {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)));
    const clauses = [`session_id = ${sqlString(opts.sessionId)}`, `kind = 'finding'`];
    if (opts.since !== undefined)
        clauses.push(`ts >= fromUnixTimestamp64Milli(${Math.trunc(opts.since)})`);
    if (opts.until !== undefined)
        clauses.push(`ts <= fromUnixTimestamp64Milli(${Math.trunc(opts.until)})`);
    if (opts.condition) {
        clauses.push(`JSONExtractString(payload, 'data', 'condition') = ${sqlString(opts.condition)}`);
    }
    const rows = await query<Row>(`SELECT activity_key, session_id, episode_id, kind, type, dir,
            toUnixTimestamp64Milli(ts) AS ts_ms, payload
       FROM activity
      WHERE ${clauses.join(" AND ")}
      ORDER BY ts DESC, activity_key DESC
      LIMIT ${limit}`);
    const items: FindingRecord[] = rows.map((r) => {
        let data: unknown = null;
        try {
            data = (JSON.parse(r.payload) as {
                data?: unknown;
            }).data ?? null;
        }
        catch {
            data = null;
        }
        const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
        return {
            activity_id: r.activity_key,
            session_id: r.session_id,
            episode_id: Number(r.episode_id),
            type: r.type,
            ts: Number(r.ts_ms),
            condition: typeof d.condition === "string" ? d.condition : null,
            source: typeof d.source === "string" ? d.source : null,
            payload: data,
        };
    });
    const lo = opts.since ??
        (items.length ? items[items.length - 1].ts : Date.now() - GAP_FALLBACK_MS);
    const hi = opts.until ?? (items.length ? items[0].ts : Date.now());
    const gapClauses = [
        `session_id = ${sqlString(opts.sessionId)}`,
        `to_ts >= fromUnixTimestamp64Milli(${Math.trunc(lo)})`,
        `from_ts <= fromUnixTimestamp64Milli(${Math.trunc(hi)})`,
    ];
    const gapRows = await query<{
        from_ms: string | number;
        to_ms: string | number;
        dropped_count: number;
        reason: string;
    }>(`SELECT toUnixTimestamp64Milli(from_ts) AS from_ms,
            toUnixTimestamp64Milli(to_ts) AS to_ms,
            dropped_count, reason
       FROM gaps WHERE ${gapClauses.join(" AND ")}
      ORDER BY from_ts DESC LIMIT ${GAP_LIMIT + 1}`);
    const gapsTruncated = gapRows.length > GAP_LIMIT;
    return {
        items,
        gaps_window: { from_ts: Math.trunc(lo), to_ts: Math.trunc(hi) },
        gaps_truncated: gapsTruncated,
        gaps: gapRows.slice(0, GAP_LIMIT).map((g) => ({
            from_ts: Number(g.from_ms),
            to_ts: Number(g.to_ms),
            dropped_count: Number(g.dropped_count),
            reason: g.reason,
        })),
    };
}
export async function countActivity(sessionId: string): Promise<number> {
    const rows = await query<{
        n: string | number;
    }>(`SELECT count() AS n FROM activity WHERE session_id = ${sqlString(sessionId)}`);
    return rows.length ? Number(rows[0].n) : 0;
}
import type { AnchorWhen, GameSchemaDeclaration, MessageRule } from "@prex/protocol";
export type FieldRole = "level" | "event" | "sporadic" | "unknown";
export interface FoldedField {
    value: unknown;
    role: FieldRole;
    observedAt: number;
    staleMs: number;
}
export interface FoldedState {
    at: number;
    episodeId: number | null;
    anchorTs: number | null;
    foldedMessages: number;
    fields: Record<string, FoldedField>;
    truncatedAtEpisodeStart: boolean;
}
function bodyOf(frameText: string): Record<string, unknown> | null {
    let frame: unknown;
    try {
        frame = JSON.parse(frameText);
    }
    catch {
        return null;
    }
    if (typeof frame !== "object" || frame === null)
        return null;
    const f = frame as Record<string, unknown>;
    const data = f.data;
    if (typeof data === "object" && data !== null) {
        const d = data as Record<string, unknown>;
        const inner = d.payload;
        if (typeof inner === "object" && inner !== null)
            return inner as Record<string, unknown>;
        return d;
    }
    return f;
}
function flatten(obj: unknown, prefix: string, out: Map<string, unknown>): void {
    if (obj === null || typeof obj !== "object") {
        out.set(prefix, obj);
        return;
    }
    if (Array.isArray(obj)) {
        out.set(prefix, obj);
        return;
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
}
function matchesRule(rule: MessageRule, kind: string, type: string): boolean {
    if (rule.match.kind !== kind)
        return false;
    return rule.match.type === undefined || rule.match.type === type;
}
function isAnchor(when: AnchorWhen, body: Record<string, unknown>): boolean {
    if ("absent" in when)
        return !(when.absent in body);
    return Object.entries(when.equals).every(([k, v]) => body[k] === v);
}
function roleFor(rule: MessageRule | undefined, path: string): FieldRole {
    if (!rule?.fields)
        return "unknown";
    const head = path.split(".")[0];
    for (const role of ["level", "event", "sporadic"] as const) {
        const names = rule.fields[role];
        if (names && (names.includes(path) || names.includes(head)))
            return role;
    }
    return "unknown";
}
interface FoldRow {
    ts: number;
    episode_id: number;
    kind: string;
    type: string;
    payload: string;
}
export function foldRows(rows: FoldRow[], at: number, declaration: GameSchemaDeclaration | null): FoldedState {
    const upTo = rows.filter((r) => r.ts <= at);
    if (upTo.length === 0) {
        return { at, episodeId: null, anchorTs: null, foldedMessages: 0, fields: {}, truncatedAtEpisodeStart: false };
    }
    const episodeId = upTo[upTo.length - 1].episode_id;
    const inEpisode = upTo.filter((r) => r.episode_id === episodeId);
    let anchorIdx = -1;
    if (declaration) {
        for (let i = inEpisode.length - 1; i >= 0; i--) {
            const row = inEpisode[i];
            const rule = declaration.messages.find((m) => matchesRule(m, row.kind, row.type));
            if (!rule?.anchorWhen)
                continue;
            const body = bodyOf(row.payload);
            if (body && isAnchor(rule.anchorWhen, body)) {
                anchorIdx = i;
                break;
            }
        }
    }
    const start = anchorIdx >= 0 ? anchorIdx : 0;
    const window = inEpisode.slice(start);
    const fields: Record<string, FoldedField> = {};
    for (const row of window) {
        const body = bodyOf(row.payload);
        if (!body)
            continue;
        const rule = declaration?.messages.find((m) => matchesRule(m, row.kind, row.type));
        const leaves = new Map<string, unknown>();
        flatten(body, "", leaves);
        for (const [path, value] of leaves) {
            fields[path] = { value, role: roleFor(rule, path), observedAt: row.ts, staleMs: at - row.ts };
        }
    }
    return {
        at,
        episodeId,
        anchorTs: anchorIdx >= 0 ? inEpisode[anchorIdx].ts : null,
        foldedMessages: window.length,
        fields,
        truncatedAtEpisodeStart: anchorIdx < 0,
    };
}
export async function stateAt(sessionId: string, at: number, declaration: GameSchemaDeclaration | null, lookbackMs = 60000, fields?: string[]): Promise<FoldedState> {
    const rows = await query<{
        ts_ms: string | number;
        episode_id: number;
        kind: string;
        type: string;
        payload: string;
    }>(`SELECT toUnixTimestamp64Milli(ts) AS ts_ms, episode_id, kind, type, payload
       FROM activity
      WHERE session_id = ${sqlString(sessionId)}
        AND ts <= fromUnixTimestamp64Milli(${Math.trunc(at)})
        AND ts >= fromUnixTimestamp64Milli(${Math.trunc(at - lookbackMs)})
      ORDER BY ts ASC, activity_key ASC`);
    const state = foldRows(rows.map((r) => ({ ts: Number(r.ts_ms), episode_id: Number(r.episode_id), kind: r.kind, type: r.type, payload: r.payload })), at, declaration);
    if (!fields || fields.length === 0)
        return state;
    const filtered: Record<string, FoldedField> = {};
    for (const [path, field] of Object.entries(state.fields)) {
        if (fields.some((f) => path === f || path.startsWith(`${f}.`)))
            filtered[path] = field;
    }
    return { ...state, fields: filtered };
}
export type Bucket = "none" | "minute" | "hour" | "day";
export interface AggregateRow {
    bucket: string | null;
    kind: string;
    type: string;
    count: number;
    first_ts: number;
    last_ts: number;
}
const BUCKET_SQL: Record<Exclude<Bucket, "none">, string> = {
    minute: "toStartOfMinute(ts)",
    hour: "toStartOfHour(ts)",
    day: "toStartOfDay(ts)",
};
export async function aggregateActivity(opts: {
    sessionId: string;
    kind?: string;
    type?: string;
    since?: number;
    until?: number;
    bucket?: Bucket;
    limit?: number;
}): Promise<AggregateRow[]> {
    const bucket = opts.bucket ?? "none";
    const limit = Math.min(1000, Math.max(1, Math.trunc(opts.limit ?? 200)));
    const bucketExpr = bucket === "none" ? null : BUCKET_SQL[bucket];
    const select = bucketExpr ? `toUnixTimestamp(${bucketExpr}) * 1000 AS bucket_ms, ` : "";
    const group = bucketExpr ? `${bucketExpr}, kind, type` : "kind, type";
    const rows = await query<{
        bucket_ms?: string | number;
        kind: string;
        type: string;
        n: string | number;
        first_ms: string | number;
        last_ms: string | number;
    }>(`SELECT ${select}kind, type, count() AS n,
            toUnixTimestamp64Milli(min(ts)) AS first_ms,
            toUnixTimestamp64Milli(max(ts)) AS last_ms
       FROM activity
      WHERE ${whereFor({ sessionId: opts.sessionId, kind: opts.kind, type: opts.type, since: opts.since, until: opts.until })}
      GROUP BY ${group}
      ORDER BY n DESC
      LIMIT ${limit}`);
    return rows.map((r) => ({
        bucket: r.bucket_ms !== undefined ? new Date(Number(r.bucket_ms)).toISOString() : null,
        kind: r.kind,
        type: r.type,
        count: Number(r.n),
        first_ts: Number(r.first_ms),
        last_ts: Number(r.last_ms),
    }));
}
function segmentsOf(path: string): string[] {
    return path.split(".").filter((s) => s.length > 0).slice(0, 12);
}
function rooted(fn: "JSONExtractRaw" | "JSONExtractArrayRaw", segments: string[]): string {
    const inner = segments.map(sqlString).join(", ");
    const tail = inner ? `, ${inner}` : "";
    return `if(JSONHas(payload, 'data', 'payload'),
             ${fn}(payload, 'data', 'payload'${tail}),
             ${fn}(payload, 'data'${tail}))`;
}
function jsonPathExpr(path: string): string {
    const segments = segmentsOf(path);
    if (segments.length === 0)
        return "''";
    return rooted("JSONExtractRaw", segments);
}
export const ARRAY_MARKER = "[]";
interface ArrayPath {
    array: string[];
    element: string[];
}
export function splitArrayPath(path: string): ArrayPath | null {
    const at = path.indexOf(ARRAY_MARKER);
    if (at === -1)
        return null;
    const rest = path.slice(at + ARRAY_MARKER.length);
    if (rest.includes(ARRAY_MARKER))
        return null;
    return { array: segmentsOf(path.slice(0, at)), element: segmentsOf(rest) };
}
function arrayJoinSource(p: ArrayPath, where: string): string {
    return `(SELECT ts, arrayJoin(${rooted("JSONExtractArrayRaw", p.array)}) AS el
             FROM activity
            WHERE ${where})`;
}
function elementValueExpr(p: ArrayPath): string {
    if (p.element.length === 0)
        return "el";
    return `JSONExtractRaw(el, ${p.element.map(sqlString).join(", ")})`;
}
export interface FieldSample {
    ts: number;
    value: string;
}
export async function fieldHistory(opts: {
    sessionId: string;
    path: string;
    kind?: string;
    type?: string;
    since?: number;
    until?: number;
    maxSamples?: number;
    changesOnly?: boolean;
}): Promise<{
    samples: FieldSample[];
    total: number;
}> {
    if (opts.path.includes(ARRAY_MARKER)) {
        throw new Error(`field_history takes a scalar path; "${opts.path}" unnests an array. ` +
            `Use aggregate_by_field for a distribution over array elements.`);
    }
    const expr = jsonPathExpr(opts.path);
    const where = `${whereFor({ sessionId: opts.sessionId, kind: opts.kind, type: opts.type, since: opts.since, until: opts.until })} AND ${expr} != ''`;
    const countRows = await query<{
        n: string | number;
    }>(`SELECT count() AS n FROM activity WHERE ${where}`);
    const total = countRows.length ? Number(countRows[0].n) : 0;
    const max = Math.min(2000, Math.max(1, Math.trunc(opts.maxSamples ?? 500)));
    const step = total > max ? Math.ceil(total / max) : 1;
    const inner = `SELECT toUnixTimestamp64Milli(ts) AS ts_ms, ${expr} AS v
                   FROM activity WHERE ${where}`;
    const sql = opts.changesOnly
        ? `SELECT ts_ms, v FROM (
         SELECT ts_ms, v, lagInFrame(v) OVER (ORDER BY ts_ms ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS prev
           FROM (${inner})
       ) WHERE prev != v ORDER BY ts_ms ASC LIMIT ${max}`
        : `SELECT ts_ms, v FROM (
         SELECT ts_ms, v, row_number() OVER (ORDER BY ts_ms ASC) AS rn FROM (${inner})
       ) WHERE rn % ${step} = 0 ORDER BY ts_ms ASC LIMIT ${max}`;
    const rows = await query<{
        ts_ms: string | number;
        v: string;
    }>(sql);
    return { samples: rows.map((r) => ({ ts: Number(r.ts_ms), value: r.v })), total };
}
export interface FieldAggregateRow {
    bucket: string | null;
    value: string;
    count: number;
    first_ts: number;
    last_ts: number;
}
export interface FieldAggregateResult {
    values: FieldAggregateRow[];
    rows_in_scope?: number;
    note?: string;
}
export async function aggregateByField(opts: {
    sessionId: string;
    path: string;
    kind?: string;
    type?: string;
    since?: number;
    until?: number;
    bucket?: Bucket;
    limit?: number;
}): Promise<FieldAggregateResult> {
    const where = whereFor({ sessionId: opts.sessionId, kind: opts.kind, type: opts.type, since: opts.since, until: opts.until });
    const bucket = opts.bucket ?? "none";
    const bucketExpr = bucket === "none" ? null : BUCKET_SQL[bucket];
    const select = bucketExpr ? `toUnixTimestamp(${bucketExpr}) * 1000 AS bucket_ms, ` : "";
    const group = bucketExpr ? `${bucketExpr}, v` : "v";
    const limit = Math.min(1000, Math.max(1, Math.trunc(opts.limit ?? 200)));
    let from: string;
    let valueExpr: string;
    if (opts.path.includes(ARRAY_MARKER)) {
        const parts = splitArrayPath(opts.path);
        if (!parts) {
            return {
                values: [],
                note: `path "${opts.path}" uses ${ARRAY_MARKER} more than once; only one level of array unnesting is supported`,
            };
        }
        from = arrayJoinSource(parts, where);
        valueExpr = elementValueExpr(parts);
    }
    else {
        from = `activity`;
        valueExpr = jsonPathExpr(opts.path);
    }
    const outerWhere = from === "activity" ? `${where} AND ${valueExpr} != ''` : `${valueExpr} != ''`;
    const rows = await query<{
        bucket_ms?: string | number;
        v: string;
        n: string | number;
        first_ms: string | number;
        last_ms: string | number;
    }>(`SELECT ${select}${valueExpr} AS v, count() AS n,
            toUnixTimestamp64Milli(min(ts)) AS first_ms,
            toUnixTimestamp64Milli(max(ts)) AS last_ms
       FROM ${from}
      WHERE ${outerWhere}
      GROUP BY ${group}
      ORDER BY n DESC
      LIMIT ${limit}`);
    const values = rows.map((r) => ({
        bucket: r.bucket_ms !== undefined ? new Date(Number(r.bucket_ms)).toISOString() : null,
        value: r.v,
        count: Number(r.n),
        first_ts: Number(r.first_ms),
        last_ts: Number(r.last_ms),
    }));
    if (values.length > 0)
        return { values };
    const [scope] = await query<{
        n: string | number;
    }>(`SELECT count() AS n FROM activity WHERE ${where}`);
    const rowsInScope = Number(scope?.n ?? 0);
    return {
        values: [],
        rows_in_scope: rowsInScope,
        note: rowsInScope === 0
            ? "no rows matched the kind/type/time filters, so the path was never evaluated"
            : `${rowsInScope} rows matched the filters but "${opts.path}" extracted nothing from any of them. ` +
                `Check the path against a real payload (get_activity_detail). Values inside an array need ` +
                `${ARRAY_MARKER}, e.g. "enemies${ARRAY_MARKER}.name" rather than "enemies.name".`,
    };
}
