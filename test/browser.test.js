import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { importBookmarksHtml, previewLibraryToBrowser, pushLibraryToBrowser, restoreBrowserBackup } from "../src/index.js";

const DEMO_FIXTURE_PATH = resolve("fixtures/demo-bookmarks.html");

test("pushLibraryToBrowser refuses to write while browser is running unless quitBrowser is enabled", async () => {
  const { home, browserRoot, cleanup } = await createTestProfile();

  try {
    const library = await createDemoLibrary();

    await assert.rejects(
      () => pushLibraryToBrowser(library, {
        browser: "chrome",
        profile: "Default",
        browserRoot,
        env: { MARKBRIDGE_HOME: home },
        isBrowserRunning: () => true,
        retryHint: "markbridge push-browser --browser chrome --profile Default --quit-browser --reopen"
      }),
      /will not modify the browser Bookmarks file[\s\S]*Suggested command:[\s\S]*markbridge push-browser/
    );
  } finally {
    await cleanup();
  }
});

test("pushLibraryToBrowser can quit a running browser, push bookmarks, and reopen verification URL", async () => {
  const { home, browserRoot, bookmarksPath, cleanup } = await createTestProfile();
  const library = await createDemoLibrary();
  const actions = [];
  let runningChecks = 0;

  try {
    const result = await pushLibraryToBrowser(library, {
      browser: "chrome",
      profile: "Default",
      browserRoot,
      env: { MARKBRIDGE_HOME: home },
      quitBrowser: true,
      reopen: true,
      pollIntervalMs: 1,
      quitTimeoutMs: 100,
      isBrowserRunning: () => runningChecks++ === 0,
      quitBrowserAction: (config) => actions.push(`quit:${config.name}`),
      reopenBrowserAction: (config, url) => actions.push(`reopen:${config.name}:${url}`)
    });

    assert.equal(result.browserWasRunning, true);
    assert.equal(result.quitBrowser, true);
    assert.equal(result.reopened, true);
    assert.equal(result.pushed, 5);
    assert.equal(existsSync(result.backupPath), true);
    assert.deepEqual(actions, [
      "quit:Google Chrome",
      "reopen:Google Chrome:chrome://bookmarks"
    ]);

    const browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
    const serialized = JSON.stringify(browserBookmarks);

    assert.match(serialized, /MarkBridge Public Docs/);
    assert.match(serialized, /Engineering Search/);
    assert.match(serialized, /Private Bank Portal/);
    assert.match(serialized, /Private Health Notes/);
    assert.match(serialized, /Temporary Article/);
  } finally {
    await cleanup();
  }
});

test("previewLibraryToBrowser reports merge duplicates without writing bookmarks", async () => {
  const { home, browserRoot, bookmarksPath, cleanup } = await createTestProfile();
  const library = await createDemoLibrary();

  try {
    await pushLibraryToBrowser(library, {
      browser: "chrome",
      profile: "Default",
      browserRoot,
      env: { MARKBRIDGE_HOME: home },
      skipRunningCheck: true
    });

    const before = await readFile(bookmarksPath, "utf8");
    const preview = await previewLibraryToBrowser(library, {
      browser: "chrome",
      profile: "Default",
      browserRoot,
      env: { MARKBRIDGE_HOME: home },
      mode: "merge"
    });
    const after = await readFile(bookmarksPath, "utf8");

    assert.equal(preview.mode, "merge");
    assert.equal(preview.summary.targetFolderExisted, true);
    assert.equal(preview.summary.addedBookmarks, 0);
    assert.equal(preview.summary.skippedDuplicates, 5);
    assert.equal(preview.summary.changed, false);
    assert.equal(after, before);
  } finally {
    await cleanup();
  }
});

test("pushLibraryToBrowser merge mode does not duplicate repeated imports", async () => {
  const { home, browserRoot, bookmarksPath, cleanup } = await createTestProfile();
  const library = await createDemoLibrary();

  try {
    await pushLibraryToBrowser(library, {
      browser: "chrome",
      profile: "Default",
      browserRoot,
      env: { MARKBRIDGE_HOME: home },
      skipRunningCheck: true,
      mode: "merge"
    });

    const second = await pushLibraryToBrowser(library, {
      browser: "chrome",
      profile: "Default",
      browserRoot,
      env: { MARKBRIDGE_HOME: home },
      skipRunningCheck: true,
      mode: "merge"
    });

    assert.equal(second.pushed, 0);
    assert.equal(second.backupPath, null);
    assert.equal(second.summary.skippedDuplicates, 5);

    const browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));

    assert.equal(countUrlOccurrences(browserBookmarks, "https://docs.example.com/markbridge"), 1);
    assert.equal(countUrlOccurrences(browserBookmarks, "https://developer.mozilla.org/en-US/search?q=bookmarks"), 1);
    assert.equal(countDirectFolders(browserBookmarks, "MarkBridge"), 1);
  } finally {
    await cleanup();
  }
});

