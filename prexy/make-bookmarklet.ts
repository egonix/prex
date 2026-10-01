import * as esbuild from "esbuild";
function arg(name: string, def?: string): string | undefined {
    const idx = Deno.args.indexOf(`--${name}`);
    if (idx !== -1 && Deno.args[idx + 1] !== undefined)
        return Deno.args[idx + 1];
    return def;
}
function flag(name: string): boolean {
    return Deno.args.includes(`--${name}`);
}
const server = arg("server", "http://localhost:8000")!;
const game = arg("game", "default")!;
const token = arg("token") ?? crypto.randomUUID();
const moduleUrl = arg("module");
const raw = flag("raw");
const source = `
(async () => {
  const SERVER_URL = ${JSON.stringify(server)};
  const TOKEN = ${JSON.stringify(token)};
  const GAME = ${JSON.stringify(game)};
  const MODULE_URL = ${JSON.stringify(moduleUrl ?? "")};
  const res = await fetch(SERVER_URL + "/prexy/core.js", { cache: "no-store" });
  const code = await res.text();
  (0, eval)(code);
  const agent = new window.Prexy.PrexyAgent({ serverUrl: SERVER_URL, token: TOKEN, game: GAME });
  window.__prexy = agent;
  console.log("[prexy] connecting session " + TOKEN + " to " + SERVER_URL);
  await agent.connect();
  if (MODULE_URL) {
    console.log("[prexy] auto load module from " + MODULE_URL);
    try {
      await agent.loadModule(MODULE_URL);
    } catch (err) {
      console.warn("[prexy] failed to load module", err);
    }
  }
})();
`.trim();
const bookmarklet = raw
    ? `javascript:${source}`
    : `javascript:${encodeURIComponent((await esbuild.transform(source, { minify: true, loader: "js" })).code.trim())}`;
console.log(`token: ${token}`);
console.log(`server: ${server}`);
console.log(`game:  ${game}`);
if (moduleUrl)
    console.log(`module: ${moduleUrl}`);
console.log(`form:  ${raw ? "raw (unminified, not percent-encoded)" : "minified"}`);
console.log();
console.log(raw ? "Bookmarklet source:" : "Save this as a bookmark's URL (name it anything, e.g. \"prex\"):");
console.log(bookmarklet);
esbuild.stop();
