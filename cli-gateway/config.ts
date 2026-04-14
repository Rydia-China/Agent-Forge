import type { GatewayConfig } from "./types.js";
import path from "path";

export const CONFIG: GatewayConfig = {
  port: 9001,
  commands: {
    "forge-eval": {
      bin: "npx",
      baseArgs: ["tsx", "cli/src/main.ts"],
      cwd: path.resolve(import.meta.dirname, ".."),
      description: "Agent-Forge eval CLI",
    },
  },
};