test("restoreBrowserBackup refuses to restore while browser is running unless quitBrowser is enabled", async () => {
  const { home, browserRoot, profileDir, cleanup } = await createTestProfile();
  const backupPath = join(profileDir, "Bookmarks.markbridge-backup-test");

  try {
    await writeFile(backupPath, JSON.stringify(createChromeBookmarksFile(), null, 2), "utf8");

    await assert.rejects(
      () => restoreBrowserBackup({
        browser: "chrome",
        profile: "Default",
        browserRoot,
        backupPath,
        env: { MARKBRIDGE_HOME: home },
        isBrowserRunning: () => true,
        retryHint: "markbridge browser restore --browser chrome --profile Default --backup backup --quit-browser --reopen"
      }),
      /will not modify the browser Bookmarks file[\s\S]*Suggested command:[\s\S]*markbridge browser restore/
    );
  } finally {
    await cleanup();
  }
});

test("restoreBrowserBackup can quit a running browser, restore backup, and reopen", async () => {
  const { home, browserRoot, profileDir, bookmarksPath, cleanup } = await createTestProfile();
  const backupPath = join(profileDir, "Bookmarks.markbridge-backup-test");
  const actions = [];
  let runningChecks = 0;

  try {
    const backup = createChromeBookmarksFile();
    backup.roots.bookmark_bar.children[0].name = "Restored Bookmark";
    await writeFile(backupPath, JSON.stringify(backup, null, 2), "utf8");

    const result = await restoreBrowserBackup({
      browser: "chrome",
      profile: "Default",
      browserRoot,
      backupPath,
      env: { MARKBRIDGE_HOME: home },
      quitBrowser: true,
      reopen: true,
      pollIntervalMs: 1,
      quitTimeoutMs: 100,
      isBrowserRunning: () => runningChecks++ === 0,
      quitBrowserAction: (config) => actions.push(`quit:${config.name}`),
      reopenBrowserAction: (config, url) => actions.push(`reopen:${config.name}:${url}`)
    });

    assert.equal(result.quitBrowser, true);
    assert.equal(result.reopened, true);
    assert.equal(existsSync(result.safetyBackupPath), true);
    assert.deepEqual(actions, [
      "quit:Google Chrome",
      "reopen:Google Chrome:chrome://bookmarks"
    ]);

    const restored = await readFile(bookmarksPath, "utf8");
    assert.match(restored, /Restored Bookmark/);
  } finally {
    await cleanup();
  }
});

async function createDemoLibrary() {
  const html = await readFile(DEMO_FIXTURE_PATH, "utf8");
  const { library } = importBookmarksHtml(html);

  return library;
}

async function createTestProfile() {
  const home = await mkdtemp(join(tmpdir(), "markbridge-browser-test-"));
  const browserRoot = join(home, "Chrome");
  const profileDir = join(browserRoot, "Default");
  const bookmarksPath = join(profileDir, "Bookmarks");

  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "Preferences"), JSON.stringify({ profile: { name: "Test Person" } }), "utf8");
  await writeFile(bookmarksPath, JSON.stringify(createChromeBookmarksFile(), null, 2), "utf8");

  return {
    home,
    browserRoot,
    profileDir,
    bookmarksPath,
    cleanup: () => rm(home, { recursive: true, force: true })
  };
}

function createChromeBookmarksFile() {
  return {
    checksum: "old-checksum",
    roots: {
      bookmark_bar: {
        children: [
          {
            date_added: "13370000000000000",
            guid: "11111111-1111-4111-8111-111111111111",
            id: "10",
            name: "Existing Bookmark",
            type: "url",
            url: "https://existing.example.com"
          }
        ],
        date_added: "13370000000000000",
        date_modified: "13370000000000000",
        guid: "22222222-2222-4222-8222-222222222222",
        id: "1",
        name: "Bookmarks bar",
        type: "folder"
      },
      other: {
        children: [],
        date_added: "13370000000000000",
        date_modified: "0",
        guid: "33333333-3333-4333-8333-333333333333",
        id: "2",
        name: "Other bookmarks",
        type: "folder"
      },
      synced: {
        children: [],
        date_added: "13370000000000000",
        date_modified: "0",
        guid: "44444444-4444-4444-8444-444444444444",
        id: "3",
        name: "Mobile bookmarks",
        type: "folder"
      }
    },
    version: 1
  };
}

function countUrlOccurrences(value, url) {
  let count = 0;

  visitChromeNodes(value, (node) => {
    if (node.type === "url" && node.url === url) {
      count += 1;
    }
  });

  return count;
}

function countDirectFolders(bookmarksFile, name) {
  return bookmarksFile.roots.bookmark_bar.children
    .filter((node) => node.type === "folder" && node.name === name)
    .length;
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
