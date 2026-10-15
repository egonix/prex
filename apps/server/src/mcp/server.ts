import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
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
