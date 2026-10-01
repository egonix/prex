import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { triggerContentEquals, useStore } from "../store";
import type { CreateTrigger, Trigger } from "../protocol";
function TriggerField({ label, text }: {
    label: string;
    text: string;
}) {
    const [copied, setCopied] = useState(false);
    return (<div class="mt-1.5">
      <div class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-neutral-600">
        <span>{label}</span>
        <button type="button" class="normal-case tracking-normal text-neutral-500 hover:text-neutral-200" onClick={() => {
            navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
            }).catch(() => { });
        }}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre class="mt-0.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded bg-neutral-950 px-1.5 py-1 font-mono text-[11px] text-neutral-300">
        {text}
      </pre>
    </div>);
}
function actionText(t: Trigger): string {
    return t.action.type === "webhook" ? t.action.url : t.action.code;
}
export function TriggersPanel() {
    const activeToken = useStore((s) => s.activeToken);
    const triggers = useStore((s) => s.triggers);
    const triggersError = useStore((s) => s.triggersError);
    const refreshTriggers = useStore((s) => s.refreshTriggers);
    const triggersLoaded = useStore((s) => s.triggersLoaded);
    const createTrigger = useStore((s) => s.createTrigger);
    const updateTrigger = useStore((s) => s.updateTrigger);
    const deleteTrigger = useStore((s) => s.deleteTrigger);
    const triggerDraft = useStore((s) => s.triggerDraft);
    const setTriggerDraft = useStore((s) => s.setTriggerDraft);
    const savedTriggers = useStore((s) => s.savedTriggers);
    const restoreSavedTrigger = useStore((s) => s.restoreSavedTrigger);
    const [restoringAll, setRestoringAll] = useState(false);
    const missing = useMemo(() => {
        if (!triggersLoaded)
            return [];
        const saved = (activeToken && savedTriggers[activeToken]) || [];
        return saved.filter((s) => !triggers.some((live) => triggerContentEquals(s, live)));
    }, [activeToken, savedTriggers, triggers, triggersLoaded]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const toggleExpanded = (id: string) => setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id))
            next.add(id);
        return next;
    });
    const [match, setMatch] = useState("event:http");
    const [filter, setFilter] = useState("");
    const [actionType, setActionType] = useState<"webhook" | "eval">("eval");
    const [actionValue, setActionValue] = useState("");
    const [rateLimitSec, setRateLimitSec] = useState("");
    const [formError, setFormError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    useEffect(() => {
        if (activeToken)
            refreshTriggers();
        if (editingId)
            resetForm();
    }, [activeToken]);
    useEffect(() => {
        if (!triggerDraft)
            return;
        setEditingId(null);
        if (triggerDraft.match)
            setMatch(triggerDraft.match);
        setTriggerDraft(null);
        formRef.current?.scrollIntoView({ block: "nearest" });
    }, [triggerDraft]);
    function resetForm() {
        setEditingId(null);
        setFilter("");
        setActionValue("");
        setRateLimitSec("");
        setFormError(null);
    }
    function startEdit(t: Trigger) {
        setEditingId(t.id);
        setMatch(t.match);
        setFilter(t.filter ?? "");
        setActionType(t.action.type);
        setActionValue(actionText(t));
        setRateLimitSec(t.rateLimitMs ? String(t.rateLimitMs / 1000) : "");
        setFormError(null);
        formRef.current?.scrollIntoView({ block: "nearest" });
    }
    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        const asNew = (e.submitter as HTMLButtonElement | null)?.value === "new";
        if (!match.trim()) {
            setFormError("match is required");
            return;
        }
        if (!actionValue.trim()) {
            setFormError(actionType === "webhook" ? "webhook url is required" : "eval code is required");
            return;
        }
        const rateLimitMs = rateLimitSec.trim() ? Math.round(Number(rateLimitSec) * 1000) : undefined;
        if (rateLimitSec.trim() && (!Number.isFinite(rateLimitMs) || rateLimitMs! <= 0)) {
            setFormError("rate limit must be a positive number of seconds");
            return;
        }
        const action: CreateTrigger["action"] = actionType === "webhook"
            ? { type: "webhook", url: actionValue.trim() }
            : { type: "eval", code: actionValue };
        const input: CreateTrigger = { match: match.trim(), filter: filter.trim() || undefined, action, rateLimitMs };
        setSubmitting(true);
        setFormError(null);
        const result = editingId && !asNew ? await updateTrigger(editingId, input) : await createTrigger(input);
        setSubmitting(false);
        if (!result.ok) {
            setFormError(result.error ?? (editingId && !asNew ? "failed to update trigger" : "failed to create trigger"));
            return;
        }
        resetForm();
    }
    const inputClass = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500";
    return (<>
      {!activeToken && <div class="px-3 pt-2 text-neutral-600">No session selected</div>}

      {activeToken && (<>
          {triggersError && <div class="px-3 pb-2 text-red-400">{triggersError}</div>}

          {missing.length > 0 && (<div class="mx-2 mb-2 rounded border border-amber-800/60 bg-amber-950/30 p-2">
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                  Saved, not active ({missing.length})
                </span>
                {missing.length > 1 && (<button type="button" disabled={restoringAll} class="text-amber-400 hover:text-amber-200 disabled:opacity-50" onClick={async () => {
                        setRestoringAll(true);
                        for (const m of missing)
                            await restoreSavedTrigger(m);
                        setRestoringAll(false);
                    }}>
                    {restoringAll ? "restoring\u2026" : "restore all"}
                  </button>)}
              </div>
              <ul class="space-y-1">
                {missing.map((m) => (<li key={m.savedId} class="flex items-center justify-between gap-2">
                    <span class="min-w-0 flex-1 truncate text-amber-200" title={m.match}>
                      {m.match}
                    </span>
                    <button type="button" class="shrink-0 rounded border border-amber-700 px-1.5 text-amber-300 hover:bg-amber-900/40" onClick={() => restoreSavedTrigger(m)}>
                      restore
                    </button>
                  </li>))}
              </ul>
            </div>)}

          <ul class="flex-1 space-y-2 overflow-y-auto px-2">
            {triggers.length === 0 && !triggersError && <div class="px-1 text-neutral-600">No triggers yet</div>}
            {triggers.map((t) => {
                const open = expanded.has(t.id);
                return (<li key={t.id} class={`rounded border p-2 ${editingId === t.id ? "border-violet-700" : "border-neutral-800"}`}>
                  <div class="flex items-center justify-between gap-2">
                    <button type="button" class="min-w-0 flex-1 truncate text-left font-medium text-violet-300" onClick={() => toggleExpanded(t.id)} title={open ? "Collapse" : "Show the whole trigger"}>
                      <span class="text-neutral-600">{open ? "\u25BE" : "\u25B8"}</span> {t.match}
                    </button>
                    <button type="button" class="shrink-0 text-neutral-500 hover:text-violet-300" onClick={() => startEdit(t)} title="Load into the form below to change or copy it">
                      edit
                    </button>
                    <button type="button" class="shrink-0 text-neutral-500 hover:text-red-400" onClick={() => {
                        if (editingId === t.id)
                            resetForm();
                        deleteTrigger(t.id);
                    }}>
                      delete
                    </button>
                  </div>
                  {open ? (<>
                      {t.filter && <TriggerField label="filter" text={t.filter}/>}
                      <TriggerField label={`→ ${t.action.type}`} text={actionText(t)}/>
                    </>) : (<>
                      {t.filter && <div class="mt-1 truncate text-neutral-500">filter: {t.filter}</div>}
                      <div class="mt-1 truncate text-neutral-400">
                        → {t.action.type} {actionText(t)}
                      </div>
                    </>)}
                  {!!t.rateLimitMs && <div class="mt-1 text-neutral-500">≤ 1 / {t.rateLimitMs / 1000}s</div>}
                </li>);
            })}
          </ul>

          <form ref={formRef} onSubmit={handleSubmit} class="space-y-2 border-t border-neutral-800 p-3">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              {editingId ? "Edit trigger" : "New trigger"}
            </div>
            <input class={inputClass} value={match} onInput={(e) => setMatch(e.currentTarget.value)} placeholder="match, e.g. &quot;event:http&quot;" spellcheck={false}/>
            <textarea class={`${inputClass} font-mono text-[11px]`} rows={2} value={filter} onInput={(e) => setFilter(e.currentTarget.value)} placeholder="filter (optional JS, `event` in scope)" spellcheck={false}/>
            <div class="flex items-start gap-2">
              <select class="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" value={actionType} onChange={(e) => setActionType(e.currentTarget.value as "webhook" | "eval")}>
                <option value="eval">eval</option>
                <option value="webhook">webhook</option>
              </select>
              {actionType === "webhook" ? (<input class={`${inputClass} min-w-0 flex-1`} value={actionValue} onInput={(e) => setActionValue(e.currentTarget.value)} placeholder="https://..." spellcheck={false}/>) : (<textarea class={`${inputClass} min-w-0 flex-1 resize-y font-mono text-[11px]`} rows={editingId ? 6 : 2} value={actionValue} onInput={(e) => setActionValue(e.currentTarget.value)} placeholder="notify(...)" spellcheck={false}/>)}
            </div>
            <div class="flex items-center gap-2">
              <input class="w-16 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" type="number" min="0" step="any" value={rateLimitSec} onInput={(e) => setRateLimitSec(e.currentTarget.value)} placeholder="0"/>
              <span class="text-neutral-500">
                min seconds between fires <span class="text-neutral-600">(blank = unthrottled)</span>
              </span>
            </div>
            {formError && <div class="text-red-400">{formError}</div>}
            {editingId ? (<div class="flex gap-2">
                <button type="submit" value="save" disabled={submitting} class="flex-1 rounded border border-violet-700 bg-violet-900/40 px-2 py-1 text-neutral-100 hover:bg-violet-900/60 disabled:opacity-50">
                  {submitting ? "Saving\u2026" : "Save changes"}
                </button>
                <button type="submit" value="new" disabled={submitting} class="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50" title="Create a copy with these values and leave the original unchanged">
                  Add as new
                </button>
                <button type="button" disabled={submitting} class="rounded border border-neutral-700 px-2 py-1 text-neutral-400 hover:bg-neutral-800 disabled:opacity-50" onClick={resetForm}>
                  Cancel
                </button>
              </div>) : (<button type="submit" disabled={submitting} class="w-full rounded border border-violet-700 bg-violet-900/40 px-2 py-1 text-neutral-100 hover:bg-violet-900/60 disabled:opacity-50">
                {submitting ? "Adding\u2026" : "Add trigger"}
              </button>)}
          </form>
        </>)}
    </>);
}
