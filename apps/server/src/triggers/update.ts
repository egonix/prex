import { persistTrigger } from "../store/config.ts";
import { CreateTriggerSchema, type Trigger } from "@prex/protocol";
import type { z } from "zod";
import type { Session } from "../sessions/registry.ts";
export const UpdateTriggerSchema = CreateTriggerSchema.partial().extend({
    rateLimitMs: CreateTriggerSchema.shape.rateLimitMs.unwrap().nullable().optional(),
});
export type UpdateTrigger = z.infer<typeof UpdateTriggerSchema>;
export function updateTrigger(session: Session, id: string, patch: UpdateTrigger): Trigger | null {
    const existing = session.triggers.get(id);
    if (!existing)
        return null;
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const updated = { ...existing, ...definedPatch, id: existing.id } as Trigger;
    if (patch.rateLimitMs === null)
        delete updated.rateLimitMs;
    session.triggers.set(id, updated);
    persistTrigger(session, updated);
    return updated;
}
