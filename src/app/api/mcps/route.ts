import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sandboxManager } from "@/lib/mcp/sandbox";
import { registry } from "@/lib/mcp/registry";

/** GET /api/mcps — list all MCP servers */
export async function GET() {
  const mcps = await prisma.mcpServer.findMany({
    select: {
      name: true,
      description: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(mcps);
}

/** POST /api/mcps — create a dynamic MCP server */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name || !body.code) {
      return NextResponse.json(
        { error: "Missing required fields: name, code" },
        { status: 400 },
      );
    }

    const record = await prisma.mcpServer.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        code: body.code,
        enabled: body.enabled ?? true,
      },
    });

    let loadError: string | null = null;
    if (record.enabled) {
      try {
        const provider = await sandboxManager.load(record.name, record.code);
        registry.replace(provider);
      } catch (err: unknown) {
        loadError = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json(
      { ...record, loadError },
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
