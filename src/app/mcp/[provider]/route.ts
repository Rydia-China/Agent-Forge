import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { createScopedMcpServer } from "@/lib/mcp/as-mcp-server";
import { NextResponse } from "next/server";
import { authenticateAgentForgeApiKey } from "@/lib/services/billing-service";

type RouteCtx = { params: Promise<{ provider: string }> };

async function handleMcp(
  req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const auth = authenticateAgentForgeApiKey(req.headers);
  if (auth.status === "unauthorized") {
    return NextResponse.json({ error: auth.message }, { status: 401 });
  }

  const { provider } = await ctx.params;
  const server = await createScopedMcpServer(provider, auth.apiKeyName);

  if (!server) {
    return NextResponse.json(
      { error: `MCP provider "${provider}" not found` },
      { status: 404 },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  return transport.handleRequest(req);
}

export async function POST(req: Request, ctx: RouteCtx) {
  return handleMcp(req, ctx);
}

export async function GET(req: Request, ctx: RouteCtx) {
  return handleMcp(req, ctx);
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  return handleMcp(req, ctx);
}
