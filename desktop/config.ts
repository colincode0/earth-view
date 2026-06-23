import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The desktop build stores user-supplied API credentials in a local JSON file
 * (in Electron's userData directory) instead of a `.env`. The shape matches the
 * `env` object the existing server functions in `src/server/*` already expect,
 * so they can be reused without modification.
 */
export type DesktopConfig = {
  COPERNICUS_CLIENT_ID?: string;
  COPERNICUS_CLIENT_SECRET?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
};

const KEYS = [
  "COPERNICUS_CLIENT_ID",
  "COPERNICUS_CLIENT_SECRET",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

export function readConfig(configPath: string): DesktopConfig {
  try {
    if (!existsSync(configPath)) return {};
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const out: DesktopConfig = {};
    for (const key of KEYS) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) {
        out[key] = value.trim();
      }
    }
    return out;
  } catch {
    // A corrupt or unreadable config should never crash the app; fall back to
    // no-key mode (NASA GIBS still works).
    return {};
  }
}

export function writeConfig(configPath: string, incoming: DesktopConfig): DesktopConfig {
  const next: DesktopConfig = {};
  for (const key of KEYS) {
    const value = incoming[key];
    if (typeof value === "string" && value.trim()) {
      next[key] = value.trim();
    }
  }
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
