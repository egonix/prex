import { getSession, listSessions, type Session } from "../sessions/registry.ts";
import { getSessionRecord, type SessionRecord } from "../store/config.ts";
const SESSION_ID_LENGTH = 16;
export async function deriveSessionId(token: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, SESSION_ID_LENGTH);
}
export async function resolveSessionId(sessionId: string): Promise<Session | null> {
    for (const meta of listSessions()) {
        if ((await deriveSessionId(meta.token)) === sessionId) {
            return getSession(meta.token) ?? null;
        }
    }
    return null;
}
export async function describeSessionId(sessionId: string): Promise<{
    live: Session | null;
    record: SessionRecord | null;
}> {
    const live = await resolveSessionId(sessionId);
    if (live)
        return { live, record: null };
    const record = await getSessionRecord(sessionId).catch(() => null);
    return { live: null, record };
}
