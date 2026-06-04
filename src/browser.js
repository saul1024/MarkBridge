import { execFile } from "node:child_process";
import { copyFile, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

import { addBookmark, addFolder, createEmptyLibrary, createRandomIdFactory, getChildren, isBookmark, isFolder } from "./model.js";
import { normalizeUrl } from "./normalize.js";

const execFileAsync = promisify(execFile);
const CHROME_EPOCH_OFFSET_MS = 11644473600000n;
const DEFAULT_TARGET_FOLDER = "MarkBridge";
const DEFAULT_TARGET_ROOT = "bookmark_bar";
const DEFAULT_BROWSER_PUSH_MODE = "replace-folder";
const ROOT_ORDER = ["bookmark_bar", "other", "synced"];
const ROOT_FALLBACK_NAMES = {
  bookmark_bar: "Bookmarks Bar",
  other: "Other Bookmarks",
  synced: "Mobile Bookmarks"
};
export const BROWSER_PUSH_MODES = new Set(["merge", "replace-folder", "append"]);

export const SUPPORTED_BROWSERS = {
  chrome: {
    key: "chrome",
    name: "Google Chrome",
    processName: "Google Chrome",
    verifyUrl: "chrome://bookmarks",
    defaultUserDataDir: () => join(homedir(), "Library", "Application Support", "Google", "Chrome")
  },
  edge: {
    key: "edge",
    name: "Microsoft Edge",
    processName: "Microsoft Edge",
    verifyUrl: "edge://favorites",
    defaultUserDataDir: () => join(homedir(), "Library", "Application Support", "Microsoft Edge")
  }
};

const BROWSER_ALIASES = new Map([
  ["chrome", "chrome"],
  ["google-chrome", "chrome"],
  ["googlechrome", "chrome"],
  ["edge", "edge"],
  ["microsoft-edge", "edge"],
  ["microsoftedge", "edge"]
]);

export function normalizeBrowserKey(value) {
  const key = BROWSER_ALIASES.get(String(value ?? "").toLowerCase());

  if (!key) {
    throw new Error(`Unsupported browser: ${value}. Supported browsers: ${Object.keys(SUPPORTED_BROWSERS).join(", ")}`);
  }

  return key;
}

export function getBrowserUserDataDir(browser, options = {}) {
  const key = normalizeBrowserKey(browser);
  const upperKey = key.toUpperCase();

  return options.browserRoot
    ?? options.env?.[`MARKBRIDGE_${upperKey}_USER_DATA_DIR`]
    ?? options.env?.MARKBRIDGE_BROWSER_USER_DATA_DIR
    ?? SUPPORTED_BROWSERS[key].defaultUserDataDir();
}

export async function listBrowserProfiles(options = {}) {
  const browserKeys = options.browser
    ? [normalizeBrowserKey(options.browser)]
    : Object.keys(SUPPORTED_BROWSERS);
  const profiles = [];

  for (const browser of browserKeys) {
    const config = SUPPORTED_BROWSERS[browser];
    const userDataDir = getBrowserUserDataDir(browser, options);
    const entries = await readdirIfExists(userDataDir);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const profilePath = join(userDataDir, entry.name);
      const bookmarksPath = join(profilePath, "Bookmarks");
      const preferencesPath = join(profilePath, "Preferences");

      if (!looksLikeBrowserProfile(entry.name, bookmarksPath, preferencesPath)) {
        continue;
      }

      profiles.push({
        browser,
        browserName: config.name,
        profile: entry.name,
        name: await readProfileDisplayName(preferencesPath, entry.name),
        userDataDir,
        profilePath,
        bookmarksPath,
        hasBookmarks: existsSync(bookmarksPath),
        verifyUrl: config.verifyUrl
      });
    }
  }

  return profiles.sort(compareProfiles);
}

