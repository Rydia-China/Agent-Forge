/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts (both dev and production).
 * Used for one-time initialization tasks.
 * 
 * IMPORTANT: Use dynamic imports to avoid loading Node.js-only modules
 * in Edge Runtime during build analysis.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[instrumentation] Initializing MCP providers...");
    const { initMcp } = await import("@/lib/mcp/init");
    await initMcp();
    console.log("[instrumentation] MCP providers initialized");
  }
}
