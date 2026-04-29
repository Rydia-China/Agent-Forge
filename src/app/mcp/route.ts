import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { createAsMcpServer } from "@/lib/mcp/as-mcp-server";
import { authenticateAgentForgeApiKey } from "@/lib/services/billing-service";

async function handleMcp(req: Request): Promise<Response> {
  const auth = authenticateAgentForgeApiKey(req.headers);
  if (auth.status === "unauthorized") {
    return Response.json({ error: auth.message }, { status: 401 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  const server = await createAsMcpServer(auth.apiKeyName);
  await server.connect(transport);

  return transport.handleRequest(req);
}

export async function POST(req: Request) {
  return handleMcp(req);
}

export async function GET(req: Request) {
  return handleMcp(req);
}

export async function DELETE(req: Request) {
  return handleMcp(req);
}
