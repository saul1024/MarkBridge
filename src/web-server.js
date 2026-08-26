import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BROWSER_PUSH_MODES, listBrowserProfiles, previewLibraryToBrowser, pullBrowserBookmarks, pushLibraryToBrowser } from "./browser.js";
import { loadCosConfig } from "./cos.js";
import { loadEnvironment } from "./env.js";
import { countExportedBookmarks, exportBookmarksHtml, listExportFolders, resolveExportFolder } from "./exporter.js";
import { importBookmarksHtml } from "./importer.js";
import { getDefaultSyncConfigPath, loadSyncConfig, saveSyncConfig } from "./store.js";
import { getSyncRemoteStatus, syncPullCloudToBrowser, syncPushBrowserToCloud } from "./sync.js";

export const DEFAULT_WEB_HOST = "127.0.0.1";
export const DEFAULT_WEB_PORT = 8787;

const DEFAULT_WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../web");
const SECRET_KEYS = new Set([
  "secretId",
  "secretKey",
  "securityToken",
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_SECURITY_TOKEN"
]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function resolveWebListenHost(host) {
  const value = host === undefined || host === null || host === ""
    ? DEFAULT_WEB_HOST
    : String(host).trim();

  if (value === "localhost") {
    return DEFAULT_WEB_HOST;
  }

  if (value !== DEFAULT_WEB_HOST) {
    throw new Error(`markbridge web only binds 127.0.0.1 (got ${value}).`);
  }

  return value;
}

export function resolveWebListenPort(port) {
  if (port === undefined || port === null || port === "") {
    return DEFAULT_WEB_PORT;
  }

  const value = Number.parseInt(String(port), 10);

  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }

  return value;
}

export function isLocalRemoteAddress(address) {
  if (address === undefined || address === null || address === "") {
    return true;
  }

  const value = String(address).trim().replace(/^::ffff:/iu, "");
  return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

export function createWebHandler(options = {}) {
  const deps = createWebDeps(options);

  return async function handleRequest(req, res) {
    try {
      if (!isLocalRemoteAddress(req.socket?.remoteAddress)) {
        sendJson(res, 403, {
          ok: false,
          error: "Localhost only. This server refuses non-127.0.0.1 clients."
        });
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      const handled = await routeApi(req, res, url, pathname, deps);

      if (!handled) {
        await serveStatic(req, res, pathname, deps.webRoot);
      }
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function createWebServer(options = {}) {
  const handler = options.handler ?? createWebHandler(options);

  return createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) {
        sendError(res, error);
      }
    });
  });
}

