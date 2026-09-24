import { type GameModule, type PrexyAgent, PREXY_CONTROL_SOCKET } from "../core.ts";
import { createCaptureLog, drainPrehook, hookEventSource, hookFetch, hookNamedDispatch, hookSendBeacon, hookWebSocketFull, hookXHR, nativeFetch, readGlobal, type CaptureLogEntry, } from "./lib/capture.ts";
import { getMethods, hijack, hijackMethods, hook, notify, requestNotificationPermission } from "./lib/toolkit.ts";
export interface DefaultApi {
    log: CaptureLogEntry[];
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    readGlobal: typeof readGlobal;
    hookNamedDispatch: (name: string) => boolean;
    nativeFetch: typeof nativeFetch;
    notify: typeof notify;
    requestNotificationPermission: typeof requestNotificationPermission;
    hook: typeof hook;
    hijack: typeof hijack;
    getMethods: typeof getMethods;
    hijackMethods: typeof hijackMethods;
}
const defaultModule: GameModule = {
    name: "default",
    init(agent: PrexyAgent) {
        const capture = createCaptureLog(agent);
        agent.registerCaptureLog(capture.log);
        const isControlSocket = (ws: WebSocket) => !!(ws as unknown as Record<symbol, boolean>)[PREXY_CONTROL_SOCKET];
        hookFetch(capture.push);
        hookXHR(capture.push);
        hookWebSocketFull(capture.push, { isControlSocket });
        hookEventSource(capture.push);
        hookSendBeacon(capture.push);
        const replayed = drainPrehook(capture.push);
        const api: DefaultApi = {
            log: capture.log,
            pause: capture.pause,
            resume: capture.resume,
            isPaused: capture.isPaused,
            readGlobal,
            hookNamedDispatch: (name: string) => hookNamedDispatch(name, capture.push),
            nativeFetch,
            notify,
            requestNotificationPermission,
            hook,
            hijack,
            getMethods,
            hijackMethods,
        };
        (window as unknown as {
            __prexDefault: DefaultApi;
        }).__prexDefault = api;
        agent.event("default-ready", { replayed });
    },
};
export default defaultModule;
