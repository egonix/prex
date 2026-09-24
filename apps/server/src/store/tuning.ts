export function envInt(name: string, fallback: number, range: {
    min: number;
    max: number;
}): number {
    const raw = Deno.env.get(name);
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        console.warn(`[prex] ${name}="${raw}" is not an integer, using ${fallback}`);
        return fallback;
    }
    if (parsed < range.min || parsed > range.max) {
        console.warn(`[prex] ${name}=${parsed} is outside ${range.min}..${range.max}, using ${fallback}`);
        return fallback;
    }
    if (parsed !== fallback)
        console.log(`[prex] ${name}=${parsed} (default ${fallback})`);
    return parsed;
}
