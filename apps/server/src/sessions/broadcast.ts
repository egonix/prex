import type { ServerToViewer } from "@prex/protocol";
import type { Session } from "./registry.ts";
export function broadcastToViewers(session: Session, message: ServerToViewer): void {
    const payload = JSON.stringify(message);
    for (const socket of session.viewers.values()) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(payload);
        }
    }
}
