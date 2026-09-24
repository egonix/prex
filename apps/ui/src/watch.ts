import type { ServerToViewer } from "./protocol";
export interface WatchDef {
    id: string;
    groupKey: string;
    path: string;
    label?: string;
}
export function groupKeyOf(msg: ServerToViewer): string | null {
    if (msg.type !== "event")
        return null;
    const data = msg.data;
    if (!data || typeof data !== "object")
        return null;
    const d = data as Record<string, unknown>;
    if (msg.name === "ws" && typeof d.type === "string")
        return `ws:${d.type}`;
    if (msg.name === "http") {
        const method = typeof d.method === "string" ? d.method : "?";
        const path = typeof d.path === "string" ? d.path : typeof d.url === "string" ? d.url : "?";
        return `http:${method} ${path}`;
    }
    return null;
}
export function rootValueFor(msg: ServerToViewer): unknown {
    if (msg.type !== "event")
        return undefined;
    const data = msg.data as Record<string, unknown>;
    return msg.name === "ws" ? data.payload : data;
}
export function valueAtPath(root: unknown, path: string): unknown {
    if (!path)
        return root;
    let cur: unknown = root;
    for (const seg of path.split(".")) {
        if (cur == null || typeof cur !== "object")
            return undefined;
        cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
}
export interface LeafChange {
    path: string;
    previous: unknown;
    current: unknown;
    kind: "number" | "primitive" | "added" | "removed";
    delta?: number;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
const ARRAY_ID_KEYS = ["id", "sourceId"];
function arrayIdKey(arr: unknown[]): string | null {
    if (arr.length === 0)
        return null;
    for (const k of ARRAY_ID_KEYS) {
        if (arr.every((el) => isPlainObject(el) && typeof el[k] === "string"))
            return k;
    }
    return null;
}
function joinPath(base: string, seg: string): string {
    return base ? `${base}.${seg}` : seg;
}
export function diffValues(previous: unknown, current: unknown, basePath = ""): LeafChange[] {
    if (previous === current)
        return [];
    if (isPlainObject(previous) && isPlainObject(current)) {
        const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
        const out: LeafChange[] = [];
        for (const k of keys)
            out.push(...diffValues(previous[k], current[k], joinPath(basePath, k)));
        return out;
    }
    if (Array.isArray(previous) && Array.isArray(current)) {
        const idKey = arrayIdKey(previous) || arrayIdKey(current);
        if (idKey) {
            const prevMap = new Map(previous.map((el) => [(el as Record<string, unknown>)[idKey], el]));
            const curMap = new Map(current.map((el) => [(el as Record<string, unknown>)[idKey], el]));
            const ids = new Set([...prevMap.keys(), ...curMap.keys()]);
            const out: LeafChange[] = [];
            for (const id of ids)
                out.push(...diffValues(prevMap.get(id), curMap.get(id), `${basePath}[${id}]`));
            return out;
        }
        if (JSON.stringify(previous) === JSON.stringify(current))
            return [];
        return [{ path: basePath, previous, current, kind: "primitive" }];
    }
    if (previous === undefined && current !== undefined)
        return [{ path: basePath, previous, current, kind: "added" }];
    if (current === undefined && previous !== undefined)
        return [{ path: basePath, previous, current, kind: "removed" }];
    if (typeof previous === "number" && typeof current === "number") {
        return [{ path: basePath, previous, current, kind: "number", delta: current - previous }];
    }
    return [{ path: basePath, previous, current, kind: "primitive" }];
}
