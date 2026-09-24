import type { McpServer } from "npm:@modelcontextprotocol/sdk@^1.30.0/server/mcp.js";
import { z } from "zod";
import { sendCommand } from "../../rpc/command.ts";
import { broadcastToViewers } from "../../sessions/broadcast.ts";
import { resolveSessionId } from "../session-id.ts";
const TRANSPORT_ERRORS = new Set(["prexy not connected", "command timed out"]);
function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
export function registerExecutionTools(server: McpServer): void {
    server.registerTool("execute_javascript", {
        description: "Runs the given JavaScript directly in the connected browser tab's own page context and " +
            "returns its result. This is a powerful, trust-sensitive operation \u2014 the code has the " +
            "same access the page's own scripts do. Prefer query_activity/get_activity_detail to " +
            "investigate first; use this when you need to read or change live page state directly.",
        inputSchema: { session_id: z.string(), code: z.string() },
        annotations: { readOnlyHint: false },
    }, async ({ session_id, code }: {
        session_id: string;
        code: string;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session) {
            return { isError: true, content: [{ type: "text" as const, text: "session_not_found" }] };
        }
        const id = crypto.randomUUID();
        broadcastToViewers(session, { type: "eval", id, code, from: "mcp" });
        const result = await sendCommand(session, id, code);
        broadcastToViewers(session, result.ok
            ? { type: "result", id, ok: true, value: result.value, from: "mcp" }
            : { type: "result", id, ok: false, error: result.error, from: "mcp" });
        if (result.ok)
            return json({ outcome: "result", value: result.value });
        if (TRANSPORT_ERRORS.has(result.error))
            return json({ outcome: "execution_error", error: result.error });
        return json({ outcome: "exception", error: result.error });
    });
}
