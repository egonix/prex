import type { GameSchemaDeclaration } from "@prex/protocol";
import { exec, sqlString } from "./client.ts";
import { DEFAULT_RETENTION_DAYS } from "./schema.ts";
export interface RetentionRule {
    game: string;
    kind?: string;
    type?: string;
    duration: string;
}
export interface GameRetention {
    rules: RetentionRule[];
    defaultDuration?: string;
}
export function retentionOf(decl: GameSchemaDeclaration): GameRetention {
    return {
        rules: decl.messages
            .filter((m) => m.retention)
            .map((m) => ({ game: decl.game, kind: m.match.kind, type: m.match.type, duration: m.retention! })),
        defaultDuration: decl.defaultRetention,
    };
}
const UNITS: Record<string, string> = { s: "SECOND", m: "MINUTE", h: "HOUR", d: "DAY" };
export interface ParsedDuration {
    amount: number;
    unit: string;
}
export function parseDuration(value: string): ParsedDuration | null {
    const m = /^(\d+)([smhd])$/.exec(value.trim());
    if (!m)
        return null;
    const amount = Number(m[1]);
    if (!Number.isSafeInteger(amount) || amount <= 0)
        return null;
    return { amount, unit: UNITS[m[2]] };
}
export function buildTtlClause(rules: RetentionRule[], defaultDuration?: string): string | null {
    const parts: string[] = [];
    for (const rule of rules) {
        const d = parseDuration(rule.duration);
        if (!d)
            return null;
        const conds = [`game = ${sqlString(rule.game)}`];
        if (rule.kind)
            conds.push(`kind = ${sqlString(rule.kind)}`);
        if (rule.type)
            conds.push(`type = ${sqlString(rule.type)}`);
        parts.push(`ts + INTERVAL ${d.amount} ${d.unit} DELETE WHERE ${conds.join(" AND ")}`);
    }
    const fallback = defaultDuration ? parseDuration(defaultDuration) : null;
    if (defaultDuration && !fallback)
        return null;
    parts.push(fallback
        ? `ts + INTERVAL ${fallback.amount} ${fallback.unit} DELETE`
        : `ts + INTERVAL ${DEFAULT_RETENTION_DAYS} DAY DELETE`);
    return parts.join(", ");
}
async function applyClause(clause: string | null): Promise<boolean> {
    if (clause === null)
        return false;
    await exec(`ALTER TABLE activity MODIFY TTL ${clause}`);
    return true;
}
const byGame = new Map<string, GameRetention>();
const MS: Record<string, number> = { SECOND: 1000, MINUTE: 60000, HOUR: 3600000, DAY: 86400000 };
export function registryClause(entries: Iterable<[
    string,
    GameRetention
]>): string | null {
    const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const rules: RetentionRule[] = [];
    let widest: string | undefined;
    let widestMs = -1;
    for (const [, entry] of sorted) {
        rules.push(...entry.rules);
        const d = entry.defaultDuration ? parseDuration(entry.defaultDuration) : null;
        if (d && d.amount * MS[d.unit] > widestMs) {
            widestMs = d.amount * MS[d.unit];
            widest = entry.defaultDuration;
        }
    }
    return buildTtlClause(rules, widest);
}
export async function setGameRetention(game: string, retention: GameRetention): Promise<boolean> {
    byGame.set(game, retention);
    return await applyClause(registryClause(byGame));
}
export async function restoreRetention(stored: Map<string, GameRetention>): Promise<number> {
    let added = 0;
    for (const [game, retention] of stored) {
        if (byGame.has(game))
            continue;
        byGame.set(game, retention);
        added++;
    }
    if (byGame.size > 0)
        await applyClause(registryClause(byGame));
    return added;
}
