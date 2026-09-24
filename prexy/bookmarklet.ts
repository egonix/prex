(async () => {
    const SERVER_URL = "http://localhost:8000";
    const TOKEN = "REPLACE_WITH_SESSION_TOKEN";
    const GAME = "REPLACE_WITH_GAME_ID";
    const MODULE_URL = "";
    const res = await fetch(`${SERVER_URL}/prexy/core.js`, { cache: "no-store" });
    const code = await res.text();
    (0, eval)(code);
    const Prexy = (window as unknown as {
        Prexy: {
            PrexyAgent: new (opts: {
                serverUrl: string;
                token: string;
                game: string;
            }) => {
                connect(): Promise<void>;
                loadModule(url: string): Promise<unknown>;
            };
        };
    }).Prexy;
    const agent = new Prexy.PrexyAgent({ serverUrl: SERVER_URL, token: TOKEN, game: GAME });
    (window as unknown as {
        __prexy: unknown;
    }).__prexy = agent;
    await agent.connect();
    if (MODULE_URL) {
        try {
            await agent.loadModule(MODULE_URL);
        }
        catch (err) {
            console.warn("[prexy] failed to load module", err);
        }
    }
})();
