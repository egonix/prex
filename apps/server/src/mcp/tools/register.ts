import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDiscoveryTools } from "./discovery.ts";
import { registerObservationTools } from "./observation.ts";
import { registerExecutionTools } from "./execution.ts";
import { registerTriggerTools } from "./triggers.ts";
import { registerModuleTools } from "./modules.ts";
import { registerCapabilityTools } from "./capabilities.ts";
export function registerAllTools(server: McpServer): void {
    registerDiscoveryTools(server);
    registerObservationTools(server);
    registerExecutionTools(server);
    registerTriggerTools(server);
    registerModuleTools(server);
    registerCapabilityTools(server);
}
