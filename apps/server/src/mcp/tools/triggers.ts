import type { McpServer } from "npm:@modelcontextprotocol/sdk@^1.30.0/server/mcp.js";
import { z } from "zod";
import { CreateTriggerSchema, type Trigger } from "@prex/protocol";
import { broadcastToViewers } from "../../sessions/broadcast.ts";
import { pruneIfEmpty } from "../../sessions/registry.ts";
import { updateTrigger, UpdateTriggerSchema } from "../../triggers/update.ts";
import { persistTrigger, unpersistTrigger } from "../../store/config.ts";
import { findContentEqual } from "../../triggers/dedup.ts";
import { resolveSessionId } from "../session-id.ts";
function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function notFound(text: string) {
    return { isError: true, content: [{ type: "text" as const, text }] };
}
function invalidTrigger(message: string) {
    return { isError: true, content: [{ type: "text" as const, text: `invalid_trigger: ${message}` }] };
}
const actionShape = z.union([
    z.object({ type: z.literal("webhook"), url: z.string().url() }),
    z.object({ type: z.literal("eval"), code: z.string() }),
]);
export function registerTriggerTools(server: McpServer): void {
    server.registerTool("list_triggers", {
        description: "Lists a session's triggers, including their match category, optional condition, " +
            "action, and optional firing-rate limit. Available even while the session is " +
            "disconnected \u2014 trigger config outlives a dropped connection. Read-only.",
        inputSchema: { session_id: z.string() },
        annotations: { readOnlyHint: true },
    }, async ({ session_id }: {
        session_id: string;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session)
            return notFound("session_not_found");
        return json([...session.triggers.values()]);
    });
    server.registerTool("create_trigger", {
        description: "Creates a new trigger on a session, using the same model the existing trigger system already supports.",
        inputSchema: {
            session_id: z.string(),
            match: z.string(),
            filter: z.string().optional(),
            action: actionShape,
            rate_limit_ms: z.number().int().positive().optional(),
        },
        annotations: { readOnlyHint: false },
    }, async ({ session_id, match, filter, action, rate_limit_ms }: {
        session_id: string;
        match: string;
        filter?: string;
        action: {
            type: "webhook";
            url: string;
        } | {
            type: "eval";
            code: string;
        };
        rate_limit_ms?: number;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session)
            return notFound("session_not_found");
        const parsed = CreateTriggerSchema.safeParse({ match, filter, action, rateLimitMs: rate_limit_ms });
        if (!parsed.success)
            return invalidTrigger(parsed.error.message);
        const trigger: Trigger = { id: crypto.randomUUID(), ...parsed.data };
        const duplicate = findContentEqual(session, trigger);
        if (duplicate)
            return json({ ...duplicate, deduplicated: true });
        session.triggers.set(trigger.id, trigger);
        persistTrigger(session, trigger);
        broadcastToViewers(session, { type: "trigger-changed", op: "created", triggerId: trigger.id, trigger, from: "mcp" });
        return json(trigger);
    });
    server.registerTool("update_trigger", {
        description: "Updates an existing trigger, merge-style \u2014 only the fields supplied change. Preserves " +
            "the trigger's id and rate-limit throttle history.",
        inputSchema: {
            session_id: z.string(),
            trigger_id: z.string(),
            match: z.string().optional(),
            filter: z.string().optional(),
            action: actionShape.optional(),
            rate_limit_ms: z.number().int().positive().optional(),
        },
        annotations: { readOnlyHint: false },
    }, async ({ session_id, trigger_id, match, filter, action, rate_limit_ms }: {
        session_id: string;
        trigger_id: string;
        match?: string;
        filter?: string;
        action?: {
            type: "webhook";
            url: string;
        } | {
            type: "eval";
            code: string;
        };
        rate_limit_ms?: number;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session)
            return notFound("session_not_found");
        const parsed = UpdateTriggerSchema.safeParse({ match, filter, action, rateLimitMs: rate_limit_ms });
        if (!parsed.success)
            return invalidTrigger(parsed.error.message);
        const trigger = updateTrigger(session, trigger_id, parsed.data);
        if (!trigger)
            return notFound("trigger_not_found");
        broadcastToViewers(session, { type: "trigger-changed", op: "updated", triggerId: trigger.id, trigger, from: "mcp" });
        return json(trigger);
    });
    server.registerTool("delete_trigger", {
        description: "Removes a trigger from a session.",
        inputSchema: { session_id: z.string(), trigger_id: z.string() },
        annotations: { readOnlyHint: false },
    }, async ({ session_id, trigger_id }: {
        session_id: string;
        trigger_id: string;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session)
            return notFound("session_not_found");
        const existed = session.triggers.delete(trigger_id);
        if (existed)
            unpersistTrigger(session, trigger_id);
        session.triggerLastFired.delete(trigger_id);
        session.triggerLastErrorReported.delete(trigger_id);
        pruneIfEmpty(session);
        if (existed) {
            broadcastToViewers(session, { type: "trigger-changed", op: "deleted", triggerId: trigger_id, from: "mcp" });
        }
        return json({ deleted: existed });
    });
}