export async function pushLibraryToBrowser(library, options = {}) {
  const browser = normalizeBrowserKey(options.browser);
  const config = SUPPORTED_BROWSERS[browser];
  const mode = normalizeBrowserPushMode(options.mode ?? DEFAULT_BROWSER_PUSH_MODE);

  if (!options.profile) {
    throw new Error(`Usage: markbridge push-browser --browser ${browser} --profile <profile>`);
  }

  const browserWasRunning = !options.skipRunningCheck && await checkBrowserRunning(browser, options);

  if (browserWasRunning) {
    if (!options.quitBrowser) {
      throw new Error(formatBrowserRunningError(config.name, "push-browser", options.retryHint));
    }

    await quitBrowser(browser, options);

    if (!await waitForBrowserExit(browser, options)) {
      throw new Error(`${config.name} did not exit within ${options.quitTimeoutMs ?? 10000}ms. Close it manually, then run push-browser again.`);
    }
  }

  const profiles = await listBrowserProfiles({
    browser,
    browserRoot: options.browserRoot,
    env: options.env
  });
  const profile = requireBrowserProfile(profiles, browser, options);

  const bookmarksFile = await readBrowserBookmarksFile(profile.bookmarksPath);
  const targetRootKey = options.targetRoot ?? DEFAULT_TARGET_ROOT;
  const targetRoot = bookmarksFile.roots?.[targetRootKey];

  if (!targetRoot || !Array.isArray(targetRoot.children)) {
    throw new Error(`Unsupported browser bookmarks file: missing roots.${targetRootKey}.children in ${profile.bookmarksPath}`);
  }

  const idFactory = createChromeIdFactory(bookmarksFile);
  const folderTitle = options.folder ?? DEFAULT_TARGET_FOLDER;
  const { folder, stats } = buildBrowserFolderFromLibrary(library, {
    folderTitle,
    idFactory,
    now: options.now
  });
  const summary = applyBrowserFolderToRoot(targetRoot, folder, { mode });

  if (summary.changed) {
    delete bookmarksFile.checksum;
  }

  const backupPath = summary.changed ? createBackupPath(profile.bookmarksPath, options.now) : null;

  if (summary.changed) {
    await copyFile(profile.bookmarksPath, backupPath);
    await writeJsonAtomic(profile.bookmarksPath, bookmarksFile);
  }

  const result = {
    browser,
    browserName: config.name,
    profile: profile.profile,
    profileName: profile.name,
    bookmarksPath: profile.bookmarksPath,
    backupPath,
    folder: folderTitle,
    mode,
    pushed: summary.addedBookmarks,
    plannedBookmarks: stats.pushed,
    summary,
    root: targetRootKey,
    verifyUrl: config.verifyUrl,
    browserWasRunning,
    quitBrowser: browserWasRunning && Boolean(options.quitBrowser),
    reopened: false
  };

  if (options.reopen) {
    await reopenBrowser(browser, options);
    result.reopened = true;
  }

  return result;
}

export async function previewLibraryToBrowser(library, options = {}) {
  const browser = normalizeBrowserKey(options.browser);
  const config = SUPPORTED_BROWSERS[browser];
  const mode = normalizeBrowserPushMode(options.mode ?? DEFAULT_BROWSER_PUSH_MODE);

  if (!options.profile) {
    throw new Error(`Usage: markbridge import-browser --browser ${browser} --profile <profile>`);
  }

  const profiles = await listBrowserProfiles({
    browser,
    browserRoot: options.browserRoot,
    env: options.env
  });
  const profile = requireBrowserProfile(profiles, browser, options);
  const bookmarksFile = structuredClone(await readBrowserBookmarksFile(profile.bookmarksPath));
  const targetRootKey = options.targetRoot ?? DEFAULT_TARGET_ROOT;
  const targetRoot = bookmarksFile.roots?.[targetRootKey];

  if (!targetRoot || !Array.isArray(targetRoot.children)) {
    throw new Error(`Unsupported browser bookmarks file: missing roots.${targetRootKey}.children in ${profile.bookmarksPath}`);
  }

  const idFactory = createChromeIdFactory(bookmarksFile);
  const folderTitle = options.folder ?? DEFAULT_TARGET_FOLDER;
  const { folder, stats } = buildBrowserFolderFromLibrary(library, {
    folderTitle,
    idFactory,
    now: options.now
  });
  const summary = applyBrowserFolderToRoot(targetRoot, folder, { mode });

  return {
    browser,
    browserName: config.name,
    profile: profile.profile,
    profileName: profile.name,
    bookmarksPath: profile.bookmarksPath,
    folder: folderTitle,
    mode,
    pushed: summary.addedBookmarks,
    plannedBookmarks: stats.pushed,
    summary,
    root: targetRootKey,
    verifyUrl: config.verifyUrl
  };
}

