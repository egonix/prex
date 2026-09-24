import type { DockviewGroupPanel, IHeaderActionsRenderer } from "dockview-core";
export function createGroupActions(group: DockviewGroupPanel): IHeaderActionsRenderer {
    const element = document.createElement("div");
    element.className = "flex items-center pr-1";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "\u29C9";
    button.title = "Move this group into its own window";
    button.className = "px-1 text-[13px] leading-none text-neutral-500 hover:text-violet-300";
    element.appendChild(button);
    let cleanup: (() => void) | undefined;
    return {
        element,
        init(params) {
            const sync = () => {
                button.style.display = group.api.location.type === "popout" ? "none" : "";
            };
            sync();
            const disposable = group.api.onDidLocationChange(sync);
            const onClick = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                void params.containerApi.addPopoutGroup(group).catch((err: unknown) => {
                    console.warn("[prex-ui] could not pop out group:", err);
                });
            };
            button.addEventListener("click", onClick);
            cleanup = () => {
                disposable.dispose();
                button.removeEventListener("click", onClick);
            };
        },
        dispose() {
            cleanup?.();
        },
    };
}
