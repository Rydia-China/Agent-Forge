import { NextResponse } from "next/server";

/** GET /api/video/novels — proxy to remote novel service */
export async function GET() {
  const base = process.env.NOVEL_SERVICE_URL;
  if (!base) {
    return NextResponse.json(
      { error: "NOVEL_SERVICE_URL not configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${base}/novels`, {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Upstream error ${res.status}: ${text}` },
        { status: res.status },
      );
    }

    const data: unknown = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