export async function startWebServer(options = {}) {
  const host = resolveWebListenHost(options.host);
  const port = resolveWebListenPort(options.port);
  const server = options.server ?? createWebServer(options);

  return new Promise((resolvePromise, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise(server);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export function getWebListenUrl(server) {
  const address = server.address();

  if (!address || typeof address === "string") {
    return `http://${DEFAULT_WEB_HOST}:${DEFAULT_WEB_PORT}`;
  }

  const host = address.address === "::1" ? "127.0.0.1" : address.address;
  return `http://${host}:${address.port}`;
}

export function printWebListenMessage(url, log = console.log) {
  log(`MarkBridge web UI: ${url}`);
  log("Local-only: bound to 127.0.0.1, not reachable from other machines.");
  log("Press Ctrl+C to stop.");
}

function createWebDeps(options = {}) {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    envFile: options.envFile,
    webRoot: options.webRoot ?? DEFAULT_WEB_ROOT,
    cosClient: options.cosClient,
    listBrowserProfiles: options.listBrowserProfiles ?? listBrowserProfiles,
    pullBrowserBookmarks: options.pullBrowserBookmarks ?? pullBrowserBookmarks,
    previewLibraryToBrowser: options.previewLibraryToBrowser ?? previewLibraryToBrowser,
    pushLibraryToBrowser: options.pushLibraryToBrowser ?? pushLibraryToBrowser,
    loadSyncConfig: options.loadSyncConfig ?? loadSyncConfig,
    saveSyncConfig: options.saveSyncConfig ?? saveSyncConfig,
    loadEnvironment: options.loadEnvironment ?? loadEnvironment,
    loadCosConfig: options.loadCosConfig ?? loadCosConfig,
    getSyncRemoteStatus: options.getSyncRemoteStatus ?? getSyncRemoteStatus,
    syncPushBrowserToCloud: options.syncPushBrowserToCloud ?? syncPushBrowserToCloud,
    syncPullCloudToBrowser: options.syncPullCloudToBrowser ?? syncPullCloudToBrowser
  };
}

async function routeApi(req, res, url, pathname, deps) {
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: `Method not allowed: ${req.method}` });
    return true;
  }

  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      data: {
        status: "ok",
        localOnly: true,
        host: DEFAULT_WEB_HOST
      }
    });
    return true;
  }

  if (pathname === "/api/profiles" && req.method === "GET") {
    const browser = optionalQuery(url, "browser");
    const profiles = await deps.listBrowserProfiles({
      browser: browser || undefined,
      env: deps.env
    });
    sendJson(res, 200, { ok: true, data: { profiles: publicProfiles(profiles) } });
    return true;
  }

  if (pathname === "/api/folders" && req.method === "GET") {
    const browser = requiredQuery(url, "browser");
    const profile = requiredQuery(url, "profile");
    const pulled = await deps.pullBrowserBookmarks({
      browser,
      profile,
      env: deps.env
    });
    const folders = [
      {
        id: null,
        path: "",
        title: "全部书签",
        all: true,
        bookmarkCount: countExportedBookmarks(pulled.library)
      },
      ...listExportFolders(pulled.library).map((folder) => ({
        ...folder,
        all: false,
        bookmarkCount: countExportedBookmarks(pulled.library, { folderPath: folder.path })
      }))
    ];

    sendJson(res, 200, {
      ok: true,
      data: {
        browser: pulled.browser,
        browserName: pulled.browserName,
        profile: pulled.profile,
        profileName: pulled.profileName,
        bookmarksPath: pulled.bookmarksPath,
        folders
      }
    });
    return true;
  }

  if (pathname === "/api/sync/status" && req.method === "GET") {
    sendJson(res, 200, { ok: true, data: await buildSyncStatus(deps) });
    return true;
  }

  if (pathname === "/api/sync/setup" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleSyncSetup(await readJsonBody(req), deps) });
    return true;
  }

  if (pathname === "/api/sync/push/preview" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleSyncPush(await readJsonBody(req), deps, { dryRun: true }) });
    return true;
  }

  if (pathname === "/api/sync/push" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleSyncPush(await readJsonBody(req), deps, { dryRun: false }) });
    return true;
  }

  if (pathname === "/api/sync/pull/preview" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleSyncPull(await readJsonBody(req), deps, { dryRun: true }) });
    return true;
  }

  if (pathname === "/api/sync/pull" && req.method === "POST") {
    const body = await readJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      data: await handleSyncPull(body, deps, { dryRun: !body.apply })
    });
    return true;
  }

  if (pathname === "/api/copy/preview" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleCopy(await readJsonBody(req), deps, { dryRun: true }) });
    return true;
  }

  if (pathname === "/api/copy" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleCopy(await readJsonBody(req), deps, { dryRun: false }) });
    return true;
  }

  if (pathname === "/api/export" && req.method === "GET") {
    sendHtmlAttachment(res, await handleExportDownload(url, deps));
    return true;
  }

  if (pathname === "/api/export/preview" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleExportPreview(await readJsonBody(req), deps) });
    return true;
  }

  if (pathname === "/api/import/preview" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleImport(await readJsonBody(req), deps, { dryRun: true }) });
    return true;
  }

  if (pathname === "/api/import" && req.method === "POST") {
    sendJson(res, 200, { ok: true, data: await handleImport(await readJsonBody(req), deps, { dryRun: false }) });
    return true;
  }

  sendJson(res, 404, { ok: false, error: `Not found: ${pathname}` });
  return true;
}

