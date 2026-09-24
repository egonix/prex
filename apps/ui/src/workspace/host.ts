import { h, render } from "preact";
import type { IContentRenderer } from "dockview-core";
import { findPanel } from "./panels";
export function createComponent(options: {
    id: string;
    name: string;
}): IContentRenderer {
    const def = findPanel(options.name);
    const element = document.createElement("div");
    const scroll = def?.scroll ?? "auto";
    element.className = `flex h-full w-full min-h-0 min-w-0 flex-col text-xs ${scroll === "auto" ? "overflow-y-auto" : "overflow-clip"}`;
    if (!def) {
        element.className += " p-3 text-xs text-neutral-500";
        element.textContent = `Unknown panel "${options.name}": it may have been removed since this layout was saved.`;
        return { element, init() { } };
    }
    render(h(def.component, {}), element);
    return {
        element,
        init() { },
        dispose() {
            render(null, element);
        },
    };
}
