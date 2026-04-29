import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { regenerate, getById } from "@/lib/services/key-resource-service";
import {
  authenticateAgentForgeApiKey,
  withBillingContext,
} from "@/lib/services/billing-service";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  prompt: z.string().min(1).optional(),
});

/** POST /api/key-resources/:id/regenerate */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = authenticateAgentForgeApiKey(req.headers);
  if (auth.status === "unauthorized") {
    return NextResponse.json({ error: auth.message }, { status: 401 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const before = await getById(id);
    if (!before) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const result = await withBillingContext(
      auth.apiKeyName,
      () => regenerate(id, parsed.data.prompt),
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
