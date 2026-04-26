import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Sync functionality not yet implemented" },
    { status: 501 }
  );
}
