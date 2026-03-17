import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bizPool, bizDbReady } from "@/lib/biz-db";

interface CheckResult {
  ok: boolean;
  ms: number;
  error?: string;
}

async function checkPrisma(): Promise<CheckResult> {
  const t0 = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return {
      ok: false,
      ms: Math.round(performance.now() - t0),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkBizDb(): Promise<CheckResult> {
  const t0 = performance.now();
  try {
    await bizDbReady;
    await bizPool.query("SELECT 1");
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return {
      ok: false,
      ms: Math.round(performance.now() - t0),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const [db, bizDb] = await Promise.all([checkPrisma(), checkBizDb()]);

  const healthy = db.ok && bizDb.ok;

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks: { db, bizDb } },
    { status: healthy ? 200 : 503 },
  );
}
