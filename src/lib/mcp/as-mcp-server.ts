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

  // --- resources/list ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const skills = await prisma.skill.findMany({
      select: { name: true, description: true },
    });
    return {
      resources: skills.map((s) => ({
        uri: `skill://${s.name}`,
        name: s.name,
        description: s.description,
        mimeType: "text/markdown",
      })),
    };
  });

  // --- resources/read ---
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const match = uri.match(/^skill:\/\/(.+)$/);
    const skillName = match?.[1];
    if (!skillName) throw new Error(`Unknown resource URI: ${uri}`);
    const skill = await prisma.skill.findUnique({
      where: { name: skillName },
    });
    if (!skill) throw new Error(`Skill "${skillName}" not found`);
    return {
      contents: [
        { uri, mimeType: "text/markdown", text: skill.content },
      ],
    };
  });

  return server;
}