export async function pullBrowserBookmarks(options = {}) {
  const browser = normalizeBrowserKey(options.browser);
  const config = SUPPORTED_BROWSERS[browser];

  if (!options.profile) {
    throw new Error(`Usage: markbridge pull-browser --browser ${browser} --profile <profile>`);
  }

  const profiles = await listBrowserProfiles({
    browser,
    browserRoot: options.browserRoot,
    env: options.env
  });
  const profile = requireBrowserProfile(profiles, browser, options);
  const bookmarksFile = await readBrowserBookmarksFile(profile.bookmarksPath);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? createRandomIdFactory();
  const library = createEmptyLibrary({ idFactory, now });
  const batchId = options.batchId ?? idFactory();
  const importBatch = {
    id: batchId,
    sourceType: "browser-profile",
    sourceBrowser: browser,
    sourceFileName: profile.bookmarksPath,
    importedAt: now,
    importedByDeviceId: options.deviceId ?? "local",
    itemIds: [],
    stats: {
      folders: 0,
      bookmarks: 0,
      duplicates: 0,
      skipped: 0
    },
    browserProfile: profile.profile,
    browserProfileName: profile.name
  };
  const seenUrls = new Map();

  for (const rootKey of ROOT_ORDER) {
    const root = bookmarksFile.roots?.[rootKey];

    if (!root || !Array.isArray(root.children) || root.children.length === 0) {
      continue;
    }

    const folder = addFolder(library, library.rootId, {
      title: root.name || ROOT_FALLBACK_NAMES[rootKey],
      createdAt: chromeTimestampToIso(root.date_added, now),
      updatedAt: chromeTimestampToIso(root.date_modified, now),
      source: createBrowserImportSource(batchId, profile, rootKey, []),
      rawMeta: { rootKey, guid: root.guid, id: root.id }
    }, idFactory);

    importBatch.itemIds.push(folder.id);
    importBatch.stats.folders += 1;

    for (const child of root.children) {
      convertChromeNodeToLibrary(library, child, folder.id, {
        batchId,
        profile,
        rootKey,
        path: [folder.title],
        idFactory,
        importBatch,
        seenUrls,
        fallbackNow: now
      });
    }
  }

  library.imports.push(importBatch);

  return {
    library,
    importBatch,
    browser,
    browserName: config.name,
    profile: profile.profile,
    profileName: profile.name,
    bookmarksPath: profile.bookmarksPath,
    verifyUrl: config.verifyUrl
  };
}

export async function listBrowserBackups(options = {}) {
  const browser = normalizeBrowserKey(options.browser);

  if (!options.profile) {
    throw new Error(`Usage: markbridge browser backups --browser ${browser} --profile <profile>`);
  }

  const profiles = await listBrowserProfiles({
    browser,
    browserRoot: options.browserRoot,
    env: options.env
  });
  const profile = requireBrowserProfile(profiles, browser, options);
  const entries = await readdirIfExists(profile.profilePath);
  const backups = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("Bookmarks.markbridge-backup-")) {
      continue;
    }

    const path = join(profile.profilePath, entry.name);
    const info = await stat(path);

    backups.push({
      browser,
      browserName: SUPPORTED_BROWSERS[browser].name,
      profile: profile.profile,
      profileName: profile.name,
      path,
      size: info.size,
      modifiedAt: info.mtime.toISOString()
    });
  }

  return backups.sort((a, b) => a.path.localeCompare(b.path));
}

