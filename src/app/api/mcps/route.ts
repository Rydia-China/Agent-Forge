import { NextResponse } from "next/server";
import { initMcp } from "@/lib/mcp/init";
import { registry } from "@/lib/mcp/registry";

export async function GET() {
  await initMcp();
  const providers = registry.listProviders();

  const mcps = providers.map((p) => ({
    name: p.name,
  }));

  return NextResponse.json(mcps);
}
