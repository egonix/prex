export type Args = Record<string, string | number | undefined>;
export interface ArgSpec {
    name: string;
    label: string;
    kind: "string" | "number";
    default?: string | number;
    choices?: string[];
    placeholder?: string;
    hint?: string;
}
export interface Operation {
    id: string;
    label: string;
    sync: boolean;
    args?: ArgSpec[];
    maxInputBytes?: number;
    workbenchOnly?: boolean;
    apply(value: unknown, args: Args): unknown | Promise<unknown>;
}
export const DEFAULT_MAX_INPUT_BYTES = 2 * 1024 * 1024;
export function inputSize(value: unknown): number | null {
    if (typeof value === "string")
        return value.length * 2;
    if (value instanceof Uint8Array)
        return value.byteLength;
    return null;
}
function describe(value: unknown): string {
    if (value === null)
        return "null";
    if (value === undefined)
        return "nothing";
    if (value instanceof Uint8Array)
        return `${value.byteLength} bytes`;
    if (Array.isArray(value))
        return `an array of ${value.length}`;
    return typeof value;
}
export function describeShape(value: unknown): string {
    if (value === undefined)
        return "nothing";
    if (value === null)
        return "null";
    if (value instanceof Uint8Array)
        return `${value.byteLength} bytes`;
    if (Array.isArray(value)) {
        if (value.length === 0)
            return "empty list";
        const kinds = new Set(value.map((v) => (Array.isArray(v) ? "list" : v === null ? "null" : typeof v)));
        if (kinds.size !== 1)
            return `list of ${value.length} mixed values`;
        const kind = [...kinds][0];
        return `list of ${value.length} ${kind}${value.length === 1 ? "" : "s"}`;
    }
    if (typeof value === "object") {
        const keys = Object.keys(value as object);
        if (keys.length > 0 && keys.every((k, i) => k === String(i))) {
            return `index-keyed object, ${keys.length} entries`;
        }
        return `object with ${keys.length} field${keys.length === 1 ? "" : "s"}`;
    }
    if (typeof value === "string")
        return `text, ${value.length} character${value.length === 1 ? "" : "s"}`;
    return typeof value;
}
function expectString(value: unknown, what: string): string {
    if (typeof value !== "string")
        throw new Error(`expected ${what}, got ${describe(value)}`);
    return value;
}
function expectNumber(value: unknown, what: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`expected ${what}, got ${describe(value)}`);
    }
    return value;
}
function expectBytes(value: unknown, what: string): Uint8Array {
    if (!(value instanceof Uint8Array))
        throw new Error(`expected ${what}, got ${describe(value)}`);
    return value;
}
function asBytes(value: unknown, what: string): Uint8Array {
    if (value instanceof Uint8Array)
        return value;
    if (typeof value === "string")
        return new TextEncoder().encode(value);
    throw new Error(`expected ${what}, got ${describe(value)}`);
}
function expectArray(value: unknown, what: string): unknown[] {
    if (!Array.isArray(value))
        throw new Error(`expected ${what}, got ${describe(value)}`);
    return value;
}
function templateText(value: unknown): string {
    if (value === null)
        return "null";
    if (value === undefined)
        return "";
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (value instanceof Uint8Array)
        return `${value.byteLength} bytes`;
    try {
        return JSON.stringify(value) ?? String(value);
    }
    catch {
        return String(value);
    }
}
function requiredArg(args: Args, name: string, opLabel: string): string {
    const v = args[name];
    if (v === undefined || v === "") {
        throw new Error(`${opLabel} needs ${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`);
    }
    return String(v);
}
const ARITHMETIC = /^([+\-*/%])\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i;
function applyArithmetic(value: unknown, expression: string): number {
    const m = ARITHMETIC.exec(expression.trim());
    if (!m) {
        throw new Error(`"${expression}" is not arithmetic: expected an operator then a number, like +1, *100 or /1000`);
    }
    const n = expectNumber(value, "a number");
    const by = Number(m[2]);
    let r: number;
    switch (m[1]) {
        case "+":
            r = n + by;
            break;
        case "-":
            r = n - by;
            break;
        case "*":
            r = n * by;
            break;
        case "/":
            if (by === 0)
                throw new Error("cannot divide by zero");
            r = n / by;
            break;
        default:
            if (by === 0)
                throw new Error("cannot take a remainder by zero");
            r = n % by;
    }
    if (!Number.isFinite(r))
        throw new Error(`${n} ${expression} is not a finite number`);
    return Number.isInteger(r) ? r : Number(r.toPrecision(15));
}
const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0");
export function formatInstant(ms: number): string {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime()))
        throw new Error(`${ms} is not a point in time`);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    return (`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ` +
        `${sign}${pad(off / 60)}:${pad(off % 60)}`);
}
export function formatDurationMs(ms: number): string {
    const sign = ms > 0 ? "+" : ms < 0 ? "-" : "";
    const a = Math.abs(ms);
    if (a < 1000)
        return `${sign}${a}ms`;
    if (a < 60000)
        return `${sign}${(a / 1000).toFixed(1)}s`;
    if (a < 3600000)
        return `${sign}${Math.floor(a / 60000)}m ${pad((a % 60000) / 1000)}s`;
    if (a < 86400000)
        return `${sign}${Math.floor(a / 3600000)}h ${pad((a % 3600000) / 60000)}m`;
    return `${sign}${Math.floor(a / 86400000)}d ${Math.floor((a % 86400000) / 3600000)}h`;
}
export function formatBytes(n: number): string {
    const sign = n < 0 ? "-" : "";
    let a = Math.abs(n);
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let i = 0;
    while (a >= 1024 && i < units.length - 1) {
        a /= 1024;
        i++;
    }
    return `${sign}${i === 0 ? a : a.toFixed(1)} ${units[i]}`;
}
function bytesFromBinaryString(s: string): Uint8Array {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++)
        out[i] = s.charCodeAt(i) & 255;
    return out;
}
function binaryStringFromBytes(b: Uint8Array): string {
    let s = "";
    for (let i = 0; i < b.length; i++)
        s += String.fromCharCode(b[i]);
    return s;
}
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        chunks.push(value);
        total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
        out.set(c, at);
        at += c.byteLength;
    }
    return out;
}
function decompress(format: "gzip" | "deflate" | "deflate-raw", label: string) {
    return async (value: unknown): Promise<Uint8Array> => {
        const bytes = expectBytes(value, `bytes to ${label}`);
        const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
        try {
            return await readAll(stream as ReadableStream<Uint8Array>);
        }
        catch {
            throw new Error(`not valid ${label} data`);
        }
    };
}
function digest(algorithm: string, id: string) {
    return async (value: unknown): Promise<string> => {
        const bytes = asBytes(value, `bytes or text to hash with ${id}`);
        const buf = await crypto.subtle.digest(algorithm, bytes as unknown as BufferSource);
        return Array.from(new Uint8Array(buf))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    };
}
const SHORT_SUFFIXES = ["", "K", "M", "B", "T"];
const FULL_SUFFIXES = [
    "",
    "K",
    "M",
    "B",
    "T",
    "Qa",
    "Qi",
    "Sx",
    "Sp",
    "Oc",
    "No",
    "Dc",
    "Ud",
    "Dd",
    "Td",
    "Qad",
    "Qid",
    "Sxd",
    "Spd",
    "Ocd",
    "Nod",
    "Vg",
];
function clampDecimals(raw: unknown): number {
    const n = Number(raw ?? 1);
    if (!Number.isInteger(n) || n < 0 || n > 6)
        throw new Error(`decimals must be a whole number from 0 to 6, got ${raw}`);
    return n;
}
function decimalDigits(value: unknown): {
    negative: boolean;
    int: string;
    frac: string;
} {
    let s: string;
    if (typeof value === "bigint")
        s = value.toString();
    else if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error(`expected a finite number, got ${value}`);
        s = Math.abs(value) >= 1e+21 ? BigInt(value).toString() : String(value);
    }
    else if (typeof value === "string")
        s = value.trim();
    else
        throw new Error(`expected a number, or text holding one, got ${describe(value)}`);
    const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m)
        throw new Error(`"${s}" is not a number`);
    return { negative: m[1] === "-" && /[1-9]/.test(m[2] + (m[3] ?? "")), int: m[2].replace(/^0+(?=\d)/, ""), frac: m[3] ?? "" };
}
export const OPERATIONS: Operation[] = [
    {
        id: "base64.decode",
        label: "Base64 \u2192 bytes",
        sync: true,
        apply: (v) => {
            const s = expectString(v, "base64 text").trim();
            try {
                return bytesFromBinaryString(atob(s));
            }
            catch {
                throw new Error("not valid base64");
            }
        },
    },
    {
        id: "base64.encode",
        label: "Bytes \u2192 Base64",
        sync: true,
        apply: (v) => btoa(binaryStringFromBytes(asBytes(v, "bytes or text to base64-encode"))),
    },
    {
        id: "base64url.decode",
        label: "Base64url \u2192 bytes",
        sync: true,
        apply: (v) => {
            const s = expectString(v, "base64url text").trim().replace(/-/g, "+").replace(/_/g, "/");
            try {
                return bytesFromBinaryString(atob(s.padEnd(Math.ceil(s.length / 4) * 4, "=")));
            }
            catch {
                throw new Error("not valid base64url");
            }
        },
    },
    {
        id: "hex.decode",
        label: "Hex \u2192 bytes",
        sync: true,
        apply: (v) => {
            const s = expectString(v, "hex text").trim().replace(/[\s:]/g, "");
            if (s.length % 2 !== 0)
                throw new Error("hex text has an odd number of digits");
            if (!/^[0-9a-fA-F]*$/.test(s))
                throw new Error("not valid hex");
            const out = new Uint8Array(s.length / 2);
            for (let i = 0; i < out.length; i++)
                out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
            return out;
        },
    },
    {
        id: "hex.encode",
        label: "Bytes \u2192 Hex",
        sync: true,
        apply: (v) => Array.from(asBytes(v, "bytes or text to hex-encode"))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
    },
    {
        id: "url.decode",
        label: "URL-decode",
        sync: true,
        apply: (v) => {
            const s = expectString(v, "URL-encoded text");
            try {
                return decodeURIComponent(s);
            }
            catch {
                throw new Error("not valid URL-encoded text");
            }
        },
    },
    {
        id: "utf8.decode",
        label: "Bytes \u2192 text (UTF-8)",
        sync: true,
        apply: (v) => {
            const bytes = expectBytes(v, "bytes to read as UTF-8");
            try {
                return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            }
            catch {
                throw new Error("these bytes are not valid UTF-8");
            }
        },
    },
    {
        id: "json.parse",
        label: "Parse JSON",
        sync: true,
        apply: (v) => {
            if (v !== null && typeof v === "object") {
                throw new Error(`this is already structured: ${describeShape(v)}: not JSON text. Use "Pick a path" to reach into it, or "Pretty-print JSON" to read it.`);
            }
            const s = expectString(v, "JSON text");
            try {
                return JSON.parse(s);
            }
            catch (e) {
                throw new Error(`not valid JSON (${(e as Error).message})`);
            }
        },
    },
    {
        id: "json.pretty",
        label: "Pretty-print JSON",
        sync: true,
        apply: (v) => (typeof v === "string" ? JSON.stringify(JSON.parse(v), null, 2) : JSON.stringify(v, null, 2)),
    },
    {
        id: "json.pick",
        label: "Pick a path",
        sync: true,
        args: [{ name: "path", label: "Dotted path", kind: "string" }],
        apply: (v, args) => {
            const path = requiredArg(args, "path", "Pick a path");
            let cur: unknown = v;
            for (const seg of path.split(".")) {
                if (cur == null || typeof cur !== "object") {
                    throw new Error(`"${path}" runs out at "${seg}": ${describe(cur)} has no fields`);
                }
                cur = (cur as Record<string, unknown>)[seg];
            }
            if (cur === undefined)
                throw new Error(`nothing at "${path}"`);
            return cur;
        },
    },
    {
        id: "jwt.decode",
        label: "Decode JWT",
        sync: true,
        apply: (v) => {
            const s = expectString(v, "a JWT").trim();
            const parts = s.split(".");
            if (parts.length !== 3)
                throw new Error(`a JWT has three dot-separated parts, this has ${parts.length}`);
            const seg = (i: number, name: string) => {
                const b = parts[i].replace(/-/g, "+").replace(/_/g, "/");
                try {
                    return JSON.parse(new TextDecoder().decode(bytesFromBinaryString(atob(b.padEnd(Math.ceil(b.length / 4) * 4, "=")))));
                }
                catch {
                    throw new Error(`the ${name} is not valid base64url JSON`);
                }
            };
            return { header: seg(0, "header"), payload: seg(1, "payload"), signature: parts[2] };
        },
    },
    {
        id: "text.template",
        label: "Format with a template",
        sync: true,
        args: [
            {
                name: "pattern",
                label: "Pattern",
                kind: "string",
                placeholder: "{buffType} {expiresAt:time.epochMs}",
                hint: "{path} a field \u00B7 {path:op} a field through an operation \u00B7 {} the value itself \u00B7 {:op} the value itself through one \u00B7 {:+1} arithmetic (+ - * / %)",
            },
        ],
        apply: (v, args) => {
            const pattern = requiredArg(args, "pattern", "Format with a template");
            return pattern.replace(/\{([^}]*)\}/g, (_whole, spec: string) => {
                const cut = spec.indexOf(":");
                const path = (cut === -1 ? spec : spec.slice(0, cut)).trim();
                const opId = cut === -1 ? "" : spec.slice(cut + 1).trim();
                let picked: unknown = v;
                if (path) {
                    for (const seg of path.split(".")) {
                        if (picked == null || typeof picked !== "object") {
                            const hint = picked === v ? "; use {} for the value itself" : "";
                            throw new Error(`"{${spec}}": ${path} runs out at "${seg}": ${describe(picked)} has no fields${hint}`);
                        }
                        picked = (picked as Record<string, unknown>)[seg];
                    }
                    if (picked === undefined)
                        throw new Error(`"{${spec}}": nothing at "${path}"`);
                }
                if (!opId)
                    return templateText(picked);
                if (/^[+\-*/%]/.test(opId)) {
                    try {
                        return templateText(applyArithmetic(picked, opId));
                    }
                    catch (e) {
                        throw new Error(`"{${spec}}": ${(e as Error).message}`);
                    }
                }
                const op = operationById(opId);
                if (!op)
                    throw new Error(`"{${spec}}": no operation called "${opId}"`);
                if (!op.sync)
                    throw new Error(`"{${spec}}": "${opId}" is asynchronous and cannot run inside a template`);
                try {
                    return templateText(op.apply(picked, {}));
                }
                catch (e) {
                    throw new Error(`"{${spec}}": ${(e as Error).message}`);
                }
            });
        },
    },
    {
        id: "to.number",
        label: "Text \u2192 number",
        sync: true,
        apply: (v) => {
            if (typeof v === "number")
                return v;
            const s = expectString(v, "a number, or text holding one").trim();
            if (s === "")
                throw new Error("expected a number, got empty text");
            const n = Number(s);
            if (!Number.isFinite(n))
                throw new Error(`"${s}" is not a number`);
            return n;
        },
    },
    {
        id: "to.string",
        label: "Anything \u2192 text",
        sync: true,
        apply: (v) => {
            if (typeof v === "string")
                return v;
            if (typeof v === "number" || typeof v === "boolean")
                return String(v);
            if (v instanceof Uint8Array)
                throw new Error("bytes need utf8.decode, not to.string");
            throw new Error(`expected something with a text form, got ${describe(v)}`);
        },
    },
    {
        id: "time.epochMs",
        label: "Epoch ms \u2192 time",
        sync: true,
        apply: (v) => formatInstant(expectNumber(v, "a number of milliseconds since the epoch")),
    },
    {
        id: "time.epochS",
        label: "Epoch seconds \u2192 time",
        sync: true,
        apply: (v) => formatInstant(expectNumber(v, "a number of seconds since the epoch") * 1000),
    },
    {
        id: "time.relative",
        label: "Epoch ms \u2192 how long ago",
        sync: true,
        apply: (v) => {
            const ms = expectNumber(v, "a number of milliseconds since the epoch");
            const delta = Date.now() - ms;
            return delta >= 0 ? `${formatDurationMs(delta).replace(/^\+/, "")} ago` : `in ${formatDurationMs(-delta).replace(/^\+/, "")}`;
        },
    },
    {
        id: "duration.ms",
        label: "Milliseconds \u2192 duration",
        sync: true,
        apply: (v) => formatDurationMs(expectNumber(v, "a number of milliseconds")),
    },
    {
        id: "size.bytes",
        label: "Bytes \u2192 size",
        sync: true,
        apply: (v) => formatBytes(expectNumber(v, "a number of bytes")),
    },
    {
        id: "number.percent",
        label: "Number \u2192 percent",
        sync: true,
        args: [
            { name: "divisor", label: "Divide by", kind: "number", default: 100 },
            { name: "decimals", label: "Decimals", kind: "number", default: 1 },
        ],
        apply: (v, args) => {
            const n = expectNumber(v, "a number");
            const divisor = Number(args.divisor ?? 100);
            if (!Number.isFinite(divisor) || divisor === 0) {
                throw new Error(`divide by must be a non-zero number, got ${String(args.divisor)}`);
            }
            const decimals = clampDecimals(args.decimals);
            const fixed = (n / divisor).toFixed(decimals);
            const shown = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
            return `${shown}%`;
        },
    },
    {
        id: "math",
        label: "Arithmetic",
        sync: true,
        args: [
            {
                name: "expression",
                label: "Operation",
                kind: "string",
                placeholder: "+1",
                hint: "an operator then a number: +1 \u00B7 -5 \u00B7 *100 \u00B7 /1000 \u00B7 %60 \u00B7 *-1 to negate",
            },
        ],
        apply: (v, args) => applyArithmetic(v, requiredArg(args, "expression", "Arithmetic")),
    },
    {
        id: "number.radix",
        label: "Number \u2192 base",
        sync: true,
        args: [{ name: "radix", label: "Base", kind: "number", default: 16 }],
        apply: (v, args) => {
            const n = expectNumber(v, "a number");
            const radix = Number(args.radix ?? 16);
            if (!Number.isInteger(radix) || radix < 2 || radix > 36)
                throw new Error(`base must be between 2 and 36, got ${radix}`);
            return n.toString(radix);
        },
    },
    {
        id: "number.compact",
        label: "Number \u2192 compact (1.2M)",
        sync: true,
        args: [
            { name: "decimals", label: "Decimals", kind: "number", default: 1 },
            { name: "ladder", label: "Suffixes", kind: "string", default: "short", choices: ["short", "full"] },
        ],
        apply: (v, args) => {
            const decimals = clampDecimals(args.decimals);
            const suffixes = String(args.ladder ?? "short") === "full" ? FULL_SUFFIXES : SHORT_SUFFIXES;
            const n = decimalDigits(v);
            if (n.int.length <= 3) {
                const frac = n.frac.replace(/0+$/, "");
                return `${n.negative ? "-" : ""}${n.int}${frac ? `.${frac}` : ""}`;
            }
            const tier = Math.floor((n.int.length - 1) / 3);
            if (tier > suffixes.length - 1) {
                const rest = (n.int.slice(1) + n.frac).slice(0, decimals).padEnd(decimals, "0");
                const coefficient = decimals === 0 ? n.int[0] : `${n.int[0]}.${rest}`;
                return `${n.negative ? "-" : ""}${coefficient}e${n.int.length - 1}`;
            }
            const split = n.int.length - tier * 3;
            const whole = n.int.slice(0, split);
            const rest = (n.int.slice(split) + n.frac).slice(0, decimals).padEnd(decimals, "0");
            const shown = decimals === 0 ? whole : `${whole}.${rest}`;
            return `${n.negative ? "-" : ""}${shown}${suffixes[tier]}`;
        },
    },
    {
        id: "regex.extract",
        label: "Extract by pattern",
        sync: true,
        args: [
            { name: "pattern", label: "Pattern", kind: "string" },
            { name: "flags", label: "Flags", kind: "string", default: "" },
        ],
        apply: (v, args) => {
            const s = expectString(v, "text to search");
            const pattern = requiredArg(args, "pattern", "Extract by pattern");
            let re: RegExp;
            try {
                re = new RegExp(pattern, String(args.flags ?? ""));
            }
            catch (e) {
                throw new Error(`that pattern is not valid (${(e as Error).message})`);
            }
            const m = s.match(re);
            if (!m)
                throw new Error("the pattern matched nothing");
            return m.length > 1 ? m.slice(1) : m[0];
        },
    },
    {
        id: "regex.replace",
        label: "Replace by pattern",
        sync: true,
        args: [
            { name: "pattern", label: "Pattern", kind: "string" },
            { name: "flags", label: "Flags", kind: "string", default: "g" },
            { name: "replacement", label: "Replacement", kind: "string", default: "" },
        ],
        apply: (v, args) => {
            const s = expectString(v, "text to replace in");
            const pattern = requiredArg(args, "pattern", "Replace by pattern");
            try {
                return s.replace(new RegExp(pattern, String(args.flags ?? "g")), String(args.replacement ?? ""));
            }
            catch (e) {
                throw new Error(`that pattern is not valid (${(e as Error).message})`);
            }
        },
    },
    {
        id: "xor",
        label: "XOR with a key",
        sync: true,
        args: [{ name: "key", label: "Key (hex)", kind: "string" }],
        apply: (v, args) => {
            const bytes = asBytes(v, "bytes or text to XOR");
            const keyHex = requiredArg(args, "key", "XOR with a key").replace(/[\s:]/g, "");
            if (keyHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(keyHex))
                throw new Error("the key must be hex, with an even number of digits");
            const key = new Uint8Array(keyHex.length / 2);
            for (let i = 0; i < key.length; i++)
                key[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
            const out = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++)
                out[i] = bytes[i] ^ key[i % key.length];
            return out;
        },
    },
    {
        id: "as.boolean",
        label: "0/1 \u2192 true/false",
        sync: true,
        apply: (v) => {
            if (typeof v === "boolean")
                return v;
            if (v === 0 || v === "0" || v === "false")
                return false;
            if (v === 1 || v === "1" || v === "true")
                return true;
            throw new Error(`expected 0, 1, "true" or "false", got ${typeof v === "number" || typeof v === "string" ? JSON.stringify(v) : describe(v)}`);
        },
    },
    {
        id: "array.join",
        label: "List \u2192 text (joined)",
        sync: true,
        args: [{ name: "separator", label: "Between", kind: "string", default: "" }],
        apply: (v, args) => {
            const arr = expectArray(v, "a list to join into text");
            for (const [i, el] of arr.entries()) {
                if (typeof el !== "string" && typeof el !== "number" && typeof el !== "boolean") {
                    throw new Error(`element ${i + 1} is ${describe(el)}, which has no text form`);
                }
            }
            return arr.join(String(args.separator ?? ""));
        },
    },
    {
        id: "text.split",
        label: "Text \u2192 list (split)",
        sync: true,
        args: [{ name: "separator", label: "Split on", kind: "string", default: "" }],
        apply: (v, args) => expectString(v, "text to split into a list").split(String(args.separator ?? "")),
    },
    {
        id: "array.fromCharCodes",
        label: "Character codes \u2192 text",
        sync: true,
        apply: (v) => {
            const arr = expectArray(v, "a list of character codes");
            const codes = arr.map((el, i) => {
                if (typeof el !== "number" || !Number.isInteger(el) || el < 0 || el > 65535) {
                    throw new Error(`element ${i + 1} is ${typeof el === "number" ? el : describe(el)}, not a character code (0–65535)`);
                }
                return el;
            });
            return String.fromCharCode(...codes);
        },
    },
    {
        id: "text.toCharCodes",
        label: "Text \u2192 character codes",
        sync: true,
        apply: (v) => {
            const s = expectString(v, "text to read as character codes");
            const out: number[] = [];
            for (let i = 0; i < s.length; i++)
                out.push(s.charCodeAt(i));
            return out;
        },
    },
    {
        id: "array.toBytes",
        label: "List \u2192 bytes",
        sync: true,
        apply: (v) => {
            const arr = expectArray(v, "a list of byte values");
            const out = new Uint8Array(arr.length);
            arr.forEach((el, i) => {
                if (typeof el !== "number" || !Number.isInteger(el) || el < 0 || el > 255) {
                    throw new Error(`element ${i + 1} is ${typeof el === "number" ? el : describe(el)}, not a byte (0–255)`);
                }
                out[i] = el;
            });
            return out;
        },
    },
    {
        id: "bytes.toArray",
        label: "Bytes \u2192 list of numbers",
        sync: true,
        apply: (v) => Array.from(expectBytes(v, "bytes to list")),
    },
    {
        id: "object.toList",
        label: "Index-keyed object \u2192 list",
        sync: true,
        apply: (v) => {
            if (v === null || typeof v !== "object" || Array.isArray(v) || v instanceof Uint8Array) {
                throw new Error(`expected an object keyed by index, got ${describe(v)}`);
            }
            const keys = Object.keys(v as Record<string, unknown>);
            if (keys.length === 0)
                return [];
            const bad = keys.findIndex((k, i) => k !== String(i));
            if (bad !== -1) {
                throw new Error(`keys must run 0,1,2,…: key ${bad + 1} is "${keys[bad]}", not "${bad}"`);
            }
            return keys.map((k) => (v as Record<string, unknown>)[k]);
        },
    },
    {
        id: "js",
        label: "Expression (JavaScript)",
        sync: true,
        workbenchOnly: true,
        args: [{ name: "code", label: "Expression on `value`", kind: "string", default: "value" }],
        apply: (v, args) => {
            const code = requiredArg(args, "code", "Expression");
            try {
                return new Function("value", `"use strict"; return (${code});`)(v);
            }
            catch (e) {
                throw new Error(`the expression failed: ${(e as Error).message}`);
            }
        },
    },
    { id: "gunzip", label: "Gunzip", sync: false, apply: decompress("gzip", "gzip") },
    { id: "inflate", label: "Inflate (zlib)", sync: false, apply: decompress("deflate", "zlib") },
    { id: "inflate.raw", label: "Inflate (raw)", sync: false, apply: decompress("deflate-raw", "raw deflate") },
    { id: "hash.sha1", label: "SHA-1", sync: false, apply: digest("SHA-1", "SHA-1") },
    { id: "hash.sha256", label: "SHA-256", sync: false, apply: digest("SHA-256", "SHA-256") },
    { id: "hash.sha512", label: "SHA-512", sync: false, apply: digest("SHA-512", "SHA-512") },
];
const BY_ID = new Map(OPERATIONS.map((o) => [o.id, o]));
export function operationById(id: string): Operation | undefined {
    return BY_ID.get(id);
}
const GROUP_ORDER: {
    label: string;
    ids: string[];
}[] = [
    { label: "Decode & encode", ids: ["base64.decode", "base64url.decode", "hex.decode", "url.decode", "utf8.decode", "base64.encode", "hex.encode"] },
    { label: "Structure", ids: ["json.parse", "json.pick", "text.template", "json.pretty", "jwt.decode"] },
    {
        label: "Read as",
        ids: [
            "time.epochMs",
            "time.epochS",
            "time.relative",
            "duration.ms",
            "size.bytes",
            "number.percent",
            "number.compact",
            "number.radix",
        ],
    },
    { label: "Arithmetic", ids: ["math"] },
    { label: "Change type", ids: ["to.number", "to.string"] },
    {
        label: "Interpret as",
        ids: [
            "as.boolean",
            "array.join",
            "array.fromCharCodes",
            "array.toBytes",
            "object.toList",
            "text.split",
            "text.toCharCodes",
            "bytes.toArray",
        ],
    },
    { label: "Patterns & bits", ids: ["regex.extract", "regex.replace", "xor"] },
    { label: "Decompress (async)", ids: ["gunzip", "inflate", "inflate.raw"] },
    { label: "Hash (async)", ids: ["hash.sha1", "hash.sha256", "hash.sha512"] },
    { label: "Escape hatch", ids: ["js"] },
];
export function groupedOperations(): {
    label: string;
    operations: Operation[];
}[] {
    const placed = new Set<string>();
    const groups = GROUP_ORDER.map((g) => {
        const operations = g.ids.map((id) => BY_ID.get(id)).filter((o): o is Operation => o !== undefined);
        for (const o of operations)
            placed.add(o.id);
        return { label: g.label, operations };
    }).filter((g) => g.operations.length > 0);
    const rest = OPERATIONS.filter((o) => !placed.has(o.id));
    if (rest.length > 0)
        groups.push({ label: "Other", operations: rest });
    return groups;
}
