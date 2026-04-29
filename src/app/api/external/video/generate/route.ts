import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callFcGenerateVideo } from "@/lib/services/fc-video-client";
import {
  authenticateExternalVideoApiKey,
  trackExternalVideoApiCall,
} from "@/lib/services/external-video-api-service";

const GenerateVideoRequestSchema = z.object({
  prompt: z.string().min(1),
  sourceImageUrl: z.string().url().optional(),
  styleName: z.string().min(1).optional(),
  referenceImageUrls: z.array(z.string().url()).optional(),
  sourceVideoUrls: z.array(z.string().url()).optional(),
  duration: z.number().min(1).max(15).optional(),
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

  const parsed = GenerateVideoRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const videoUrl = await trackExternalVideoApiCall(
      auth.apiKeyName,
      "video.generate",
      () => callFcGenerateVideo(parsed.data),
    );
    return NextResponse.json({
      status: "ok",
      product: "video.generate",
      videoUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
