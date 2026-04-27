/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts (both dev and production).
 * Used for one-time initialization tasks.
 */

import { initMcp } from "@/lib/mcp/init";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[instrumentation] Initializing MCP providers...");
    await initMcp();
    console.log("[instrumentation] MCP providers initialized");
  }
}
