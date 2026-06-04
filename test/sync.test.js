import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createDefaultRemoteKey, getDefaultSyncConfigPath, getSyncRemoteStatus, loadSyncConfig, saveSyncConfig, syncPullCloudToBrowser, syncPushBrowserToCloud } from "../src/index.js";

test("createDefaultRemoteKey creates stable readable object keys", () => {
  assert.equal(
    createDefaultRemoteKey({
      browser: "chrome",
      profileName: "Huu Quang",
      folder: "书签栏 / Books"
    }),
    "bookmarks/chrome/Huu-Quang/Books.html"
  );

  assert.equal(
    createDefaultRemoteKey({
      browser: "edge",
      profile: "Profile 1",
      folder: "Work Tools"
    }),
    "bookmarks/edge/Profile-1/Work-Tools.html"
  );
});

test("sync config persists browser defaults without COS secrets", async () => {
  const home = await mkdtemp(join(tmpdir(), "markbridge-sync-config-"));
  const configPath = getDefaultSyncConfigPath({ MARKBRIDGE_HOME: home });

  try {
    await saveSyncConfig({
      browser: "chrome",
      profile: "Huu Quang",
      folder: "Books",
      mode: "merge",
      remoteKey: "bookmarks/chrome/Huu-Quang/Books.html"
    }, configPath, { now: "2026-06-04T00:00:00.000Z" });

    const loaded = await loadSyncConfig(configPath);
    const raw = await readFile(configPath, "utf8");

    assert.deepEqual(loaded, {
      browser: "chrome",
      profile: "Huu Quang",
      folder: "Books",
      mode: "merge",
      remoteKey: "bookmarks/chrome/Huu-Quang/Books.html"
    });
    assert.match(raw, /"format": "markbridge-sync-config"/);
    assert.doesNotMatch(raw, /COS_SECRET/);
    assert.doesNotMatch(raw, /SECRETEXAMPLE/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("getSyncRemoteStatus reports existing and missing COS objects", async () => {
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  uploaded.set("books.html", {
    body: Buffer.from("hello"),
    contentType: "text/html; charset=utf-8",
    lastModified: "Thu, 04 Jun 2026 00:00:00 GMT",
    etag: "\"memory-etag\""
  });

  const found = await getSyncRemoteStatus({
    client,
    remoteKey: "books.html"
  });
  const missing = await getSyncRemoteStatus({
    client,
    remoteKey: "missing.html"
  });

  assert.deepEqual(found, {
    remoteKey: "books.html",
    exists: true,
    size: 5,
    lastModified: "Thu, 04 Jun 2026 00:00:00 GMT",
    etag: "\"memory-etag\"",
    statusCode: 200
  });
  assert.deepEqual(missing, {
    remoteKey: "missing.html",
    exists: false
  });
});

test("syncPushBrowserToCloud exports a selected browser folder and uploads HTML", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    const preview = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html",
      dryRun: true
    });

    assert.equal(preview.dryRun, true);
    assert.equal(preview.uploaded, false);
    assert.equal(preview.exportedBookmarks, 2);
    assert.equal(preview.folder.path, "Bookmarks Bar / Books");
    assert.equal(uploaded.size, 0);

    const result = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
    });

    assert.equal(result.uploaded, true);
    assert.equal(result.remoteKey, "bookmarks/chrome/Sync-User/Bookmarks-Bar-Books.html");
    assert.equal(result.exportedBookmarks, 2);
    assert.equal(uploaded.get("bookmarks/chrome/Sync-User/Bookmarks-Bar-Books.html").contentType, "text/html; charset=utf-8");

    const html = uploaded.get("bookmarks/chrome/Sync-User/Bookmarks-Bar-Books.html").body.toString("utf8");

    assert.match(html, /Books/);
    assert.match(html, /Node Handbook/);
    assert.match(html, /SQLite Notes/);
    assert.doesNotMatch(html, /Outside Link/);
    assert.doesNotMatch(html, /Bookmarks Bar/);
  } finally {
    await cleanup();
  }
});