export async function restoreBrowserBackup(options = {}) {
  const browser = normalizeBrowserKey(options.browser);
  const config = SUPPORTED_BROWSERS[browser];
  const backupPath = options.backupPath;

  if (!options.profile || !backupPath) {
    throw new Error(`Usage: markbridge browser restore --browser ${browser} --profile <profile> --backup <path>`);
  }

  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  const browserWasRunning = !options.skipRunningCheck && await checkBrowserRunning(browser, options);

  if (browserWasRunning) {
    if (!options.quitBrowser) {
      throw new Error(formatBrowserRunningError(config.name, "browser restore", options.retryHint));
    }

    await quitBrowser(browser, options);

    if (!await waitForBrowserExit(browser, options)) {
      throw new Error(`${config.name} did not exit within ${options.quitTimeoutMs ?? 10000}ms. Close it manually, then run browser restore again.`);
    }
  }

  const profiles = await listBrowserProfiles({
    browser,
    browserRoot: options.browserRoot,
    env: options.env
  });
  const profile = requireBrowserProfile(profiles, browser, options);
  const safetyBackupPath = createBackupPath(profile.bookmarksPath, options.now);

  await copyFile(profile.bookmarksPath, safetyBackupPath);
  await copyFile(backupPath, profile.bookmarksPath);

  const result = {
    browser,
    browserName: config.name,
    profile: profile.profile,
    profileName: profile.name,
    bookmarksPath: profile.bookmarksPath,
    restoredFrom: backupPath,
    safetyBackupPath,
    verifyUrl: config.verifyUrl,
    browserWasRunning,
    quitBrowser: browserWasRunning && Boolean(options.quitBrowser),
    reopened: false
  };

  if (options.reopen) {
    await reopenBrowser(browser, options);
    result.reopened = true;
  }

  return result;
}

export async function isBrowserRunning(browser) {
  const key = normalizeBrowserKey(browser);
  const processName = SUPPORTED_BROWSERS[key].processName;

  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "comm="]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .some((command) => basename(command) === processName || command.endsWith(`/${processName}`));
  } catch {
    return false;
  }
}

export async function quitBrowser(browser, options = {}) {
  const key = normalizeBrowserKey(browser);
  const config = SUPPORTED_BROWSERS[key];

  if (options.quitBrowserAction) {
    await options.quitBrowserAction(config);
    return;
  }

  await execFileAsync("osascript", ["-e", `quit app "${escapeAppleScriptString(config.name)}"`]);
}

export async function reopenBrowser(browser, options = {}) {
  const key = normalizeBrowserKey(browser);
  const config = SUPPORTED_BROWSERS[key];
  const url = options.reopenUrl ?? config.verifyUrl;

  if (options.reopenBrowserAction) {
    await options.reopenBrowserAction(config, url);
    return;
  }

  await execFileAsync("open", ["-a", config.name, url]);
}

export async function waitForBrowserExit(browser, options = {}) {
  const timeoutMs = options.quitTimeoutMs ?? 10000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (!await checkBrowserRunning(browser, options)) {
      return true;
    }

    await delay(pollIntervalMs);
  }

  return false;
}

async function checkBrowserRunning(browser, options) {
  if (options.isBrowserRunning) {
    return Boolean(await options.isBrowserRunning(browser));
  }

  return isBrowserRunning(browser);
}

function buildBrowserFolderFromLibrary(library, options) {
  const children = [];
  const stats = {
    pushed: 0
  };

  for (const item of getChildren(library, library.rootId)) {
    const converted = convertLibraryItem(item, library, options);

    if (converted) {
      children.push(converted.node);
      stats.pushed += converted.count;
    }
  }

  return {
    folder: createChromeFolderNode(options.folderTitle, children, {
      idFactory: options.idFactory,
      createdAt: options.now,
      updatedAt: options.now
    }),
    stats
  };
}

function convertLibraryItem(item, library, options) {
  if (!item || item.deletedAt) {
    return null;
  }

  if (isBookmark(item)) {
    return {
      node: {
        date_added: toChromeTimestamp(item.createdAt),
        guid: randomUUID(),
        id: options.idFactory(),
        name: item.title,
        type: "url",
        url: item.url
      },
      count: 1
    };
  }

  if (isFolder(item)) {
    const children = [];
    let count = 0;

    for (const child of getChildren(library, item.id)) {
      const converted = convertLibraryItem(child, library, options);

      if (converted) {
        children.push(converted.node);
        count += converted.count;
      }
    }

    if (children.length === 0) {
      return null;
    }

    return {
      node: createChromeFolderNode(item.title, children, {
        idFactory: options.idFactory,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }),
      count
    };
  }

  return null;
}

