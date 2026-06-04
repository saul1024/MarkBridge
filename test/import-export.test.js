import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { addBookmark, addFolder, createEmptyLibrary, createIdFactory, exportBookmarksHtml, getChildren, importBookmarksHtml, listBookmarks, normalizeUrl } from "../src/index.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));
const FIXED_NOW = "2026-06-02T00:00:00.000Z";

test("imports Chrome-style bookmark HTML with hierarchy, Chinese titles, entities, and empty folders", () => {
  const { library, importBatch } = importBookmarksHtml(readFixture("chrome-bookmarks.html"), {
    now: FIXED_NOW,
    batchId: "batch-chrome",
    deviceId: "device-test",
    sourceFileName: "chrome-bookmarks.html"
  });

  assert.equal(importBatch.stats.folders, 3);
  assert.equal(importBatch.stats.bookmarks, 3);
  assert.equal(importBatch.stats.duplicates, 0);
  assert.equal(importBatch.sourceBrowser, "chrome");

  const rootChildren = getChildren(library, library.rootId);
  assert.deepEqual(rootChildren.map((item) => item.title), ["Bookmarks Bar"]);

  const bar = findByTitle(library, "Bookmarks Bar");
  assert.deepEqual(getChildren(library, bar.id).map((item) => item.title), ["Example Docs", "中文资料", "空文件夹"]);

  const chineseFolder = findByTitle(library, "中文资料");
  assert.deepEqual(getChildren(library, chineseFolder.id).map((item) => item.title), ["中文 & Entity", "Tom & Jerry <Dev>"]);

  const emptyFolder = findByTitle(library, "空文件夹");
  assert.deepEqual(getChildren(library, emptyFolder.id), []);

  const entityBookmark = findByTitle(library, "Tom & Jerry <Dev>");
  assert.equal(entityBookmark.url, "https://example.com/escaped?name=Tom&role=dev");
  assert.equal(entityBookmark.source.batchId, "batch-chrome");

  const faviconBookmark = findByTitle(library, "Example Docs");
  assert.deepEqual(faviconBookmark.favicon, {
    mode: "inline-data",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgo="
  });
});

test("imports Firefox-style bookmark HTML with missing dates without failing", () => {
  const { library, importBatch } = importBookmarksHtml(readFixture("firefox-bookmarks.html"), {
    now: FIXED_NOW,
    batchId: "batch-firefox"
  });

  assert.equal(importBatch.sourceBrowser, "firefox");
  assert.equal(importBatch.stats.folders, 1);
  assert.equal(importBatch.stats.bookmarks, 2);
  assert.equal(findByTitle(library, "MDN HTML").createdAt, FIXED_NOW);
  assert.equal(findByTitle(library, "No Dates").createdAt, FIXED_NOW);
});

test("imports Edge-style bookmark HTML", () => {
  const { library, importBatch } = importBookmarksHtml(readFixture("edge-bookmarks.html"), {
    now: FIXED_NOW,
    batchId: "batch-edge"
  });

  assert.equal(importBatch.sourceBrowser, "edge");
  assert.equal(importBatch.stats.folders, 1);
  assert.equal(importBatch.stats.bookmarks, 2);

  const favoritesBar = findByTitle(library, "Favorites Bar");
  assert.deepEqual(getChildren(library, favoritesBar.id).map((item) => item.title), ["Microsoft Edge Docs", ""]);
  assert.equal(findByUrl(library, "https://example.com/untitled").title, "");
});

test("normalizes URLs and counts duplicates while preserving query-sensitive variants", () => {
  const { library, importBatch } = importBookmarksHtml(readFixture("duplicates.html"), {
    now: FIXED_NOW,
    batchId: "batch-duplicates"
  });

  assert.equal(normalizeUrl("https://Example.com/path/#section"), "https://example.com/path");
  assert.equal(importBatch.stats.bookmarks, 3);
  assert.equal(importBatch.stats.duplicates, 1);

  const first = findByTitle(library, "First Copy");
  const second = findByTitle(library, "Second Copy");
  const query = findByTitle(library, "Query Is Different");

  assert.equal(first.normalizedUrl, "https://example.com/path");
  assert.equal(second.normalizedUrl, "https://example.com/path");
  assert.equal(second.rawMeta.duplicateOf, first.id);
  assert.equal(query.normalizedUrl, "https://example.com/path?keep=query");
});

test("demo fixture lists and exports all imported bookmarks", () => {
  const { library, importBatch } = importBookmarksHtml(readFixture("demo-bookmarks.html"), {
    now: FIXED_NOW,
    batchId: "batch-demo"
  });

  assert.equal(importBatch.stats.folders, 3);
  assert.equal(importBatch.stats.bookmarks, 5);

  assert.deepEqual(listBookmarks(library).map((row) => row.title), [
    "MarkBridge Public Docs",
    "Engineering Search",
    "Private Bank Portal",
    "Private Health Notes",
    "Temporary Article"
  ]);

  const exported = exportBookmarksHtml(library);
  assert.match(exported, /MarkBridge Public Docs/);
  assert.match(exported, /Engineering Search/);
  assert.match(exported, /Personal Vault/);
  assert.match(exported, /Private Bank Portal/);
  assert.match(exported, /Private Health Notes/);
  assert.match(exported, /Read Later/);
  assert.match(exported, /Temporary Article/);
});

