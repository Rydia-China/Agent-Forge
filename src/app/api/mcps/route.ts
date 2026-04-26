import { NextResponse } from "next/server";
import { initMcp } from "@/lib/mcp/init";
import { registry } from "@/lib/mcp/registry";
import { getCatalogEntries } from "@/lib/mcp/catalog";

export async function GET() {
  await initMcp();
  const providers = registry.listProviders();
  const catalog = getCatalogEntries();

  const mcps = providers.map((p) => {
    const entry = catalog.find((e) => e.name === p.name);
    return {
      name: p.name,
      available: entry?.available ?? true,
      active: true,
    };
  });

  return NextResponse.json(mcps);
}
