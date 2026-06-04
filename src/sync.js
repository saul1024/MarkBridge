import { countExportedBookmarks, exportBookmarksHtml, resolveExportFolder } from "./exporter.js";
import { importBookmarksHtml } from "./importer.js";
import { previewLibraryToBrowser, pullBrowserBookmarks, pushLibraryToBrowser } from "./browser.js";
import { createCosClient, headCosFile, isCosNotFoundError } from "./cos.js";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

export async function syncPushBrowserToCloud(options = {}) {
  const client = options.client ?? createCosClient(options.config);
  const pulled = await pullBrowserBookmarks({
    browser: options.browser,
    profile: options.profile,
    browserRoot: options.browserRoot,
    env: options.env
  });
  const exportOptions = {
    includeEmptyFolders: Boolean(options.includeEmptyFolders),
    folder: options.folder,
    folderPath: options.folderPath
  };
  const folderScope = resolveExportFolder(pulled.library, exportOptions);
  const scopedExportOptions = {
    ...exportOptions,
    folderId: folderScope?.id
  };
  const remoteKey = normalizeRemoteKey(options.remoteKey) || createDefaultRemoteKey({
    browser: pulled.browser,
    profileName: pulled.profileName,
    profile: pulled.profile,
    folder: folderScope?.path
  });
  const exportedBookmarks = countExportedBookmarks(pulled.library, scopedExportOptions);
  const html = exportBookmarksHtml(pulled.library, scopedExportOptions);
  const body = Buffer.from(html, "utf8");
  const result = {
    dryRun: Boolean(options.dryRun),
    remoteKey,
    size: body.length,
    browser: pulled.browser,
    browserName: pulled.browserName,
    profile: pulled.profile,
    profileName: pulled.profileName,
    bookmarksPath: pulled.bookmarksPath,
    folder: folderScope,
    exportedBookmarks,
    pulled: pulled.importBatch.stats,
    uploaded: false
  };

  if (options.dryRun) {
    return result;
  }

  const uploaded = await client.putObject(remoteKey, body, {
    contentType: HTML_CONTENT_TYPE
  });

  return {
    ...result,
    uploaded: true,
    statusCode: uploaded.statusCode,
    etag: uploaded.headers.etag
  };
}

export async function syncPullCloudToBrowser(options = {}) {
  const client = options.client ?? createCosClient(options.config);
  const remoteKey = normalizeRemoteKey(options.remoteKey) || createDefaultRemoteKey({
    browser: options.browser,
    profileName: options.profileName,
    profile: options.profile,
    folder: options.remoteFolder ?? options.sourceFolder ?? options.folder
  });
  const body = await client.getObject(remoteKey);
  const html = body.toString("utf8");
  const imported = importBookmarksHtml(html, {
    sourceFileName: remoteKey,
    sourceBrowser: options.browser
  });
  const targetFolder = options.folder ?? "MarkBridge";
  const mode = options.mode ?? "merge";

  if (options.dryRun) {
    const preview = await previewLibraryToBrowser(imported.library, {
      browser: options.browser,
      profile: options.profile,
      browserRoot: options.browserRoot,
      folder: targetFolder,
      mode,
      env: options.env
    });

    return {
      dryRun: true,
      remoteKey,
      size: body.length,
      imported: imported.importBatch.stats,
      ...preview,
      folder: targetFolder,
      uploaded: false
    };
  }

  const pushed = await pushLibraryToBrowser(imported.library, {
    browser: options.browser,
    profile: options.profile,
    browserRoot: options.browserRoot,
    folder: targetFolder,
    mode,
    quitBrowser: Boolean(options.quitBrowser),
    reopen: Boolean(options.reopen),
    skipRunningCheck: Boolean(options.skipRunningCheck),
    retryHint: options.retryHint,
    env: options.env
  });

  return {
    dryRun: false,
    remoteKey,
    size: body.length,
    imported: imported.importBatch.stats,
    ...pushed
  };
}

export function createDefaultRemoteKey(options = {}) {
  const browser = slugPathPart(options.browser || "browser");
  const profile = slugPathPart(options.profileName || options.profile || "profile");
  const folder = slugPathPart(options.folder || "all-bookmarks");

  return `bookmarks/${browser}/${profile}/${folder}.html`;
}

export async function getSyncRemoteStatus(options = {}) {
  const remoteKey = normalizeRemoteKey(options.remoteKey) || createDefaultRemoteKey({
    browser: options.browser,
    profileName: options.profileName,
    profile: options.profile,
    folder: options.remoteFolder ?? options.sourceFolder ?? options.folder
  });

  try {
    const result = await headCosFile({
      client: options.client,
      config: options.config,
      remoteKey
    });

    return {
      ...result,
      exists: true
    };
  } catch (error) {
    if (!isCosNotFoundError(error)) {
      throw error;
    }

    return {
      remoteKey,
      exists: false
    };
  }
}

function normalizeRemoteKey(value) {
  if (value === undefined || value === null || value === true || value === false) {
    return "";
  }

  const remoteKey = String(value ?? "").trim().replace(/^\/+/u, "");

  return remoteKey;
}

function slugPathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/gu, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    || "untitled";
}
