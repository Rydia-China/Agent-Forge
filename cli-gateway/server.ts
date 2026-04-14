import http from "http";
import { CONFIG } from "./config.js";
import { execCommand, execCommandStream, listTools } from "./executor.js";
import { verifyAuth } from "./auth.js";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const headers = {
    get(name: string): string | null {
      const value = req.headers[name.toLowerCase()];
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    },
  };
  if (!verifyAuth({ headers })) {
    json(res, 403, { error: "Unauthorized" });
    return false;
  }
  return true;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const method = req.method?.toUpperCase() || "GET";
  const pathname = url.pathname;

  try {
    // Health check
    if (method === "GET" && pathname === "/health") {
      if (!checkAuth(req, res)) return;
      json(res, 200, { status: "ok", uptime: process.uptime() });
      return;
    }

    // List tools
    if (method === "GET" && pathname === "/tools") {
      if (!checkAuth(req, res)) return;
      json(res, 200, listTools(CONFIG));
      return;
    }

    // Exec (sync)
    if (method === "POST" && pathname === "/exec") {
      if (!checkAuth(req, res)) return;
      const body = await readBody(req);
      const request = JSON.parse(body);
      const result = await execCommand(CONFIG, request);
      json(res, 200, result);
      return;
    }

    // Exec (streaming SSE)
    if (method === "POST" && pathname === "/exec/stream") {
      if (!checkAuth(req, res)) return;
      const body = await readBody(req);
      const request = JSON.parse(body);
      const stream = execCommandStream(CONFIG, request);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const reader = stream.getReader();
      const pump = async (): Promise<void> => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(value);
        }
      };
      await pump();
      return;
    }

    // 404
    json(res, 404, { error: "Not found" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("not allowed")) {
      json(res, 400, { error: message });
    } else if (message.includes("disallowed shell characters")) {
      json(res, 400, { error: message });
    } else if (message.includes("TIMEOUT") || message.includes("timed out")) {
      json(res, 408, { error: "Command timed out" });
    } else {
      json(res, 500, { error: message });
    }
  }
}

const port = Number(process.env.CLI_GATEWAY_PORT) || CONFIG.port;
const server = http.createServer(handleRequest);
server.listen(port, () => {
  console.log(`CLI Gateway listening on :${port}`);
  console.log(`Available commands: ${Object.keys(CONFIG.commands).join(", ")}`);
});
