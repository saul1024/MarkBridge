import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createCosClient, deleteCosFile, headCosFile, isCosNotFoundError, listCosFiles, loadCosConfig, loadEnvironment, parseDotenv, pullCosFile, pushCosFile } from "../src/index.js";

const CONFIG = {
  endpoint: "https://cos.ap-guangzhou.myqcloud.com",
  region: "ap-guangzhou",
  bucket: "markbridge-1250000000",
  secretId: "AKIDEXAMPLE",
  secretKey: "SECRETEXAMPLE"
};

test("parseDotenv reads COS example values without touching process env", () => {
  const parsed = parseDotenv([
    "SYNC_PROVIDER=cos",
    "COS_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com",
    "COS_REGION=ap-guangzhou",
    "COS_BUCKET=markbridge-1250000000",
    "COS_SECRET_ID=AKIDEXAMPLE",
    "COS_SECRET_KEY='SECRETEXAMPLE'",
    "# ignored"
  ].join("\n"));

  assert.deepEqual(parsed, {
    SYNC_PROVIDER: "cos",
    COS_ENDPOINT: "https://cos.ap-guangzhou.myqcloud.com",
    COS_REGION: "ap-guangzhou",
    COS_BUCKET: "markbridge-1250000000",
    COS_SECRET_ID: "AKIDEXAMPLE",
    COS_SECRET_KEY: "SECRETEXAMPLE"
  });
});

test("loadEnvironment loads .env and lets explicit environment override it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "markbridge-env-test-"));

  try {
    await writeFile(join(cwd, ".env"), [
      "SYNC_PROVIDER=cos",
      "COS_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com",
      "COS_REGION=ap-guangzhou",
      "COS_BUCKET=from-file",
      "COS_SECRET_ID=file-id",
      "COS_SECRET_KEY=file-key"
    ].join("\n"), "utf8");

    const loaded = await loadEnvironment({
      cwd,
      env: {
        COS_BUCKET: "from-env"
      }
    });

    assert.equal(loaded.COS_BUCKET, "from-env");
    assert.equal(loaded.COS_SECRET_ID, "file-id");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadCosConfig validates required COS fields", () => {
  const config = loadCosConfig({
    SYNC_PROVIDER: "cos",
    COS_ENDPOINT: CONFIG.endpoint,
    COS_REGION: CONFIG.region,
    COS_BUCKET: CONFIG.bucket,
    COS_SECRET_ID: CONFIG.secretId,
    COS_SECRET_KEY: CONFIG.secretKey
  });

  assert.equal(config.endpoint, CONFIG.endpoint);
  assert.equal(config.region, CONFIG.region);
  assert.equal(config.bucket, CONFIG.bucket);
  assert.equal(config.secretId, CONFIG.secretId);
  assert.equal(config.secretKey, CONFIG.secretKey);
  assert.equal(config.securityToken, undefined);

  assert.throws(
    () => loadCosConfig({ SYNC_PROVIDER: "cos" }),
    /Missing COS configuration: COS_ENDPOINT, COS_REGION, COS_BUCKET, COS_SECRET_ID, COS_SECRET_KEY/
  );
});

test("createCosClient signs PUT requests without exposing secret key", async () => {
  const requests = [];
  const client = createCosClient(CONFIG, {
    now: "2026-06-04T00:00:00.000Z",
    request: async (request) => {
      requests.push(request);
      return {
        statusCode: 200,
        headers: { etag: "\"etag-value\"" },
        body: Buffer.alloc(0)
      };
    }
  });

  await client.putObject("folder/books.html", Buffer.from("hello"), {
    contentType: "text/html; charset=utf-8"
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].protocol, "https:");
  assert.equal(requests[0].host, "markbridge-1250000000.cos.ap-guangzhou.myqcloud.com");
  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].path, "/folder/books.html");
  assert.equal(requests[0].headers["content-length"], "5");
  assert.equal(requests[0].headers["content-type"], "text/html; charset=utf-8");
  assert.match(requests[0].headers.authorization, /q-ak=AKIDEXAMPLE/);
  assert.doesNotMatch(requests[0].headers.authorization, /SECRETEXAMPLE/);
});