async function buildSyncStatus(deps) {
  const configPath = getDefaultSyncConfigPath(deps.env);
  const config = publicSyncConfig(await deps.loadSyncConfig(configPath));
  const cos = await loadOptionalCos(deps);
  let remote = null;

  if (cos.configured && (config?.remoteKey || (config?.browser && config?.profile))) {
    try {
      remote = await deps.getSyncRemoteStatus({
        client: deps.cosClient,
        config: cos.raw,
        remoteKey: config.remoteKey,
        browser: config.browser,
        profile: config.profile,
        folder: config.folderPath ?? config.folder
      });
    } catch (error) {
      remote = {
        exists: false,
        error: error.message
      };
    }
  }

  return {
    configured: Boolean(config) && cos.configured,
    setup: Boolean(config),
    configPath,
    config,
    cos: {
      configured: cos.configured,
      ...(cos.configured ? publicCosConfig(cos.raw) : {}),
      ...(cos.configured ? {} : { error: cos.error })
    },
    remote
  };
}

async function handleSyncSetup(body, deps) {
  const browser = requiredString(body.browser, "browser");
  const profile = requiredString(body.profile, "profile");
  const folder = optionalString(body.folder);
  const folderPath = optionalString(body.folderPath);
  const mode = optionalString(body.mode) || "merge";
  const cos = await requireCos(deps);
  const preview = await deps.syncPushBrowserToCloud({
    client: deps.cosClient,
    config: cos.raw,
    browser,
    profile,
    folder: folder || undefined,
    folderPath: folderPath || undefined,
    includeEmptyFolders: Boolean(body.includeEmptyFolders),
    remoteKey: optionalString(body.remoteKey) || undefined,
    dryRun: true,
    env: deps.env
  });
  const syncConfigPath = getDefaultSyncConfigPath(deps.env);
  const saved = await deps.saveSyncConfig({
    browser,
    profile,
    folder: folder || preview.folder?.title || undefined,
    folderPath: folderPath || preview.folder?.path || undefined,
    includeEmptyFolders: Boolean(body.includeEmptyFolders),
    mode,
    remoteKey: preview.remoteKey
  }, syncConfigPath);

  return {
    configPath: syncConfigPath,
    config: publicSyncConfig(saved.config),
    cos: publicCosConfig(cos.raw),
    preview: publicSyncResult(preview)
  };
}

async function handleSyncPush(body, deps, options) {
  const syncConfigPath = getDefaultSyncConfigPath(deps.env);
  const syncConfig = await requireSyncConfig(deps, syncConfigPath);
  const cos = await requireCos(deps);
  const force = Boolean(body.force);
  let result;

  try {
    result = await deps.syncPushBrowserToCloud({
      client: deps.cosClient,
      config: cos.raw,
      browser: syncConfig.browser,
      profile: syncConfig.profile,
      folder: syncConfig.folder,
      folderPath: syncConfig.folderPath,
      includeEmptyFolders: Boolean(syncConfig.includeEmptyFolders),
      remoteKey: optionalString(body.remoteKey) || syncConfig.remoteKey,
      dryRun: options.dryRun,
      force,
      expectedEtag: syncConfig.lastRemoteEtag,
      expectedRemoteKey: syncConfig.lastRemoteKey,
      env: deps.env
    });
  } catch (error) {
    attachConflict(error);
    throw error;
  }

  if (!options.dryRun && result.uploaded) {
    await deps.saveSyncConfig({
      ...syncConfig,
      lastRemoteEtag: result.etag,
      lastRemoteKey: result.remoteKey
    }, syncConfigPath);
  }

  return {
    configPath: syncConfigPath,
    cos: publicCosConfig(cos.raw),
    ...publicSyncResult(result)
  };
}

