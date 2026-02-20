import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import * as svc from "@/lib/services/api-service";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export const apisMcp: McpProvider = {
  name: "apis",

  async listTools(): Promise<Tool[]> {
    return [
      /* ---------- usage ---------- */
      {
        name: "list",
        description: "List all APIs (name, description, enabled, productionVersion).",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "get",
        description:
          "Get API details: schema (data model) + available operations with descriptions and input definitions.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "API name" } },
          required: ["name"],
        },
      },
      {
        name: "call",
        description:
          "Invoke API operation(s) concurrently. Returns an array of results with status (ok/error). For a single call, pass a one-element array.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of API call tasks",
              items: {
                type: "object",
                properties: {
                  api_name: { type: "string", description: "API name" },
                  operation: { type: "string", description: "Operation name" },
                  params: {
                    type: "object",
                    description: "Operation parameters (key-value pairs matching the operation's input definition)",
                  },
                },
                required: ["api_name", "operation"],
              },
            },
          },
          required: ["items"],
        },
      },
      /* ---------- management ---------- */
      {
        name: "create",
        description:
          "Create a new API (v1). Defines a set of declarative SQL operations against the business database.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            description: { type: "string", description: "What this API does — shown in system prompt" },
            schema: { type: "object", description: "Data model definition: { tables: { tableName: { field: type } } }" },
            operations: {
              type: "array",
              description: "Operation definitions array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  type: { type: "string", description: "\"query\" or \"execute\"" },
                  sql: { type: "string", description: "Parameterized SQL ($1, $2, ...)" },
                  params: { type: "array", items: { type: "string" }, description: "Param names in order matching $1, $2" },
                  input: { type: "object", description: "Input definition: { paramName: { type, required?, description? } }" },
                },
                required: ["name", "description", "type", "sql", "params", "input"],
              },
            },
            enabled: { type: "boolean", description: "Default: true" },
          },
          required: ["name", "description", "schema", "operations"],
        },
      },
      {
        name: "update",
        description: "Push a new version of an API. Auto-promotes to production by default.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            schema: { type: "object" },
            operations: { type: "array" },
            description: { type: "string" },
            promote: { type: "boolean", description: "Set new version as production (default: true)" },
          },
          required: ["name", "schema", "operations"],
        },
      },
      {
        name: "delete",
        description: "Delete an API and all its versions.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "toggle",
        description: "Enable or disable an API.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" }, enabled: { type: "boolean" } },
          required: ["name", "enabled"],
        },
      },
      {
        name: "list_versions",
        description: "List all versions of an API, showing which is production.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "set_production",
        description: "Set a specific version as production (rollback/promote).",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            version: { type: "number", description: "Version number to set as production" },
          },
          required: ["name", "version"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      /* ---------- usage ---------- */
      case "list": {
        const apis = await svc.listApis();
        return json(apis);
      }
      case "get": {
        const { name: n } = svc.ApiNameParams.parse(args);
        const detail = await svc.getApi(n);
        if (!detail) return text(`API "${n}" not found`);
        // Return schema + operations (with input definitions) for progressive disclosure
        return json({
          name: detail.name,
          description: detail.description,
          enabled: detail.enabled,
          version: detail.version,
          schema: detail.schema,
          operations: detail.operations.map((op) => ({
            name: op.name,
            description: op.description,
            type: op.type,
            input: op.input,
          })),
          httpEndpoints: detail.operations.map((op) => ({
            operation: op.name,
            method: "POST",
            url: `/api/public/${detail.name}/${op.name}`,
          })),
          docsUrl: `/api/public/${detail.name}`,
        });
      }
      case "call": {
        const { items } = z
          .object({ items: z.array(svc.ApiCallParams).min(1) })
          .parse(args);
        const results = await Promise.allSettled(
          items.map(({ api_name, operation, params }) =>
            svc.callApiOperation(api_name, operation, params),
          ),
        );
        const output = results.map((r, i) =>
          r.status === "fulfilled"
            ? { index: i, status: "ok" as const, result: r.value }
            : { index: i, status: "error" as const, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        );
        return json(output);
      }
      /* ---------- management ---------- */
      case "create": {
        const params = svc.ApiCreateParams.parse(args);
        const { record } = await svc.createApi(params);
        return text(`Created API "${record.name}" (v1)`);
      }
      case "update": {
        const params = svc.ApiUpdateParams.parse(args);
        const { record, version } = await svc.updateApi(params);
        const promoted = params.promote ? " (promoted to production)" : "";
        return text(`Pushed API "${record.name}" v${version.version}${promoted}`);
      }
      case "delete": {
        const { name: n } = svc.ApiNameParams.parse(args);
        await svc.deleteApi(n);
        return text(`Deleted API "${n}" and all versions`);
      }
      case "toggle": {
        const params = svc.ApiToggleParams.parse(args);
        const record = await svc.toggleApi(params);
        return text(`API "${record.name}" is now ${record.enabled ? "enabled" : "disabled"}`);
      }
      case "list_versions": {
        const { name: n } = svc.ApiNameParams.parse(args);
        const versions = await svc.listApiVersions(n);
        return json(versions);
      }
      case "set_production": {
        const { name: n, version } = svc.ApiSetProductionParams.parse(args);
        const record = await svc.setApiProduction(n, version);
        return text(`API "${record.name}" production set to v${record.productionVersion}`);
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
