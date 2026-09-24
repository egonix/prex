const URL_BASE = Deno.env.get("PREX_CLICKHOUSE_URL") ?? "";
const DB = Deno.env.get("PREX_CLICKHOUSE_DB") ?? "prex";
const USER = Deno.env.get("PREX_CLICKHOUSE_USER") ?? "default";
const PASSWORD = Deno.env.get("PREX_CLICKHOUSE_PASSWORD") ?? "";
export const SESSION_NOT_FOUND = "session_not_found";
export const STORE_UNAVAILABLE = "store_unavailable";
export class StoreUnavailable extends Error {
    readonly code = STORE_UNAVAILABLE;
    constructor(cause: unknown) {
        super(`activity store unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = "StoreUnavailable";
    }
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
        reachable = res.status < 500;
        throw new StoreUnavailable(`HTTP ${res.status}: ${text.slice(0, 500)}`);
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
