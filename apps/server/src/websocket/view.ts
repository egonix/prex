import { ViewerToServerSchema } from "@prex/protocol";
import { getOrCreateSession, pruneIfEmpty, toMeta } from "../sessions/registry.ts";
import { broadcastToViewers } from "../sessions/broadcast.ts";
import { sendCommand } from "../rpc/command.ts";
export function attachViewerSocket(req: Request, token: string): Response {
    if (!token)
        return new Response("missing token", { status: 400 });
    const { socket, response } = Deno.upgradeWebSocket(req);
    const session = getOrCreateSession(token);
    const viewerId = crypto.randomUUID();
    socket.onopen = () => {
        session.viewers.set(viewerId, socket);
        socket.send(JSON.stringify({ type: "viewer-welcome", viewerId }));
        if (session.prexy) {
            socket.send(JSON.stringify({ type: "prexy-connected", meta: toMeta(session) }));
        }
    };
    socket.onmessage = async (event) => {
        let parsed;
        try {
            parsed = ViewerToServerSchema.parse(JSON.parse(event.data));
        }
        catch (err) {
            console.warn(`[prex] session ${token}: invalid message from viewer`, err);
            return;
        }
        if (parsed.type === "eval") {
            const id = crypto.randomUUID();
            broadcastToViewers(session, { type: "eval", id, code: parsed.code, from: viewerId });
            const result = await sendCommand(session, id, parsed.code);
            broadcastToViewers(session, result.ok
                ? { type: "result", id, ok: true, value: result.value, from: viewerId }
                : { type: "result", id, ok: false, error: result.error, from: viewerId });
        }
    };
    socket.onclose = () => {
        session.viewers.delete(viewerId);
        pruneIfEmpty(session);
    };
    socket.onerror = (event) => {
        console.warn(`[prex] session ${token}: viewer socket error`, event);
    };
    return response;
}