test("exports Netscape bookmark HTML without MarkBridge internal fields", () => {
  const { library } = importBookmarksHtml(readFixture("private-filter.html"), {
    now: FIXED_NOW,
    batchId: "batch-private"
  });

  const exported = exportBookmarksHtml(library);

  assert.match(exported, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
  assert.match(exported, /<META HTTP-EQUIV="Content-Type" CONTENT="text\/html; charset=UTF-8">/);
  assert.match(exported, /<TITLE>Bookmarks<\/TITLE>/);
  assert.match(exported, /<H1>Bookmarks<\/H1>/);
  assert.match(exported, /Public Link/);
  assert.doesNotMatch(exported, /privacy/);
  assert.doesNotMatch(exported, /tagIds/);
  assert.doesNotMatch(exported, /description/);
  assert.match(exported, /https:\/\/public\.example\.com/);
  assert.match(exported, /Private Secret/);
  assert.match(exported, /https:\/\/secret\.example\.com\/private/);
  assert.match(exported, /Temporary Link/);
  assert.match(exported, /https:\/\/temporary\.example\.com/);
});

test("exports escaped titles and URLs and can import its own output", () => {
  const { library } = importBookmarksHtml(readFixture("chrome-bookmarks.html"), {
    now: FIXED_NOW,
    batchId: "batch-roundtrip"
  });

  const exported = exportBookmarksHtml(library, { includeEmptyFolders: true });

  assert.match(exported, /Tom &amp; Jerry &lt;Dev&gt;/);
  assert.match(exported, /name=Tom&amp;role=dev/);
  assert.match(exported, /空文件夹/);

  const roundTrip = importBookmarksHtml(exported, {
    now: FIXED_NOW,
    batchId: "batch-roundtrip-2"
  });

  assert.equal(roundTrip.importBatch.stats.bookmarks, 3);
  assert.ok(findByTitle(roundTrip.library, "Tom & Jerry <Dev>"));
  assert.ok(findByTitle(roundTrip.library, "空文件夹"));
});

test("omits empty folders by default and can export them explicitly", () => {
  const { library } = importBookmarksHtml(readFixture("chrome-bookmarks.html"), {
    now: FIXED_NOW,
    batchId: "batch-empty-folder"
  });

  assert.doesNotMatch(exportBookmarksHtml(library), /空文件夹/);
  assert.match(exportBookmarksHtml(library, { includeEmptyFolders: true }), /空文件夹/);
});

test("exports only the selected folder subtree", () => {
  const { library } = importBookmarksHtml(readFixture("chrome-bookmarks.html"), {
    now: FIXED_NOW,
    batchId: "batch-folder-export"
  });

  const exported = exportBookmarksHtml(library, { folder: "中文资料" });

  assert.match(exported, /中文资料/);
  assert.match(exported, /中文 &amp; Entity/);
  assert.match(exported, /Tom &amp; Jerry &lt;Dev&gt;/);
  assert.doesNotMatch(exported, /Bookmarks Bar/);
  assert.doesNotMatch(exported, /Example Docs/);
  assert.doesNotMatch(exported, /空文件夹/);
});

test("folder export requires an exact path when folder titles are ambiguous", () => {
  const idFactory = createIdFactory("folder-test");
  const library = createEmptyLibrary({ now: FIXED_NOW, idFactory });
  const bar = addFolder(library, library.rootId, { title: "Bookmarks Bar", now: FIXED_NOW }, idFactory);
  const other = addFolder(library, library.rootId, { title: "Other bookmarks", now: FIXED_NOW }, idFactory);
  const barBooks = addFolder(library, bar.id, { title: "Books", now: FIXED_NOW }, idFactory);
  const otherBooks = addFolder(library, other.id, { title: "Books", now: FIXED_NOW }, idFactory);

  addBookmark(library, barBooks.id, { title: "Bar Book", url: "https://bar.example.com/book", now: FIXED_NOW }, idFactory);
  addBookmark(library, otherBooks.id, { title: "Other Book", url: "https://other.example.com/book", now: FIXED_NOW }, idFactory);

  assert.throws(
    () => exportBookmarksHtml(library, { folder: "Books" }),
    /Folder selector is ambiguous/
  );

  const exported = exportBookmarksHtml(library, { folderPath: "Other bookmarks / Books" });

  assert.match(exported, /Books/);
  assert.match(exported, /Other Book/);
  assert.doesNotMatch(exported, /Bar Book/);
  assert.doesNotMatch(exported, /Other bookmarks/);
});

test("folder export error lists available folder paths", () => {
  const { library } = importBookmarksHtml(readFixture("chrome-bookmarks.html"), {
    now: FIXED_NOW,
    batchId: "batch-folder-missing"
  });

  assert.throws(
    () => exportBookmarksHtml(library, { folder: "Missing Folder" }),
    /Available folders:\n  Bookmarks Bar\n  Bookmarks Bar \/ 中文资料\n  Bookmarks Bar \/ 空文件夹/
  );
});

function readFixture(name) {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

function findByTitle(library, title) {
  const item = Object.values(library.items).find((candidate) => candidate.title === title);
  assert.ok(item, `Expected to find item titled ${title}`);
  return item;
}

function findByUrl(library, url) {
  const item = Object.values(library.items).find((candidate) => candidate.url === url);
  assert.ok(item, `Expected to find bookmark with URL ${url}`);
  return item;
}
