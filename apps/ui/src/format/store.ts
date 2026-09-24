import { containsWorkbenchOnlyStep, recipeOf, EMPTY_RECIPE, type InterpretationKind, type Recipe } from "./recipe";
import { detect } from "./detect";
export const FORMATS_KEY = "prex-ui-field-formats";
export const FORMATS_VERSION = 1;
export interface FieldIdentity {
    group: string | null;
    path: string;
}
export interface StoredFormat {
    identity: FieldIdentity;
    recipe: Recipe;
    kind: InterpretationKind;
}
export interface ResolvedFormat {
    recipe: Recipe;
    kind: InterpretationKind;
    origin: "chosen" | "detected";
}
export function identityKey(identity: FieldIdentity): string {
    return JSON.stringify([identity.group, identity.path]);
}
export const BUILT_IN_INTERPRETATIONS: {
    kind: InterpretationKind;
    label: string;
    recipe: Recipe;
}[] = [
    { kind: "time", label: "A moment in time", recipe: recipeOf("time.epochMs") },
    { kind: "duration", label: "An elapsed duration", recipe: recipeOf("duration.ms") },
    { kind: "size", label: "A size", recipe: recipeOf("size.bytes") },
    { kind: "raw", label: "Leave exactly as it arrived", recipe: EMPTY_RECIPE },
];
export function deriveDeltaRecipe(kind: InterpretationKind): Recipe {
    switch (kind) {
        case "time":
        case "duration":
            return recipeOf("duration.ms");
        case "size":
            return recipeOf("size.bytes");
        default:
            return EMPTY_RECIPE;
    }
}
type FormatMap = Record<string, StoredFormat>;
let formats: FormatMap = load();
const listeners = new Set<() => void>();
export function subscribeToFormats(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}
function announce(): void {
    save();
    for (const fn of listeners)
        fn();
}
function load(): FormatMap {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(FORMATS_KEY);
    }
    catch {
        return {};
    }
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw) as {
            version?: number;
            formats?: FormatMap;
        };
        if (parsed?.version !== FORMATS_VERSION || !parsed.formats) {
            console.warn("[prex-ui] stored field formats are from another version, starting fresh");
            return {};
        }
        return parsed.formats;
    }
    catch {
        console.warn("[prex-ui] stored field formats could not be parsed, starting fresh");
        return {};
    }
}
function save(): void {
    try {
        localStorage.setItem(FORMATS_KEY, JSON.stringify({ version: FORMATS_VERSION, formats }));
    }
    catch {
    }
}
export function chosenFormats(): FormatMap {
    return formats;
}
export function chosenFor(identity: FieldIdentity): StoredFormat | undefined {
    return formats[identityKey(identity)];
}
export function setChosenFormat(identity: FieldIdentity, recipe: Recipe, kind: InterpretationKind): void {
    if (containsWorkbenchOnlyStep(recipe)) {
        throw new Error("a recipe containing an Expression step cannot be attached to a field");
    }
    formats = { ...formats, [identityKey(identity)]: { identity, recipe, kind } };
    announce();
}
export function clearChosenFormat(identity: FieldIdentity): void {
    const key = identityKey(identity);
    if (!(key in formats))
        return;
    const next = { ...formats };
    delete next[key];
    formats = next;
    announce();
}
export function resolveFormat(group: string | null, path: string, value: unknown): ResolvedFormat | null {
    if (group !== null) {
        const specific = formats[identityKey({ group, path })];
        if (specific)
            return { recipe: specific.recipe, kind: specific.kind, origin: "chosen" };
    }
    const anyGroup = formats[identityKey({ group: null, path })];
    if (anyGroup)
        return { recipe: anyGroup.recipe, kind: anyGroup.kind, origin: "chosen" };
    const detected = detect(value, path);
    if (detected)
        return { recipe: detected.recipe, kind: detected.kind, origin: "detected" };
    return null;
}