function convertChromeNodeToLibrary(library, node, parentId, context) {
  if (!node || typeof node !== "object") {
    context.importBatch.stats.skipped += 1;
    return;
  }

  if (node.type === "folder") {
    const folder = addFolder(library, parentId, {
      title: node.name ?? "",
      createdAt: chromeTimestampToIso(node.date_added, context.fallbackNow),
      updatedAt: chromeTimestampToIso(node.date_modified, context.fallbackNow),
      source: createBrowserImportSource(context.batchId, context.profile, context.rootKey, context.path),
      rawMeta: { guid: node.guid, id: node.id }
    }, context.idFactory);

    context.importBatch.itemIds.push(folder.id);
    context.importBatch.stats.folders += 1;

    for (const child of node.children ?? []) {
      convertChromeNodeToLibrary(library, child, folder.id, {
        ...context,
        path: [...context.path, folder.title]
      });
    }

    return;
  }

  if (node.type === "url" && node.url) {
    const normalizedUrl = normalizeUrl(node.url);
    const duplicateOf = context.seenUrls.get(normalizedUrl);
    const rawMeta = { guid: node.guid, id: node.id };

    if (duplicateOf) {
      context.importBatch.stats.duplicates += 1;
      rawMeta.duplicateOf = duplicateOf;
    } else {
      context.seenUrls.set(normalizedUrl, null);
    }

    const bookmark = addBookmark(library, parentId, {
      title: node.name ?? "",
      url: node.url,
      normalizedUrl,
      createdAt: chromeTimestampToIso(node.date_added, context.fallbackNow),
      updatedAt: chromeTimestampToIso(node.date_last_used ?? node.date_added, context.fallbackNow),
      source: createBrowserImportSource(context.batchId, context.profile, context.rootKey, context.path),
      rawMeta
    }, context.idFactory);

    if (!duplicateOf) {
      context.seenUrls.set(normalizedUrl, bookmark.id);
    }

    context.importBatch.itemIds.push(bookmark.id);
    context.importBatch.stats.bookmarks += 1;
    return;
  }

  context.importBatch.stats.skipped += 1;
}

function createBrowserImportSource(batchId, profile, rootKey, originalPath) {
  return {
    batchId,
    browserProfile: profile.profile,
    browserProfileName: profile.name,
    bookmarksPath: profile.bookmarksPath,
    rootKey,
    originalPath
  };
}

function createChromeFolderNode(name, children, options) {
  return {
    children,
    date_added: toChromeTimestamp(options.createdAt),
    date_modified: toChromeTimestamp(options.updatedAt),
    guid: randomUUID(),
    id: options.idFactory(),
    name,
    type: "folder"
  };
}

function createChromeIdFactory(bookmarksFile) {
  let max = 0;

  visitChromeNodes(bookmarksFile.roots, (node) => {
    const parsed = Number.parseInt(node?.id, 10);

    if (Number.isFinite(parsed) && parsed > max) {
      max = parsed;
    }
  });

  return () => String(++max);
}

function visitChromeNodes(value, visit) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (value.type) {
    visit(value);
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        visitChromeNodes(item, visit);
      }
    } else if (child && typeof child === "object") {
      visitChromeNodes(child, visit);
    }
  }
}

function replaceFolder(targetRoot, folder) {
  targetRoot.children = targetRoot.children.filter((child) => !(child.type === "folder" && child.name === folder.name));
  targetRoot.children.push(folder);
  targetRoot.date_modified = toChromeTimestamp();
}

