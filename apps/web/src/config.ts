import type { AppConfig } from "@copperkeep/contracts";

/**
 * Fetched at boot, never baked into the bundle — that is what lets curriculum, audio
 * and Pyodide version independently of the web build (§9.1 rule 2 and 3).
 */
let cached: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`/config.json returned ${response.status}`);
  cached = (await response.json()) as AppConfig;
  return cached;
}

export function config(): AppConfig {
  if (!cached) throw new Error("config not loaded");
  return cached;
}
