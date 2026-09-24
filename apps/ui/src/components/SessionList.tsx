import { useStore } from "../store";
export function SessionList() {
    const sessions = useStore((s) => s.sessions);
    const activeToken = useStore((s) => s.activeToken);
    const connect = useStore((s) => s.connect);
    return (<div class="flex h-full min-h-0 flex-col overflow-y-auto bg-neutral-900">
      <div class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Sessions ({sessions.length})
      </div>
      {sessions.length === 0 && <div class="px-3 text-xs text-neutral-600">No active sessions</div>}
      <ul>
        {sessions.map((session) => {
            const active = session.token === activeToken;
            const online = Boolean(session.connectedAt);
            return (<li key={session.token}>
              <button type="button" onClick={() => connect(session.token)} class={`flex w-full flex-col items-start gap-0.5 border-l-2 px-3 py-2 text-left text-xs hover:bg-neutral-800 ${active ? "border-violet-500 bg-neutral-800" : "border-transparent"}`}>
                <span class="flex w-full items-center gap-1.5">
                  <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? "bg-emerald-500" : "bg-neutral-600"}`}/>
                  <span class="truncate font-medium text-neutral-200">{session.token}</span>
                </span>
                <span class="truncate text-neutral-500">{session.game}</span>
                {session.url && <span class="truncate text-neutral-600">{session.url}</span>}
                <span class="text-neutral-600">{session.viewerCount ?? 0} viewer(s)</span>
              </button>
            </li>);
        })}
      </ul>
    </div>);
}
