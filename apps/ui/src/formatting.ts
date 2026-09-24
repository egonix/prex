import { useEffect, useRef, useState } from "preact/hooks";
import { deriveDeltaRecipe, resolveFormat, subscribeToFormats, type ResolvedFormat } from "./format/store";
import { describeFailure, displayValue, isRecipeSync, runRecipe, runRecipeSync } from "./format/recipe";
export interface Formatted {
    text: string;
    origin: "chosen" | "detected" | null;
    failure: string | null;
    raw: string;
    pending: boolean;
}
function rawOnly(raw: string): Formatted {
    return { text: raw, origin: null, failure: null, raw, pending: false };
}
export function useFormatsVersion(): number {
    const [version, setVersion] = useState(0);
    useEffect(() => subscribeToFormats(() => setVersion((v) => v + 1)), []);
    return version;
}
function useResolvedValue(resolved: ResolvedFormat | null, value: unknown, raw: string): Formatted {
    const [async_, setAsync] = useState<Formatted | null>(null);
    const token = useRef(0);
    const isAsync = resolved !== null && !isRecipeSync(resolved.recipe);
    useEffect(() => {
        if (!isAsync || !resolved) {
            setAsync(null);
            return;
        }
        const mine = ++token.current;
        setAsync(null);
        void runRecipe(resolved.recipe, value).then((result) => {
            if (token.current !== mine)
                return;
            setAsync(result.ok
                ? { text: displayValue(result.value), origin: resolved.origin, failure: null, raw, pending: false }
                : { text: raw, origin: resolved.origin, failure: describeFailure(result.failure), raw, pending: false });
        });
        return () => {
            token.current++;
        };
    }, [isAsync, resolved, value, raw]);
    if (!resolved)
        return rawOnly(raw);
    if (isAsync) {
        return async_ ?? { text: raw, origin: resolved.origin, failure: null, raw, pending: true };
    }
    const result = runRecipeSync(resolved.recipe, value);
    return result.ok
        ? { text: displayValue(result.value), origin: resolved.origin, failure: null, raw, pending: false }
        : { text: raw, origin: resolved.origin, failure: describeFailure(result.failure), raw, pending: false };
}
export function useFormattedValue(group: string | null, path: string, value: unknown, raw: string): Formatted {
    useFormatsVersion();
    const resolved = resolveFormat(group, path, value);
    return useResolvedValue(resolved, value, raw);
}
export function useFormattedDelta(group: string | null, path: string, value: unknown, delta: number, raw: string): Formatted {
    useFormatsVersion();
    const valueFormat = resolveFormat(group, path, value);
    const resolved: ResolvedFormat | null = valueFormat
        ? { recipe: deriveDeltaRecipe(valueFormat.kind), kind: valueFormat.kind, origin: valueFormat.origin }
        : null;
    return useResolvedValue(resolved && resolved.recipe.steps.length > 0 ? resolved : null, delta, raw);
}
