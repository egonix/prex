import type { ServerToPrexy } from "@prex/protocol";
import type { Session } from "../sessions/registry.ts";
const DEFAULT_TIMEOUT_MS = 10000;
export type CommandResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: string;
};
export function sendCommand(session: Session, id: string, code: string, opts: {
    timeoutMs?: number;
} = {}): Promise<CommandResult> {
    if (!session.prexy || session.prexy.readyState !== WebSocket.OPEN) {
        return Promise.resolve({ ok: false, error: "prexy not connected" });
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            session.pending.delete(id);
            resolve({ ok: false, error: "command timed out" });
        }, timeoutMs);
        session.pending.set(id, { resolve, timer });
        const command: ServerToPrexy = { type: "eval", id, code };
        session.prexy!.send(JSON.stringify(command));
    });
}
export function resolveCommand(session: Session, id: string, result: CommandResult): boolean {
    const pending = session.pending.get(id);
    if (!pending)
        return false;
    clearTimeout(pending.timer);
    session.pending.delete(id);
    pending.resolve(result);
    return true;
}
