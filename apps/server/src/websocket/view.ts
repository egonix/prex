import type { WSEvents } from "hono/ws";
import { ViewerToServerSchema } from "@prex/protocol";
import { getOrCreateSession, pruneIfEmpty, toMeta } from "../sessions/registry.ts";
import { broadcastToViewers } from "../sessions/broadcast.ts";
import { sendCommand } from "../rpc/command.ts";
export function viewerSocketEvents(token: string): WSEvents {
    const session = getOrCreateSession(token);
    const viewerId = crypto.randomUUID();
    const events: WSEvents = {};
    events.onOpen = (_event, socket) => {
        session.viewers.set(viewerId, socket);
        socket.send(JSON.stringify({ type: "viewer-welcome", viewerId }));
        if (session.prexy) {
            socket.send(JSON.stringify({ type: "prexy-connected", meta: toMeta(session) }));
        }
    };
    events.onMessage = async (event) => {
        let parsed;
        try {
            parsed = ViewerToServerSchema.parse(JSON.parse(typeof event.data === "string" ? event.data : String(event.data)));
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
    events.onClose = () => {
        session.viewers.delete(viewerId);
        pruneIfEmpty(session);
    };
    events.onError = (event) => {
        console.warn(`[prex] session ${token}: viewer socket error:`, (event as {
            error?: unknown;
        }).error ?? event);
    };
    return events;
}
