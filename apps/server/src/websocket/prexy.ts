import type { WSEvents } from "hono/ws";
import { GAME_SCHEMA_EVENT, PrexyToServerSchema } from "@prex/protocol";
import { getOrCreateSession, pruneIfEmpty, sessionIdOf, toMeta } from "../sessions/registry.ts";
import { broadcastToViewers } from "../sessions/broadcast.ts";
import { resolveCommand } from "../rpc/command.ts";
import { dispatchTriggers } from "../triggers/dispatch.ts";
import { applyCapabilityEvent } from "../sessions/capabilities.ts";
import { applyDeclaration, validateDeclaration } from "../sessions/schemas.ts";
import { saveConfig } from "../store/config.ts";
import { retentionOf, setGameRetention } from "../store/retention.ts";
import { record } from "../triggers/timing.ts";
import { enqueue } from "../store/ingest.ts";
import { closeEpisode, openEpisode, upsertSessionRecord } from "../store/config.ts";
export function prexySocketEvents(token: string): WSEvents {
    const session = getOrCreateSession(token);
    const events: WSEvents = {};
    events.onOpen = (_event, socket) => {
        if (session.prexy && session.prexy !== socket && session.prexy.readyState === WebSocket.OPEN) {
            session.prexy.close(4000, "replaced by new prexy connection");
        }
        session.prexy = socket;
        void openEpisode(session).catch((err) => {
            console.warn(`[prex] session ${token}: could not open episode: ${err}`);
        });
    };
    events.onMessage = (event) => {
        const receivedAt = performance.now();
        const frame = typeof event.data === "string" ? event.data : String(event.data);
        let parsed;
        try {
            parsed = PrexyToServerSchema.parse(JSON.parse(frame));
        }
        catch (err) {
            console.warn(`[prex] session ${token}: invalid message from prexy`, err);
            return;
        }
        if (parsed.type === "hello") {
            if (session.declaration && session.declaration.game !== parsed.game) {
                console.warn(`[prex] session ${token}: dropping restored declaration for "${session.declaration.game}", session is "${parsed.game}"`);
                session.declaration = undefined;
            }
            session.game = parsed.game;
            session.meta.url = parsed.url;
            session.meta.origin = parsed.origin;
            session.meta.connectedAt = Date.now();
            const connectedMsg = { type: "prexy-connected" as const, meta: toMeta(session) };
            broadcastToViewers(session, connectedMsg);
            dispatchTriggers(session, connectedMsg);
            void upsertSessionRecord(session).catch((err) => {
                console.warn(`[prex] session ${token}: could not persist session record: ${err}`);
            });
            return;
        }
        if (parsed.type === "result") {
            resolveCommand(session, parsed.id, parsed.ok ? { ok: true, value: parsed.value } : { ok: false, error: parsed.error });
            return;
        }
        if (parsed.type === "event") {
            applyCapabilityEvent(session, parsed.name, parsed.data);
            if (parsed.name === GAME_SCHEMA_EVENT) {
                const result = validateDeclaration(session, parsed.data);
                if (!result.ok || !result.declaration) {
                    console.warn(`[prex] session ${token}: rejected game-schema: ${result.error}`);
                    broadcastToViewers(session, {
                        type: "event" as const,
                        name: "schema-rejected",
                        data: { error: result.error },
                    });
                }
                else {
                    const decl = result.declaration;
                    applyDeclaration(session, decl);
                    void (async () => {
                        const sessionId = await sessionIdOf(session);
                        if (sessionId)
                            await saveConfig(sessionId, "declaration", "current", decl);
                        await setGameRetention(decl.game, retentionOf(decl));
                        console.log(`[prex] session ${token}: applied game-schema for ${decl.game} (${decl.messages.length} rule(s))`);
                    })().catch((err) => {
                        console.warn(`[prex] session ${token}: declaration accepted but not persisted: ${err}`);
                    });
                }
            }
        }
        broadcastToViewers(session, parsed);
        const dispatchStart = performance.now();
        dispatchTriggers(session, parsed);
        const done = performance.now();
        record("dispatch_ms", done - dispatchStart);
        enqueue(session, parsed, frame);
        record("handler_ms", performance.now() - receivedAt);
    };
    events.onClose = (_event, socket) => {
        if (session.prexy === socket) {
            session.prexy = null;
            session.capabilities.clear();
            const disconnectedMsg = { type: "prexy-disconnected" as const, meta: toMeta(session) };
            broadcastToViewers(session, disconnectedMsg);
            dispatchTriggers(session, disconnectedMsg);
            void closeEpisode(session).catch((err) => {
                console.warn(`[prex] session ${token}: could not close episode: ${err}`);
            });
            pruneIfEmpty(session);
        }
    };
    events.onError = (event) => {
        console.warn(`[prex] session ${token}: prexy socket error:`, (event as {
            error?: unknown;
        }).error ?? event);
    };
    return events;
}
