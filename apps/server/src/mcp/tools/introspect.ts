import type { Session } from "../../sessions/registry.ts";
import { sendCommand } from "../../rpc/command.ts";
function introspectSnippet(game: string): string {
    return `(() => {
  const candidates = ["__prexDefault", ${JSON.stringify(game)}];
  const found = candidates.filter((name) => typeof window[name] !== "undefined");
  if ([...document.querySelectorAll("*")].some((el) => el.shadowRoot)) found.push("shadow-dom-host");
  return found;
})()`;
}
export interface IntrospectResult {
    active_globals: string[];
    capture_module_loaded: boolean;
}
export async function introspectSession(session: Session): Promise<IntrospectResult> {
    if (!session.prexy || session.prexy.readyState !== WebSocket.OPEN) {
        return { active_globals: [], capture_module_loaded: false };
    }
    const result = await sendCommand(session, crypto.randomUUID(), introspectSnippet(session.game));
    if (!result.ok || !Array.isArray(result.value)) {
        return { active_globals: [], capture_module_loaded: false };
    }
    const active_globals = result.value.filter((v): v is string => typeof v === "string");
    return { active_globals, capture_module_loaded: active_globals.length > 0 };
}