async function handleSyncPull(body, deps, options) {
  const syncConfigPath = getDefaultSyncConfigPath(deps.env);
  const syncConfig = await requireSyncConfig(deps, syncConfigPath);
  const cos = await requireCos(deps);
  const dryRun = options.dryRun;
  const result = await deps.syncPullCloudToBrowser({
    client: deps.cosClient,
    config: cos.raw,
    remoteKey: optionalString(body.remoteKey) || syncConfig.remoteKey,
    browser: syncConfig.browser,
    profile: syncConfig.profile,
    folder: optionalString(body.folder) || syncConfig.folder || "MarkBridge",
    mode: optionalString(body.mode) || syncConfig.mode || "merge",
    dryRun,
    quitBrowser: Boolean(body.quitBrowser),
    reopen: Boolean(body.reopen),
    skipRunningCheck: Boolean(body.skipRunningCheck),
    expectedEtag: syncConfig.lastRemoteEtag,
    expectedRemoteKey: syncConfig.lastRemoteKey,
    env: deps.env
  });

  if (!dryRun) {
    try {
      const remote = await deps.getSyncRemoteStatus({
        client: deps.cosClient,
        config: cos.raw,
        remoteKey: result.remoteKey
      });

      if (remote.exists && remote.etag) {
        await deps.saveSyncConfig({
          ...syncConfig,
          lastRemoteEtag: remote.etag,
          lastRemoteKey: remote.remoteKey || result.remoteKey
        }, syncConfigPath);
      }
    } catch {
      // Pull already succeeded; remembering the ETag is best-effort.
    }
  }

  return {
    configPath: syncConfigPath,
    cos: publicCosConfig(cos.raw),
    ...publicSyncResult(result)
  };
}

async function handleExportDownload(url, deps) {
  const browser = requiredQuery(url, "browser");
  const profile = requiredQuery(url, "profile");
  const folderPath = optionalQuery(url, "folderPath");
  const built = await buildExport(deps, { browser, profile, folderPath });
  return {
    html: built.html,
    filename: exportAttachmentFilename(browser, profile, built.folder)
  };
}

async function handleExportPreview(body, deps) {
  const browser = requiredString(body.browser, "browser");
  const profile = requiredString(body.profile, "profile");
  const folderPath = optionalString(body.folderPath);
  const built = await buildExport(deps, { browser, profile, folderPath });
  return {
    exportedBookmarks: built.exportedBookmarks,
    folder: built.folder,
    size: built.size
  };
}

async function buildExport(deps, options) {
  const pulled = await deps.pullBrowserBookmarks({
    browser: options.browser,
    profile: options.profile,
    env: deps.env
  });
  const exportOptions = options.folderPath ? { folderPath: options.folderPath } : {};
  const folder = options.folderPath
    ? resolveExportFolder(pulled.library, exportOptions)
    : null;
  const html = exportBookmarksHtml(pulled.library, exportOptions);
  return {
    html,
    folder,
    exportedBookmarks: countExportedBookmarks(pulled.library, exportOptions),
    size: Buffer.byteLength(html, "utf8")
  };
}

async function handleImport(body, deps, options) {
  const html = requiredString(body.html, "html");
  const browser = requiredString(body.browser, "browser");
  const profile = requiredString(body.profile, "profile");
  const folder = optionalString(body.folder) || "MarkBridge";
  const mode = optionalString(body.mode) || "merge";

  if (mode && !BROWSER_PUSH_MODES.has(mode) && mode !== "replace") {
    throw createHttpError(400, `Unsupported browser import mode: ${mode}. Supported modes: ${Array.from(BROWSER_PUSH_MODES).join(", ")}`);
  }

  const imported = importBookmarksHtml(html, {
    sourceFileName: optionalString(body.sourceFileName) || "upload.html",
    sourceBrowser: browser
  });
  const pushOptions = {
    browser,
    profile,
    folder,
    mode,
    env: deps.env,
    quitBrowser: Boolean(body.quitBrowser),
    reopen: Boolean(body.reopen),
    skipRunningCheck: Boolean(body.skipRunningCheck)
  };

  if (options.dryRun) {
    const preview = await deps.previewLibraryToBrowser(imported.library, pushOptions);
    return {
      dryRun: true,
      written: false,
      imported: imported.importBatch.stats,
      ...publicPushResult(preview),
      quitBrowser: Boolean(body.quitBrowser)
    };
  }

  const pushed = await deps.pushLibraryToBrowser(imported.library, pushOptions);
  return {
    dryRun: false,
    written: true,
    imported: imported.importBatch.stats,
    ...publicPushResult(pushed),
    quitBrowser: Boolean(body.quitBrowser)
  };
}