test("headCosFile reads object metadata and exposes structured 404 errors", async () => {
  const client = createCosClient(CONFIG, {
    now: "2026-06-04T00:00:00.000Z",
    request: async (request) => {
      if (request.path === "/missing.html") {
        return {
          statusCode: 404,
          headers: {},
          body: Buffer.from("<Error><Message>The specified key does not exist.</Message></Error>")
        };
      }

      return {
        statusCode: 200,
        headers: {
          "content-length": "434",
          "last-modified": "Thu, 04 Jun 2026 00:00:00 GMT",
          etag: "\"abc\""
        },
        body: Buffer.alloc(0)
      };
    }
  });

  const found = await headCosFile({
    client,
    remoteKey: "books.html"
  });

  assert.deepEqual(found, {
    remoteKey: "books.html",
    exists: true,
    size: 434,
    lastModified: "Thu, 04 Jun 2026 00:00:00 GMT",
    etag: "\"abc\"",
    statusCode: 200
  });

  await assert.rejects(
    () => headCosFile({ client, remoteKey: "missing.html" }),
    (error) => {
      assert.equal(isCosNotFoundError(error), true);
      assert.equal(error.statusCode, 404);
      assert.match(error.message, /The specified key does not exist/);
      return true;
    }
  );
});

test("COS file helpers upload, download, list, and delete objects", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "markbridge-cloud-test-"));
  const sourcePath = join(workdir, "books.html");
  const outputPath = join(workdir, "out", "books.html");
  const requests = [];
  const client = createCosClient(CONFIG, {
    now: "2026-06-04T00:00:00.000Z",
    request: async (request) => {
      requests.push(request);

      if (request.method === "GET" && request.path === "/books.html") {
        return { statusCode: 200, headers: {}, body: Buffer.from("<html>downloaded</html>") };
      }

      if (request.method === "GET" && request.path === "/") {
        return {
          statusCode: 200,
          headers: {},
          body: Buffer.from([
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<ListBucketResult>",
            "<Name>markbridge-1250000000</Name>",
            "<Prefix>markbridge/</Prefix>",
            "<IsTruncated>false</IsTruncated>",
            "<Contents>",
            "<Key>markbridge/books.html</Key>",
            "<LastModified>2026-06-04T00:00:00.000Z</LastModified>",
            "<ETag>&quot;abc&quot;</ETag>",
            "<Size>42</Size>",
            "</Contents>",
            "</ListBucketResult>"
          ].join(""))
        };
      }

      return { statusCode: 200, headers: {}, body: Buffer.alloc(0) };
    }
  });

  try {
    await writeFile(sourcePath, "<html>source</html>", "utf8");

    const uploaded = await pushCosFile({
      client,
      filePath: sourcePath,
      remoteKey: "books.html"
    });
    const downloaded = await pullCosFile({
      client,
      remoteKey: "books.html",
      outputPath
    });
    const listed = await listCosFiles({
      client,
      prefix: "markbridge/",
      maxKeys: 10
    });
    const deleted = await deleteCosFile({
      client,
      remoteKey: "books.html"
    });

    assert.equal(uploaded.remoteKey, "books.html");
    assert.equal(uploaded.size, 19);
    assert.equal(downloaded.size, 23);
    assert.equal(deleted.statusCode, 200);
    assert.equal(await readFile(outputPath, "utf8"), "<html>downloaded</html>");
    assert.deepEqual(listed.objects, [{
      key: "markbridge/books.html",
      size: 42,
      lastModified: "2026-06-04T00:00:00.000Z",
      etag: "\"abc\""
    }]);
    assert.deepEqual(requests.map((request) => `${request.method} ${request.path}`), [
      "PUT /books.html",
      "GET /books.html",
      "GET /",
      "DELETE /books.html"
    ]);
    assert.equal(requests[2].query.prefix, "markbridge/");
    assert.equal(requests[2].query["max-keys"], "10");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
