import * as esbuild from "esbuild";
import { readdir, readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { fileURLToPath as fromFileUrl } from "node:url";
const here = new URL(".", import.meta.url);
const outDir = fromFileUrl(new URL("../apps/server/static/prexy/", here));
const moduleOutDir = fromFileUrl(new URL("../static/prex-detect/", here));
const NO_TSCONFIG = { tsconfigRaw: {} };
const gameEntryPoints: string[] = [];
for (const entry of await readdir(fromFileUrl(new URL("./games/", here)), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
        gameEntryPoints.push(fromFileUrl(new URL(`./games/${entry.name}`, here)));
    }
}
const moduleEntryPoints: string[] = [];
const modulesDir = fromFileUrl(new URL("./modules/", here));
for (const entry of await readdir(modulesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
        moduleEntryPoints.push(fromFileUrl(new URL(`./modules/${entry.name}`, here)));
    }
}
await esbuild.build({
    entryPoints: [fromFileUrl(new URL("./core.ts", here))],
    outdir: outDir,
    bundle: true,
    format: "iife",
    globalName: "Prexy",
    target: "es2020",
    minify: true,
    sourcemap: true,
    ...NO_TSCONFIG,
});
const coreJs = await readFile(`${outDir}/core.js`, "utf8");
const loaded = runInNewContext("(0, eval)(code); typeof globalThis.Prexy?.PrexyAgent", { code: coreJs });
if (loaded !== "function") {
    console.error(`[prexy] core.js does not leave a global Prexy.PrexyAgent under (0, eval)(code), as bookmarklets load it (got ${loaded})`);
    process.exit(1);
}
await esbuild.build({
    entryPoints: gameEntryPoints,
    outdir: `${outDir}/games`,
    bundle: true,
    format: "esm",
    target: "es2020",
    minify: true,
    sourcemap: true,
    ...NO_TSCONFIG,
});
if (moduleEntryPoints.length > 0) {
    await esbuild.build({
        entryPoints: moduleEntryPoints,
        outdir: moduleOutDir,
        bundle: true,
        format: "esm",
        target: "es2020",
        minify: true,
        sourcemap: true,
        ...NO_TSCONFIG,
    });
}
esbuild.stop();
console.log(`[prexy] built into ${outDir}`);
if (moduleEntryPoints.length > 0)
    console.log(`[prexy] modules built into ${moduleOutDir}`);
