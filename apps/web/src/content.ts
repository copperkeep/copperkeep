import type { Course, Manifest } from "@copperkeep/contracts";
import { config } from "./config";

export async function loadManifest(): Promise<Manifest> {
  const response = await fetch(`${config().contentBaseUrl}/manifest.json`);
  if (!response.ok) throw new Error(`content manifest returned ${response.status}`);
  return (await response.json()) as Manifest;
}

export async function loadCourse(path: string): Promise<Course> {
  const response = await fetch(`${config().contentBaseUrl}/${path}`);
  if (!response.ok) throw new Error(`course ${path} returned ${response.status}`);
  return (await response.json()) as Course;
}

/** Compares dotted versions without pulling in a semver dependency. */
export function satisfiesMinAppVersion(appVersion: string, minAppVersion: string): boolean {
  const parse = (value: string) => value.split("-")[0]!.split(".").map((n) => Number(n) || 0);
  const [app, min] = [parse(appVersion), parse(minAppVersion)];
  for (let i = 0; i < Math.max(app.length, min.length); i += 1) {
    const a = app[i] ?? 0;
    const m = min[i] ?? 0;
    if (a !== m) return a > m;
  }
  return true;
}
