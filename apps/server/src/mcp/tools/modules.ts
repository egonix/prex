import type { McpServer } from "npm:@modelcontextprotocol/sdk@^1.30.0/server/mcp.js";
import { z } from "zod";
import { sendCommand } from "../../rpc/command.ts";
import { broadcastToViewers } from "../../sessions/broadcast.ts";
import { resolveSessionId } from "../session-id.ts";
import { introspectSession } from "./introspect.ts";
const TRANSPORT_ERRORS = new Set(["prexy not connected", "command timed out"]);
function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function notFound(text: string) {
    return { isError: true, content: [{ type: "text" as const, text }] };
}
export function registerModuleTools(server: McpServer): void {
    server.registerTool("list_modules", {
        description: "Reports a session's per-target capture module and best-effort info about what's " +
            "currently active on the page. Does not enumerate arbitrary loadable HUD-module URLs \u2014 " +
            "nothing in this system tracks those; load_module still works for any URL you already " +
            "know. Read-only.",
        inputSchema: { session_id: z.string() },
        annotations: { readOnlyHint: true },
    }, async ({ session_id }: {
        session_id: string;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session)
            return notFound("session_not_found");
        const { capture_module_loaded } = await introspectSession(session);
        return json({
            capture_module_url: `/prexy/games/${session.game}.js`,
            capture_module_loaded,
            note: "Arbitrary HUD-module URLs aren't enumerable \u2014 nothing in this system tracks them. " +
                "load_module still works for any URL you already know.",
        });
    });
    server.registerTool("load_module", {
        description: "Loads (or reloads) a module into a session's connected page from a URL you already " +
            "know \u2014 reuses the existing cache-busted hot-swap mechanism, replacing any already-running " +
            "instance of the same module.",
        inputSchema: { session_id: z.string(), url: z.string() },
        annotations: { readOnlyHint: false },
    }, async ({ session_id, url }: {
        session_id: string;
        url: string;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session)
            return notFound("session_not_found");
        const code = `window.__prexy.loadModule(${JSON.stringify(url)})`;
        const id = crypto.randomUUID();
        broadcastToViewers(session, { type: "eval", id, code, from: "mcp" });
        const result = await sendCommand(session, id, code);
        broadcastToViewers(session, result.ok
            ? { type: "result", id, ok: true, value: result.value, from: "mcp" }
            : { type: "result", id, ok: false, error: result.error, from: "mcp" });
        if (result.ok)
            return json({ loaded: true, module_name: String(result.value) });
        if (TRANSPORT_ERRORS.has(result.error))
            return json({ outcome: "execution_error", error: result.error });
        return json({ outcome: "exception", error: result.error });
    });
}
