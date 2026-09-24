import type { DockviewApi } from "dockview-core";
import { PANELS, isKnownPanel, type PanelDefinition } from "./panels";
import { parseStoredLayout, pruneUnknownPanels, type StoredLayout } from "./layout-guard";
import { BUILT_IN_LAYOUT } from "./default-layout";
export const LAYOUT_KEY = "prex-ui-workspace-layout";
export const DEFAULT_KEY = "prex-ui-workspace-default";
export const LAYOUT_VERSION = 1;
export type { StoredLayout } from "./layout-guard";
function instanceIdFor(def: PanelDefinition): string {
    return def.id;
}
export function buildBuiltInLayout(api: DockviewApi): void {
    const inGroup = (group: string) => PANELS.filter((p) => p.defaultGroup === group);
    type Dir = "left" | "right" | "above" | "below" | "within";
    const add = (def: PanelDefinition, position?: {
        direction: Dir;
        referencePanel: string;
    }) => api.addPanel({ id: instanceIdFor(def), component: def.id, title: def.title, position });
    const left = inGroup("left");
    const centre = inGroup("centre");
    const centreBottom = inGroup("centre-bottom");
    const right = inGroup("right");
    const first = left[0] ?? centre[0] ?? right[0] ?? centreBottom[0];
    if (!first)
        return;
    const addGroup = (defs: PanelDefinition[], anchor: PanelDefinition | undefined, direction: Dir) => {
        defs.forEach((def, i) => {
            if (i === 0) {
                add(def, anchor ? { direction, referencePanel: instanceIdFor(anchor) } : undefined);
            }
            else {
                add(def, { direction: "within", referencePanel: instanceIdFor(defs[0]) });
            }
        });
        return defs[0];
    };
    const leftAnchor = addGroup(left, undefined, "right");
    const centreAnchor = addGroup(centre, leftAnchor ?? undefined, "right");
    const rightAnchor = addGroup(right, centreAnchor ?? leftAnchor, "right");
    addGroup(centreBottom, centreAnchor ?? leftAnchor ?? rightAnchor, "below");
    sizePanel(api, leftAnchor, { width: 256 });
    sizePanel(api, rightAnchor, { width: 288 });
    sizePanel(api, centreAnchor, { height: 320 });
}
export function buildDefaultLayout(api: DockviewApi): void {
    if (applyCustomDefault(api))
        return;
    if (applySerializedLayout(api, BUILT_IN_LAYOUT, "shipped default layout"))
        return;
    buildBuiltInLayout(api);
}
function applyCustomDefault(api: DockviewApi): boolean {
    const parsed = parseStoredLayout(readRaw(DEFAULT_KEY), LAYOUT_VERSION);
    if (parsed.status === "absent")
        return false;
    if (parsed.status === "unparseable") {
        console.warn("[prex-ui] saved default layout could not be parsed, falling back");
        return false;
    }
    if (parsed.status === "version") {
        console.warn(`[prex-ui] saved default layout is version ${String(parsed.found)}, expected ${LAYOUT_VERSION}: falling back`);
        return false;
    }
    return applySerializedLayout(api, parsed.layout, "saved default layout");
}
function applySerializedLayout(api: DockviewApi, source: unknown, label: string): boolean {
    const { layout, dropped } = pruneUnknownPanels(source, isKnownPanel);
    if (dropped.length > 0) {
        console.warn(`[prex-ui] ${label} named unknown panel kind(s), ignoring: ${dropped.join(", ")}`);
    }
    if (!layout) {
        console.warn(`[prex-ui] ${label} had no known panels left, falling back`);
        return false;
    }
    try {
        api.fromJSON(layout as never);
        return true;
    }
    catch (err) {
        console.warn(`[prex-ui] ${label} was rejected by the layout engine, falling back:`, err);
        api.clear();
        return false;
    }
}
export function saveAsDefault(api: DockviewApi): void {
    try {
        const payload: StoredLayout = { version: LAYOUT_VERSION, layout: api.toJSON() };
        localStorage.setItem(DEFAULT_KEY, JSON.stringify(payload));
    }
    catch {
    }
}
export function clearCustomDefault(): void {
    try {
        localStorage.removeItem(DEFAULT_KEY);
    }
    catch {
    }
}
export function hasCustomDefault(): boolean {
    return readRaw(DEFAULT_KEY) !== null;
}
function sizePanel(api: DockviewApi, def: PanelDefinition | undefined, size: {
    width?: number;
    height?: number;
}): void {
    if (!def)
        return;
    api.getPanel(instanceIdFor(def))?.api.setSize(size);
}
export function saveLayout(api: DockviewApi): void {
    try {
        const payload: StoredLayout = { version: LAYOUT_VERSION, layout: api.toJSON() };
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(payload));
    }
    catch {
    }
}
export function clearLayout(): void {
    try {
        localStorage.removeItem(LAYOUT_KEY);
    }
    catch {
    }
}
export function resetLayout(api: DockviewApi): void {
    clearLayout();
    api.clear();
    buildDefaultLayout(api);
    saveLayout(api);
}
export function restoreLayout(api: DockviewApi): void {
    const parsed = parseStoredLayout(readRaw(LAYOUT_KEY), LAYOUT_VERSION);
    switch (parsed.status) {
        case "absent":
            buildDefaultLayout(api);
            return;
        case "unparseable":
            console.warn("[prex-ui] saved layout could not be parsed, using the default");
            buildDefaultLayout(api);
            return;
        case "version":
            console.warn(`[prex-ui] saved layout is version ${String(parsed.found)}, expected ${LAYOUT_VERSION}: using the default`);
            buildDefaultLayout(api);
            return;
    }
    const { layout, dropped } = pruneUnknownPanels(parsed.layout, isKnownPanel);
    if (dropped.length > 0) {
        console.warn(`[prex-ui] saved layout named unknown panel kind(s), ignoring: ${dropped.join(", ")}`);
    }
    if (!layout) {
        console.warn("[prex-ui] saved layout had no known panels left after filtering, using the default");
        buildDefaultLayout(api);
        return;
    }
    try {
        api.fromJSON(layout as never);
    }
    catch (err) {
        console.warn("[prex-ui] saved layout was rejected by the layout engine, using the default:", err);
        api.clear();
        buildDefaultLayout(api);
    }
}
function readRaw(key: string): string | null {
    try {
        return localStorage.getItem(key);
    }
    catch {
        return null;
    }
}
