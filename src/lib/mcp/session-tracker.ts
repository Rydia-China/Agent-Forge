/**
 * Session MCP Tracker — tracks which MCPs each chat session has loaded.
 *
 * Core MCPs (skills, mcp_manager, upload) are always visible to every session.
 * On-demand MCPs (catalog + dynamic) become visible only after the session
 * explicitly calls mcp_manager__load.
 *
 * The actual providers live in the global McpRegistry (shared pool).
 * This tracker only controls *visibility* per session.
 * In-memory only — session scope resets on process restart.
 */

const CORE_MCPS = new Set(["skills", "mcp_manager", "upload"]);

class SessionMcpTracker {
  private sessions = new Map<string, Set<string>>();

  /** Mark an MCP as loaded for a session. */
  load(sessionId: string, mcpName: string): void {
    let set = this.sessions.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessions.set(sessionId, set);
    }
    set.add(mcpName);
  }

  /** Remove an MCP from a session's visible set (does NOT unload from global pool). */
  unload(sessionId: string, mcpName: string): void {
    this.sessions.get(sessionId)?.delete(mcpName);
  }

  /** Check if a specific MCP is visible to a session. */
  isVisible(sessionId: string, mcpName: string): boolean {
    if (CORE_MCPS.has(mcpName)) return true;
    return this.sessions.get(sessionId)?.has(mcpName) ?? false;
  }

  /** Get the full set of MCP names visible to a session (core + loaded). */
  getVisible(sessionId: string): Set<string> {
    const loaded = this.sessions.get(sessionId);
    if (!loaded) return new Set(CORE_MCPS);
    return new Set([...CORE_MCPS, ...loaded]);
  }

  /** Get only the non-core MCPs loaded for a session. */
  getLoaded(sessionId: string): Set<string> {
    return this.sessions.get(sessionId) ?? new Set();
  }

  /** Clean up when a session is no longer active. */
  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

// Global singleton (survives HMR in Next.js dev)
const globalForTracker = globalThis as unknown as {
  sessionMcpTracker: SessionMcpTracker | undefined;
};

export const sessionMcpTracker =
  globalForTracker.sessionMcpTracker ?? new SessionMcpTracker();

globalForTracker.sessionMcpTracker = sessionMcpTracker;
