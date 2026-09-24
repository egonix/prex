const CAPACITY = 4096;
interface Ring {
    samples: Float64Array;
    next: number;
    filled: number;
    total: number;
}
const rings = new Map<string, Ring>();
export function record(name: string, ms: number): void {
    let ring = rings.get(name);
    if (!ring) {
        ring = { samples: new Float64Array(CAPACITY), next: 0, filled: 0, total: 0 };
        rings.set(name, ring);
    }
    ring.samples[ring.next] = ms;
    ring.next = (ring.next + 1) % CAPACITY;
    if (ring.filled < CAPACITY)
        ring.filled++;
    ring.total++;
}
export interface TimingStats {
    total: number;
    window: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
}
function quantile(sorted: Float64Array, q: number): number {
    if (sorted.length === 0)
        return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[idx];
}
export function stats(): Record<string, TimingStats> {
    const out: Record<string, TimingStats> = {};
    for (const [name, ring] of rings) {
        const live = ring.samples.slice(0, ring.filled);
        const sorted = live.slice().sort();
        let sum = 0;
        for (const v of live)
            sum += v;
        out[name] = {
            total: ring.total,
            window: ring.filled,
            mean: ring.filled ? sum / ring.filled : 0,
            p50: quantile(sorted, 0.5),
            p95: quantile(sorted, 0.95),
            p99: quantile(sorted, 0.99),
            max: ring.filled ? sorted[sorted.length - 1] : 0,
        };
    }
    return out;
}
export function reset(): void {
    rings.clear();
}
