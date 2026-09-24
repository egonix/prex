export interface ScriptMatch {
    key: string;
    files: string[];
    contexts: string[];
}
export async function discoverInScripts(pattern: RegExp, opts: {
    contextChars?: number;
    maxContextsPerKey?: number;
    filter?: (url: string) => boolean;
} = {}): Promise<ScriptMatch[]> {
    const contextChars = opts.contextChars ?? 150;
    const maxContextsPerKey = opts.maxContextsPerKey ?? 3;
    const filter = opts.filter ?? (() => true);
    const scriptUrls = [...document.querySelectorAll("script[src]")].map((el) => (el as HTMLScriptElement).src).filter(filter);
    const found = new Map<string, ScriptMatch>();
    await Promise.all(scriptUrls.map(async (url) => {
        try {
            const res = await fetch(url);
            const text = await res.text();
            const fileName = url.split("/").pop()?.split("?")[0] ?? url;
            const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
            let m: RegExpExecArray | null;
            while ((m = re.exec(text))) {
                const key = m[1] ?? m[0];
                let entry = found.get(key);
                if (!entry) {
                    entry = { key, files: [], contexts: [] };
                    found.set(key, entry);
                }
                if (!entry.files.includes(fileName))
                    entry.files.push(fileName);
                if (entry.contexts.length < maxContextsPerKey) {
                    entry.contexts.push(text.slice(Math.max(0, m.index - 10), m.index + contextChars));
                }
            }
        }
        catch {
        }
    }));
    return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}
