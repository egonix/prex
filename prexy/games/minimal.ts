import type { GameModule, PrexyAgent } from "../core.ts";
const minimalModule: GameModule = {
    name: "minimal",
    init(agent: PrexyAgent) {
        agent.event("game-module-ready", { name: "minimal" });
    },
};
export default minimalModule;
