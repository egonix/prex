import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { ComponentChildren } from "preact";
import { useStore } from "../store";
import { useFormattedValue, useFormatsVersion, type Formatted } from "../formatting";
import { BUILT_IN_INTERPRETATIONS, chosenFor, clearChosenFormat, resolveFormat, setChosenFormat, type FieldIdentity, } from "../format/store";
import { suggest } from "../format/detect";
export function FormattedValue({ group, path, value, raw, class: className = "", pickable = true, showText = true, }: {
    group: string | null;
    path: string;
    value: unknown;
    raw: string;
    class?: string;
    pickable?: boolean;
    showText?: boolean;
}) {
    const formatted = useFormattedValue(group, path, value, raw);
    return (<span class={`flex min-w-0 items-baseline gap-0.5 ${className}`}>
      {showText ? <FormattedText formatted={formatted} class="min-w-0 truncate"/> : <span class="min-w-0 flex-1"/>}
      {pickable && <SendToWorkbench identity={{ group, path }} value={value}/>}
      {pickable && <FormatPicker identity={{ group, path }} value={value} origin={formatted.origin}/>}
    </span>);
}
export function FormattedText({ formatted, class: className = "" }: {
    formatted: Formatted;
    class?: string;
}) {
    const [showRaw, setShowRaw] = useState(false);
    const converted = formatted.origin !== null && formatted.failure === null;
    const showing = showRaw || !converted ? formatted.raw : formatted.text;
    const mark = formatted.failure !== null
        ? "border-b border-dotted border-amber-500/70"
        : formatted.origin === "detected"
            ? "border-b border-dotted border-sky-600/50"
            : formatted.origin === "chosen"
                ? "border-b border-sky-500/40"
                : "";
    const title = formatted.failure !== null
        ?
            `format failed: ${formatted.failure}\n\nshowing the value as it arrived:\n${formatted.raw}`
        : converted
            ? `${formatted.origin === "detected" ? "automatic guess" : "your choice"}: click for the value as it arrived\n\n${formatted.raw}`
            : undefined;
    return (<span class={`${className} ${mark} ${converted ? "cursor-pointer" : ""}`} title={title} onClick={converted ? () => setShowRaw((v) => !v) : undefined}>
      {formatted.failure !== null && <span class="mr-0.5 text-amber-500">⚠</span>}
      {formatted.pending && <span class="mr-0.5 text-neutral-600">…</span>}
      {showing}
    </span>);
}
export function SendToWorkbench({ identity, value }: {
    identity: FieldIdentity;
    value: unknown;
}) {
    const setWorkbenchInput = useStore((s) => s.setWorkbenchInput);
    return (<button type="button" class="shrink-0 px-0.5 text-neutral-700 hover:text-sky-400" title="Examine this value in the Workbench" onClick={() => setWorkbenchInput({
            value,
            identity,
            label: `${identity.group ?? "any message type"} · ${identity.path || "(whole payload)"}`,
        })}>
      🔍
    </button>);
}
const MENU_WIDTH = 190;
interface MenuPos {
    top: number;
    left: number;
}
function menuPosition(button: HTMLElement): MenuPos {
    const win = button.ownerDocument.defaultView ?? window;
    const rect = button.getBoundingClientRect();
    const left = Math.max(4, Math.min(rect.right - MENU_WIDTH, win.innerWidth - MENU_WIDTH - 4));
    const below = win.innerHeight - rect.bottom;
    const top = below < 220 && rect.top > below ? Math.max(4, rect.top - 4) : rect.bottom + 2;
    return { top, left };
}
function AnchoredMenu({ anchor, pos, onClose, children, }: {
    anchor: HTMLElement;
    pos: MenuPos;
    onClose: () => void;
    children: ComponentChildren;
}) {
    const menuRef = useRef<HTMLDivElement>(null);
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const doc = anchor.ownerDocument;
        const win = doc.defaultView ?? window;
        const away = (e: Event) => {
            const target = e.target as Node;
            if (!anchor.contains(target) && !menuRef.current?.contains(target))
                close.current();
        };
        const key = (e: KeyboardEvent) => e.key === "Escape" && close.current();
        const resized = () => close.current();
        doc.addEventListener("mousedown", away, true);
        doc.addEventListener("keydown", key);
        win.addEventListener("resize", resized);
        return () => {
            doc.removeEventListener("mousedown", away, true);
            doc.removeEventListener("keydown", key);
            win.removeEventListener("resize", resized);
        };
    }, [anchor]);
    return createPortal(<div ref={menuRef} class="fixed z-50 rounded border border-neutral-700 bg-neutral-950 py-0.5 text-[11px] text-neutral-200 shadow-lg" style={{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${MENU_WIDTH}px` }}>
      {children}
    </div>, anchor.ownerDocument.body);
}
export function FormatPicker({ identity, value, origin, }: {
    identity: FieldIdentity;
    value: unknown;
    origin: "chosen" | "detected" | null;
}) {
    const [menu, setMenu] = useState<MenuPos | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const setWorkbenchInput = useStore((s) => s.setWorkbenchInput);
    useFormatsVersion();
    const chosen = chosenFor(identity);
    const label = origin === "chosen" ? "\u0192" : origin === "detected" ? "\u0192?" : "\u0192";
    const tint = origin === "chosen" ? "text-sky-400" : origin === "detected" ? "text-sky-700" : "text-neutral-700";
    return (<span class="shrink-0">
      <button ref={buttonRef} type="button" class={`px-0.5 ${tint} hover:text-violet-300`} title={origin === "chosen"
            ? "rendered by your choice \u2014 click to change"
            : origin === "detected"
                ? "an automatic guess \u2014 click to correct it"
                : "choose how this field reads"} onClick={(e) => setMenu((v) => (v ? null : menuPosition(e.currentTarget as HTMLElement)))}>
        {label}
      </button>
      {menu && buttonRef.current && (<AnchoredMenu anchor={buttonRef.current} pos={menu} onClose={() => setMenu(null)}>
          
          <button type="button" class={`block w-full px-2 py-0.5 text-left hover:bg-neutral-800 ${!chosen ? "text-violet-300" : "text-neutral-300"}`} onClick={() => {
                clearChosenFormat(identity);
                setMenu(null);
            }}>
            Automatic{!chosen && " \u2713"}
          </button>
          <div class="my-0.5 border-t border-neutral-800"/>
          {BUILT_IN_INTERPRETATIONS.map((option) => (<button key={option.kind} type="button" class={`block w-full px-2 py-0.5 text-left hover:bg-neutral-800 ${chosen?.kind === option.kind ? "text-violet-300" : "text-neutral-300"}`} onClick={() => {
                    setChosenFormat(identity, option.recipe, option.kind);
                    setMenu(null);
                }}>
              {option.label}
              {chosen?.kind === option.kind && " \u2713"}
            </button>))}
          
          {suggest(value).filter((s) => s.steps.length > 0).length > 0 && (<>
              <div class="my-0.5 border-t border-neutral-800"/>
              <div class="px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-700">might be</div>
              {suggest(value)
                    .filter((s) => s.steps.length > 0)
                    .map((s) => (<button key={s.label} type="button" class="block w-full truncate px-2 py-0.5 text-left text-sky-400 hover:bg-neutral-800" title={s.reason} onClick={() => {
                        setChosenFormat(identity, { steps: s.steps.map((st) => ({ opId: st.opId, args: st.args ?? {}, enabled: true, each: st.each })) }, "custom");
                        setMenu(null);
                    }}>
                    {s.label}
                  </button>))}
            </>)}

          
          {origin !== null && (<>
              <div class="my-0.5 border-t border-neutral-800"/>
              <button type="button" class="block w-full px-2 py-0.5 text-left text-neutral-300 hover:bg-neutral-800" onClick={() => {
                    const resolved = resolveFormat(identity.group, identity.path, value);
                    setWorkbenchInput({
                        value,
                        identity,
                        label: `${identity.group ?? "any message type"} · ${identity.path || "(whole payload)"}`,
                        recipe: resolved?.recipe,
                    });
                    setMenu(null);
                }}>
                Open the recipe…
              </button>
            </>)}
          <div class="truncate border-t border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-600">
            {identity.group ? identity.group : "any message type"} · {identity.path || "(whole payload)"}
          </div>
        </AnchoredMenu>)}
    </span>);
}
