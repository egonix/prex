import { persistTrigger } from "../store/config.ts";
import { CreateTriggerSchema, type Trigger } from "@prex/protocol";
import type { Session } from "../sessions/registry.ts";
export const UpdateTriggerSchema = CreateTriggerSchema.partial();
export function updateTrigger(session: Session, id: string, patch: Partial<Omit<Trigger, "id">>): Trigger | null {
    const existing = session.triggers.get(id);
    if (!existing)
        return null;
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const updated: Trigger = { ...existing, ...definedPatch, id: existing.id };
    session.triggers.set(id, updated);
    persistTrigger(session, updated);
    return updated;
}
