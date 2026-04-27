import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ChatMessage } from "./types";

const TEMP_DIR = join(process.cwd(), "temp");

/**
 * Write full session messages to temp/chat-{sessionId}.{timestamp}.json
 */
export async function writeChatLog(
  sessionId: string,
  messages: ChatMessage[],
): Promise<string> {
  mkdirSync(TEMP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `chat-${sessionId}.${ts}.json`;
  const filePath = join(TEMP_DIR, filename);
  writeFileSync(filePath, JSON.stringify({ sessionId, messages }, null, 2));
  console.log(`[chat-log] written → ${filePath}`);
  return filePath;
}
