import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createDefaultRemoteKey, detectPullRemoteChange, detectPushConflict, getDefaultSyncConfigPath, getSyncRemoteStatus, loadSyncConfig, saveSyncConfig, syncPullCloudToBrowser, syncPushBrowserToCloud } from "../src/index.js";

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

test("saveSyncConfig persists lastRemoteEtag without COS secrets", async () => {
  const home = await mkdtemp(join(tmpdir(), "markbridge-sync-etag-"));
  const configPath = getDefaultSyncConfigPath({ MARKBRIDGE_HOME: home });

  try {
    await saveSyncConfig({
      browser: "chrome",
      profile: "Huu Quang",
      folder: "Books",
      mode: "merge",
      remoteKey: "bookmarks/chrome/Huu-Quang/Books.html",
      lastRemoteEtag: "\"etag-abc123\"",
      lastRemoteKey: "bookmarks/chrome/Huu-Quang/Books.html",
      COS_SECRET_ID: "AKIDEXAMPLE",
      COS_SECRET_KEY: "SECRETEXAMPLE"
    }, configPath);

    const loaded = await loadSyncConfig(configPath);
    const raw = await readFile(configPath, "utf8");

    assert.equal(loaded.lastRemoteEtag, "\"etag-abc123\"");
    assert.equal(loaded.lastRemoteKey, "bookmarks/chrome/Huu-Quang/Books.html");
    assert.equal(loaded.browser, "chrome");
    assert.doesNotMatch(raw, /COS_SECRET/);
    assert.doesNotMatch(raw, /SECRETEXAMPLE/);
    assert.doesNotMatch(raw, /AKIDEXAMPLE/);
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

test("detectPullRemoteChange classifies missing, new, unchanged, and changed remotes", () => {
  assert.deepEqual(detectPullRemoteChange({
    remote: { exists: false },
    expectedEtag: undefined
  }), {
    remoteExists: false,
    remoteEtag: null,
    expectedEtag: null,
    remoteChanged: false,
    remoteUnchanged: false,
    remoteStatus: "missing"
  });

  assert.deepEqual(detectPullRemoteChange({
    remote: { exists: true, etag: "\"abc\"" },
    expectedEtag: undefined
  }), {
    remoteExists: true,
    remoteEtag: "\"abc\"",
    expectedEtag: null,
    remoteChanged: true,
    remoteUnchanged: false,
    remoteStatus: "new-to-us"
  });

  assert.deepEqual(detectPullRemoteChange({
    remote: { exists: true, etag: "\"abc\"" },
    expectedEtag: "abc"
  }), {
    remoteExists: true,
    remoteEtag: "\"abc\"",
    expectedEtag: "abc",
    remoteChanged: false,
    remoteUnchanged: true,
    remoteStatus: "unchanged"
  });

  assert.deepEqual(detectPullRemoteChange({
    remote: { exists: true, etag: "\"new\"" },
    expectedEtag: "\"old\""
  }), {
    remoteExists: true,
    remoteEtag: "\"new\"",
    expectedEtag: "old",
    remoteChanged: true,
    remoteUnchanged: false,
    remoteStatus: "changed"
  });
});

test("syncPullCloudToBrowser reports new-to-us when no expectedEtag and still imports", async () => {
  const { browserRoot, bookmarksPath, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    uploaded.set("books.html", {
      body: Buffer.from(createBooksHtml(), "utf8"),
      contentType: "text/html; charset=utf-8",
      etag: "\"first-etag\""
    });

    const result = await syncPullCloudToBrowser({
      client,
      remoteKey: "books.html",
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "ImportedBooks",
      mode: "merge",
      skipRunningCheck: true
    });

    assert.equal(result.remoteExists, true);
    assert.equal(result.remoteEtag, "\"first-etag\"");
    assert.equal(result.expectedEtag, null);
    assert.equal(result.remoteChanged, true);
    assert.equal(result.remoteUnchanged, false);
    assert.equal(result.remoteStatus, "new-to-us");
    assert.equal(result.pushed, 2);
    assert.match(await readFile(bookmarksPath, "utf8"), /ImportedBooks/);
  } finally {
    await cleanup();
  }
});

test("syncPullCloudToBrowser reports unchanged when expectedEtag matches and still imports", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    uploaded.set("books.html", {
      body: Buffer.from(createBooksHtml(), "utf8"),
      contentType: "text/html; charset=utf-8",
      etag: "\"first-etag\""
    });

    const result = await syncPullCloudToBrowser({
      client,
      remoteKey: "books.html",
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "ImportedBooks",
      mode: "merge",
      expectedEtag: "first-etag",
      skipRunningCheck: true
    });

    assert.equal(result.remoteExists, true);
    assert.equal(result.remoteEtag, "\"first-etag\"");
    assert.equal(result.expectedEtag, "first-etag");
    assert.equal(result.remoteChanged, false);
    assert.equal(result.remoteUnchanged, true);
    assert.equal(result.remoteStatus, "unchanged");
    assert.equal(result.pushed, 2);
  } finally {
    await cleanup();
  }
});

test("syncPullCloudToBrowser reports changed after remote body and etag change", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    uploaded.set("books.html", {
      body: Buffer.from(createBooksHtml(), "utf8"),
      contentType: "text/html; charset=utf-8",
      etag: "\"first-etag\""
    });

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

    assert.equal(first.remoteStatus, "new-to-us");
    assert.equal(first.pushed, 2);

    uploaded.set("books.html", {
      body: Buffer.from(createBooksHtml().replace(
        '        <DT><A HREF="https://sqlite.org/docs.html">SQLite Notes</A>',
        '        <DT><A HREF="https://sqlite.org/docs.html">SQLite Notes</A>\n        <DT><A HREF="https://example.com/new">New Link</A>'
      ), "utf8"),
      contentType: "text/html; charset=utf-8",
      etag: "\"second-etag\""
    });

    const second = await syncPullCloudToBrowser({
      client,
      remoteKey: "books.html",
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "ImportedBooks",
      mode: "merge",
      expectedEtag: first.remoteEtag,
      skipRunningCheck: true
    });

    assert.equal(second.remoteExists, true);
    assert.equal(second.remoteEtag, "\"second-etag\"");
    assert.equal(second.expectedEtag, "first-etag");
    assert.equal(second.remoteChanged, true);
    assert.equal(second.remoteUnchanged, false);
    assert.equal(second.remoteStatus, "changed");
    assert.equal(second.imported.bookmarks, 3);
    assert.equal(second.pushed, 1);
  } finally {
    await cleanup();
  }
});

