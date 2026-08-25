import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { saveSyncConfig } from "../src/store.js";
import {
  createWebHandler,
  getWebListenUrl,
  resolveWebListenHost,
  startWebServer
} from "../src/index.js";

test("web server binds 127.0.0.1 and reports health", async () => {
  const home = await mkdtemp(join(tmpdir(), "markbridge-web-health-"));

  try {
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      env: { MARKBRIDGE_HOME: home }
    });

    try {
      assert.equal(server.address().address, "127.0.0.1");
      const url = getWebListenUrl(server);
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);

      const response = await fetch(`${url}/api/health`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data.status, "ok");
      assert.equal(body.data.localOnly, true);

      const page = await fetch(url);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /127\.0\.0\.1/);
      assert.match(html, /跨 Profile 复制/);
      assert.match(html, /COS 同步/);
      assert.match(html, /导出 HTML/);
      assert.doesNotMatch(html, /lorem ipsum/i);
    } finally {
      await closeServer(server);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("web server refuses to bind 0.0.0.0", async () => {
  await assert.rejects(
    () => startWebServer({ host: "0.0.0.0", port: 0 }),
    /127\.0\.0\.1/
  );
  assert.equal(resolveWebListenHost(), "127.0.0.1");
  assert.throws(() => resolveWebListenHost("0.0.0.0"), /127\.0\.0\.1/);
});

test("web handler refuses non-localhost remoteAddress", async () => {
  const handler = createWebHandler();
  const result = await invokeHandler(handler, {
    method: "GET",
    url: "/api/health",
    remoteAddress: "8.8.8.8"
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /Localhost only/);
});

test("profiles lists fixture profiles", async () => {
  const fixture = await createFixtureProfiles();

  try {
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      env: fixture.env,
      cwd: fixture.home
    });

    try {
      const url = getWebListenUrl(server);
      const response = await fetch(`${url}/api/profiles?browser=chrome`);
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.deepEqual(body.data.profiles.map((item) => item.profile), ["Default", "Profile 1"]);
      assert.equal(body.data.profiles[0].name, "Source Person");
      assert.equal(body.data.profiles[1].name, "Dest Person");
      assert.equal(JSON.stringify(body).includes("secretId"), false);
      assert.equal(JSON.stringify(body).includes("secretKey"), false);

      const folders = await fetchJson(url, "/api/folders?browser=chrome&profile=Default");
      assert.equal(folders.ok, true);
      assert.equal(folders.data.folders[0].all, true);
      assert.equal(folders.data.folders[0].title, "全部书签");
      assert.ok(folders.data.folders.some((folder) => folder.path === "Bookmarks Bar / Books"));
    } finally {
      await closeServer(server);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("copy preview does not write bookmarks file", async () => {
  const fixture = await createFixtureProfiles();

  try {
    const beforeSource = await readFile(fixture.sourceBookmarksPath, "utf8");
    const beforeDest = await readFile(fixture.destBookmarksPath, "utf8");
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      env: fixture.env,
      cwd: fixture.home
    });

    try {
      const url = getWebListenUrl(server);
      const body = await fetchJson(url, "/api/copy/preview", {
        fromBrowser: "chrome",
        fromProfile: "Default",
        fromFolderPath: "Bookmarks Bar / Books",
        toBrowser: "chrome",
        toProfile: "Profile 1",
        toFolder: "ImportedBooks",
        mode: "merge"
      });

      assert.equal(body.ok, true);
      assert.equal(body.data.dryRun, true);
      assert.equal(body.data.written, false);
      assert.equal(body.data.from.exportedBookmarks, 2);
      assert.equal(body.data.to.plannedBookmarks, 2);
      assert.equal(body.data.to.folder, "ImportedBooks");
      assert.equal(await readFile(fixture.sourceBookmarksPath, "utf8"), beforeSource);
      assert.equal(await readFile(fixture.destBookmarksPath, "utf8"), beforeDest);
      assert.doesNotMatch(beforeDest, /ImportedBooks/);
    } finally {
      await closeServer(server);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("export preview returns count and does not change Bookmarks file", async () => {
  const fixture = await createFixtureProfiles();

  try {
    const beforeSource = await readFile(fixture.sourceBookmarksPath, "utf8");
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      env: fixture.env,
      cwd: fixture.home
    });

    try {
      const url = getWebListenUrl(server);
      const body = await fetchJson(url, "/api/export/preview", {
        browser: "chrome",
        profile: "Default"
      });

      assert.equal(body.ok, true);
      assert.equal(body.data.exportedBookmarks, 3);
      assert.equal(body.data.folder, null);
      assert.ok(body.data.size > 0);
      assert.equal(await readFile(fixture.sourceBookmarksPath, "utf8"), beforeSource);
    } finally {
      await closeServer(server);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("GET /api/export returns html containing a known bookmark title", async () => {
  const fixture = await createFixtureProfiles();

  try {
    const beforeSource = await readFile(fixture.sourceBookmarksPath, "utf8");
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      env: fixture.env,
      cwd: fixture.home
    });

    try {
      const url = getWebListenUrl(server);
      const missing = await fetch(`${url}/api/export`);
      const missingBody = await missing.json();
      assert.equal(missing.status, 400);
      assert.equal(missingBody.ok, false);
      assert.match(missingBody.error, /browser/);

      const response = await fetch(`${url}/api/export?browser=chrome&profile=Default`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
      assert.match(response.headers.get("content-disposition") ?? "", /\.html/);
      assert.match(html, /NETSCAPE-Bookmark-file-1/);
      assert.match(html, /Node Handbook/);
      assert.equal(await readFile(fixture.sourceBookmarksPath, "utf8"), beforeSource);
    } finally {
      await closeServer(server);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("import preview does not write Bookmarks", async () => {
  const fixture = await createFixtureProfiles();

  try {
    const beforeDest = await readFile(fixture.destBookmarksPath, "utf8");
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      env: fixture.env,
      cwd: fixture.home
    });

    try {
      const url = getWebListenUrl(server);
      const html = [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        "<TITLE>Bookmarks</TITLE>",
        "<H1>Bookmarks</H1>",
        "<DL><p>",
        '    <DT><A HREF="https://imported.example.com">Imported Example</A>',
        "</DL><p>",
        ""
      ].join("\n");
      const body = await fetchJson(url, "/api/import/preview", {
        html,
        browser: "chrome",
        profile: "Profile 1",
        folder: "ImportedHtml",
        mode: "merge"
      });

      assert.equal(body.ok, true);
      assert.equal(body.data.dryRun, true);
      assert.equal(body.data.written, false);
      assert.equal(body.data.imported.bookmarks, 1);
      assert.equal(body.data.folder, "ImportedHtml");
      assert.equal(await readFile(fixture.destBookmarksPath, "utf8"), beforeDest);
      assert.doesNotMatch(beforeDest, /ImportedHtml/);
      assert.doesNotMatch(beforeDest, /Imported Example/);
    } finally {
      await closeServer(server);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("missing COS on sync status returns configured false not a crash", async () => {
  const home = await mkdtemp(join(tmpdir(), "markbridge-web-cos-missing-"));

  try {
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      env: {
        MARKBRIDGE_HOME: home
      },
      cwd: home
    });

    try {
      const url = getWebListenUrl(server);
      const response = await fetch(`${url}/api/sync/status`);
      const body = await response.json();
      const serialized = JSON.stringify(body);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data.configured, false);
      assert.equal(body.data.cos.configured, false);
      assert.match(body.data.cos.error, /Missing COS configuration/);
      assert.equal(Object.hasOwn(body.data.cos, "secretId"), false);
      assert.equal(Object.hasOwn(body.data.cos, "secretKey"), false);
      assert.doesNotMatch(serialized, /AKIDEXAMPLE|SECRETEXAMPLE/);
    } finally {
      await closeServer(server);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("sync push preview does not upload and can report conflict fields", async () => {
  const fixture = await createFixtureProfiles();
  const objects = new Map();
  const client = createMemoryCosClient(objects);
  await saveSyncConfig({
    browser: "chrome",
    profile: "Default",
    folder: "Books",
    folderPath: "Bookmarks Bar / Books",
    mode: "merge",
    remoteKey: "bookmarks/chrome/source-person/books.html",
    lastRemoteEtag: "old-etag",
    lastRemoteKey: "bookmarks/chrome/source-person/books.html"
  }, join(fixture.env.MARKBRIDGE_HOME, "sync-config.json"));
  await client.putObject("bookmarks/chrome/source-person/books.html", "<html>stale</html>", {
    etag: "\"remote-changed\""
  });
  const putCount = { value: 0 };
  const originalPut = client.putObject.bind(client);
  client.putObject = async (...args) => {
    putCount.value += 1;
    return originalPut(...args);
  };

  try {
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      env: {
        ...fixture.env,
        COS_ENDPOINT: "https://cos.ap-guangzhou.myqcloud.com",
        COS_REGION: "ap-guangzhou",
        COS_BUCKET: "markbridge-1250000000",
        COS_SECRET_ID: "AKIDEXAMPLE",
        COS_SECRET_KEY: "SECRETEXAMPLE"
      },
      cwd: fixture.home,
      cosClient: client
    });

    try {
      const url = getWebListenUrl(server);
      const preview = await fetchJson(url, "/api/sync/push/preview", { force: false });
      assert.equal(preview.ok, true);
      assert.equal(preview.data.dryRun, true);
      assert.equal(preview.data.uploaded, false);
      assert.equal(preview.data.conflict, true);
      assert.equal(putCount.value, 0);
      const serialized = JSON.stringify(preview);
      assert.equal(serialized.includes("AKIDEXAMPLE"), false);
      assert.equal(serialized.includes("SECRETEXAMPLE"), false);
      assert.equal(serialized.includes("secretKey"), false);
    } finally {
      await closeServer(server);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("createWebHandler accepts injected profile listing", async () => {
  const handler = createWebHandler({
    listBrowserProfiles: async () => ([
      {
        browser: "edge",
        browserName: "Microsoft Edge",
        profile: "Default",
        name: "Injected",
        hasBookmarks: true,
        bookmarksPath: "/tmp/Bookmarks",
        verifyUrl: "edge://favorites",
        secretKey: "should-not-leak"
      }
    ])
  });
  const result = await invokeHandler(handler, {
    method: "GET",
    url: "/api/profiles?browser=edge",
    remoteAddress: "127.0.0.1"
  });

  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.profiles[0].name, "Injected");
  assert.equal(Object.hasOwn(result.body.data.profiles[0], "secretKey"), false);
});

async function fetchJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, body === undefined
    ? undefined
    : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  return response.json();
}

async function invokeHandler(handler, options) {
  const chunks = [];
  let status = 0;
  const res = {
    writeHead(code) {
      status = code;
    },
    end(data) {
      chunks.push(String(data ?? ""));
    }
  };

  await handler({
    method: options.method,
    url: options.url,
    socket: { remoteAddress: options.remoteAddress }
  }, res);

  return {
    status,
    body: JSON.parse(chunks.join("") || "{}")
  };
}

async function closeServer(server) {
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }

  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function createFixtureProfiles() {
  const home = await mkdtemp(join(tmpdir(), "markbridge-web-profiles-"));
  const browserRoot = join(home, "Chrome");
  const sourceDir = join(browserRoot, "Default");
  const destDir = join(browserRoot, "Profile 1");
  const sourceBookmarksPath = join(sourceDir, "Bookmarks");
  const destBookmarksPath = join(destDir, "Bookmarks");
  const markbridgeHome = join(home, "markbridge-home");

  await mkdir(sourceDir, { recursive: true });
  await mkdir(destDir, { recursive: true });
  await mkdir(markbridgeHome, { recursive: true });
  await writeFile(join(sourceDir, "Preferences"), JSON.stringify({ profile: { name: "Source Person" } }), "utf8");
  await writeFile(join(destDir, "Preferences"), JSON.stringify({ profile: { name: "Dest Person" } }), "utf8");
  await writeFile(sourceBookmarksPath, JSON.stringify(createChromeBookmarksFile(), null, 2), "utf8");
  await writeFile(destBookmarksPath, JSON.stringify(createEmptyChromeBookmarksFile(), null, 2), "utf8");

  return {
    home,
    sourceBookmarksPath,
    destBookmarksPath,
    env: {
      MARKBRIDGE_HOME: markbridgeHome,
      MARKBRIDGE_CHROME_USER_DATA_DIR: browserRoot
    },
    cleanup: () => rm(home, { recursive: true, force: true })
  };
}

function createEmptyChromeBookmarksFile() {
  const file = createChromeBookmarksFile();
  file.roots.bookmark_bar.children = [];
  return file;
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
        headers: { etag }
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
