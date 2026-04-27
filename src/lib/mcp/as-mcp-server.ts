import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types";
import { registry } from "./registry";
import { runAgent } from "@/lib/agent/agent";
import { writeChatLog } from "@/lib/agent/chat-log";
import { prisma } from "@/lib/db";

const AgentChatArgs = z.object({
  message: z.string(),
  session_id: z.string().optional(),
  logs: z.boolean().optional(),
});

/**
 * Create a low-level MCP Server instance wired to our MCP Registry.
 * Uses setRequestHandler for full control over JSON Schema tools.
 * Called per-request (stateless mode).
 * 
 * Note: MCP providers are initialized at server startup via instrumentation.ts,
 * not on-demand during requests.
 */
export async function createAsMcpServer(): Promise<Server> {
  const server = new Server(
    { name: "agent-forge", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // --- tools/list ---
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await registry.listAllTools();
    tools.push({
      name: "agent__chat",
      description:
        "Send a message to the Agent Forge assistant. Returns the agent's reply.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "User message" },
          session_id: {
            type: "string",
            description: "Optional session ID for continuity",
          },
        },
        required: ["message"],
      },
    });
    return { tools };
  });

  // --- tools/call ---
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    if (name === "agent__chat") {
      const parsed = AgentChatArgs.parse(args ?? {});
      const result = await runAgent(parsed.message, parsed.session_id);
      if (parsed.logs) {
        await writeChatLog(result.sessionId, result.messages);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: result.sessionId,
              reply: result.reply,
            }),
          },
        ],
      };
    }

    return registry.callTool(name, (args ?? {}) as Record<string, unknown>);
  });

  // --- resources/list (skills as MCP resources, using production version) ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const skills = await prisma.skill.findMany({
      where: { isProduction: true },
      orderBy: { name: "asc" },
    });
    return {
      resources: skills.map((s: { name: string; description: string }) => ({
        uri: `skill://${s.name}`,
        name: s.name,
        description: s.description,
        mimeType: "text/markdown",
      })),
    };
  });

  // --- resources/read (returns production version content) ---
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const match = uri.match(/^skill:\/\/(.+)$/);
    const skillName = match?.[1];
    if (!skillName) throw new Error(`Unknown resource URI: ${uri}`);
    
    const skill = await prisma.skill.findFirst({
      where: { name: skillName, isProduction: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!skill) throw new Error(`Skill "${skillName}" not found`);
    
    // Fetch content from OSS
    const bucket = process.env.OSS_BUCKET!;
    const region = process.env.OSS_REGION!;
    const ossUrl = `https://${bucket}.oss-${region}.aliyuncs.com/${skill.ossKey}`;
    const response = await fetch(ossUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch skill content from OSS: ${skill.ossKey}`);
    }
    const content = await response.text();
    
    return {
      contents: [
        { uri, mimeType: "text/markdown", text: content },
      ],
    };
  });

  return server;
}

/**
 * Create a scoped MCP Server that only exposes a single provider's tools.
 * Tool names are unqualified (no provider prefix) since the server IS the provider.
 * 
 * Note: MCP providers are initialized at server startup via instrumentation.ts,
 * not on-demand during requests.
 */
export async function createScopedMcpServer(
  providerName: string,
): Promise<Server | null> {
  const provider = registry.getProvider(providerName);
  if (!provider) return null;

  const server = new Server(
    { name: providerName, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await provider.listTools();
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return await provider.callTool(
        name,
        (args ?? {}) as Record<string, unknown>,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
