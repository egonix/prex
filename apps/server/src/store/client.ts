const URL_BASE = process.env.PREX_CLICKHOUSE_URL ?? "";
const DB = process.env.PREX_CLICKHOUSE_DB ?? "prex";
const USER = process.env.PREX_CLICKHOUSE_USER ?? "default";
const PASSWORD = process.env.PREX_CLICKHOUSE_PASSWORD ?? "";
export const SESSION_NOT_FOUND = "session_not_found";
export const STORE_UNAVAILABLE = "store_unavailable";
export class StoreUnavailable extends Error {
    readonly code = STORE_UNAVAILABLE;
    constructor(cause: unknown) {
        super(`activity store unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = "StoreUnavailable";
    }
}
export const QUERY_FAILED = "query_failed";
export class QueryRejected extends Error {
    readonly code = QUERY_FAILED;
    readonly reason: string;
    constructor(reason: string, message: string) {
        super(message);
        this.name = "QueryRejected";
        this.reason = reason;
    }
}
function rejection(text: string): QueryRejected | null {
    let body = text.trim();
    try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.exception === "string")
            body = parsed.exception.trim();
    }
    catch {
    }
    const m = /Code: (\d+)\. DB::Exception: ([\s\S]*?)(?: \(([A-Z][A-Z0-9_]*)\))?(?: \(version [\s\S]*)?$/.exec(body);
    if (!m)
        return null;
    const message = m[2].replace(/\s*In query [\s\S]*$/, "").trim();
    return new QueryRejected(m[3] ?? `CODE_${m[1]}`, message);
}
let reachable = false;
export function storeReachable(): boolean {
    return reachable;
}
export function storeEnabled(): boolean {
    return URL_BASE !== "";
}
async function send(body: string, params: Record<string, string> = {}): Promise<string> {
    if (!URL_BASE)
        throw new StoreUnavailable("activity store is not configured (PREX_CLICKHOUSE_URL unset)");
    const url = new URL(URL_BASE);
    url.searchParams.set("database", DB);
    for (const [k, v] of Object.entries(params))
        url.searchParams.set(k, v);
    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            body,
            headers: { "X-ClickHouse-User": USER, "X-ClickHouse-Key": PASSWORD },
        });
    }
    catch (err) {
        reachable = false;
        throw new StoreUnavailable(err);
    }
    const text = await res.text();
    if (!res.ok) {
        const rejected = rejection(text);
        reachable = rejected !== null || res.status < 500;
        throw rejected ?? new StoreUnavailable(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    reachable = true;
    return text;
}
export async function exec(sql: string): Promise<void> {
    await send(sql);
}
export async function query<T>(sql: string, settings: Record<string, string> = {}): Promise<T[]> {
    const text = await send(`${sql} FORMAT JSONEachRow`, settings);
    const out: T[] = [];
    for (const line of text.split("\n")) {
        if (line.trim())
            out.push(JSON.parse(line) as T);
    }
    return out;
}
export async function insertRows(table: string, rows: string[]): Promise<void> {
    if (rows.length === 0)
        return;
    await send(rows.join("\n"), { query: `INSERT INTO ${table} FORMAT JSONEachRow` });
}
export function sqlString(value: string): string {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
export function database(): string {
    return DB;
}
export const __testing = { rejection };
