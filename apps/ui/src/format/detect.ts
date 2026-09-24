import { recipeOf, type InterpretationKind, type Recipe } from "./recipe";
export const EPOCH_MS_FLOOR = 1000000000000;
export const EPOCH_MS_CEILING = 2000000000000;
export const EPOCH_S_FLOOR = 1000000000;
export const EPOCH_S_CEILING = 2000000000;
export const TIME_WORDS = new Set([
    "time",
    "timestamp",
    "ts",
    "at",
    "date",
    "expires",
    "expiry",
    "deadline",
    "until",
    "since",
    "start",
    "end",
    "seen",
    "stamp",
]);
export function wordsOf(segment: string): string[] {
    return segment
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((w) => w.toLowerCase());
}
export function hasTimeLikeName(path: string): boolean {
    const last = path.split(".").pop() ?? "";
    return wordsOf(last).some((w) => TIME_WORDS.has(w));
}
export interface Detection {
    recipe: Recipe;
    kind: InterpretationKind;
}
function numericValue(value: unknown): {
    n: number;
    coerced: boolean;
} | null {
    if (typeof value === "number")
        return Number.isFinite(value) ? { n: value, coerced: false } : null;
    if (typeof value === "string") {
        const s = value.trim();
        if (s === "")
            return null;
        const n = Number(s);
        return Number.isFinite(n) ? { n, coerced: true } : null;
    }
    return null;
}
export function detect(value: unknown, path: string): Detection | null {
    if (looksLikeJwt(value))
        return { recipe: recipeOf("jwt.decode"), kind: "custom" };
    const indexed = indexedByteObject(value);
    if (indexed) {
        const text = utf8OrNull(indexed);
        if (text !== null) {
            const base = ["object.toList", "array.toBytes", "utf8.decode"];
            try {
                JSON.parse(text);
                return { recipe: recipeOf(...base, "json.parse"), kind: "custom" };
            }
            catch {
                return { recipe: recipeOf(...base), kind: "custom" };
            }
        }
    }
    const num = numericValue(value);
    if (!num)
        return null;
    const { n, coerced } = num;
    if (n < 0 || !Number.isInteger(n))
        return null;
    const chain = (opId: string): Detection => ({
        recipe: coerced ? recipeOf("to.number", opId) : recipeOf(opId),
        kind: "time",
    });
    if (n >= EPOCH_MS_FLOOR && n < EPOCH_MS_CEILING)
        return chain("time.epochMs");
    if (n >= EPOCH_S_FLOOR && n < EPOCH_S_CEILING && hasTimeLikeName(path))
        return chain("time.epochS");
    return null;
}
function asByteArray(value: unknown): number[] | null {
    if (value instanceof Uint8Array)
        return Array.from(value.slice(0, 4));
    if (Array.isArray(value) && value.length >= 2) {
        const head = value.slice(0, 4);
        if (head.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255))
            return head as number[];
    }
    return null;
}
export interface MagicMatch {
    label: string;
    reason: string;
    opId: string;
}
export function magicOf(value: unknown): MagicMatch | null {
    const head = asByteArray(value);
    if (!head)
        return null;
    const hex = head.map((b) => b.toString(16).padStart(2, "0"));
    if (head[0] === 31 && head[1] === 139 && head[2] === 8) {
        return { label: "a gzip frame", reason: `starts ${hex.slice(0, 3).join(" ")}`, opId: "gunzip" };
    }
    if ((head[0] & 15) === 8 && head.length >= 2 && ((head[0] << 8) | head[1]) % 31 === 0) {
        return { label: "a zlib stream", reason: `starts ${hex.slice(0, 2).join(" ")}, a valid zlib header`, opId: "inflate" };
    }
    if (head[0] === 80 && head[1] === 75 && head[2] === 3 && head[3] === 4) {
        return { label: "a zip archive", reason: "starts 50 4b 03 04 (PK)", opId: "" };
    }
    return null;
}
export function looksLikeJwt(value: unknown): boolean {
    if (typeof value !== "string")
        return false;
    const parts = value.trim().split(".");
    if (parts.length !== 3 || parts.some((p) => p.length === 0))
        return false;
    if (!/^[A-Za-z0-9_-]+$/.test(parts[0]))
        return false;
    try {
        const b = parts[0].replace(/-/g, "+").replace(/_/g, "/");
        const header = JSON.parse(atob(b.padEnd(Math.ceil(b.length / 4) * 4, "=")));
        return header !== null && typeof header === "object" && typeof header.alg === "string";
    }
    catch {
        return false;
    }
}
const MAX_INDEXED_ENTRIES = 8192;
export function indexedByteObject(value: unknown): number[] | null {
    if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array)
        return null;
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0 || keys.length > MAX_INDEXED_ENTRIES || keys[0] !== "0")
        return null;
    const obj = value as Record<string, unknown>;
    const out: number[] = [];
    for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== String(i))
            return null;
        const v = obj[keys[i]];
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255)
            return null;
        out.push(v);
    }
    return out;
}
function utf8OrNull(bytes: number[]): string | null {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    }
    catch {
        return null;
    }
}
export interface Suggestion {
    label: string;
    reason: string;
    steps: {
        opId: string;
        args?: Record<string, string | number>;
        each?: boolean;
    }[];
}
function allNumbers(a: unknown[]): a is number[] {
    return a.length > 0 && a.every((v) => typeof v === "number" && Number.isFinite(v));
}
export function suggest(value: unknown): Suggestion[] {
    const out: Suggestion[] = [];
    const magic = magicOf(value);
    if (magic) {
        if (magic.opId === "") {
            out.push({ label: `Looks like ${magic.label}`, reason: `${magic.reason}: no operation here can open one`, steps: [] });
        }
        else {
            const toBytes = value instanceof Uint8Array ? [] : [{ opId: "array.toBytes" }];
            out.push({
                label: `Looks like ${magic.label}`,
                reason: magic.reason,
                steps: [...toBytes, { opId: magic.opId }, { opId: "utf8.decode" }],
            });
        }
    }
    const indexed = indexedByteObject(value);
    if (indexed) {
        const text = utf8OrNull(indexed);
        const steps = [{ opId: "object.toList" }, { opId: "array.toBytes" }];
        let reason = `keys run 0…${indexed.length - 1}, every value a byte`;
        if (text !== null) {
            steps.push({ opId: "utf8.decode" });
            reason += ", and they decode as UTF-8";
            try {
                JSON.parse(text);
                steps.push({ opId: "json.parse" });
                reason += " that parses as JSON";
            }
            catch {
            }
        }
        out.push({ label: "Looks like a byte array put through JSON", reason, steps });
    }
    if (Array.isArray(value) && value.length > 0) {
        if (allNumbers(value)) {
            const ints = value.every((n) => Number.isInteger(n));
            if (ints && value.every((n) => n === 0 || n === 1)) {
                out.push({ label: "Looks like true/false values", reason: "every element is 0 or 1", steps: [{ opId: "as.boolean", each: true }] });
            }
            if (ints && value.every((n) => n >= 32 && n <= 126)) {
                out.push({ label: "Looks like character codes", reason: "every element is a printable character code", steps: [{ opId: "array.fromCharCodes" }] });
            }
            if (ints && !magic && value.every((n) => n >= 0 && n <= 255)) {
                out.push({ label: "Could be bytes", reason: "every element is in 0\u2013255", steps: [{ opId: "array.toBytes" }] });
            }
            if (value.every((n) => n >= EPOCH_MS_FLOOR && n < EPOCH_MS_CEILING)) {
                out.push({ label: "Looks like moments in time", reason: "every element is in the epoch-millisecond band", steps: [{ opId: "time.epochMs", each: true }] });
            }
        }
        if (value.every((v) => typeof v === "string" && v.length === 1)) {
            out.push({ label: "Looks like text split into characters", reason: "every element is a single character", steps: [{ opId: "array.join" }] });
        }
    }
    if (typeof value === "string" && value.length > 0) {
        const s = value.trim();
        if (/%[0-9A-Fa-f]{2}/.test(s)) {
            out.push({ label: "Looks URL-encoded", reason: "contains %XX escapes", steps: [{ opId: "url.decode" }] });
        }
        if (/^[{[]/.test(s)) {
            try {
                JSON.parse(s);
                out.push({ label: "Looks like JSON text", reason: "parses as JSON", steps: [{ opId: "json.parse" }] });
            }
            catch {
            }
        }
        if (s.length >= 8 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s) && !/^\d+$/.test(s)) {
            out.push({ label: "Could be base64", reason: "base64 alphabet, length divides by 4", steps: [{ opId: "base64.decode" }, { opId: "utf8.decode" }] });
        }
        if (s.length >= 8 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s)) {
            out.push({ label: "Could be hex", reason: "hex digits, even length", steps: [{ opId: "hex.decode" }, { opId: "utf8.decode" }] });
        }
    }
    return out;
}
