import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import { createEmptyLibrary } from "./model.js";

export const LIBRARY_FILE_FORMAT = "markbridge-library";
export const LIBRARY_FILE_VERSION = 1;

export function getMarkBridgeHome(env = process.env) {
  return env.MARKBRIDGE_HOME || join(homedir(), ".markbridge");
}

export function getDefaultLibraryPath(env = process.env) {
  return env.MARKBRIDGE_LIBRARY || join(getMarkBridgeHome(env), "library.json");
}

export async function loadLibrary(path = getDefaultLibraryPath()) {
  if (!existsSync(path)) {
    return null;
  }

  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);

  if (parsed.format === LIBRARY_FILE_FORMAT && parsed.library) {
    return parsed.library;
  }

  if (parsed.schemaVersion && parsed.items && parsed.rootId) {
    return parsed;
  }

  throw new Error(`Unsupported MarkBridge library file: ${path}`);
}

export async function loadOrCreateLibrary(path = getDefaultLibraryPath(), options = {}) {
  return (await loadLibrary(path)) ?? createEmptyLibrary(options);
}

export async function saveLibrary(library, path = getDefaultLibraryPath(), options = {}) {
  const now = options.now ?? new Date().toISOString();
  const file = {
    format: LIBRARY_FILE_FORMAT,
    formatVersion: LIBRARY_FILE_VERSION,
    schemaVersion: library.schemaVersion,
    library,
    createdAt: options.createdAt ?? library.createdAt ?? now,
    updatedAt: now
  };
  const targetDir = dirname(path);
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;

  library.updatedAt = now;
  await mkdir(targetDir, { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