test("syncPullCloudToBrowser ignores expectedEtag when expectedRemoteKey differs", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    uploaded.set("books.html", {
      body: Buffer.from(createBooksHtml(), "utf8"),
      contentType: "text/html; charset=utf-8",
      etag: "\"first-etag\""
    });

    const result = await syncPullCloudToBrowser({
      client,
      remoteKey: "books.html",
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "ImportedBooks",
      mode: "merge",
      expectedEtag: "first-etag",
      expectedRemoteKey: "other-key.html",
      skipRunningCheck: true
    });

    assert.equal(result.expectedEtag, null);
    assert.equal(result.remoteChanged, true);
    assert.equal(result.remoteStatus, "new-to-us");
    assert.equal(result.pushed, 2);
  } finally {
    await cleanup();
  }
});

test("detectPushConflict allows first upload, matching etag, and force", () => {
  assert.deepEqual(detectPushConflict({
    remote: { exists: false },
    expectedEtag: undefined,
    force: false
  }), {
    remoteExists: false,
    remoteEtag: null,
    expectedEtag: null,
    conflict: false,
    conflictReason: null,
    force: false
  });

  assert.equal(detectPushConflict({
    remote: { exists: true, etag: "\"abc\"" },
    expectedEtag: "abc",
    force: false
  }).conflict, false);

  assert.equal(detectPushConflict({
    remote: { exists: true, etag: "\"abc\"" },
    expectedEtag: "\"ABC\"",
    force: false
  }).conflict, true);

  assert.deepEqual(detectPushConflict({
    remote: { exists: true, etag: "\"remote\"" },
    expectedEtag: undefined,
    force: false
  }).conflictReason, "missing-expected-etag");

  assert.deepEqual(detectPushConflict({
    remote: { exists: true, etag: "\"new\"" },
    expectedEtag: "old",
    force: false
  }).conflictReason, "etag-mismatch");

  assert.equal(detectPushConflict({
    remote: { exists: true, etag: "\"new\"" },
    expectedEtag: "old",
    force: true
  }).conflict, false);
});

test("syncPushBrowserToCloud first push uploads when remote is missing", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    const result = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html"
    });

    assert.equal(result.uploaded, true);
    assert.equal(result.conflict, false);
    assert.equal(result.remoteExists, false);
    assert.equal(result.remoteKey, "books.html");
    assert.equal(uploaded.has("books.html"), true);
    assert.ok(result.etag);
  } finally {
    await cleanup();
  }
});

