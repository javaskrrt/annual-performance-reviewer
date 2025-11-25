import prompts from "prompts";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * Cross-platform config path:
 * mac/linux: ~/.config/javaskrrt/config.json
 * windows:   %APPDATA%/javaskrrt/config.json
 */
const CONFIG_DIR =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "javaskrrt")
    : path.join(os.homedir(), ".config", "javaskrrt");

const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

/**
 * Retrieves a user’s OpenAI API key via:
 *   1 → CLI flag
 *   2 → env var OPENAI_API_KEY
 *   3 → stored config file
 *   4 → interactive prompt
 */
export async function getUserOpenAIKey(cliKey?: string): Promise<string> {
  // 1) CLI flag takes highest priority
  if (cliKey) return cliKey.trim();

  // 2) env var is next
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY.trim();
  }

  // 3) Read stored config
  const stored = await readStoredKey();
  if (stored) return stored;

  // 4) Prompt the user
  const { key } = await prompts({
    type: "password",
    name: "key",
    message: "Enter your OpenAI API key (only stored locally for future runs):",
    validate: (v: string) =>
      v.startsWith("sk-") ? true : "That doesn’t look like an OpenAI API key."
  });

  const final = key.trim();
  await storeKey(final);
  return final;
}

async function readStoredKey(): Promise<string | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const json = JSON.parse(raw);
    if (typeof json?.openaiKey === "string") return json.openaiKey;
    return null;
  } catch {
    return null;
  }
}

async function storeKey(key: string) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(
    CONFIG_PATH,
    JSON.stringify({ openaiKey: key }, null, 2),
    "utf8"
  );
}