function exportAttachmentFilename(browser, profile, folder) {
  const raw = ["markbridge", browser, profile, folder?.title || folder?.path]
    .filter(Boolean)
    .join("-");
  const slug = raw
    .replace(/[^\p{L}\p{N}.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return `${slug || "markbridge-bookmarks"}.html`;
}

function sendHtmlAttachment(res, payload) {
  const body = Buffer.from(payload.html, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-disposition": `attachment; filename="${payload.filename}"`,
    "cache-control": "no-store",
    "content-length": body.length
  });
  res.end(body);
}

async function handleCopy(body, deps, options) {
  const fromBrowser = requiredString(body.fromBrowser, "fromBrowser");
  const fromProfile = requiredString(body.fromProfile, "fromProfile");
  const toBrowser = requiredString(body.toBrowser, "toBrowser");
  const toProfile = requiredString(body.toProfile, "toProfile");
  const toFolder = optionalString(body.toFolder) || "MarkBridge";
  const mode = optionalString(body.mode) || "merge";

  if (mode && !BROWSER_PUSH_MODES.has(mode) && mode !== "replace") {
    throw createHttpError(400, `Unsupported browser import mode: ${mode}. Supported modes: ${Array.from(BROWSER_PUSH_MODES).join(", ")}`);
  }

  const pulled = await deps.pullBrowserBookmarks({
    browser: fromBrowser,
    profile: fromProfile,
    env: deps.env
  });
  const scoped = scopeLibraryForCopy(pulled.library, {
    browser: fromBrowser,
    folder: optionalString(body.fromFolder),
    folderPath: optionalString(body.fromFolderPath)
  });
  const pushOptions = {
    browser: toBrowser,
    profile: toProfile,
    folder: toFolder,
    mode,
    env: deps.env,
    quitBrowser: Boolean(body.quitBrowser),
    reopen: Boolean(body.reopen),
    skipRunningCheck: Boolean(body.skipRunningCheck)
  };

  if (options.dryRun) {
    const preview = await deps.previewLibraryToBrowser(scoped.library, pushOptions);
    return {
      dryRun: true,
      written: false,
      from: {
        browser: pulled.browser,
        browserName: pulled.browserName,
        profile: pulled.profile,
        profileName: pulled.profileName,
        bookmarksPath: pulled.bookmarksPath,
        folder: scoped.folder,
        pulled: pulled.importBatch.stats,
        exportedBookmarks: scoped.exportedBookmarks
      },
      to: publicPushResult(preview),
      quitBrowser: Boolean(body.quitBrowser)
    };
  }

  const pushed = await deps.pushLibraryToBrowser(scoped.library, pushOptions);
  return {
    dryRun: false,
    written: true,
    from: {
      browser: pulled.browser,
      browserName: pulled.browserName,
      profile: pulled.profile,
      profileName: pulled.profileName,
      bookmarksPath: pulled.bookmarksPath,
      folder: scoped.folder,
      pulled: pulled.importBatch.stats,
      exportedBookmarks: scoped.exportedBookmarks
    },
    to: publicPushResult(pushed),
    quitBrowser: Boolean(body.quitBrowser)
  };
}

function scopeLibraryForCopy(library, options = {}) {
  const folder = optionalString(options.folder);
  const folderPath = optionalString(options.folderPath);

  if (!folder && !folderPath) {
    return {
      library,
      folder: null,
      exportedBookmarks: countExportedBookmarks(library)
    };
  }

  const folderScope = resolveExportFolder(library, { folder, folderPath });
  const html = exportBookmarksHtml(library, { folderPath: folderScope.path });
  const imported = importBookmarksHtml(html, {
    sourceFileName: "markbridge-copy",
    sourceBrowser: options.browser
  });

  return {
    library: imported.library,
    folder: folderScope,
    exportedBookmarks: countExportedBookmarks(library, { folderPath: folderScope.path })
  };
}

async function loadOptionalCos(deps) {
  try {
    const env = await deps.loadEnvironment({
      cwd: deps.cwd,
      env: deps.env,
      envFile: deps.envFile
    });
    const config = deps.loadCosConfig(env);
    return {
      configured: true,
      raw: config,
      error: null
    };
  } catch (error) {
    return {
      configured: false,
      raw: null,
      error: error.message
    };
  }
}

async function requireCos(deps) {
  const cos = await loadOptionalCos(deps);

  if (!cos.configured) {
    throw createHttpError(400, cos.error || "Missing COS configuration. Check .env or environment variables.");
  }

  return cos;
}

async function requireSyncConfig(deps, syncConfigPath) {
  const config = await deps.loadSyncConfig(syncConfigPath);

  if (!config) {
    throw createHttpError(400, `No MarkBridge sync defaults found at ${syncConfigPath}. Save setup first.`);
  }

  if (!config.browser || !config.profile) {
    throw createHttpError(400, `Invalid MarkBridge sync defaults at ${syncConfigPath}. Save setup again.`);
  }

  return config;
}

async function serveStatic(req, res, pathname, webRoot) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: `Method not allowed: ${req.method}` });
    return;
  }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
  const resolvedRoot = resolve(webRoot);
  const resolvedPath = resolve(join(resolvedRoot, relative));

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    sendJson(res, 403, { ok: false, error: "Forbidden path." });
    return;
  }

  if (!existsSync(resolvedPath)) {
    sendJson(res, 404, { ok: false, error: `Not found: ${pathname}` });
    return;
  }

  const body = await readFile(resolvedPath);
  res.writeHead(200, {
    "content-type": MIME_TYPES[extname(resolvedPath)] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw createHttpError(400, "JSON body must be an object.");
    }

    return parsed;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw createHttpError(400, "Invalid JSON body.");
  }
}

