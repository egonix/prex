import type { CreateTrigger, Trigger } from "@prex/protocol";
import type { Session } from "../sessions/registry.ts";
export function triggerContentEquals(a: CreateTrigger, b: CreateTrigger): boolean {
    if (a.match !== b.match)
        return false;
    if ((a.filter ?? "") !== (b.filter ?? ""))
        return false;
    if ((a.rateLimitMs ?? null) !== (b.rateLimitMs ?? null))
        return false;
    if (a.action.type !== b.action.type)
        return false;
    if (a.action.type === "webhook" && b.action.type === "webhook")
        return a.action.url === b.action.url;
    if (a.action.type === "eval" && b.action.type === "eval")
        return a.action.code === b.action.code;
    return false;
}
export function findContentEqual(session: Session, input: CreateTrigger): Trigger | undefined {
    for (const existing of session.triggers.values()) {
        if (triggerContentEquals(existing, input))
            return existing;
    }
    return undefined;
}
