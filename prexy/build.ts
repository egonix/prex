import * as esbuild from "esbuild";
import { fromFileUrl } from "jsr:@std/path@^1.0.8/from-file-url";
const here = new URL(".", import.meta.url);
const outDir = fromFileUrl(new URL("../apps/server/static/prexy/", here));
const moduleOutDir = fromFileUrl(new URL("../static/prex-detect/", here));
const gameEntryPoints: string[] = [];
for await (const entry of Deno.readDir(fromFileUrl(new URL("./games/", here)))) {
    if (entry.isFile && entry.name.endsWith(".ts")) {
        gameEntryPoints.push(fromFileUrl(new URL(`./games/${entry.name}`, here)));
    }
}
const moduleEntryPoints: string[] = [];
const modulesDir = fromFileUrl(new URL("./modules/", here));
for await (const entry of Deno.readDir(modulesDir)) {
    if (entry.isFile && entry.name.endsWith(".ts")) {
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
});
await esbuild.build({
    entryPoints: gameEntryPoints,
    outdir: `${outDir}/games`,
    bundle: true,
    format: "esm",
    target: "es2020",
    minify: true,
    sourcemap: true,
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
    });
}
esbuild.stop();
console.log(`[prexy] built into ${outDir}`);
if (moduleEntryPoints.length > 0)
    console.log(`[prexy] modules built into ${moduleOutDir}`);