function sendError(res, error) {
  const statusCode = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : error?.code === "SYNC_CONFLICT"
      ? 409
      : 400;
  const payload = {
    ok: false,
    error: error?.message || "Request failed."
  };

  if (error?.code === "SYNC_CONFLICT") {
    payload.conflict = true;
    payload.remoteKey = error.remoteKey ?? null;
    payload.expectedEtag = error.expectedEtag ?? null;
    payload.remoteEtag = error.remoteEtag ?? null;
  }

  if (error?.backupPath) {
    payload.backupPath = error.backupPath;
  }

  sendJson(res, statusCode, payload);
}

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(sanitizeForClient(payload))}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sanitizeForClient(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForClient);
  }

  if (value && typeof value === "object") {
    const cleaned = {};

    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEYS.has(key)) {
        continue;
      }

      cleaned[key] = sanitizeForClient(nested);
    }

    return cleaned;
  }

  return value;
}

function publicProfiles(profiles) {
  return profiles.map((profile) => ({
    browser: profile.browser,
    browserName: profile.browserName,
    profile: profile.profile,
    name: profile.name,
    hasBookmarks: profile.hasBookmarks,
    bookmarksPath: profile.bookmarksPath,
    verifyUrl: profile.verifyUrl
  }));
}

function publicSyncConfig(config) {
  if (!config) {
    return null;
  }

  return sanitizeForClient({ ...config });
}

function publicCosConfig(config) {
  if (!config) {
    return null;
  }

  return {
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket
  };
}

function publicSyncResult(result) {
  return sanitizeForClient({ ...result });
}

function publicPushResult(result) {
  return sanitizeForClient({
    browser: result.browser,
    browserName: result.browserName,
    profile: result.profile,
    profileName: result.profileName,
    bookmarksPath: result.bookmarksPath,
    backupPath: result.backupPath ?? null,
    folder: result.folder,
    mode: result.mode,
    pushed: result.pushed,
    plannedBookmarks: result.plannedBookmarks,
    summary: result.summary,
    verifyUrl: result.verifyUrl,
    browserWasRunning: result.browserWasRunning,
    quitBrowser: result.quitBrowser,
    reopened: result.reopened
  });
}

function optionalQuery(url, key) {
  return optionalString(url.searchParams.get(key));
}

function requiredQuery(url, key) {
  const value = optionalQuery(url, key);

  if (!value) {
    throw createHttpError(400, `Missing query parameter: ${key}`);
  }

  return value;
}

function requiredString(value, key) {
  const normalized = optionalString(value);

  if (!normalized) {
    throw createHttpError(400, `Missing field: ${key}`);
  }

  return normalized;
}

function optionalString(value) {
  if (value === undefined || value === null || value === true || value === false) {
    return "";
  }

  return String(value).trim();
}

function attachConflict(error) {
  if (error?.code === "SYNC_CONFLICT") {
    error.statusCode = 409;
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
