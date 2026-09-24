import type { Session } from "../sessions/registry.ts";
export interface McpSessionSummary {
    session_id: string;
    game: string;
    origin: string | null;
    url: string | null;
    connected: boolean;
    connected_at: number | null;
    viewer_count: number;
}
export function toSessionSummary(sessionId: string, session: Session): McpSessionSummary {
    return {
        session_id: sessionId,
        game: session.game,
        origin: session.meta.origin ?? null,
        url: session.meta.url ?? null,
        connected: session.prexy !== null,
        connected_at: session.meta.connectedAt ?? null,
        viewer_count: session.viewers.size,
    };
}
export interface McpSessionDetailBase extends McpSessionSummary {
    capture_module: string;
}
export function toSessionDetailBase(sessionId: string, session: Session): McpSessionDetailBase {
    return {
        ...toSessionSummary(sessionId, session),
        capture_module: `/prexy/games/${session.game}.js`,
    };
}