test("syncPullCloudToBrowser previews and merges COS HTML without duplicate browser bookmarks", async () => {
  const { browserRoot, bookmarksPath, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    uploaded.set("books.html", {
      body: Buffer.from(createBooksHtml(), "utf8"),
      contentType: "text/html; charset=utf-8"
    });

    const preview = await syncPullCloudToBrowser({
      client,
      remoteKey: "books.html",
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "ImportedBooks",
      mode: "merge",
      dryRun: true
    });

    assert.equal(preview.dryRun, true);
    assert.equal(preview.size, uploaded.get("books.html").body.length);
    assert.equal(preview.imported.bookmarks, 2);
    assert.equal(preview.summary.addedBookmarks, 2);
    assert.equal(preview.summary.skippedDuplicates, 0);
    assert.doesNotMatch(await readFile(bookmarksPath, "utf8"), /ImportedBooks/);

    const first = await syncPullCloudToBrowser({
      client,
      remoteKey: "books.html",
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "ImportedBooks",
      mode: "merge",
      skipRunningCheck: true
    });

    assert.equal(first.dryRun, false);
    assert.equal(first.pushed, 2);
    assert.equal(existsSync(first.backupPath), true);

    const second = await syncPullCloudToBrowser({
      client,
      remoteKey: "books.html",
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "ImportedBooks",
      mode: "merge",
      skipRunningCheck: true
    });

    assert.equal(second.pushed, 0);
    assert.equal(second.summary.skippedDuplicates, 2);
    assert.equal(second.backupPath, null);

    const bookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
    const importedFolder = bookmarks.roots.bookmark_bar.children.find((item) => item.name === "ImportedBooks");

    assert.ok(importedFolder);
    assert.equal(countUrlOccurrences(importedFolder, "https://nodejs.org/docs"), 1);
    assert.equal(countUrlOccurrences(importedFolder, "https://sqlite.org/docs.html"), 1);
  } finally {
    await cleanup();
  }
});

function createMemoryCosClient(objects) {
  return {
    async headObject(key) {
      const object = objects.get(key);

      if (!object) {
        const error = new Error(`Missing memory COS object: ${key}`);
        error.statusCode = 404;
        throw error;
      }

      return {
        statusCode: 200,
        headers: {
          "content-length": String(object.body.length),
          "last-modified": object.lastModified,
          etag: object.etag ?? "\"memory-etag\""
        }
      };
    },

    async putObject(key, body, options = {}) {
      objects.set(key, {
        body: Buffer.from(body),
        contentType: options.contentType,
        etag: "\"memory-etag\""
      });

      return {
        statusCode: 200,
        headers: {
          etag: "\"memory-etag\""
        }
      };
    },

    async getObject(key) {
      const object = objects.get(key);

      if (!object) {
        throw new Error(`Missing memory COS object: ${key}`);
      }

      return object.body;
    }
  };
}

async function createTestChromeProfile() {
  const home = await mkdtemp(join(tmpdir(), "markbridge-sync-test-"));
  const browserRoot = join(home, "Chrome");
  const profileDir = join(browserRoot, "Default");
  const bookmarksPath = join(profileDir, "Bookmarks");

  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "Preferences"), JSON.stringify({ profile: { name: "Sync User" } }), "utf8");
  await writeFile(bookmarksPath, JSON.stringify(createChromeBookmarksFile(), null, 2), "utf8");

  return {
    browserRoot,
    bookmarksPath,
    cleanup: () => rm(home, { recursive: true, force: true })
  };
}

function createChromeBookmarksFile() {
  return {
    checksum: "old",
    roots: {
      bookmark_bar: {
        children: [
          {
            children: [
              {
                date_added: "13370000000000000",
                guid: "66666666-6666-4666-8666-666666666666",
                id: "11",
                name: "Node Handbook",
                type: "url",
                url: "https://nodejs.org/docs"
              },
              {
                date_added: "13370000000000000",
                guid: "77777777-7777-4777-8777-777777777777",
                id: "12",
                name: "SQLite Notes",
                type: "url",
                url: "https://sqlite.org/docs.html"
              }
            ],
            date_added: "13370000000000000",
            date_modified: "13370000000000000",
            guid: "55555555-5555-4555-8555-555555555555",
            id: "10",
            name: "Books",
            type: "folder"
          },
          {
            date_added: "13370000000000000",
            guid: "88888888-8888-4888-8888-888888888888",
            id: "13",
            name: "Outside Link",
            type: "url",
            url: "https://outside.example.com"
          }
        ],
        date_added: "13370000000000000",
        date_modified: "13370000000000000",
        guid: "22222222-2222-4222-8222-222222222222",
        id: "1",
        name: "Bookmarks Bar",
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

function createBooksHtml() {
  return [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
    "    <DT><H3>Books</H3>",
    "    <DL><p>",
    '        <DT><A HREF="https://nodejs.org/docs">Node Handbook</A>',
    '        <DT><A HREF="https://sqlite.org/docs.html">SQLite Notes</A>',
    "    </DL><p>",
    "</DL><p>"
  ].join("\n");
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
