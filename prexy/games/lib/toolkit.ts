export type NotificationPermissionState = NotificationPermission | null;
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
    if (typeof window === "undefined" || typeof Notification === "undefined")
        return null;
    if (Notification.permission !== "default")
        return Notification.permission;
    try {
        return await Notification.requestPermission();
    }
    catch {
        return null;
    }
}
export function notify(title: string, body?: unknown, tag?: string, timeoutMs = 7000): boolean {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
        console.log("[notify] not supported in this context");
        return false;
    }
    if (Notification.permission === "denied") {
        console.log("[notify] permission denied");
        return false;
    }
    if (Notification.permission !== "granted") {
        console.log("[notify] permission not yet granted \u2014 call requestNotificationPermission() first");
        requestNotificationPermission();
        return false;
    }
    try {
        const note = new Notification(title, { body: String(body ?? ""), tag: tag || "prex-notification", silent: true });
        note.onclick = () => {
            window.focus();
            note.close();
        };
        setTimeout(() => note.close(), timeoutMs);
        return true;
    }
    catch (err) {
        console.error("[notify] error:", (err as Error)?.message ?? err);
        return false;
    }
}
export type HookCallback<F extends (...args: unknown[]) => unknown> = (target: F, thisArg: unknown, args: Parameters<F>) => ReturnType<F>;
export function hook<F extends (...args: unknown[]) => unknown>(fn: F, callback: HookCallback<F> = (target, thisArg, args) => Reflect.apply(target, thisArg, args) as ReturnType<F>): F {
    return new Proxy(fn, {
        apply(target, thisArg, args) {
            return callback(target, thisArg, args as Parameters<F>);
        },
    });
}
export interface HijackPatch<F extends (...args: unknown[]) => unknown> {
    arg?: (args: Parameters<F>) => Parameters<F>;
    ret?: (value: ReturnType<F>) => ReturnType<F>;
}
export function hijack<F extends (...args: unknown[]) => unknown>(fn: F, patch: HijackPatch<F> = {}, dump = false, printFn: (...args: unknown[]) => void = console.log): F {
    return new Proxy(fn, {
        apply(target, thisArg, args) {
            const label = `${(target as {
                name?: string;
            }).name || "(anonymous)"}`;
            if (dump) {
                printFn(`[hijack] PRE ${label}(${args.join(",")})`, target);
                console.trace();
            }
            else {
                printFn(`[hijack] PRE ${label}(${args.join(",")}) =>`, args);
            }
            const patchedArgs = patch.arg ? patch.arg(args as Parameters<F>) : (args as Parameters<F>);
            const value = Reflect.apply(target, thisArg, patchedArgs) as ReturnType<F>;
            const returnValue = patch.ret ? patch.ret(value) : value;
            printFn(`[hijack] POST ${label}(${args.join(",")}) =>`, returnValue);
            return returnValue;
        },
        get(target, property, receiver) {
            const original = (target as unknown as Record<PropertyKey, unknown>)[property as PropertyKey];
            if (typeof original === "function") {
                return (...args: unknown[]) => Reflect.apply(original as (...a: unknown[]) => unknown, receiver, args);
            }
            return original;
        },
    }) as F;
}
export function getMethods(obj: object, filterNative = false): string[] {
    return Object.getOwnPropertyNames(obj).filter((p) => {
        const value = (obj as Record<string, unknown>)[p];
        if (typeof value !== "function")
            return false;
        return filterNative ? !value.toString().includes("[native code]") : true;
    });
}
export function hijackMethods(obj: object, filterNative = true, patch: HijackPatch<(...args: unknown[]) => unknown> = {}, dump = false, printFn: (...args: unknown[]) => void = console.log): void {
    for (const key of getMethods(obj, filterNative)) {
        if (key === "hijack" || key === "hijackMethods")
            continue;
        const ref = (obj as Record<string, unknown>)[key];
        if (typeof ref === "function") {
            printFn(`[hijackMethods] wrapping ${key}`);
            (obj as Record<string, unknown>)[key] = hijack(ref as (...args: unknown[]) => unknown, patch, dump, printFn);
        }
        else if (ref && typeof ref === "object") {
            hijackMethods(ref, filterNative, patch, dump, printFn);
        }
    }
}
