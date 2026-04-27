import { NextResponse } from "next/server";
import { registry } from "@/lib/mcp/registry";

export async function GET() {
  const providers = registry.listProviders();

  const mcps = providers.map((p) => ({
    name: p.name,
  }));

  return NextResponse.json(mcps);
}
