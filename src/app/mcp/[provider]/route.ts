import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { createScopedMcpServer } from "@/lib/mcp/as-mcp-server";
import { NextResponse } from "next/server";

type RouteCtx = { params: Promise<{ provider: string }> };

async function handleMcp(
  req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { provider } = await ctx.params;
  const server = await createScopedMcpServer(provider);

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
