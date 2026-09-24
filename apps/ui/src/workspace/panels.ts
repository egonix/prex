import type { VNode } from "preact";
import { SessionList } from "../components/SessionList";
import { Repl } from "../components/Repl";
import { ConsolePanel } from "../components/ConsolePanel";
import { TriggersPanel } from "../components/TriggersPanel";
import { WatchPanel } from "../components/WatchPanel";
import { StateTab } from "../components/StateTab";
import { ModuleTab } from "../components/ModuleTab";
import { PerfPanel } from "../components/PerfPanel";
import { Workbench } from "../components/Workbench";
export interface PanelDefinition {
    id: string;
    title: string;
    component: () => VNode;
    defaultGroup?: string;
    singleton?: boolean;
    scroll?: "auto" | "none";
}
export const PANELS: PanelDefinition[] = [
    { id: "sessions", title: "Sessions", component: SessionList, defaultGroup: "left", scroll: "none" },
    { id: "repl", title: "REPL", component: Repl, defaultGroup: "centre", scroll: "none" },
    { id: "console", title: "Console & events", component: ConsolePanel, defaultGroup: "centre-bottom", scroll: "none" },
    { id: "triggers", title: "Triggers", component: TriggersPanel, defaultGroup: "right" },
    { id: "watches", title: "Watches", component: WatchPanel, defaultGroup: "right" },
    { id: "state", title: "State", component: StateTab, defaultGroup: "right", scroll: "none" },
    { id: "module", title: "Module", component: ModuleTab, defaultGroup: "right" },
    { id: "workbench", title: "Workbench", component: Workbench },
    { id: "perf", title: "Performance", component: PerfPanel },
];
const byId = new Map(PANELS.map((p) => [p.id, p]));
if (byId.size !== PANELS.length) {
    throw new Error("[prex-ui] duplicate panel id in PANELS");
}
export function findPanel(id: string): PanelDefinition | undefined {
    return byId.get(id);
}
export function isKnownPanel(id: string): boolean {
    return byId.has(id);
}
