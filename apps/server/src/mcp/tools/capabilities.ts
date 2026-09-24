import type { McpServer } from "npm:@modelcontextprotocol/sdk@^1.30.0/server/mcp.js";
import { z } from "zod";
import { sendCommand } from "../../rpc/command.ts";
import { resolveSessionId } from "../session-id.ts";
import { listCapabilities } from "../../sessions/capabilities.ts";
const TRANSPORT_ERRORS = new Set(["prexy not connected", "command timed out"]);
const InvokeEnvelopeSchema = z.union([
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({
        ok: z.literal(false),
        error: z.string(),
        kind: z.enum(["not-found", "unavailable", "invocation-error"]),
    }),
]);
function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function notFound(text: string) {
    return { isError: true, content: [{ type: "text" as const, text }] };
}
export function registerCapabilityTools(server: McpServer): void {
    server.registerTool("list_capabilities", {
        description: "Lists the target-page capabilities a loaded prexycp module has generated for a session " +
            "\u2014 name, description, input schema, and whether each is currently available. Empty if the " +
            "session never loaded prexycp. Read-only.",
        inputSchema: { session_id: z.string() },
        annotations: { readOnlyHint: true },
    }, async ({ session_id }: {
        session_id: string;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session)
            return notFound("session_not_found");
        return json(listCapabilities(session));
    });
    server.registerTool("invoke_capability", {
        description: "Invokes one target-page capability a loaded prexycp module has generated for a session " +
            "(see list_capabilities for available identities), by identity. This is the dedicated, " +
            "schema-aware path \u2014 equivalent to eval'ing `window.__prexycp.invoke(...)` directly via " +
            "execute_javascript, but unwraps prexycp's own result envelope for you.",
        inputSchema: { session_id: z.string(), identity: z.string(), args: z.record(z.unknown()).optional() },
        annotations: { readOnlyHint: false },
    }, async ({ session_id, identity, args }: {
        session_id: string;
        identity: string;
        args?: Record<string, unknown>;
    }) => {
        const session = await resolveSessionId(session_id);
        if (!session)
            return notFound("session_not_found");
        const argsJson = JSON.stringify(args ?? {});
        const code = `window.__prexycp.invoke(${JSON.stringify(identity)}, ${JSON.stringify(argsJson)})`;
        const result = await sendCommand(session, crypto.randomUUID(), code);
        if (!result.ok) {
            if (TRANSPORT_ERRORS.has(result.error))
                return json({ outcome: "execution_error", error: result.error });
            return json({ outcome: "exception", error: result.error });
        }
        let envelopeRaw: unknown;
        try {
            envelopeRaw = JSON.parse(String(result.value));
        }
        catch {
            return json({ outcome: "exception", error: "prexycp returned a non-JSON result" });
        }
        const envelope = InvokeEnvelopeSchema.safeParse(envelopeRaw);
        if (!envelope.success) {
            return json({ outcome: "exception", error: "prexycp's result did not match its own documented envelope" });
        }
        if (envelope.data.ok)
            return json({ outcome: "result", value: envelope.data.value });
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ outcome: "capability_error", error: envelope.data.error, kind: envelope.data.kind }, null, 2) }] };
    });
}
