import { registry } from "./registry";
import * as staticProviders from "./static";
import { bizDbReady } from "@/lib/biz-db";

export async function initMcp(): Promise<void> {
  if (!registry.initialized) {
    registry.initialized = true;

    bizDbReady.catch((err) => {
      console.error("[initMcp] Background database initialization failed:", err);
    });
  }

  const providers = Object.values(staticProviders);

  for (const provider of providers) {
    if (registry.getProvider(provider.name)) continue;
    registry.register(provider);
    registry.protect(provider.name);
  }
}
