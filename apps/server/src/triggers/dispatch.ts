import type { ServerToViewer, Trigger } from "@prex/protocol";
import { toMeta, type Session } from "../sessions/registry.ts";
import { broadcastToViewers } from "../sessions/broadcast.ts";
import { sendCommand } from "../rpc/command.ts";
export type DispatchableMessage = Extract<ServerToViewer, {
    type: "console" | "event" | "prexy-connected" | "prexy-disconnected";
}>;
function matchKeys(message: DispatchableMessage): string[] {
    if (message.type === "console")
        return ["console", `console.${message.level}`];
    if (message.type === "event")
        return ["event", `event:${message.name}`];
    return [message.type];
}
function evalFilter(filterBody: string, event: DispatchableMessage): {
    ok: true;
    value: boolean;
} | {
    ok: false;
    error: unknown;
} {
    try {
        const predicate = new Function("event", filterBody);
        return { ok: true, value: Boolean(predicate(event)) };
    }
    catch (err) {
        return { ok: false, error: err };
    }
}
const FILTER_ERROR_REPORT_INTERVAL_MS = 5000;
function reportFilterError(session: Session, trigger: Trigger, error: unknown): void {
    const lastReported = session.triggerLastErrorReported.get(trigger.id) ?? 0;
    if (Date.now() - lastReported < FILTER_ERROR_REPORT_INTERVAL_MS)
        return;
    session.triggerLastErrorReported.set(trigger.id, Date.now());
    console.warn(`[prex] trigger ${trigger.id} filter threw, skipping`, error);
    broadcastToViewers(session, {
        type: "trigger-fired",
        triggerId: trigger.id,
        match: trigger.match,
        action: trigger.action.type,
        ok: false,
        detail: `filter error: ${error instanceof Error ? error.message : String(error)}`,
    });
}
export function dispatchTriggers(session: Session, message: DispatchableMessage): void {
    if (session.triggers.size === 0)
        return;
    const keys = matchKeys(message);
    for (const trigger of session.triggers.values()) {
        if (trigger.match !== "*" && !keys.includes(trigger.match))
            continue;
        if (trigger.filter) {
            const result = evalFilter(trigger.filter, message);
            if (!result.ok) {
                reportFilterError(session, trigger, result.error);
                continue;
            }
            if (!result.value)
                continue;
        }
        if (trigger.rateLimitMs) {
            const lastFired = session.triggerLastFired.get(trigger.id) ?? 0;
            if (Date.now() - lastFired < trigger.rateLimitMs)
                continue;
        }
        session.triggerLastFired.set(trigger.id, Date.now());
        fireAction(session, trigger, message);
    }
}
function fireAction(session: Session, trigger: Trigger, event: DispatchableMessage): void {
    if (trigger.action.type === "webhook") {
        fireWebhookAction(session, trigger, event);
        return;
    }
    fireEvalAction(session, trigger, event);
}
async function fireWebhookAction(session: Session, trigger: Trigger, event: DispatchableMessage): Promise<void> {
    if (trigger.action.type !== "webhook")
        return;
    const url = trigger.action.url;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ session: toMeta(session), trigger: trigger.id, event }),
        });
        broadcastToViewers(session, {
            type: "trigger-fired",
            triggerId: trigger.id,
            match: trigger.match,
            action: "webhook",
            ok: res.ok,
            detail: String(res.status),
        });
    }
    catch (err) {
        console.warn(`[prex] trigger ${trigger.id} webhook POST to ${url} failed`, err);
        broadcastToViewers(session, {
            type: "trigger-fired",
            triggerId: trigger.id,
            match: trigger.match,
            action: "webhook",
            ok: false,
            detail: String(err),
        });
    }
}
async function fireEvalAction(session: Session, trigger: Trigger, event: DispatchableMessage): Promise<void> {
    if (trigger.action.type !== "eval")
        return;
    const id = crypto.randomUUID();
    const from = `trigger:${trigger.id}`;
    const code = `const event = ${JSON.stringify(event)};\n${trigger.action.code}`;
    broadcastToViewers(session, { type: "eval", id, code: trigger.action.code, from });
    const result = await sendCommand(session, id, code);
    broadcastToViewers(session, result.ok
        ? { type: "result", id, ok: true, value: result.value, from }
        : { type: "result", id, ok: false, error: result.error, from });
    broadcastToViewers(session, {
        type: "trigger-fired",
        triggerId: trigger.id,
        match: trigger.match,
        action: "eval",
        ok: result.ok,
        detail: result.ok ? undefined : result.error,
    });
}
