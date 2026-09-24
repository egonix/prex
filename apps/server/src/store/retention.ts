import { exec, sqlString } from "./client.ts";
import { DEFAULT_RETENTION_DAYS } from "./schema.ts";
export interface RetentionRule {
    game: string;
    kind?: string;
    type?: string;
    duration: string;
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
export async function applyRetention(rules: RetentionRule[], defaultDuration?: string): Promise<boolean> {
    const clause = buildTtlClause(rules, defaultDuration);
    if (clause === null)
        return false;
    await exec(`ALTER TABLE activity MODIFY TTL ${clause}`);
    return true;
}
const byGame = new Map<string, {
    rules: RetentionRule[];
    defaultDuration?: string;
}>();
function widestDefault(): string | undefined {
    let best: string | undefined;
    let bestMs = -1;
    const MS: Record<string, number> = { SECOND: 1000, MINUTE: 60000, HOUR: 3600000, DAY: 86400000 };
    for (const entry of byGame.values()) {
        if (!entry.defaultDuration)
            continue;
        const d = parseDuration(entry.defaultDuration);
        if (!d)
            continue;
        const ms = d.amount * MS[d.unit];
        if (ms > bestMs) {
            bestMs = ms;
            best = entry.defaultDuration;
        }
    }
    return best;
}
export async function setGameRetention(game: string, rules: RetentionRule[], defaultDuration?: string): Promise<boolean> {
    byGame.set(game, { rules, defaultDuration });
    const all: RetentionRule[] = [];
    for (const entry of byGame.values())
        all.push(...entry.rules);
    return await applyRetention(all, widestDefault());
}
