import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";
import { describeShape, groupedOperations, operationById } from "../format/ops";
import { detect, suggest } from "../format/detect";
import { containsWorkbenchOnlyStep, describeFailure, displayValue, runRecipe, type Recipe, type RecipeStep, } from "../format/recipe";
import { chosenFor, setChosenFormat } from "../format/store";
export function Workbench() {
    const input = useStore((s) => s.workbenchInput);
    const setInput = useStore((s) => s.setWorkbenchInput);
    const [typed, setTyped] = useState("");
    const [steps, setSteps] = useState<RecipeStep[]>([]);
    const [adding, setAdding] = useState("");
    const [confirmReplace, setConfirmReplace] = useState(false);
    useEffect(() => {
        if (input?.recipe)
            setSteps(input.recipe.steps.map((s) => ({ ...s, args: { ...s.args } })));
        setConfirmReplace(false);
    }, [input]);
    const source: unknown = input ? input.value : typed;
    const recipe: Recipe = { steps };
    const [output, setOutput] = useState<{
        text: string;
        failure: string | null;
        pending: boolean;
    }>({
        text: "",
        failure: null,
        pending: false,
    });
    const [shapes, setShapes] = useState<Record<number, string>>({});
    const token = useRef(0);
    useEffect(() => {
        const mine = ++token.current;
        setOutput((o) => ({ ...o, pending: true }));
        const seen: Record<number, string> = {};
        void runRecipe(recipe, source, (i, v) => {
            seen[i] = describeShape(v);
        }).then((result) => {
            if (token.current !== mine)
                return;
            setShapes(seen);
            setOutput(result.ok
                ? { text: displayValue(result.value), failure: null, pending: false }
                : { text: "", failure: describeFailure(result.failure), pending: false });
        });
    }, [source, JSON.stringify(steps)]);
    function update(i: number, patch: Partial<RecipeStep>) {
        setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    }
    function move(i: number, by: number) {
        setSteps((prev) => {
            const j = i + by;
            if (j < 0 || j >= prev.length)
                return prev;
            const next = prev.slice();
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    }
    return (<div class="flex flex-1 flex-col gap-2 p-2">
      
      <div>
        <div class="mb-1 flex items-baseline justify-between gap-2">
          <span class="text-[10px] uppercase tracking-wide text-neutral-500">
            value <span class="normal-case tracking-normal text-neutral-600">— {describeShape(source)}</span>
          </span>
          {input && (<button type="button" class="text-neutral-500 hover:text-violet-300" onClick={() => setInput(null)}>
              clear
            </button>)}
        </div>
        {input ? (<div class="rounded border border-neutral-800 bg-neutral-950 px-1.5 py-1">
            <div class="truncate text-[10px] text-violet-300" title={input.label}>
              {input.label}
            </div>
            <div class="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-neutral-300">
              {displayValue(input.value)}
            </div>
          </div>) : (<textarea class="h-20 w-full resize-y rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 font-mono text-[11px] text-neutral-200 outline-none focus:border-violet-500" placeholder="paste a value, or send one here from the log, State or Watches…" value={typed} onInput={(e) => setTyped(e.currentTarget.value)}/>)}
      </div>

      
      
      <Suggestions value={source} path={input?.identity?.path ?? ""} onApply={(s) => setSteps((prev) => [...prev, ...s])}/>

      
      <div>
        <div class="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">recipe</div>
        {steps.length === 0 && <div class="text-neutral-600">No steps: the result is the value as it arrived.</div>}
        <ul class="space-y-1">
          {steps.map((step, i) => {
            const op = operationById(step.opId);
            return (<li key={`${step.opId}-${i}`} class="rounded border border-neutral-800 px-1.5 py-1">
                <div class="flex items-center gap-1">
                  <span class="w-4 shrink-0 text-right text-neutral-600">{i + 1}</span>
                  <input type="checkbox" checked={step.enabled} title="temporarily disable this step, keeping it in place" onChange={(e) => update(i, { enabled: e.currentTarget.checked })}/>
                  <span class={`flex-1 truncate ${step.enabled ? "text-neutral-200" : "text-neutral-600 line-through"}`}>
                    {op?.label ?? step.opId}
                    
                    <span class="ml-1.5 font-mono text-[10px] text-neutral-600" title="use this id in a template placeholder">
                      {step.opId}
                    </span>
                    {op?.sync === false && <span class="ml-1 text-[10px] text-sky-700">async</span>}
                    {op?.workbenchOnly && <span class="ml-1 text-[10px] text-amber-600">workbench only</span>}
                  </span>
                  
                  <button type="button" class={`shrink-0 px-1 font-mono text-[10px] ${step.each ? "text-sky-400" : "text-neutral-700 hover:text-sky-600"}`} title={step.each
                    ? "running on each element of the array \u2014 click for the array as a whole"
                    : "run this step on each element of the array instead of the array itself"} onClick={() => update(i, { each: !step.each })}>
                    [ ]
                  </button>
                  <button type="button" class="px-0.5 text-neutral-500 hover:text-violet-300" title="move up" onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" class="px-0.5 text-neutral-500 hover:text-violet-300" title="move down" onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button type="button" class="px-0.5 text-neutral-500 hover:text-red-400" title="remove" onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
                {step.enabled && shapes[i] && (<div class="pl-5 text-[10px] text-neutral-600">→ {shapes[i]}</div>)}
                {op?.args?.length ? (<div class="mt-1 flex flex-wrap gap-1 pl-5">
                    {op.args.map((arg) => (<label key={arg.name} class="flex items-baseline gap-1">
                        <span class="text-[10px] text-neutral-500">{arg.label}</span>
                        
                        {arg.choices ? (<select class="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-[11px] text-neutral-200 outline-none focus:border-violet-500" value={String(step.args[arg.name] ?? arg.default ?? arg.choices[0])} onChange={(e) => update(i, { args: { ...step.args, [arg.name]: e.currentTarget.value } })}>
                            {arg.choices.map((choice) => (<option key={choice} value={choice}>
                                {choice}
                              </option>))}
                          </select>) : (<input class={`${arg.placeholder && arg.placeholder.length > 16 ? "min-w-0 flex-1" : "w-28"} rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 font-mono text-[11px] text-neutral-200 outline-none focus:border-violet-500`} value={String(step.args[arg.name] ?? "")} placeholder={arg.placeholder ?? (arg.default !== undefined ? String(arg.default) : "required")} title={[arg.hint, arg.placeholder && `e.g. ${arg.placeholder}`].filter(Boolean).join("\n") || undefined} onInput={(e) => update(i, { args: { ...step.args, [arg.name]: e.currentTarget.value } })}/>)}
                      </label>))}
                  </div>) : null}
              </li>);
        })}
        </ul>

        <select class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-[11px] text-neutral-200 outline-none focus:border-violet-500" value={adding} onChange={(e) => {
            const id = e.currentTarget.value;
            if (!id)
                return;
            const op = operationById(id);
            const args: Record<string, string | number> = {};
            for (const a of op?.args ?? [])
                if (a.default !== undefined)
                    args[a.name] = a.default;
            setSteps((prev) => [...prev, { opId: id, args, enabled: true }]);
            setAdding("");
        }}>
          <option value="">add a step…</option>
          
          {groupedOperations().map((group) => (<optgroup key={group.label} label={group.label}>
              {group.operations.map((op) => (<option key={op.id} value={op.id}>
                  {op.label} · {op.id}
                </option>))}
            </optgroup>))}
        </select>
      </div>

      
      <AttachSection identity={input?.identity ?? null} steps={steps} confirm={confirmReplace} setConfirm={setConfirmReplace}/>

      
      <div class="min-h-0 flex-1">
        <div class="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
          result {output.pending && <span class="text-neutral-600">…</span>}
        </div>
        {output.failure ? (<div class="rounded border border-amber-800/60 bg-amber-950/30 px-1.5 py-1 text-amber-400">{output.failure}</div>) : (<pre class="max-h-full overflow-auto whitespace-pre-wrap break-all rounded border border-neutral-800 bg-neutral-950 px-1.5 py-1 font-mono text-[11px] text-neutral-200">
            {output.text}
          </pre>)}
      </div>
    </div>);
}
function AttachSection({ identity, steps, confirm, setConfirm, }: {
    identity: import("../format/store").FieldIdentity | null;
    steps: RecipeStep[];
    confirm: boolean;
    setConfirm: (v: boolean) => void;
}) {
    const [note, setNote] = useState<string | null>(null);
    const recipe: Recipe = { steps };
    if (!identity) {
        return (<div class="rounded border border-neutral-800 px-1.5 py-1 text-[10px] text-neutral-600">
        Nothing to attach to: this value came from a log row, which is a message rather than a field. Send a value
        from State or Watches to attach a recipe to it.
      </div>);
    }
    if (containsWorkbenchOnlyStep(recipe)) {
        return (<div class="rounded border border-amber-800/60 bg-amber-950/30 px-1.5 py-1 text-[10px] text-amber-400">
        This recipe contains an Expression step, which cannot be attached to a field: it stays here, where you are
        watching it. A custom step you want permanently is the signal that the conversion belongs in the built-in set.
      </div>);
    }
    const existing = chosenFor(identity);
    const target = `${identity.group ?? "any message type"} · ${identity.path || "(whole payload)"}`;
    return (<div class="rounded border border-neutral-800 px-1.5 py-1">
      <div class="truncate text-[10px] text-neutral-500" title={target}>
        attach to <span class="text-violet-300">{target}</span>
      </div>
      
      {existing && !confirm && (<div class="mt-0.5 text-[10px] text-amber-500">
          replaces the {existing.kind} format already on this field ({existing.recipe.steps.length} step
          {existing.recipe.steps.length === 1 ? "" : "s"})
        </div>)}
      <button type="button" class="mt-1 w-full rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-200 hover:border-violet-500 hover:text-violet-300" onClick={() => {
            if (existing && !confirm) {
                setConfirm(true);
                return;
            }
            try {
                setChosenFormat(identity, { steps: steps.map((s) => ({ ...s, args: { ...s.args } })) }, "custom");
                setNote(`attached to ${target}`);
                setConfirm(false);
            }
            catch (e) {
                setNote((e as Error).message);
            }
        }}>
        {existing && !confirm ? "Replace the format on this field\u2026" : existing ? "Yes, replace it" : "Attach to this field"}
      </button>
      {note && <div class="mt-0.5 text-[10px] text-neutral-500">{note}</div>}
    </div>);
}
function Suggestions({ value, path, onApply, }: {
    value: unknown;
    path: string;
    onApply: (steps: RecipeStep[]) => void;
}) {
    const found = suggest(value);
    const recognised = detect(value, path);
    if (found.length === 0 && !recognised)
        return null;
    return (<div class="rounded border border-sky-900/60 bg-sky-950/20 px-1.5 py-1">
      {recognised && (<>
          <div class="mb-0.5 text-[10px] uppercase tracking-wide text-emerald-600">recognised as</div>
          <button type="button" class="mb-1 block w-full truncate text-left text-emerald-400 hover:text-violet-300" title="add the steps this was recognised by: the same recipe a row would render it through" onClick={() => onApply(recognised.recipe.steps.map((s) => ({ ...s, args: { ...s.args } })))}>
            + {recognised.recipe.steps.map((s) => operationById(s.opId)?.label ?? s.opId).join(" \u2192 ")}
          </button>
        </>)}
      {found.length > 0 && <div class="mb-0.5 text-[10px] uppercase tracking-wide text-sky-600">might be</div>}
      <ul class="space-y-0.5">
        {found.map((s) => (<li key={s.label} class="flex items-baseline gap-1">
            {s.steps.length > 0 ? (<button type="button" class="shrink-0 text-sky-400 hover:text-violet-300" title={`add ${s.steps.length} step${s.steps.length === 1 ? "" : "s"} to the recipe`} onClick={() => onApply(s.steps.map((st) => ({ opId: st.opId, args: st.args ?? {}, enabled: true, each: st.each })))}>
                + {s.label}
              </button>) : (<span class="shrink-0 text-neutral-400">{s.label}</span>)}
            <span class="min-w-0 truncate text-[10px] text-neutral-600" title={s.reason}>
             : {s.reason}
            </span>
          </li>))}
      </ul>
    </div>);
}