function applyBrowserFolderToRoot(targetRoot, folder, options) {
  const mode = normalizeBrowserPushMode(options.mode);
  const existingFolders = targetRoot.children.filter((child) => child.type === "folder" && child.name === folder.name);
  const summary = {
    mode,
    targetFolder: folder.name,
    targetFolderExisted: existingFolders.length > 0,
    targetFolderCreated: false,
    replacedFolder: false,
    addedBookmarks: 0,
    addedFolders: 0,
    skippedDuplicates: 0,
    changed: false
  };

  if (mode === "replace-folder") {
    replaceFolder(targetRoot, folder);
    summary.replacedFolder = summary.targetFolderExisted;
    summary.targetFolderCreated = !summary.targetFolderExisted;
    summary.addedBookmarks = countChromeBookmarksUnder(folder);
    summary.addedFolders = countChromeFoldersUnder(folder, { includeSelf: true });
    summary.changed = true;
    return summary;
  }

  if (mode === "append") {
    targetRoot.children.push(folder);
    targetRoot.date_modified = toChromeTimestamp();
    summary.targetFolderCreated = true;
    summary.addedBookmarks = countChromeBookmarksUnder(folder);
    summary.addedFolders = countChromeFoldersUnder(folder, { includeSelf: true });
    summary.changed = true;
    return summary;
  }

  const targetFolder = existingFolders[0];

  if (!targetFolder) {
    targetRoot.children.push(folder);
    targetRoot.date_modified = toChromeTimestamp();
    summary.targetFolderCreated = true;
    summary.addedBookmarks = countChromeBookmarksUnder(folder);
    summary.addedFolders = countChromeFoldersUnder(folder, { includeSelf: true });
    summary.changed = true;
    return summary;
  }

  const existingUrls = collectChromeNormalizedUrls(targetFolder);
  const beforeBookmarks = summary.addedBookmarks;
  const beforeFolders = summary.addedFolders;

  mergeChromeFolder(targetFolder, folder, {
    existingUrls,
    summary
  });

  summary.changed = summary.addedBookmarks > beforeBookmarks || summary.addedFolders > beforeFolders;

  if (summary.changed) {
    targetFolder.date_modified = toChromeTimestamp();
    targetRoot.date_modified = toChromeTimestamp();
  }

  return summary;
}

function mergeChromeFolder(targetFolder, incomingFolder, context) {
  for (const child of incomingFolder.children ?? []) {
    if (child.type === "folder") {
      const matchingFolder = (targetFolder.children ?? []).find((candidate) => candidate.type === "folder" && candidate.name === child.name);

      if (matchingFolder) {
        const beforeBookmarks = context.summary.addedBookmarks;
        const beforeFolders = context.summary.addedFolders;

        mergeChromeFolder(matchingFolder, child, context);

        if (context.summary.addedBookmarks > beforeBookmarks || context.summary.addedFolders > beforeFolders) {
          matchingFolder.date_modified = toChromeTimestamp();
        }

        continue;
      }
    }

    const cloned = cloneChromeNodeForMerge(child, context);

    if (cloned) {
      targetFolder.children.push(cloned);
    }
  }
}

function cloneChromeNodeForMerge(node, context) {
  if (node.type === "url") {
    const normalizedUrl = normalizeUrl(node.url);

    if (context.existingUrls.has(normalizedUrl)) {
      context.summary.skippedDuplicates += 1;
      return null;
    }

    context.existingUrls.add(normalizedUrl);
    context.summary.addedBookmarks += 1;
    return node;
  }

  if (node.type === "folder") {
    const children = [];

    for (const child of node.children ?? []) {
      const cloned = cloneChromeNodeForMerge(child, context);

      if (cloned) {
        children.push(cloned);
      }
    }

    if (children.length === 0) {
      return null;
    }

    context.summary.addedFolders += 1;
    return {
      ...node,
      children
    };
  }

  return null;
}

function countChromeBookmarksUnder(node) {
  if (!node) {
    return 0;
  }

  if (node.type === "url") {
    return node.url ? 1 : 0;
  }

  return (node.children ?? []).reduce((total, child) => total + countChromeBookmarksUnder(child), 0);
}

function countChromeFoldersUnder(node, options = {}) {
  if (!node || node.type !== "folder") {
    return 0;
  }

  const self = options.includeSelf ? 1 : 0;
  return self + (node.children ?? []).reduce((total, child) => total + countChromeFoldersUnder(child, { includeSelf: true }), 0);
}

