import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { addBookmark, addFolder, createEmptyLibrary, createIdFactory } from "../src/model.js";
import {
  isInteractive,
  pickFromList,
  resolveBrowserProfileFolder,
  resolveExportFolderInteractively
} from "../src/prompt.js";

const FIXED_NOW = "2026-08-25T00:00:00.000Z";

test("isInteractive requires TTY and stays off for json, flags, and env", () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };

  assert.equal(isInteractive({ stdin: tty, stdout: tty, env: {} }), true);
  assert.equal(isInteractive({ stdin: pipe, stdout: tty, env: {} }), false);
  assert.equal(isInteractive({ stdin: tty, stdout: pipe, env: {} }), false);
  assert.equal(isInteractive({ stdin: tty, stdout: tty, json: true, env: {} }), false);
  assert.equal(isInteractive({ stdin: tty, stdout: tty, noInteractive: true, env: {} }), false);
  assert.equal(isInteractive({ stdin: tty, stdout: tty, env: { MARKBRIDGE_NO_INTERACTIVE: "1" } }), false);
  assert.equal(isInteractive({ stdin: tty, stdout: tty, env: { MARKBRIDGE_NO_INTERACTIVE: "true" } }), false);
});

test("pickFromList selects item by number", async () => {
  const { input, output, text } = createStdio(["2"]);
  const selected = await pickFromList({
    title: "Select folder",
    items: [
      { path: "Bookmarks Bar / Books" },
      { path: "Other bookmarks / Nested Other" }
    ],
    formatItem: (item) => item.path,
    getId: (item) => item.path,
    input,
    output
  });

  assert.equal(selected.path, "Other bookmarks / Nested Other");
  assert.match(text(), /1\. Bookmarks Bar \/ Books/);
  assert.match(text(), /2\. Other bookmarks \/ Nested Other/);
});

test("pickFromList selects by exact path/id", async () => {
  const { input, output } = createStdio(["Other bookmarks / Nested Other"]);
  const selected = await pickFromList({
    title: "Select folder",
    items: [
      { path: "Bookmarks Bar / Books" },
      { path: "Other bookmarks / Nested Other" }
    ],
    formatItem: (item) => item.path,
    getId: (item) => item.path,
    input,
    output
  });

  assert.equal(selected.path, "Other bookmarks / Nested Other");
});

test("pickFromList retries empty or invalid answers then throws", async () => {
  const answers = ["", "0", "9"];
  let text = "";

  await assert.rejects(
    () => pickFromList({
      title: "Select folder",
      items: [{ path: "Books" }],
      formatItem: (item) => item.path,
      getId: (item) => item.path,
      maxAttempts: 3,
      question: async () => answers.shift() ?? "",
      output: { write: (chunk) => { text += chunk; } }
    }),
    /Too many invalid selections/
  );

  assert.match(text, /Please enter a number or exact id\/path/);
  assert.match(text, /Invalid selection/);
});

test("sync setup with injected picker fills browser, profile, folderPath without those flags", async () => {
  const home = await mkdtemp(join(tmpdir(), "markbridge-prompt-setup-"));
  const { browserRoot, cleanup } = await createTestChromeProfile(home, createChromeBookmarksFileWithAllRoots());
  const titles = [];

  try {
    const result = await resolveBrowserProfileFolder({}, {
      interactive: true,
      env: { MARKBRIDGE_HOME: home },
      promptFolder: true,
      listProfiles: (options) => import("../src/browser.js").then(({ listBrowserProfiles }) => listBrowserProfiles({
        ...options,
        browserRoot
      })),
      pullBookmarks: (options) => import("../src/browser.js").then(({ pullBrowserBookmarks }) => pullBrowserBookmarks({
        ...options,
        browserRoot
      })),
      pick: async ({ title, items }) => {
        titles.push(title);

        if (title === "Select browser") {
          return items.find((item) => item.key === "chrome");
        }

        if (title === "Select profile") {
          return items.find((item) => item.profile === "Default");
        }

        if (title === "Select folder") {
          return items.find((item) => item.path === "Other bookmarks / Nested Other");
        }

        throw new Error(`Unexpected prompt: ${title}`);
      }
    });

    assert.equal(result.browser, "chrome");
    assert.equal(result.profile, "Default");
    assert.equal(result.folder, undefined);
    assert.equal(result.folderPath, "Other bookmarks / Nested Other");
    assert.ok(titles.includes("Select profile"));
    assert.ok(titles.includes("Select folder"));
  } finally {
    await cleanup();
  }
});

