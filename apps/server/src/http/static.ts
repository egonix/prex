const CONTENT_TYPES: Record<string, string> = {
    ".js": "application/javascript; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
};
async function serveStaticDir(req: Request, prefix: string, root: URL): Promise<Response | null> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(prefix))
        return null;
    const rel = url.pathname.slice(prefix.length);
    if (rel.includes(".."))
        return new Response("bad path", { status: 400 });
    const fileUrl = new URL(rel, root);
    if (!fileUrl.pathname.startsWith(root.pathname)) {
        return new Response("bad path", { status: 400 });
    }
    const ext = rel.slice(rel.lastIndexOf("."));
    try {
        const body = await Deno.readFile(fileUrl);
        return new Response(body, {
            headers: {
                "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
                "cache-control": "no-store",
            },
        });
    }
    catch {
        return new Response("not found", { status: 404 });
    }
}
const PREXY_ROOT = new URL("../../static/prexy/", import.meta.url);
const GAMES_MOUNTED_ROOT = new URL("file:///static/games/");
export async function serveStaticPrexy(req: Request): Promise<Response | null> {
    const res = await serveStaticDir(req, "/prexy/", PREXY_ROOT);
    if (res?.status === 404 && new URL(req.url).pathname.startsWith("/prexy/games/")) {
        return serveStaticDir(req, "/prexy/games/", GAMES_MOUNTED_ROOT);
    }
    return res;
}
const MOUNTED_ROOT = new URL("file:///static/");
export function serveStaticMounted(req: Request): Promise<Response | null> {
    return serveStaticDir(req, "/static/", MOUNTED_ROOT);
}
