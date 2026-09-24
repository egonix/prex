import { z } from "zod";
export const SessionMetaSchema = z.object({
    token: z.string(),
    game: z.string(),
    url: z.string().optional(),
    origin: z.string().optional(),
    userAgent: z.string().optional(),
    connectedAt: z.number().optional(),
    viewerCount: z.number().optional(),
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;
export const HelloSchema = z.object({
    type: z.literal("hello"),
    game: z.string(),
    url: z.string(),
    origin: z.string(),
});
export const ResultOkSchema = z.object({
    type: z.literal("result"),
    id: z.string(),
    ok: z.literal(true),
    value: z.unknown(),
    from: z.string().optional(),
});
export const ResultErrSchema = z.object({
    type: z.literal("result"),
    id: z.string(),
    ok: z.literal(false),
    error: z.string(),
    from: z.string().optional(),
});
export const ConsoleSchema = z.object({
    type: z.literal("console"),
    level: z.enum(["log", "warn", "error"]),
    args: z.array(z.unknown()),
});
export const EventSchema = z.object({
    type: z.literal("event"),
    name: z.string(),
    data: z.unknown(),
});
export const PrexyToServerSchema = z.union([
    HelloSchema,
    ResultOkSchema,
    ResultErrSchema,
    ConsoleSchema,
    EventSchema,
]);
export type PrexyToServer = z.infer<typeof PrexyToServerSchema>;
export const EvalCommandSchema = z.object({
    type: z.literal("eval"),
    id: z.string(),
    code: z.string(),
    from: z.string().optional(),
});
export const LoadModuleCommandSchema = z.object({
    type: z.literal("load-module"),
    id: z.string(),
    url: z.string(),
});
export const ServerToPrexySchema = z.discriminatedUnion("type", [
    EvalCommandSchema,
    LoadModuleCommandSchema,
]);
export type ServerToPrexy = z.infer<typeof ServerToPrexySchema>;
export const ViewerEvalSchema = z.object({
    type: z.literal("eval"),
    code: z.string(),
});
export const ViewerToServerSchema = z.discriminatedUnion("type", [
    ViewerEvalSchema,
]);
export type ViewerToServer = z.infer<typeof ViewerToServerSchema>;
export const PrexyConnectedSchema = z.object({
    type: z.literal("prexy-connected"),
    meta: SessionMetaSchema,
});
export const PrexyDisconnectedSchema = z.object({
    type: z.literal("prexy-disconnected"),
    meta: SessionMetaSchema,
});
export const ViewerWelcomeSchema = z.object({
    type: z.literal("viewer-welcome"),
    viewerId: z.string(),
});
export const TriggerFiredSchema = z.object({
    type: z.literal("trigger-fired"),
    triggerId: z.string(),
    match: z.string(),
    action: z.enum(["webhook", "eval"]),
    ok: z.boolean(),
    detail: z.string().optional(),
});
export const TriggerActionWebhookSchema = z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
});
export const TriggerActionEvalSchema = z.object({
    type: z.literal("eval"),
    code: z.string(),
});
export const TriggerActionSchema = z.discriminatedUnion("type", [
    TriggerActionWebhookSchema,
    TriggerActionEvalSchema,
]);
export type TriggerAction = z.infer<typeof TriggerActionSchema>;
export const CreateTriggerSchema = z.object({
    match: z.string(),
    filter: z.string().optional(),
    action: TriggerActionSchema,
    rateLimitMs: z.number().int().positive().optional(),
});
export type CreateTrigger = z.infer<typeof CreateTriggerSchema>;
export const TriggerSchema = CreateTriggerSchema.extend({
    id: z.string(),
});
export type Trigger = z.infer<typeof TriggerSchema>;
export const TriggerChangedSchema = z.object({
    type: z.literal("trigger-changed"),
    op: z.enum(["created", "updated", "deleted"]),
    triggerId: z.string(),
    trigger: TriggerSchema.optional(),
    from: z.string().optional(),
});
export const ServerToViewerSchema = z.union([
    PrexyConnectedSchema,
    PrexyDisconnectedSchema,
    ViewerWelcomeSchema,
    EvalCommandSchema,
    TriggerFiredSchema,
    TriggerChangedSchema,
    PrexyToServerSchema,
]);
export type ServerToViewer = z.infer<typeof ServerToViewerSchema>;
export const AnchorWhenSchema = z.union([
    z.object({ absent: z.string() }),
    z.object({ equals: z.record(z.unknown()) }),
]);
export const FieldRolesSchema = z.object({
    level: z.array(z.string()).optional(),
    event: z.array(z.string()).optional(),
    sporadic: z.array(z.string()).optional(),
});
export const MessageRuleSchema = z.object({
    match: z.object({ kind: z.string(), type: z.string().optional() }),
    anchorWhen: AnchorWhenSchema.optional(),
    fields: FieldRolesSchema.optional(),
    retention: z.string().optional(),
});
export const GameSchemaDeclarationSchema = z.object({
    game: z.string(),
    version: z.number(),
    messages: z.array(MessageRuleSchema),
    defaultRetention: z.string().optional(),
});
export type AnchorWhen = z.infer<typeof AnchorWhenSchema>;
export type FieldRoles = z.infer<typeof FieldRolesSchema>;
export type MessageRule = z.infer<typeof MessageRuleSchema>;
export type GameSchemaDeclaration = z.infer<typeof GameSchemaDeclarationSchema>;
export const GAME_SCHEMA_EVENT = "game-schema";
