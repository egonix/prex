import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { triggerContentEquals, useStore } from "../store";
import type { CreateTrigger } from "../protocol";
export function TriggersPanel() {
    const activeToken = useStore((s) => s.activeToken);
    const triggers = useStore((s) => s.triggers);
    const triggersError = useStore((s) => s.triggersError);
    const refreshTriggers = useStore((s) => s.refreshTriggers);
    const triggersLoaded = useStore((s) => s.triggersLoaded);
    const createTrigger = useStore((s) => s.createTrigger);
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
    const [match, setMatch] = useState("event:http");
    const [filter, setFilter] = useState("");
    const [actionType, setActionType] = useState<"webhook" | "eval">("eval");
    const [actionValue, setActionValue] = useState("");
    const [rateLimitSec, setRateLimitSec] = useState("");
    const [formError, setFormError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);
    useEffect(() => {
        if (activeToken)
            refreshTriggers();
    }, [activeToken]);
    useEffect(() => {
        if (!triggerDraft)
            return;
        if (triggerDraft.match)
            setMatch(triggerDraft.match);
        setTriggerDraft(null);
        formRef.current?.scrollIntoView({ block: "nearest" });
    }, [triggerDraft]);
    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
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
        setSubmitting(true);
        setFormError(null);
        const result = await createTrigger({ match: match.trim(), filter: filter.trim() || undefined, action, rateLimitMs });
        setSubmitting(false);
        if (!result.ok) {
            setFormError(result.error ?? "failed to create trigger");
            return;
        }
        setFilter("");
        setActionValue("");
        setRateLimitSec("");
    }
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
            {triggers.map((t) => (<li key={t.id} class="rounded border border-neutral-800 p-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate font-medium text-violet-300">{t.match}</span>
                  <button type="button" class="shrink-0 text-neutral-500 hover:text-red-400" onClick={() => deleteTrigger(t.id)}>
                    delete
                  </button>
                </div>
                {t.filter && (<div class="mt-1 truncate text-neutral-500" title={t.filter}>
                    filter: {t.filter}
                  </div>)}
                <div class="mt-1 truncate text-neutral-400" title={t.action.type === "webhook" ? t.action.url : t.action.code}>
                  → {t.action.type} {t.action.type === "webhook" ? t.action.url : t.action.code}
                </div>
                {!!t.rateLimitMs && <div class="mt-1 text-neutral-500">≤ 1 / {t.rateLimitMs / 1000}s</div>}
              </li>))}
          </ul>

          <form ref={formRef} onSubmit={handleSubmit} class="space-y-2 border-t border-neutral-800 p-3">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">New trigger</div>
            <input class="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" value={match} onInput={(e) => setMatch(e.currentTarget.value)} placeholder="match, e.g. &quot;event:http&quot;" spellcheck={false}/>
            <textarea class="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" rows={2} value={filter} onInput={(e) => setFilter(e.currentTarget.value)} placeholder="filter (optional JS, `event` in scope)" spellcheck={false}/>
            <div class="flex gap-2">
              <select class="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" value={actionType} onChange={(e) => setActionType(e.currentTarget.value as "webhook" | "eval")}>
                <option value="eval">eval</option>
                <option value="webhook">webhook</option>
              </select>
              <input class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" value={actionValue} onInput={(e) => setActionValue(e.currentTarget.value)} placeholder={actionType === "webhook" ? "https://..." : "notify(...)"} spellcheck={false}/>
            </div>
            <div class="flex items-center gap-2">
              <input class="w-16 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-violet-500" type="number" min="0" step="any" value={rateLimitSec} onInput={(e) => setRateLimitSec(e.currentTarget.value)} placeholder="0"/>
              <span class="text-neutral-500">
                min seconds between fires <span class="text-neutral-600">(blank = unthrottled)</span>
              </span>
            </div>
            {formError && <div class="text-red-400">{formError}</div>}
            <button type="submit" disabled={submitting} class="w-full rounded border border-violet-700 bg-violet-900/40 px-2 py-1 text-neutral-100 hover:bg-violet-900/60 disabled:opacity-50">
              {submitting ? "Adding\u2026" : "Add trigger"}
            </button>
          </form>
        </>)}
    </>);
}
