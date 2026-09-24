import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { DockviewComponent, themeDark } from "dockview-core";
import type { DockviewApi, ContextMenuItem } from "dockview-core";
import { createComponent } from "./host";
import { createGroupActions } from "./group-actions";
import { PANELS, findPanel } from "./panels";
import { restoreLayout, resetLayout, saveLayout, saveAsDefault, clearCustomDefault, hasCustomDefault } from "./layout";
const SAVE_DEBOUNCE_MS = 250;
function tabContextMenuItems(): ContextMenuItem[] {
    return ["maximize", "popout", "separator", "close", "closeOthers", "closeAll"];
}
export function Workspace() {
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<DockviewApi | null>(null);
    const [openKinds, setOpenKinds] = useState<string[]>([]);
    const [customDefault, setCustomDefault] = useState(() => hasCustomDefault());
    useEffect(() => {
        if (!containerRef.current)
            return;
        const dock = new DockviewComponent(containerRef.current, {
            createComponent,
            defaultRenderer: "always",
            theme: themeDark,
            createRightHeaderActionComponent: createGroupActions,
            getTabContextMenuItems: tabContextMenuItems,
        });
        const api = dock.api;
        apiRef.current = api;
        const syncOpenKinds = () => setOpenKinds(api.panels.map((p) => p.view.contentComponent));
        restoreLayout(api);
        syncOpenKinds();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const disposable = api.onDidLayoutChange(() => {
            syncOpenKinds();
            if (timer)
                clearTimeout(timer);
            timer = setTimeout(() => saveLayout(api), SAVE_DEBOUNCE_MS);
        });
        return () => {
            if (timer)
                clearTimeout(timer);
            disposable.dispose();
            apiRef.current = null;
            dock.dispose();
        };
    }, []);
    const openPanel = useCallback((kind: string) => {
        const api = apiRef.current;
        const def = findPanel(kind);
        if (!api || !def)
            return;
        const existing = api.panels.find((p) => p.view.contentComponent === kind);
        if (existing) {
            existing.api.setActive();
            return;
        }
        api.addPanel({ id: def.id, component: def.id, title: def.title });
    }, []);
    const closed = PANELS.filter((p) => !openKinds.includes(p.id));
    return (<div class="flex min-h-0 min-w-0 flex-1 flex-col">
      
      <div class="flex shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-1">
        <select class="rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-xs text-neutral-200 outline-none focus:border-violet-500 disabled:text-neutral-600" value="" disabled={closed.length === 0} onChange={(e) => {
            const kind = e.currentTarget.value;
            e.currentTarget.value = "";
            if (kind)
                openPanel(kind);
        }} title="Open a panel that is currently closed">
          <option value="">{closed.length === 0 ? "All panels open" : "Open panel\u2026"}</option>
          {closed.map((p) => (<option key={p.id} value={p.id}>
              {p.title}
            </option>))}
        </select>

        <button type="button" class="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200" onClick={() => {
            const api = apiRef.current;
            if (!api)
                return;
            saveAsDefault(api);
            setCustomDefault(true);
        }} title="Make the current arrangement the default: what Reset layout returns to, and what a browser with no saved arrangement opens in">
          Save as default
        </button>

        {customDefault && (<button type="button" class="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200" onClick={() => {
                clearCustomDefault();
                setCustomDefault(false);
            }} title="Forget the saved default and go back to the built-in one. Does not change the current arrangement.">
            Clear default
          </button>)}

        <button type="button" class="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200" onClick={() => {
            const api = apiRef.current;
            if (api)
                resetLayout(api);
        }} title={customDefault ? "Return to your saved default arrangement" : "Discard the saved arrangement and return to the built-in default"}>
          Reset layout
        </button>
      </div>

      
      <div ref={containerRef} class="min-h-0 min-w-0 flex-1"/>
    </div>);
}
