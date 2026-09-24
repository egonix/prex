import { z } from "zod";
import type { Session } from "./registry.ts";
const CapabilityDefinitionSchema = z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()).optional(),
});
const RegisteredOrChangedSchema = z.object({
    identity: z.string(),
    name: z.string(),
    definition: CapabilityDefinitionSchema,
});
const RemovedSchema = z.object({
    identity: z.string(),
    name: z.string(),
    reason: z.enum(["breaking-change", "target-unreachable", "target-gone", "module-unloaded"]),
});
const InvalidatedSchema = z.object({ identity: z.string() });
export interface CapabilityRecord {
    identity: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    available: boolean;
}
export function applyCapabilityEvent(session: Session, name: string, data: unknown): void {
    switch (name) {
        case "prexycp-loaded":
        case "prexycp-reloaded":
            session.capabilities.clear();
            return;
        case "capability-registered":
        case "capability-changed": {
            const parsed = RegisteredOrChangedSchema.safeParse(data);
            if (!parsed.success)
                return;
            const { identity, name: capName, definition } = parsed.data;
            session.capabilities.set(identity, {
                identity,
                name: capName,
                description: definition.description,
                inputSchema: definition.inputSchema,
                outputSchema: definition.outputSchema,
                available: true,
            });
            return;
        }
        case "capability-removed": {
            const parsed = RemovedSchema.safeParse(data);
            if (!parsed.success)
                return;
            session.capabilities.delete(parsed.data.identity);
            return;
        }
        case "capability-invalidated": {
            const parsed = InvalidatedSchema.safeParse(data);
            if (!parsed.success)
                return;
            const existing = session.capabilities.get(parsed.data.identity);
            if (existing)
                existing.available = false;
            return;
        }
        case "target-connection-restored": {
            for (const record of session.capabilities.values())
                record.available = true;
            return;
        }
    }
}
export function listCapabilities(session: Session): CapabilityRecord[] {
    return [...session.capabilities.values()];
}
