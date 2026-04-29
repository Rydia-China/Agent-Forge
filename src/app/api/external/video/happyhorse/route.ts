import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callFcHappyHorseGenerate } from "@/lib/services/fc-happyhorse-client";
import {
  authenticateExternalVideoApiKey,
  trackExternalVideoApiCall,
} from "@/lib/services/external-video-api-service";

const HappyHorseRequestSchema = z.object({
  prompt: z.string().min(1),
  media: z.array(
    z.object({
      type: z.enum(["video", "reference_image"]),
      url: z.string().url(),
    }),
  ).min(1),
  resolution: z.enum(["1080P", "720P"]).optional(),
  ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).optional(),
  duration: z.number().min(1).max(15).optional(),
  model: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const auth = authenticateExternalVideoApiKey(req.headers);
  if (auth.status === "not_configured") {
    return NextResponse.json({ error: auth.message }, { status: 503 });
  }
  if (auth.status === "unauthorized") {
    return NextResponse.json({ error: auth.message }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = HappyHorseRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await trackExternalVideoApiCall(
      auth.apiKeyName,
      "video.happyhorse",
      () => callFcHappyHorseGenerate(parsed.data),
    );
    return NextResponse.json({
      status: "ok",
      product: "video.happyhorse",
      result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
