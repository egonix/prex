import { McpServer } from "npm:@modelcontextprotocol/sdk@^1.30.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@^1.30.0/server/webStandardStreamableHttp.js";
import { registerAllTools } from "./tools/register.ts";
export async function handleMcpRequest(req: Request): Promise<Response> {
    const server = new McpServer({ name: "prex-mcp", version: "0.1.0" });
    registerAllTools(server);
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
}
