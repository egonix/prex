import { query, sqlString } from "./client.ts";
import { envInt } from "./tuning.ts";
const MAX_MEMORY_BYTES = envInt("PREX_SQL_MAX_MEMORY_MB", 512, { min: 64, max: 16384 }) * 1024 * 1024;
const MAX_EXECUTION_SECONDS = envInt("PREX_SQL_TIMEOUT_SECONDS", 15, { min: 1, max: 300 });
const DEFAULT_ROWS = 200;
const MAX_ROWS = 1000;
function limitSettings(rows: number): Record<string, string> {
    return {
        readonly: "2",
        max_execution_time: String(MAX_EXECUTION_SECONDS),
        max_memory_usage: String(MAX_MEMORY_BYTES),
        max_result_rows: String(rows),
        max_block_size: String(rows),
        result_overflow_mode: "break",
    };
}
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
export class AdHocRejected extends Error {
}
function validate(sql: string): string {
    const trimmed = sql.trim().replace(/;\s*$/, "");
    if (trimmed.length === 0)
        throw new AdHocRejected("empty query");
    if (trimmed.includes(";"))
        throw new AdHocRejected("only a single statement is allowed");
    if (!/^(select|with)\b/i.test(trimmed)) {
        throw new AdHocRejected("only SELECT (or WITH ... SELECT) is allowed");
    }
    if (/\bformat\s+[a-z]/i.test(trimmed)) {
        throw new AdHocRejected("remove the FORMAT clause; results are always returned as rows");
    }
    return trimmed;
}
export interface AdHocResult {
    rows: unknown[];
    row_count: number;
    truncated: boolean;
    row_limit: number;
    note?: string;
}
export async function runReadOnlySql(opts: {
    sessionId: string;
    sql: string;
    limit?: number;
}): Promise<AdHocResult> {
    if (!SAFE_SESSION_ID.test(opts.sessionId))
        throw new AdHocRejected("session_id has an unexpected shape");
    const sql = validate(opts.sql);
    const rows = Math.min(MAX_ROWS, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_ROWS)));
    const scope = `session_id = ''${opts.sessionId}''`;
    const settings = {
        ...limitSettings(rows),
        additional_table_filters: `{'activity' : '${scope}', 'gaps' : '${scope}'}`,
    };
    const out = await query<unknown>(`SELECT * FROM (${sql}) LIMIT ${rows + 1}`, {
        ...settings,
        max_result_rows: String(rows + 1),
        max_block_size: String(rows + 1),
    });
    const truncated = out.length > rows;
    return {
        rows: truncated ? out.slice(0, rows) : out,
        row_count: truncated ? rows : out.length,
        truncated,
        row_limit: rows,
        note: truncated ? `more rows matched; showing the first ${rows}` : undefined,
    };
}
export const __testing = { validate, SAFE_SESSION_ID, sqlString };
