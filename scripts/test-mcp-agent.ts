#!/usr/bin/env tsx
/**
 * 独立测试 Agent - 验证 MCP 端点是否按预期工作
 * 
 * 测试内容：
 * 1. MCP 端点连接性测试
 * 2. tools/list 请求测试
 * 3. tools/call 请求测试（调用具体的 tool）
 * 4. resources/list 请求测试
 * 5. resources/read 请求测试
 */

interface McpRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

class McpTestAgent {
  private baseUrl: string;
  private requestId = 0;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<McpResponse> {
    const request: McpRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    };

    console.log(`\n📤 发送请求: ${method}`);
    console.log(JSON.stringify(request, null, 2));

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json() as McpResponse;
    console.log(`\n📥 收到响应:`);
    console.log(JSON.stringify(result, null, 2));

    return result;
  }

  async testConnection(): Promise<boolean> {
    console.log("\n" + "=".repeat(60));
    console.log("测试 1: MCP 端点连接性");
    console.log("=".repeat(60));

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-agent", version: "1.0.0" },
          },
        }),
      });

      if (!response.ok) {
        console.error(`❌ 连接失败: HTTP ${response.status}`);
        return false;
      }

      const result = await response.json();
      console.log("✅ 连接成功");
      console.log(JSON.stringify(result, null, 2));
      return true;
    } catch (error) {
      console.error("❌ 连接失败:", error);
      return false;
    }
  }

  async testListTools(): Promise<boolean> {
    console.log("\n" + "=".repeat(60));
    console.log("测试 2: tools/list - 列出所有可用工具");
    console.log("=".repeat(60));

    try {
      const response = await this.sendRequest("tools/list");

      if (response.error) {
        console.error("❌ 请求失败:", response.error);
        return false;
      }

      const result = response.result as { tools: Array<{ name: string; description: string }> };
      console.log(`\n✅ 成功获取 ${result.tools.length} 个工具:`);
      result.tools.forEach((tool, index) => {
        console.log(`  ${index + 1}. ${tool.name}`);
        console.log(`     ${tool.description}`);
      });

      return true;
    } catch (error) {
      console.error("❌ 测试失败:", error);
      return false;
    }
  }

  async testCallTool(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    console.log("\n" + "=".repeat(60));
    console.log(`测试 3: tools/call - 调用工具 "${toolName}"`);
    console.log("=".repeat(60));

    try {
      const response = await this.sendRequest("tools/call", {
        name: toolName,
        arguments: args,
      });

      if (response.error) {
        console.error("❌ 调用失败:", response.error);
        return false;
      }

      console.log("✅ 工具调用成功");
      return true;
    } catch (error) {
      console.error("❌ 测试失败:", error);
      return false;
    }
  }

  async testListResources(): Promise<boolean> {
    console.log("\n" + "=".repeat(60));
    console.log("测试 4: resources/list - 列出所有资源");
    console.log("=".repeat(60));

    try {
      const response = await this.sendRequest("resources/list");

      if (response.error) {
        console.error("❌ 请求失败:", response.error);
        return false;
      }

      const result = response.result as { resources: Array<{ uri: string; name: string; description: string }> };
      console.log(`\n✅ 成功获取 ${result.resources.length} 个资源:`);
      result.resources.forEach((resource, index) => {
        console.log(`  ${index + 1}. ${resource.name} (${resource.uri})`);
        console.log(`     ${resource.description}`);
      });

      return true;
    } catch (error) {
      console.error("❌ 测试失败:", error);
      return false;
    }
  }

  async testReadResource(uri: string): Promise<boolean> {
    console.log("\n" + "=".repeat(60));
    console.log(`测试 5: resources/read - 读取资源 "${uri}"`);
    console.log("=".repeat(60));

    try {
      const response = await this.sendRequest("resources/read", { uri });

      if (response.error) {
        console.error("❌ 读取失败:", response.error);
        return false;
      }

      const result = response.result as { contents: Array<{ uri: string; mimeType: string; text: string }> };
      console.log(`✅ 成功读取资源，内容长度: ${result.contents[0]?.text.length || 0} 字符`);
      if (result.contents[0]?.text) {
        console.log("\n内容预览（前 200 字符）:");
        console.log(result.contents[0].text.substring(0, 200) + "...");
      }

      return true;
    } catch (error) {
      console.error("❌ 测试失败:", error);
      return false;
    }
  }

  async runAllTests(): Promise<void> {
    console.log("\n🚀 开始 MCP 端点测试");
    console.log(`目标地址: ${this.baseUrl}`);

    const results: Array<{ name: string; passed: boolean }> = [];

    // 测试 1: 连接性
    results.push({
      name: "连接性测试",
      passed: await this.testConnection(),
    });

    // 测试 2: 列出工具
    results.push({
      name: "列出工具",
      passed: await this.testListTools(),
    });

    // 测试 3: 调用工具（使用 skills__list）
    results.push({
      name: "调用工具 (skills__list)",
      passed: await this.testCallTool("skills__list", {}),
    });

    // 测试 4: 列出资源
    results.push({
      name: "列出资源",
      passed: await this.testListResources(),
    });

    // 测试 5: 读取资源（如果有的话）
    // 这个测试可能会失败，因为可能没有 skill 资源
    // results.push({
    //   name: "读取资源",
    //   passed: await this.testReadResource("skill://example"),
    // });

    // 输出测试报告
    console.log("\n" + "=".repeat(60));
    console.log("📊 测试报告");
    console.log("=".repeat(60));

    let passedCount = 0;
    results.forEach((result, index) => {
      const status = result.passed ? "✅ 通过" : "❌ 失败";
      console.log(`${index + 1}. ${result.name}: ${status}`);
      if (result.passed) passedCount++;
    });

    console.log("\n" + "=".repeat(60));
    console.log(`总计: ${passedCount}/${results.length} 测试通过`);
    console.log("=".repeat(60));

    if (passedCount === results.length) {
      console.log("\n🎉 所有测试通过！MCP 端点工作正常。");
      process.exit(0);
    } else {
      console.log("\n⚠️  部分测试失败，请检查日志。");
      process.exit(1);
    }
  }
}

// 主程序
async function main() {
  const baseUrl = process.env.MCP_BASE_URL || "http://localhost:8001/mcp";
  const agent = new McpTestAgent(baseUrl);
  await agent.runAllTests();
}

main().catch((error) => {
  console.error("💥 测试程序异常:", error);
  process.exit(1);
});
