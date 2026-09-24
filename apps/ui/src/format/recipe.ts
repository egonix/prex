import { DEFAULT_MAX_INPUT_BYTES, formatBytes, inputSize, operationById, type Args } from "./ops";
export interface RecipeStep {
    opId: string;
    args: Args;
    enabled: boolean;
    each?: boolean;
}
export interface Recipe {
    steps: RecipeStep[];
}
export type InterpretationKind = "time" | "duration" | "size" | "raw" | "custom";
export interface RecipeFailure {
    stepIndex: number;
    opId: string;
    message: string;
    elementIndex?: number;
}
export type RecipeResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    failure: RecipeFailure;
};
export const EMPTY_RECIPE: Recipe = { steps: [] };
export function recipeOf(...opIds: string[]): Recipe {
    return { steps: opIds.map((opId) => ({ opId, args: {}, enabled: true })) };
}
function enabledSteps(recipe: Recipe): RecipeStep[] {
    return recipe.steps.filter((s) => s.enabled);
}
export function isRecipeSync(recipe: Recipe): boolean {
    return enabledSteps(recipe).every((s) => operationById(s.opId)?.sync !== false);
}
export function containsWorkbenchOnlyStep(recipe: Recipe): boolean {
    return recipe.steps.some((s) => operationById(s.opId)?.workbenchOnly === true);
}
function checkBound(value: unknown, limit: number, opLabel: string): string | null {
    const size = inputSize(value);
    if (size !== null && size > limit) {
        return `input is ${formatBytes(size)}, past the ${formatBytes(limit)} limit for ${opLabel}: refused before running`;
    }
    return null;
}
function fail(stepIndex: number, opId: string, message: string, elementIndex?: number): RecipeResult {
    return { ok: false, failure: { stepIndex, opId, message, elementIndex } };
}
function requireArray(value: unknown, opLabel: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`${opLabel} is set to run on each element, but this is ${value === null ? "null" : typeof value}, not an array`);
    }
    return value;
}
export function runRecipeSync(recipe: Recipe, input: unknown): RecipeResult {
    let value = input;
    for (let i = 0; i < recipe.steps.length; i++) {
        const step = recipe.steps[i];
        if (!step.enabled)
            continue;
        const op = operationById(step.opId);
        if (!op)
            return fail(i, step.opId, `no operation called "${step.opId}"`);
        if (!op.sync)
            throw new Error(`runRecipeSync given async operation "${op.id}"`);
        const over = checkBound(value, op.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES, op.label);
        if (over)
            return fail(i, op.id, over);
        if (step.each) {
            let elements: unknown[];
            try {
                elements = requireArray(value, op.label);
            }
            catch (e) {
                return fail(i, op.id, (e as Error).message);
            }
            const mapped: unknown[] = [];
            for (let e = 0; e < elements.length; e++) {
                const overEl = checkBound(elements[e], op.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES, op.label);
                if (overEl)
                    return fail(i, op.id, overEl, e);
                try {
                    mapped.push(op.apply(elements[e], step.args));
                }
                catch (err) {
                    return fail(i, op.id, (err as Error).message, e);
                }
            }
            value = mapped;
            continue;
        }
        try {
            value = op.apply(value, step.args);
        }
        catch (e) {
            return fail(i, op.id, (e as Error).message);
        }
    }
    return { ok: true, value };
}
export async function runRecipe(recipe: Recipe, input: unknown, onStep?: (stepIndex: number, value: unknown) => void): Promise<RecipeResult> {
    let value = input;
    for (let i = 0; i < recipe.steps.length; i++) {
        const step = recipe.steps[i];
        if (!step.enabled)
            continue;
        const op = operationById(step.opId);
        if (!op)
            return fail(i, step.opId, `no operation called "${step.opId}"`);
        const over = checkBound(value, op.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES, op.label);
        if (over)
            return fail(i, op.id, over);
        if (step.each) {
            let elements: unknown[];
            try {
                elements = requireArray(value, op.label);
            }
            catch (e) {
                return fail(i, op.id, (e as Error).message);
            }
            const mapped: unknown[] = [];
            for (let e = 0; e < elements.length; e++) {
                const overEl = checkBound(elements[e], op.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES, op.label);
                if (overEl)
                    return fail(i, op.id, overEl, e);
                try {
                    mapped.push(await op.apply(elements[e], step.args));
                }
                catch (err) {
                    return fail(i, op.id, (err as Error).message, e);
                }
            }
            value = mapped;
            onStep?.(i, value);
            continue;
        }
        try {
            value = await op.apply(value, step.args);
        }
        catch (e) {
            return fail(i, op.id, (e as Error).message);
        }
        onStep?.(i, value);
    }
    return { ok: true, value };
}
export function describeFailure(failure: RecipeFailure): string {
    const op = operationById(failure.opId);
    const where = failure.elementIndex === undefined
        ? `step ${failure.stepIndex + 1}`
        : `step ${failure.stepIndex + 1}, element ${failure.elementIndex + 1}`;
    return `${where} (${op?.label ?? failure.opId}): ${failure.message}`;
}
export function displayValue(value: unknown): string {
    if (value === undefined)
        return "\u2014";
    if (value === null)
        return "null";
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (value instanceof Uint8Array) {
        const head = Array.from(value.slice(0, 32))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
        return `${value.byteLength} bytes: ${head}${value.byteLength > 32 ? " \u2026" : ""}`;
    }
    try {
        return JSON.stringify(value) ?? String(value);
    }
    catch {
        return String(value);
    }
}
