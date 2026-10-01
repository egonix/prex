import { Hono } from "hono";
import { CreateTriggerSchema, type Trigger } from "@prex/protocol";
import { getOrCreateSession, getSession, listSessions, pruneIfEmpty, sessionIdOf, setSessionRestorer } from "./sessions/registry.ts";
import { attachPrexySocket } from "./websocket/prexy.ts";
import { attachViewerSocket } from "./websocket/view.ts";
import { sendCommand } from "./rpc/command.ts";
import { broadcastToViewers } from "./sessions/broadcast.ts";
import { serveStaticMounted, serveStaticPrexy } from "./http/static.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { UpdateTriggerSchema, updateTrigger } from "./triggers/update.ts";
import { findContentEqual } from "./triggers/dedup.ts";
import { reset as resetTimings, stats as timingStats } from "./triggers/timing.ts";
import { applySchema } from "./store/schema.ts";
import { recordGap, startIngest } from "./store/ingest.ts";
import { storeEnabled } from "./store/client.ts";
import { stateAt } from "./store/activity.ts";
import { closeEpisodeAt, findOpenEpisodes, loadDeclaredRetention, persistTrigger, restoreSessionConfig, unpersistTrigger } from "./store/config.ts";
import { restoreRetention } from "./store/retention.ts";
const ADMIN_KEY = Deno.env.get("PREX_ADMIN_KEY");
if (!ADMIN_KEY) {
    console.warn("[prex] PREX_ADMIN_KEY is not set \u2014 /api and /ws/view are reachable by anyone who can reach this server");
}
function isAuthorized(key: string | null): boolean {
    if (!ADMIN_KEY)
        return true;
    return key === ADMIN_KEY;
}
function unauthorized(): Response {
    return withCors(new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
    }));
}
function withCors(res: Response): Response {
    res.headers.set("access-control-allow-origin", "*");
    res.headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.headers.set("access-control-allow-headers", "authorization, content-type");
    return res;
}
const app = new Hono();
app.get("/api/sessions", (c) => c.json({ ok: true, sessions: listSessions() }));
app.post("/api/sessions/:token/command", async (c) => {
    const token = c.req.param("token");
    const session = getSession(token);
    if (!session || !session.prexy) {
        return c.json({ ok: false, error: "session not connected" }, 404);
    }
    const body = await c.req.json().catch(() => null);
    const code = body?.code;
    if (typeof code !== "string") {
        return c.json({ ok: false, error: "expected { code: string }" }, 400);
    }
    const silent = body?.silent === true;
    const id = crypto.randomUUID();
    if (!silent)
        broadcastToViewers(session, { type: "eval", id, code, from: "http" });
    const result = await sendCommand(session, id, code);
    if (!silent) {
        broadcastToViewers(session, result.ok
            ? { type: "result", id, ok: true, value: result.value, from: "http" }
            : { type: "result", id, ok: false, error: result.error, from: "http" });
    }
    return c.json(result);
});
app.post("/api/sessions/:token/triggers", async (c) => {
    const token = c.req.param("token");
    const body = await c.req.json().catch(() => null);
    const parsed = CreateTriggerSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ ok: false, error: parsed.error.message }, 400);
    }
    const session = getOrCreateSession(token);
    const duplicate = findContentEqual(session, parsed.data);
    if (duplicate)
        return c.json({ ok: true, trigger: duplicate, deduplicated: true });
    const trigger: Trigger = { id: crypto.randomUUID(), ...parsed.data };
    session.triggers.set(trigger.id, trigger);
    persistTrigger(session, trigger);
    return c.json({ ok: true, trigger });
});
app.get("/api/sessions/:token/triggers", (c) => {
    const session = getSession(c.req.param("token"));
    if (!session)
        return c.json({ ok: false, error: "session not found" }, 404);
    return c.json({ ok: true, triggers: [...session.triggers.values()] });
});
app.delete("/api/sessions/:token/triggers/:id", (c) => {
    const session = getSession(c.req.param("token"));
    if (!session)
        return c.json({ ok: false, error: "session not found" }, 404);
    const existed = session.triggers.delete(c.req.param("id"));
    if (existed)
        unpersistTrigger(session, c.req.param("id"));
    session.triggerLastFired.delete(c.req.param("id"));
    session.triggerLastErrorReported.delete(c.req.param("id"));
    pruneIfEmpty(session);
    return c.json({ ok: existed });
});
app.patch("/api/sessions/:token/triggers/:id", async (c) => {
    const session = getSession(c.req.param("token"));
    if (!session)
        return c.json({ ok: false, error: "session not found" }, 404);
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateTriggerSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ ok: false, error: parsed.error.message }, 400);
    }
    const trigger = updateTrigger(session, c.req.param("id"), parsed.data);
    if (!trigger)
        return c.json({ ok: false, error: "trigger not found" }, 404);
    return c.json({ ok: true, trigger });
});
app.get("/api/sessions/:token/state", async (c) => {
    const session = getSession(c.req.param("token"));
    if (!session)
        return c.json({ ok: false, error: "session not found" }, 404);
    const sessionId = await sessionIdOf(session);
    if (!sessionId)
        return c.json({ ok: false, error: "session id unavailable" }, 503);
    const atParam = c.req.query("at");
    const at = atParam ? Number(atParam) : Date.now();
    if (!Number.isFinite(at))
        return c.json({ ok: false, error: "invalid `at`" }, 400);
    const lookback = Number(c.req.query("lookback") ?? 60000);
    try {
        const state = await stateAt(sessionId, at, session.declaration ?? null, Number.isFinite(lookback) ? lookback : 60000);
        return c.json({ ok: true, state });
    }
    catch (err) {
        return c.json({ ok: false, error: String(err) }, 503);
    }
});
app.get("/api/metrics", (c) => c.json({ ok: true, timings: timingStats() }));
app.post("/api/metrics/reset", (c) => {
    resetTimings();
    return c.json({ ok: true });
});
if (Deno.env.get("PREX_MCP") === "true") {
    app.all("/api/mcp", (c) => handleMcpRequest(c.req.raw));
}
async function initStore(): Promise<void> {
    if (!storeEnabled()) {
        console.log("[prex] activity store disabled (PREX_CLICKHOUSE_URL unset) \u2014 capture, triggers and MCP work as before, nothing is persisted");
        return;
    }
    await applySchema();
    const restored = await restoreRetention(await loadDeclaredRetention());
    if (restored > 0)
        console.log(`[prex] restored retention for ${restored} game(s)`);
    setSessionRestorer(restoreSessionConfig);
    const orphaned = await findOpenEpisodes();
    for (const ep of orphaned) {
        const at = Number(ep.last_activity_ms);
        await closeEpisodeAt(ep.session_id, ep.episode_id, at);
        await recordGap(ep.session_id, at, Date.now(), 0, "process_restart");
    }
    if (orphaned.length > 0) {
        console.log(`[prex] closed ${orphaned.length} episode(s) left open by a previous process`);
    }
    console.log("[prex] activity store ready");
}
async function initStoreWithRetry(): Promise<void> {
    const DELAY_MS = 5000;
    const ATTEMPTS = 24;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            await initStore();
            if (attempt > 1) {
                for (const meta of listSessions()) {
                    const session = getSession(meta.token);
                    if (session)
                        restoreSessionConfig(session);
                }
                console.log(`[prex] activity store reached on attempt ${attempt}`);
            }
            return;
        }
        catch (err) {
            if (attempt === ATTEMPTS) {
                console.warn(`[prex] activity store unreachable after ${ATTEMPTS} attempts: capture and triggers continue, nothing is being stored: ${err}`);
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        }
    }
}
void initStoreWithRetry();
startIngest();
Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8000) }, (req) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/ws/prexy/")) {
        const token = url.pathname.slice("/ws/prexy/".length);
        return attachPrexySocket(req, token);
    }
    if (url.pathname.startsWith("/ws/view/")) {
        if (!isAuthorized(url.searchParams.get("key")))
            return unauthorized();
        const token = url.pathname.slice("/ws/view/".length);
        return attachViewerSocket(req, token);
    }
    if (url.pathname.startsWith("/prexy/")) {
        return serveStaticPrexy(req).then((res) => withCors(res ?? new Response("not found", { status: 404 })));
    }
    if (url.pathname.startsWith("/static/")) {
        return serveStaticMounted(req).then((res) => withCors(res ?? new Response("not found", { status: 404 })));
    }
    if (url.pathname.startsWith("/api/")) {
        if (req.method === "OPTIONS")
            return withCors(new Response(null, { status: 204 }));
        const auth = req.headers.get("authorization") ?? "";
        const key = auth.startsWith("Bearer ") ? auth.slice(7) : null;
        if (!isAuthorized(key))
            return unauthorized();
        return Promise.resolve(app.fetch(req)).then(withCors);
    }
    return app.fetch(req);
});
