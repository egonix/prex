import { useStore } from "../store";
export function ModuleTab() {
    const activeToken = useStore((s) => s.activeToken);
    const dbgModuleCode = useStore((s) => s.dbgModuleCode);
    const setDbgModuleCode = useStore((s) => s.setDbgModuleCode);
    const dbgModuleAutoLoad = useStore((s) => s.dbgModuleAutoLoad);
    const setDbgModuleAutoLoad = useStore((s) => s.setDbgModuleAutoLoad);
    const loadPastedModule = useStore((s) => s.loadPastedModule);
    return (<>
      {!activeToken && <div class="px-3 pt-2 text-neutral-600">No session selected</div>}

      {activeToken && (<div class="flex flex-1 flex-col gap-2 p-2">
          <textarea class="min-h-0 flex-1 resize-none rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-[11px] text-neutral-200 outline-none focus:border-violet-500" value={dbgModuleCode} onInput={(e) => setDbgModuleCode(e.currentTarget.value)} placeholder={"export default {\n  name: \"my-module\",\n  init(agent) {\n    // agent === window.__prexy\n  },\n};"} spellcheck={false}/>
          <label class="flex items-center gap-1.5 text-neutral-400">
            <input type="checkbox" checked={dbgModuleAutoLoad} onChange={(e) => setDbgModuleAutoLoad(e.currentTarget.checked)}/>
            auto-load on connect/reconnect
          </label>
          <button type="button" disabled={!dbgModuleCode.trim()} class="rounded border border-violet-700 bg-violet-900/40 px-2 py-1 text-neutral-100 hover:bg-violet-900/60 disabled:opacity-50" onClick={loadPastedModule} title="Result shows up in the Repl panel, same as typing this by hand would">
            Load now
          </button>
        </div>)}
    </>);
}
