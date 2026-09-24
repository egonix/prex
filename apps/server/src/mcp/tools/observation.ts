import type { McpServer } from "npm:@modelcontextprotocol/sdk@^1.30.0/server/mcp.js";
import { z } from "zod";
import { describeSessionId, resolveSessionId } from "../session-id.ts";
import { aggregateActivity, aggregateByField, fieldHistory, queryActivity, queryFindings, stateAt } from "../../store/activity.ts";
import { AdHocRejected, runReadOnlySql } from "../../store/adhoc.ts";
import { queryGaps } from "../../store/config.ts";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TRUNCATE_CHARS = 10000;
export interface RawEntry {
    key?: string;
    kind?: string;
    ts?: number;
    [k: string]: unknown;
}
interface McpActivityItem {
    activity_id: string;
    kind: "console" | "network";
    type: string;
    summary: string;
    ts: number;
}
function isRawEntry(v: unknown): v is RawEntry {
    return typeof v === "object" && v !== null;
}
function summarize(raw: RawEntry): {
    kind: "console" | "network";
    type: string;
    summary: string;
} {
    if (raw.kind === "console") {
        const level = typeof raw.level === "string" ? raw.level : "log";
        const args = Array.isArray(raw.args) ? raw.args : [];
        const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
        return { kind: "console", type: level, summary: `[${level}] ${text}`.slice(0, 200) };
    }
    if (raw.kind === "http") {
        const method = String(raw.method ?? "?");
        const target = String(raw.url ?? raw.path ?? "?");
        const status = raw.error ? `error: ${raw.error}` : String(raw.status ?? "?");
        return { kind: "network", type: "http", summary: `${method} ${target} → ${status}`.slice(0, 200) };
    }
    if (raw.kind === "ws") {
        const dir = String(raw.dir ?? "?");
        const type = String(raw.type ?? "?");
        return { kind: "network", type: "ws", summary: `${dir} ${type}`.slice(0, 200) };
    }
    return { kind: "network", type: String(raw.kind ?? "unknown"), summary: JSON.stringify(raw).slice(0, 200) };
}
function toItem(raw: RawEntry): McpActivityItem {
    const { kind, type, summary } = summarize(raw);
    return { activity_id: String(raw.key ?? ""), kind, type, summary, ts: typeof raw.ts === "number" ? raw.ts : 0 };
}
export function selectActivityItems(raw: RawEntry[], opts: {
    since?: number;
    limit?: number;
}): McpActivityItem[] {
    let items = raw.map(toItem).sort((a, b) => b.ts - a.ts);
    if (opts.since !== undefined)
        items = items.filter((item) => item.ts >= opts.since!);
    const capped = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return items.slice(0, capped);
}
function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function notFound(text: string) {
    return { isError: true, content: [{ type: "text" as const, text }] };
}
export function registerObservationTools(server: McpServer): void {
    server.registerTool("query_activity", {
        description: "Queries a session's captured activity (console output and/or network/socket traffic) in " +
            "structured form, most-recent-first. Read-only.",
        inputSchema: {
            session_id: z.string(),
            kind: z.enum(["console", "network", "all"]).optional(),
            since: z.number().optional(),
            limit: z.number().optional(),
        },
        annotations: { readOnlyHint: true },
    }, async ({ session_id, kind, since, limit }: {
        session_id: string;
        kind?: "console" | "network" | "all";
        since?: number;
        limit?: number;
    }) => {
        const { live, record } = await describeSessionId(session_id);
        if (!live && !record)
            return notFound("session_not_found");
        try {
            const { items, gaps } = await queryActivity({
                sessionId: session_id,
                kind: kind === "console" ? "console" : "all",
                since,
                limit,
            });
            const filtered = kind === "network" ? items.filter((i) => i.kind !== "console") : items;
            return json({
                connected: live !== null,
                items: filtered.map((i) => ({ activity_id: i.activity_id, kind: i.kind, type: i.type, ts: i.ts })),
                gaps,
            });
        }
        catch (err) {
            return notFound(`store_unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.registerTool("get_state_at", {
        description: "Reconstructs the target page's state as of a past instant, from stored activity. Works on " +
            "sessions whose page is closed. Pass `fields` (dotted path prefixes) to return only what you " +
            "need \u2014 a full reconstruction can run to several hundred fields. " +
            "sessions whose page is closed. Finds the nearest preceding full-state message and folds " +
            "later incremental ones onto it, stopping at a connection boundary \u2014 state is never " +
            "composed across a page reload, because in-page state does not survive one. Each field " +
            "carries how stale it was at that instant, and a role (level = an absolute value, event = a " +
            "per-occurrence increment, sporadic = meaningful by its absence) when the target declared " +
            "one. Read-only.",
        inputSchema: {
            session_id: z.string(),
            at: z.number().optional(),
            lookback_ms: z.number().optional(),
            fields: z.array(z.string()).optional(),
        },
        annotations: { readOnlyHint: true },
    }, async ({ session_id, at, lookback_ms, fields }: {
        session_id: string;
        at?: number;
        lookback_ms?: number;
        fields?: string[];
    }) => {
        const { live, record } = await describeSessionId(session_id);
        if (!live && !record)
            return notFound("session_not_found");
        try {
            const state = await stateAt(session_id, at ?? Date.now(), live?.declaration ?? null, lookback_ms ?? 60000, fields);
            return json(state);
        }
        catch (err) {
            return notFound(`store_unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.registerTool("aggregate_activity", {
        description: "Counts a session's stored activity grouped by message kind and type, optionally bucketed " +
            "over time, with first- and last-seen timestamps. Shaped for 'what changed and when did it " +
            "start' \u2014 use this instead of paging through query_activity when the question is about " +
            "volume, onset or disappearance of a message type rather than about individual items. " +
            "Read-only.",
        inputSchema: {
            session_id: z.string(),
            kind: z.string().optional(),
            type: z.string().optional(),
            since: z.number().optional(),
            until: z.number().optional(),
            bucket: z.enum(["none", "minute", "hour", "day"]).optional(),
            limit: z.number().optional(),
        },
        annotations: { readOnlyHint: true },
    }, async (args: {
        session_id: string;
        kind?: string;
        type?: string;
        since?: number;
        until?: number;
        bucket?: "none" | "minute" | "hour" | "day";
        limit?: number;
    }) => {
        const { live, record } = await describeSessionId(args.session_id);
        if (!live && !record)
            return notFound("session_not_found");
        try {
            return json(await aggregateActivity({ sessionId: args.session_id, ...args }));
        }
        catch (err) {
            return notFound(`store_unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.registerTool("query_gaps", {
        description: "Lists recorded holes in a session's stored activity \u2014 periods where capture was dropped " +
            "rather than quiet. Ingest is best-effort by design (it is never allowed to slow the live " +
            "path), so a window can be genuinely incomplete. CHECK THIS BEFORE drawing a conclusion " +
            "from an absence: without it, a gap is indistinguishable from silence and any 'X stopped " +
            "happening' finding over that window is unsound. `reason` is queue_full, flush_failed or " +
            "process_restart. Read-only.",
        inputSchema: { session_id: z.string(), since: z.number().optional(), until: z.number().optional() },
        annotations: { readOnlyHint: true },
    }, async ({ session_id, since, until }: {
        session_id: string;
        since?: number;
        until?: number;
    }) => {
        try {
            return json(await queryGaps(session_id, since, until));
        }
        catch (err) {
            return notFound(`store_unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.registerTool("field_history", {
        description: "Follows one field's value over time within a session's stored activity, extracted in the " +
            "store rather than by shipping whole payloads. `path` is dotted and relative to the target's " +
            "own message (e.g. \"playerGold\", \"weaponSkill.level\", or \"status\" for HTTP entries). " +
            "Set changes_only to collapse runs of an unchanged value to the moment it moved \u2014 usually " +
            "what makes a long series readable. Otherwise the result is evenly downsampled across the " +
            "whole window rather than truncated to its tail. Read-only.",
        inputSchema: {
            session_id: z.string(),
            path: z.string(),
            kind: z.string().optional(),
            type: z.string().optional(),
            since: z.number().optional(),
            until: z.number().optional(),
            max_samples: z.number().optional(),
            changes_only: z.boolean().optional(),
        },
        annotations: { readOnlyHint: true },
    }, async (a: {
        session_id: string;
        path: string;
        kind?: string;
        type?: string;
        since?: number;
        until?: number;
        max_samples?: number;
        changes_only?: boolean;
    }) => {
        const { live, record } = await describeSessionId(a.session_id);
        if (!live && !record)
            return notFound("session_not_found");
        try {
            return json(await fieldHistory({
                sessionId: a.session_id,
                path: a.path,
                kind: a.kind,
                type: a.type,
                since: a.since,
                until: a.until,
                maxSamples: a.max_samples,
                changesOnly: a.changes_only,
            }));
        }
        catch (err) {
            return notFound(`store_unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.registerTool("aggregate_by_field", {
        description: "Counts a session's stored activity grouped by a value INSIDE the payload, optionally " +
            "bucketed over time. Use it for questions about a field's distribution and when it changed " +
            "\u2014 e.g. path \"status\" with kind \"http\" and bucket \"hour\" answers 'which HTTP statuses " +
            "occur, and when did the failures start'. aggregate_activity groups by message type; this " +
            "groups by payload content. " +
            "Dotted paths address scalars (\"killedEnemyName\"). To group by a value inside an ARRAY of " +
            "objects \u2014 the usual shape for per-tick entity lists \u2014 mark the array with [] and the rows " +
            "are unnested one per element: \"enemies[].isChampion\", \"kills[].xp\". One [] per path. " +
            "An empty result comes back with rows_in_scope and a note saying whether the filters matched " +
            "nothing or the path did, so a wrong path is not mistaken for an absent field. Read-only.",
        inputSchema: {
            session_id: z.string(),
            path: z.string(),
            kind: z.string().optional(),
            type: z.string().optional(),
            since: z.number().optional(),
            until: z.number().optional(),
            bucket: z.enum(["none", "minute", "hour", "day"]).optional(),
            limit: z.number().optional(),
        },
        annotations: { readOnlyHint: true },
    }, async (a: {
        session_id: string;
        path: string;
        kind?: string;
        type?: string;
        since?: number;
        until?: number;
        bucket?: "none" | "minute" | "hour" | "day";
        limit?: number;
    }) => {
        const { live, record } = await describeSessionId(a.session_id);
        if (!live && !record)
            return notFound("session_not_found");
        try {
            return json(await aggregateByField({ sessionId: a.session_id, ...a }));
        }
        catch (err) {
            return notFound(`store_unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.registerTool("get_activity_detail", {
        description: "Retrieves full detail for one specific captured activity item, given an activity_id from " +
            "a prior query_activity call. Read-only.",
        inputSchema: { session_id: z.string(), activity_id: z.string() },
        annotations: { readOnlyHint: true },
    }, async ({ session_id, activity_id }: {
        session_id: string;
        activity_id: string;
    }) => {
        const { live, record } = await describeSessionId(session_id);
        if (!live && !record)
            return notFound("session_not_found");
        const { items } = await queryActivity({ sessionId: session_id, limit: MAX_LIMIT }).catch(() => ({ items: [], gaps: [] }));
        const stored = items.find((i) => i.activity_id === activity_id);
        if (!stored)
            return notFound("activity_not_found");
        const item = { activity_id: stored.activity_id, kind: stored.kind, type: stored.type, ts: stored.ts };
        const payloadText = stored.payload;
        const truncated = payloadText.length > TRUNCATE_CHARS;
        return json({
            ...item,
            payload: truncated ? payloadText.slice(0, TRUNCATE_CHARS) + "...(truncated)" : payloadText,
            truncated,
        });
    });
    server.registerTool("query_sql", {
        description: "Runs one read-only SQL SELECT against this session's stored activity, for questions the " +
            "typed tools cannot express \u2014 correlating two payload fields, bucketing a numeric " +
            "distribution, joining activity against gaps. Tables: `activity` (activity_key, session_id, " +
            "episode_id, ts DateTime64(3), kind, type, dir, game, payload String) and `gaps` " +
            "(session_id, from_ts, to_ts, dropped_count, reason). `payload` is the verbatim wire frame, " +
            "so a target's own field sits under data.payload for ws messages and under data otherwise \u2014 " +
            "use JSONExtract* on it, and arrayJoin(JSONExtractArrayRaw(...)) to unnest an array. " +
            "Both tables are filtered to this session by the server, so a bare `FROM activity` is " +
            "already scoped. Always bound `ts`: an unbounded scan of `payload` is the one thing that " +
            "reliably exhausts the memory budget. SELECT only; no FORMAT clause; single statement. " +
            "Prefer the typed tools when they fit \u2014 they are cheaper and their output is smaller. " +
            "Read-only.",
        inputSchema: {
            session_id: z.string(),
            sql: z.string(),
            limit: z.number().optional(),
        },
        annotations: { readOnlyHint: true },
    }, async ({ session_id, sql, limit }: {
        session_id: string;
        sql: string;
        limit?: number;
    }) => {
        const { live, record } = await describeSessionId(session_id);
        if (!live && !record)
            return notFound("session_not_found");
        try {
            return json(await runReadOnlySql({ sessionId: session_id, sql, limit }));
        }
        catch (err) {
            if (err instanceof AdHocRejected)
                return notFound(`rejected: ${err.message}`);
            return notFound(`query_failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.registerTool("list_findings", {
        description: "Lists what the in-page detector noticed for a session \u2014 a message type falling silent, a " +
            "rate moving, a payload's shape changing \u2014 newest first, each with the window it was " +
            "derived from and the baseline it was judged against. Use it before reasoning from raw " +
            "activity: it is the cheapest way to find out whether anything already flagged the period " +
            "you are looking at. Filter with `condition` (silence | rate | shape). Returns `gaps` " +
            "alongside, so an empty result over a lossy window is not mistaken for a quiet one. " +
            "Answers for sessions whose page is closed. Read-only.",
        inputSchema: {
            session_id: z.string(),
            since: z.number().optional(),
            until: z.number().optional(),
            condition: z.string().optional(),
            limit: z.number().optional(),
        },
        annotations: { readOnlyHint: true },
    }, async (a: {
        session_id: string;
        since?: number;
        until?: number;
        condition?: string;
        limit?: number;
    }) => {
        const { live, record } = await describeSessionId(a.session_id);
        if (!live && !record)
            return notFound("session_not_found");
        try {
            return json(await queryFindings({ sessionId: a.session_id, ...a }));
        }
        catch (err) {
            return notFound(`store_unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}
