import { useEffect } from "preact/hooks";
import { useStore } from "../store";
const STATE_STYLES: Record<string, string> = {
    idle: "bg-neutral-700 text-neutral-300",
    connecting: "bg-amber-900 text-amber-300",
    open: "bg-emerald-900 text-emerald-300",
    closed: "bg-neutral-700 text-neutral-300",
    error: "bg-red-900 text-red-300",
};
export function ConnectionBar() {
    const serverUrl = useStore((s) => s.serverUrl);
    const adminKey = useStore((s) => s.adminKey);
    const setServerUrl = useStore((s) => s.setServerUrl);
    const setAdminKey = useStore((s) => s.setAdminKey);
    const refreshSessions = useStore((s) => s.refreshSessions);
    const sessionsError = useStore((s) => s.sessionsError);
    const connectionState = useStore((s) => s.connectionState);
    const activeToken = useStore((s) => s.activeToken);
    useEffect(() => {
        refreshSessions();
    }, []);
    return (<div class="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
      <span class="text-sm font-semibold text-neutral-100">prex</span>

      <input class="w-56 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-violet-500" value={serverUrl} onInput={(e) => setServerUrl(e.currentTarget.value)} placeholder="http://localhost:8000" spellcheck={false}/>
      <input class="w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-violet-500" value={adminKey} onInput={(e) => setAdminKey(e.currentTarget.value)} placeholder="admin key" type="password" spellcheck={false}/>
      <button type="button" class="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800" onClick={() => refreshSessions()}>
        Refresh sessions
      </button>

      {sessionsError && <span class="text-xs text-red-400">{sessionsError}</span>}

      <div class="ml-auto flex items-center gap-2">
        {activeToken && (<span class="text-xs text-neutral-400">
            session <code class="text-neutral-200">{activeToken}</code>
          </span>)}
        <span class={`rounded px-2 py-0.5 text-xs ${STATE_STYLES[connectionState]}`}>{connectionState}</span>
      </div>
    </div>);
}