test("syncPushBrowserToCloud second push with matching expectedEtag uploads", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    const first = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html"
    });
    const firstBody = Buffer.from(uploaded.get("books.html").body);
    const second = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html",
      expectedEtag: first.etag.replaceAll("\"", "")
    });

    assert.equal(second.uploaded, true);
    assert.equal(second.conflict, false);
    assert.equal(second.remoteExists, true);
    assert.ok(uploaded.get("books.html").body.equals(firstBody) || uploaded.has("books.html"));
  } finally {
    await cleanup();
  }
});

test("syncPushBrowserToCloud throws SYNC_CONFLICT when remote exists without expectedEtag", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html"
    });
    const before = Buffer.from(uploaded.get("books.html").body);
    const beforeEtag = uploaded.get("books.html").etag;

    await assert.rejects(
      () => syncPushBrowserToCloud({
        client,
        browser: "chrome",
        profile: "Default",
        browserRoot,
        folder: "Books",
        remoteKey: "books.html"
      }),
      (error) => {
        assert.equal(error.code, "SYNC_CONFLICT");
        assert.equal(error.remoteKey, "books.html");
        assert.match(error.message, /Use --force to overwrite/);
        return true;
      }
    );

    assert.equal(uploaded.get("books.html").etag, beforeEtag);
    assert.ok(uploaded.get("books.html").body.equals(before));
  } finally {
    await cleanup();
  }
});

test("syncPushBrowserToCloud throws SYNC_CONFLICT when remote etag differs", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    const first = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html"
    });
    const before = Buffer.from(uploaded.get("books.html").body);
    uploaded.get("books.html").body = Buffer.from("changed-by-another-writer");
    uploaded.get("books.html").etag = "\"other-writer\"";

    await assert.rejects(
      () => syncPushBrowserToCloud({
        client,
        browser: "chrome",
        profile: "Default",
        browserRoot,
        folder: "Books",
        remoteKey: "books.html",
        expectedEtag: first.etag
      }),
      (error) => {
        assert.equal(error.code, "SYNC_CONFLICT");
        assert.equal(error.remoteEtag, "\"other-writer\"");
        assert.equal(error.expectedEtag, first.etag);
        return true;
      }
    );

    assert.equal(uploaded.get("books.html").body.toString("utf8"), "changed-by-another-writer");
    assert.ok(before.length > 0);
  } finally {
    await cleanup();
  }
});

test("syncPushBrowserToCloud force overwrites even on etag mismatch", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    const first = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html"
    });
    uploaded.get("books.html").etag = "\"other-writer\"";

    const forced = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html",
      expectedEtag: first.etag,
      force: true
    });

    assert.equal(forced.uploaded, true);
    assert.equal(forced.conflict, false);
    assert.equal(forced.force, true);
    assert.notEqual(uploaded.get("books.html").etag, "\"other-writer\"");
    assert.match(uploaded.get("books.html").body.toString("utf8"), /Node Handbook/);
  } finally {
    await cleanup();
  }
});

test("syncPushBrowserToCloud dryRun conflict returns fields and leaves object unchanged", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html"
    });
    const before = Buffer.from(uploaded.get("books.html").body);
    const beforeEtag = uploaded.get("books.html").etag;

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
    assert.equal(preview.conflict, true);
    assert.equal(preview.uploaded, false);
    assert.equal(preview.remoteExists, true);
    assert.equal(preview.conflictReason, "missing-expected-etag");
    assert.equal(uploaded.get("books.html").etag, beforeEtag);
    assert.ok(uploaded.get("books.html").body.equals(before));
  } finally {
    await cleanup();
  }
});

test("syncPushBrowserToCloud ignores expectedEtag when expectedRemoteKey differs", async () => {
  const { browserRoot, cleanup } = await createTestChromeProfile();
  const uploaded = new Map();
  const client = createMemoryCosClient(uploaded);

  try {
    const first = await syncPushBrowserToCloud({
      client,
      browser: "chrome",
      profile: "Default",
      browserRoot,
      folder: "Books",
      remoteKey: "books.html"
    });

    await assert.rejects(
      () => syncPushBrowserToCloud({
        client,
        browser: "chrome",
        profile: "Default",
        browserRoot,
        folder: "Books",
        remoteKey: "books.html",
        expectedEtag: first.etag,
        expectedRemoteKey: "other-key.html"
      }),
      (error) => error.code === "SYNC_CONFLICT"
    );
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
      const payload = Buffer.from(body);
      const etag = options.etag ?? `"etag-${createHash("sha1").update(payload).digest("hex")}"`;

      objects.set(key, {
        body: payload,
        contentType: options.contentType,
        etag,
        lastModified: options.lastModified ?? "Thu, 04 Jun 2026 00:00:00 GMT"
      });

      return {
        statusCode: 200,
        headers: {
          etag
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
