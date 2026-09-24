export interface StoredLayout {
    version: number;
    layout: unknown;
}
export type ParseOutcome = {
    status: "absent";
} | {
    status: "unparseable";
} | {
    status: "version";
    found: unknown;
} | {
    status: "ok";
    layout: unknown;
};
export function parseStoredLayout(raw: string | null, expectedVersion: number): ParseOutcome {
    if (!raw)
        return { status: "absent" };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { status: "unparseable" };
    }
    if (!parsed || typeof parsed !== "object")
        return { status: "unparseable" };
    const found = (parsed as StoredLayout).version;
    if (found !== expectedVersion)
        return { status: "version", found };
    const layout = (parsed as StoredLayout).layout;
    if (!layout || typeof layout !== "object")
        return { status: "unparseable" };
    return { status: "ok", layout };
}
interface GridNode {
    type?: unknown;
    data?: unknown;
    size?: unknown;
}
export interface PruneResult {
    layout: unknown | null;
    dropped: string[];
}
export function pruneUnknownPanels(input: unknown, isKnown: (kind: string) => boolean): PruneResult {
    const dropped: string[] = [];
    if (!input || typeof input !== "object")
        return { layout: null, dropped };
    const layout = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    const panels = layout.panels;
    if (!panels || typeof panels !== "object")
        return { layout: null, dropped };
    const removedIds = new Set<string>();
    for (const [instanceId, state] of Object.entries(panels as Record<string, unknown>)) {
        const kind = (state as {
            contentComponent?: unknown;
        } | null)?.contentComponent;
        if (typeof kind !== "string" || !isKnown(kind)) {
            removedIds.add(instanceId);
            dropped.push(typeof kind === "string" ? kind : instanceId);
            delete (panels as Record<string, unknown>)[instanceId];
        }
    }
    if (Object.keys(panels as Record<string, unknown>).length === 0)
        return { layout: null, dropped };
    if (removedIds.size === 0)
        return { layout, dropped };
    const grid = layout.grid as {
        root?: unknown;
    } | undefined;
    if (grid && typeof grid === "object") {
        const root = pruneNode(grid.root, removedIds);
        if (!root)
            return { layout: null, dropped };
        grid.root = root;
    }
    return { layout, dropped };
}
function pruneNode(node: unknown, removed: Set<string>): GridNode | null {
    if (!node || typeof node !== "object")
        return null;
    const n = node as GridNode;
    if (n.type === "leaf") {
        const data = (n.data ?? {}) as {
            views?: unknown;
            activeView?: unknown;
        };
        const views = Array.isArray(data.views)
            ? (data.views as unknown[]).filter((v): v is string => typeof v === "string" && !removed.has(v))
            : [];
        if (views.length === 0)
            return null;
        const activeView = typeof data.activeView === "string" && !removed.has(data.activeView) ? data.activeView : views[0];
        return { ...n, data: { ...data, views, activeView } };
    }
    if (n.type === "branch") {
        const children = Array.isArray(n.data)
            ? (n.data as unknown[]).map((c) => pruneNode(c, removed)).filter((c): c is GridNode => c !== null)
            : [];
        if (children.length === 0)
            return null;
        return { ...n, data: children };
    }
    return null;
}
