import { GameSchemaDeclarationSchema, type GameSchemaDeclaration } from "@prex/protocol";
import type { Session } from "./registry.ts";
export interface DeclarationResult {
    ok: boolean;
    error?: string;
    declaration?: GameSchemaDeclaration;
}
export function validateDeclaration(session: Session, data: unknown, opts?: {
    skipGameCheck?: boolean;
}): DeclarationResult {
    const parsed = GameSchemaDeclarationSchema.safeParse(data);
    if (!parsed.success)
        return { ok: false, error: `malformed declaration: ${parsed.error.message}` };
    const decl = parsed.data;
    if (!opts?.skipGameCheck && decl.game !== session.game) {
        return { ok: false, error: `declaration game "${decl.game}" does not match session game "${session.game}"` };
    }
    for (const rule of decl.messages) {
        if (!rule.match.kind)
            return { ok: false, error: "match.kind is required" };
        const seen = new Map<string, string>();
        for (const [role, names] of Object.entries(rule.fields ?? {})) {
            for (const name of names ?? []) {
                const prior = seen.get(name);
                if (prior && prior !== role) {
                    return { ok: false, error: `field "${name}" declared as both ${prior} and ${role}` };
                }
                seen.set(name, role);
            }
        }
        if (rule.retention && !isDuration(rule.retention)) {
            return { ok: false, error: `invalid retention "${rule.retention}" (expected e.g. 30s, 15m, 1h, 7d)` };
        }
    }
    if (decl.defaultRetention && !isDuration(decl.defaultRetention)) {
        return { ok: false, error: `invalid defaultRetention "${decl.defaultRetention}"` };
    }
    return { ok: true, declaration: decl };
}
function isDuration(value: string): boolean {
    return /^\d+[smhd]$/.test(value.trim()) && Number(value.trim().slice(0, -1)) > 0;
}
export function applyDeclaration(session: Session, decl: GameSchemaDeclaration): void {
    session.declaration = decl;
}
export function getDeclaration(session: Session): GameSchemaDeclaration | null {
    return session.declaration ?? null;
}
