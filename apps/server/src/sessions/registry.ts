import type { GameSchemaDeclaration, SessionMeta, Trigger } from "@prex/protocol";
import type { CapabilityRecord } from "./capabilities.ts";
import { deriveSessionId } from "../mcp/session-id.ts";
export interface PendingCommand {
    resolve: (result: {
        ok: true;
        value: unknown;
    } | {
        ok: false;
        error: string;
    }) => void;
    timer: ReturnType<typeof setTimeout>;
}
export interface Viewer {
    id: string;
    socket: WebSocket;
}
export interface Session {
    token: string;
    sessionId: string;
    sessionIdReady: Promise<string>;
    episodeId: number;
    game: string;
    prexy: WebSocket | null;
    viewers: Map<string, WebSocket>;
    meta: {
        url?: string;
        origin?: string;
        userAgent?: string;
        connectedAt?: number;
    };
    pending: Map<string, PendingCommand>;
    triggers: Map<string, Trigger>;
    triggerLastFired: Map<string, number>;
    triggerLastErrorReported: Map<string, number>;
    capabilities: Map<string, CapabilityRecord>;
    declaration?: GameSchemaDeclaration;
}
const sessions = new Map<string, Session>();
export function getSession(token: string): Session | undefined {
    return sessions.get(token);
}
let restorer: ((session: Session) => void) | null = null;
export function setSessionRestorer(fn: (session: Session) => void): void {
    restorer = fn;
}
export function getOrCreateSession(token: string): Session {
    let session = sessions.get(token);
    if (!session) {
        session = {
            token,
            sessionId: "",
            sessionIdReady: Promise.resolve(""),
            episodeId: 0,
            game: "unknown",
            prexy: null,
            viewers: new Map(),
            meta: {},
            pending: new Map(),
            triggers: new Map(),
            triggerLastFired: new Map(),
            triggerLastErrorReported: new Map(),
            capabilities: new Map(),
        };
        sessions.set(token, session);
        const created = session;
        created.sessionIdReady = deriveSessionId(token).then((id) => {
            created.sessionId = id;
            return id;
        });
        restorer?.(created);
    }
    return session;
}
export function sessionIdOf(session: Session): Promise<string> {
    return session.sessionId ? Promise.resolve(session.sessionId) : session.sessionIdReady;
}
export function listSessions(): SessionMeta[] {
    return [...sessions.values()].map(toMeta);
}
export function toMeta(session: Session): SessionMeta {
    return {
        token: session.token,
        game: session.game,
        viewerCount: session.viewers.size,
        ...session.meta,
    };
}
export function pruneIfEmpty(session: Session): void {
    if (!session.prexy && session.viewers.size === 0 && session.triggers.size === 0) {
        for (const pending of session.pending.values()) {
            clearTimeout(pending.timer);
            pending.resolve({ ok: false, error: "session closed" });
        }
        sessions.delete(session.token);
    }
}
