import { countExportedBookmarks, exportBookmarksHtml, resolveExportFolder } from "./exporter.js";
import { importBookmarksHtml } from "./importer.js";
import { previewLibraryToBrowser, pullBrowserBookmarks, pushLibraryToBrowser } from "./browser.js";
import { CosError, createCosClient, headCosFile, isCosNotFoundError } from "./cos.js";

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
  const remote = await getSyncRemoteStatus({
    client,
    config: options.config,
    remoteKey
  });
  const expectedEtag = resolveExpectedEtag(options, remoteKey);
  const force = Boolean(options.force);
  const conflictInfo = detectPushConflict({
    remote,
    expectedEtag,
    force
  });
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
    uploaded: false,
    remoteExists: conflictInfo.remoteExists,
    remoteEtag: conflictInfo.remoteEtag,
    expectedEtag: conflictInfo.expectedEtag,
    conflict: conflictInfo.conflict,
    conflictReason: conflictInfo.conflictReason,
    force
  };

  if (options.dryRun) {
    return result;
  }

  if (conflictInfo.conflict) {
    throw createSyncConflictError({
      remoteKey,
      expectedEtag: conflictInfo.expectedEtag,
      remoteEtag: conflictInfo.remoteEtag
    });
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
  const remote = await getSyncRemoteStatus({
    client,
    config: options.config,
    remoteKey
  });

  if (!remote.exists) {
    throw new CosError({
      method: "GET",
      key: remoteKey,
      statusCode: 404,
      message: "The specified key does not exist."
    });
  }

  const expectedEtag = resolveExpectedEtag(options, remoteKey);
  const change = detectPullRemoteChange({
    remote,
    expectedEtag
  });
  const remoteFields = {
    remoteExists: change.remoteExists,
    remoteEtag: change.remoteEtag,
    expectedEtag: change.expectedEtag,
    remoteChanged: change.remoteChanged,
    remoteUnchanged: change.remoteUnchanged,
    remoteStatus: change.remoteStatus
  };

  if (remote.size !== undefined) {
    remoteFields.remoteSize = remote.size;
  }

  if (remote.lastModified) {
    remoteFields.lastModified = remote.lastModified;
  }

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
      uploaded: false,
      ...remoteFields
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
    ...pushed,
    ...remoteFields
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

export function detectPushConflict(options = {}) {
  const force = Boolean(options.force);
  const inspected = inspectRemoteEtag(options);

  if (!inspected.remoteExists || force || inspected.etagsMatch) {
    return {
      remoteExists: inspected.remoteExists,
      remoteEtag: inspected.remoteEtag,
      expectedEtag: inspected.expectedEtag,
      conflict: false,
      conflictReason: null,
      force
    };
  }

  return {
    remoteExists: inspected.remoteExists,
    remoteEtag: inspected.remoteEtag,
    expectedEtag: inspected.expectedEtag,
    conflict: true,
    conflictReason: inspected.normalizedExpected ? "etag-mismatch" : "missing-expected-etag",
    force
  };
}

export function detectPullRemoteChange(options = {}) {
  const inspected = inspectRemoteEtag(options);
  const expectedEtag = inspected.normalizedExpected;

  if (!inspected.remoteExists) {
    return {
      remoteExists: false,
      remoteEtag: null,
      expectedEtag,
      remoteChanged: false,
      remoteUnchanged: false,
      remoteStatus: "missing"
    };
  }

  if (!expectedEtag) {
    return {
      remoteExists: true,
      remoteEtag: inspected.remoteEtag,
      expectedEtag: null,
      remoteChanged: true,
      remoteUnchanged: false,
      remoteStatus: "new-to-us"
    };
  }

  if (inspected.etagsMatch) {
    return {
      remoteExists: true,
      remoteEtag: inspected.remoteEtag,
      expectedEtag,
      remoteChanged: false,
      remoteUnchanged: true,
      remoteStatus: "unchanged"
    };
  }

  return {
    remoteExists: true,
    remoteEtag: inspected.remoteEtag,
    expectedEtag,
    remoteChanged: true,
    remoteUnchanged: false,
    remoteStatus: "changed"
  };
}

export function normalizeEtag(value) {
  if (!hasEtagValue(value)) {
    return "";
  }

  let etag = String(value).trim();

  if (etag.length >= 2 && etag.startsWith('"') && etag.endsWith('"')) {
    etag = etag.slice(1, -1);
  }

  return etag;
}

function resolveExpectedEtag(options, remoteKey) {
  const expectedRemoteKey = normalizeRemoteKey(options.expectedRemoteKey);

  if (expectedRemoteKey && expectedRemoteKey !== remoteKey) {
    return undefined;
  }

  return options.expectedEtag;
}

function inspectRemoteEtag(options = {}) {
  const remoteExists = Boolean(options.remote?.exists);
  const remoteEtag = remoteExists ? (options.remote.etag ?? null) : null;
  const expectedEtag = hasEtagValue(options.expectedEtag) ? options.expectedEtag : null;
  const normalizedExpected = normalizeEtag(expectedEtag) || null;
  const normalizedRemote = normalizeEtag(remoteEtag) || null;

  return {
    remoteExists,
    remoteEtag,
    expectedEtag,
    normalizedExpected,
    normalizedRemote,
    etagsMatch: Boolean(normalizedExpected) && normalizedExpected === normalizedRemote
  };
}

function hasEtagValue(value) {
  return value !== undefined && value !== null && value !== false && value !== true && String(value).trim() !== "";
}

function createSyncConflictError(options) {
  const expectedEtag = options.expectedEtag || "(none)";
  const remoteEtag = options.remoteEtag || "(none)";
  const error = new Error(
    `Remote object changed since last push. Remote: ${options.remoteKey} Last ETag: ${expectedEtag} Remote ETag: ${remoteEtag} Use --force to overwrite.`
  );

  error.name = "SyncConflictError";
  error.code = "SYNC_CONFLICT";
  error.remoteKey = options.remoteKey;
  error.remoteEtag = options.remoteEtag ?? null;
  error.expectedEtag = options.expectedEtag ?? null;

  return error;
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
