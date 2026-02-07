import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types";
import { registry } from "./registry";
import { initMcp } from "./init";
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
 */
export async function createAsMcpServer(): Promise<Server> {
  await initMcp();

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
      include: { versions: { orderBy: { version: "desc" as const }, take: 1 } },
    });
    return {
      resources: skills
        .filter((s) => s.versions.length > 0)
        .map((s) => {
          const prodVer = s.versions.find((v) => v.version === s.productionVersion) ?? s.versions[0]!;
          return {
            uri: `skill://${s.name}`,
            name: s.name,
            description: prodVer.description,
            mimeType: "text/markdown",
          };
        }),
    };
  });

  // --- resources/read (returns production version content) ---
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const match = uri.match(/^skill:\/\/(.+)$/);
    const skillName = match?.[1];
    if (!skillName) throw new Error(`Unknown resource URI: ${uri}`);
    const skill = await prisma.skill.findUnique({
      where: { name: skillName },
    });
    if (!skill) throw new Error(`Skill "${skillName}" not found`);
    const ver = await prisma.skillVersion.findUnique({
      where: { skillId_version: { skillId: skill.id, version: skill.productionVersion } },
    });
    if (!ver) throw new Error(`Skill "${skillName}" has no production version`);
    return {
      contents: [
        { uri, mimeType: "text/markdown", text: ver.content },
      ],
    };
  });

  return server;
}

/**
 * Create a scoped MCP Server that only exposes a single provider's tools.
 * Tool names are unqualified (no provider prefix) since the server IS the provider.
 */
export async function createScopedMcpServer(
  providerName: string,
): Promise<Server | null> {
  await initMcp();

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
