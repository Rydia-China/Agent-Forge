import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sandboxManager } from "@/lib/mcp/sandbox";
import { registry } from "@/lib/mcp/registry";

type Params = { params: Promise<{ name: string }> };

/** GET /api/mcps/:name — get MCP server details */
export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const mcp = await prisma.mcpServer.findUnique({ where: { name } });
  if (!mcp) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(mcp);
}

/** PUT /api/mcps/:name — update MCP server (code/description/enabled) */
export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.code !== undefined) data.code = body.code;
    if (body.description !== undefined) data.description = body.description;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.config !== undefined) data.config = body.config;

    const record = await prisma.mcpServer.update({ where: { name }, data });

    // Handle sandbox lifecycle
    let loadError: string | null = null;
    if (!record.enabled) {
      sandboxManager.unload(record.name);
      registry.unregister(record.name);
    } else if (body.code !== undefined) {
      // Code changed — reload sandbox
      try {
        const provider = await sandboxManager.load(record.name, record.code);
        registry.replace(provider);
      } catch (err: unknown) {
        loadError = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json({ ...record, loadError });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/mcps/:name */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    sandboxManager.unload(name);
    registry.unregister(name);
    await prisma.mcpServer.delete({ where: { name } });
    return NextResponse.json({ deleted: name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