test("non-interactive resolveBrowserProfileFolder throws usage when flags are missing", async () => {
  await assert.rejects(
    () => resolveBrowserProfileFolder({}, {
      interactive: false,
      usage: "Usage: markbridge sync setup --browser chrome --profile <profile>",
      env: {},
      listProfiles: async () => [{ browser: "chrome", browserName: "Google Chrome", profile: "Default", name: "Test" }]
    }),
    /Usage: markbridge sync setup --browser chrome --profile <profile>/
  );
});

test("resolveExportFolderInteractively lets an injected picker choose an ambiguous folder", async () => {
  const idFactory = createIdFactory("prompt-folder");
  const library = createEmptyLibrary({ now: FIXED_NOW, idFactory });
  const bar = addFolder(library, library.rootId, { title: "Bookmarks Bar", now: FIXED_NOW }, idFactory);
  const other = addFolder(library, library.rootId, { title: "Other bookmarks", now: FIXED_NOW }, idFactory);
  const barBooks = addFolder(library, bar.id, { title: "Books", now: FIXED_NOW }, idFactory);
  const otherBooks = addFolder(library, other.id, { title: "Books", now: FIXED_NOW }, idFactory);

  addBookmark(library, barBooks.id, { title: "Bar Book", url: "https://bar.example.com/book", now: FIXED_NOW }, idFactory);
  addBookmark(library, otherBooks.id, { title: "Other Book", url: "https://other.example.com/book", now: FIXED_NOW }, idFactory);

  const selected = await resolveExportFolderInteractively(library, { folder: "Books" }, {
    interactive: true,
    pick: async ({ items }) => items.find((item) => item.path === "Other bookmarks / Books")
  });

  assert.equal(selected.path, "Other bookmarks / Books");
});

function createStdio(lines) {
  const input = Readable.from(lines.map((line) => `${line}\n`));
  let text = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    }
  });

  return {
    input,
    output,
    text: () => text
  };
}

async function createTestChromeProfile(home, bookmarksFile) {
  const browserRoot = join(home, "Chrome");
  const profileDir = join(browserRoot, "Default");

  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "Preferences"), JSON.stringify({ profile: { name: "Test Person" } }), "utf8");
  await writeFile(join(profileDir, "Bookmarks"), JSON.stringify(bookmarksFile, null, 2), "utf8");

  return {
    browserRoot,
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

function createChromeBookmarksFileWithAllRoots() {
  const file = createChromeBookmarksFile();

  file.roots.bookmark_bar.children = [
    {
      date_added: "13370000000000000",
      guid: "55555555-5555-4555-8555-555555555555",
      id: "11",
      name: "Bar Link",
      type: "url",
      url: "https://bar.example.com"
    }
  ];
  file.roots.other.children = [
    {
      children: [
        {
          date_added: "13370000000000000",
          guid: "66666666-6666-4666-8666-666666666666",
          id: "13",
          name: "Other Link",
          type: "url",
          url: "https://other.example.com"
        }
      ],
      date_added: "13370000000000000",
      date_modified: "13370000000000000",
      guid: "77777777-7777-4777-8777-777777777777",
      id: "12",
      name: "Nested Other",
      type: "folder"
    }
  ];
  file.roots.synced.children = [
    {
      date_added: "13370000000000000",
      guid: "88888888-8888-4888-8888-888888888888",
      id: "14",
      name: "Synced Link",
      type: "url",
      url: "https://synced.example.com"
    }
  ];

  return file;
}