function collectChromeNormalizedUrls(node, urls = new Set()) {
  if (!node) {
    return urls;
  }

  if (node.type === "url" && node.url) {
    urls.add(normalizeUrl(node.url));
    return urls;
  }

  for (const child of node.children ?? []) {
    collectChromeNormalizedUrls(child, urls);
  }

  return urls;
}

function normalizeBrowserPushMode(mode) {
  const normalized = String(mode ?? DEFAULT_BROWSER_PUSH_MODE).toLowerCase();
  const aliased = normalized === "replace" ? "replace-folder" : normalized;

  if (!BROWSER_PUSH_MODES.has(aliased)) {
    throw new Error(`Unsupported browser import mode: ${mode}. Supported modes: ${Array.from(BROWSER_PUSH_MODES).join(", ")}`);
  }

  return aliased;
}

function toChromeTimestamp(value = new Date().toISOString()) {
  const timestamp = Date.parse(value);
  const millis = Number.isFinite(timestamp) ? timestamp : Date.now();
  return ((BigInt(Math.trunc(millis)) + CHROME_EPOCH_OFFSET_MS) * 1000n).toString();
}

function chromeTimestampToIso(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    const micros = BigInt(String(value));
    const millis = Number(micros / 1000n - CHROME_EPOCH_OFFSET_MS);
    const date = new Date(millis);

    if (Number.isNaN(date.getTime())) {
      return fallback;
    }

    return date.toISOString();
  } catch {
    return fallback;
  }
}

async function readBrowserBookmarksFile(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function writeJsonAtomic(path, value) {
  const tempPath = `${path}.markbridge-${process.pid}-${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function createBackupPath(path, now = new Date().toISOString()) {
  const stamp = now.replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  return `${path}.markbridge-backup-${stamp}-${randomUUID().slice(0, 8)}`;
}

function requireBrowserProfile(profiles, browser, options) {
  const config = SUPPORTED_BROWSERS[browser];
  const profile = selectBrowserProfile(profiles, options.profile);

  if (!profile) {
    const available = profiles.map((item) => `${item.profile}${item.name === item.profile ? "" : ` (${item.name})`}`).join(", ");
    throw new Error([
      `Browser profile not found: ${options.profile}`,
      available ? `Available ${config.name} profiles: ${available}` : `No ${config.name} profiles found.`,
      `User data dir: ${getBrowserUserDataDir(browser, options)}`
    ].join("\n"));
  }

  if (!profile.hasBookmarks) {
    throw new Error(`Bookmarks file not found for ${config.name} / ${profile.profile}: ${profile.bookmarksPath}`);
  }

  return profile;
}

async function readdirIfExists(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function looksLikeBrowserProfile(name, bookmarksPath, preferencesPath) {
  return existsSync(bookmarksPath)
    || existsSync(preferencesPath)
    || name === "Default"
    || /^Profile \d+$/u.test(name);
}

async function readProfileDisplayName(preferencesPath, fallback) {
  if (!existsSync(preferencesPath)) {
    return fallback;
  }

  try {
    const preferences = JSON.parse(await readFile(preferencesPath, "utf8"));
    return preferences.profile?.name || fallback;
  } catch {
    return fallback;
  }
}

function selectBrowserProfile(profiles, requested) {
  const normalized = String(requested);
  const matches = profiles.filter((profile) => profile.profile === normalized || profile.name === normalized);
  return matches.length === 1 ? matches[0] : null;
}

function compareProfiles(a, b) {
  if (a.browser !== b.browser) {
    return a.browser.localeCompare(b.browser);
  }

  if (a.profile === "Default") {
    return -1;
  }

  if (b.profile === "Default") {
    return 1;
  }

  return a.profile.localeCompare(b.profile, undefined, { numeric: true });
}

function escapeAppleScriptString(value) {
  return String(value).replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function formatBrowserRunningError(browserName, action, retryHint) {
  return [
    `${browserName} is running, so MarkBridge will not modify the browser Bookmarks file now.`,
    `Close ${browserName} first, then run ${action} again.`,
    retryHint ? `Suggested command:\n  ${retryHint}` : "Or re-run the command with --quit-browser --reopen."
  ].join("\n");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
