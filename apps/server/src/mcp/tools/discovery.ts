import type { McpServer } from "npm:@modelcontextprotocol/sdk@^1.30.0/server/mcp.js";
import { z } from "zod";
import { getSession, listSessions as listRealSessions } from "../../sessions/registry.ts";
import { describeSessionId, deriveSessionId, resolveSessionId } from "../session-id.ts";
import { toSessionDetailBase, toSessionSummary } from "../redact.ts";
import { introspectSession } from "./introspect.ts";
import { listEpisodes, listStoredSessions, storedSessionStats } from "../../store/config.ts";
function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
export function registerDiscoveryTools(server: McpServer): void {
    server.registerTool("list_sessions", {
        description: "Lists browser sessions with enough metadata to decide which one to act on. By default only " +
            "those connected right now; pass include_disconnected to also list every session the " +
            "activity store has recorded, which is what analysing stored history requires. Read-only.",
        inputSchema: { include_disconnected: z.boolean().optional() },
        annotations: { readOnlyHint: true },
    }, async ({ include_disconnected }: {
        include_disconnected?: boolean;
    }) => {
        const live = await Promise.all(listRealSessions().map(async (meta) => toSessionSummary(await deriveSessionId(meta.token), getSession(meta.token)!)));
        if (!include_disconnected)
            return json(live);
        const seen = new Set(live.map((s) => s.session_id));
        const stored = (await listStoredSessions().catch(() => []))
            .filter((r) => !seen.has(r.session_id))
            .map((r) => ({
            session_id: r.session_id,
            game: r.game,
            origin: r.origin || null,
            url: r.url || null,
            connected: false,
            connected_at: null,
            viewer_count: 0,
            last_seen: r.last_seen,
        }));
        return json([...live, ...stored]);
    });
    server.registerTool("list_episodes", {
        description: "Lists a session's connection episodes \u2014 one per prexy connection \u2014 newest first, with " +
            "how much activity each holds. An episode boundary is where the page's own state " +
            "discontinues: the session identity survives a reload, the page's in-memory state does " +
            "not. Check these before reading a value's change across time as a real event, since a " +
            "counter 'resetting' is usually just a reload. Read-only.",
        inputSchema: { session_id: z.string(), limit: z.number().optional() },
        annotations: { readOnlyHint: true },
    }, async ({ session_id, limit }: {
        session_id: string;
        limit?: number;
    }) => {
        try {
            return json(await listEpisodes(session_id, limit ?? 50));
        }
        catch (err) {
            return { isError: true, content: [{ type: "text" as const, text: `store_unavailable: ${err}` }] };
        }
    });
    server.registerTool("describe_session", {
        description: "Returns one session's detail: connection state, currently-loaded capture module, " +
            "best-effort active globals, and which capability categories (observation, execution, " +
            "triggers, modules, capability_bridge) are currently usable on it \u2014 plus what the activity " +
            "store holds for it, the target's declared retention per message type, and its declared " +
            "field roles. Answers for disconnected sessions too, with the live-only parts omitted. " +
            "Read-only.",
        inputSchema: { session_id: z.string() },
        annotations: { readOnlyHint: true },
    }, async ({ session_id }: {
        session_id: string;
    }) => {
        const { live, record } = await describeSessionId(session_id);
        if (!live) {
            if (record) {
                const stats = await storedSessionStats(session_id).catch(() => null);
                return json({
                    session_id,
                    game: record.game,
                    origin: record.origin || null,
                    url: record.url || null,
                    connected: false,
                    first_seen: record.first_seen,
                    last_seen: record.last_seen,
                    stored: stats,
                    retention: null,
                    declared_fields: null,
                    capabilities: { observation: true, execution: false, triggers: false, modules: false, capability_bridge: { loaded: false, count: 0 } },
                });
            }
            return { isError: true, content: [{ type: "text" as const, text: "session_not_found" }] };
        }
        const session = live;
        const base = toSessionDetailBase(session_id, session);
        const connected = session.prexy !== null;
        const { active_globals, capture_module_loaded } = await introspectSession(session);
        const stats = await storedSessionStats(session_id).catch(() => null);
        const decl = session.declaration;
        return json({
            ...base,
            active_globals,
            stored: stats,
            retention: decl
                ? {
                    default: decl.defaultRetention ?? "server default",
                    per_type: decl.messages.filter((m) => m.retention).map((m) => ({
                        kind: m.match.kind,
                        type: m.match.type ?? "*",
                        retention: m.retention,
                    })),
                }
                : null,
            declared_fields: decl
                ? decl.messages.map((m) => ({
                    kind: m.match.kind,
                    type: m.match.type ?? "*",
                    anchor: m.anchorWhen ?? null,
                    fields: m.fields ?? null,
                }))
                : null,
            capabilities: {
                observation: true,
                execution: connected,
                triggers: true,
                modules: connected,
                capability_bridge: { loaded: session.capabilities.size > 0, count: session.capabilities.size },
            },
            capture_module_loaded,
        });
    });
}
