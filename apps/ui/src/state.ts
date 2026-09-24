export type FieldRole = "level" | "event" | "sporadic" | "unknown";
export interface FoldedField {
    value: unknown;
    role: FieldRole;
    observedAt: number;
    staleMs: number;
}
export interface FoldedState {
    at: number;
    episodeId: number | null;
    anchorTs: number | null;
    foldedMessages: number;
    fields: Record<string, FoldedField>;
    truncatedAtEpisodeStart: boolean;
}
export const ROLE_STYLE: Record<FieldRole, string> = {
    level: "text-emerald-400",
    event: "text-amber-400",
    sporadic: "text-sky-400",
    unknown: "text-neutral-500",
};
export const ROLE_HELP: Record<FieldRole, string> = {
    level: "absolute value \u2014 current as of this instant",
    event: "per-occurrence value \u2014 belongs to the message it arrived in, not to 'now'",
    sporadic: "meaningful by its absence \u2014 a stale value here may mean 'did not happen since'",
    unknown: "no role declared for this field \u2014 judge by how stale it is",
};
