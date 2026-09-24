export interface SessionMeta {
    token: string;
    game: string;
    url?: string;
    origin?: string;
    userAgent?: string;
    connectedAt?: number;
    viewerCount?: number;
}
export type PrexyToServer = {
    type: "hello";
    game: string;
    url: string;
    origin: string;
} | {
    type: "result";
    id: string;
    ok: true;
    value: unknown;
    from?: string;
} | {
    type: "result";
    id: string;
    ok: false;
    error: string;
    from?: string;
} | {
    type: "console";
    level: "log" | "warn" | "error";
    args: unknown[];
} | {
    type: "event";
    name: string;
    data: unknown;
};
export type EvalCommand = {
    type: "eval";
    id: string;
    code: string;
    from?: string;
};
export type TriggerFired = {
    type: "trigger-fired";
    triggerId: string;
    match: string;
    action: "webhook" | "eval";
    ok: boolean;
    detail?: string;
};
export type TriggerChanged = {
    type: "trigger-changed";
    op: "created" | "updated" | "deleted";
    triggerId: string;
    trigger?: Trigger;
    from?: string;
};
export type ServerToViewer = {
    type: "prexy-connected";
    meta: SessionMeta;
} | {
    type: "prexy-disconnected";
    meta: SessionMeta;
} | {
    type: "viewer-welcome";
    viewerId: string;
} | EvalCommand | TriggerFired | TriggerChanged | PrexyToServer;
export type ViewerToServer = {
    type: "eval";
    code: string;
};
export type TriggerAction = {
    type: "webhook";
    url: string;
} | {
    type: "eval";
    code: string;
};
export interface CreateTrigger {
    match: string;
    filter?: string;
    action: TriggerAction;
    rateLimitMs?: number;
}
export interface Trigger extends CreateTrigger {
    id: string;
}
