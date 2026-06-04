import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

const DEFAULT_MAX_KEYS = 100;

export function loadCosConfig(env = process.env) {
  const provider = env.SYNC_PROVIDER ?? "cos";

  if (provider !== "cos") {
    throw new Error(`Unsupported sync provider: ${provider}. Expected SYNC_PROVIDER=cos.`);
  }

  const config = {
    endpoint: env.COS_ENDPOINT,
    region: env.COS_REGION,
    bucket: env.COS_BUCKET,
    secretId: env.COS_SECRET_ID,
    secretKey: env.COS_SECRET_KEY,
    securityToken: env.COS_SECURITY_TOKEN
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== "securityToken" && !value)
    .map(([key]) => envKeyForConfigKey(key));

  if (missing.length > 0) {
    throw new Error(`Missing COS configuration: ${missing.join(", ")}. Check .env or environment variables.`);
  }

  return config;
}

export function createCosClient(config, options = {}) {
  const request = options.request ?? requestHttp;
  const now = options.now;

  return {
    async headObject(key) {
      return requestCos(config, {
        method: "HEAD",
        key
      }, { request, now });
    },

    async putObject(key, body, requestOptions = {}) {
      const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);

      return requestCos(config, {
        method: "PUT",
        key,
        body: payload,
        headers: {
          "content-length": String(payload.length),
          "content-type": requestOptions.contentType ?? "application/octet-stream"
        }
      }, { request, now });
    },

    async getObject(key) {
      const response = await requestCos(config, {
        method: "GET",
        key
      }, { request, now });

      return response.body;
    },

    async deleteObject(key) {
      return requestCos(config, {
        method: "DELETE",
        key
      }, { request, now });
    },

    async listObjects(options = {}) {
      const query = {};
      const prefix = normalizeOptionalString(options.prefix);
      const maxKeys = Number.parseInt(String(options.maxKeys ?? DEFAULT_MAX_KEYS), 10);

      if (prefix) {
        query.prefix = prefix;
      }

      if (Number.isFinite(maxKeys) && maxKeys > 0) {
        query["max-keys"] = String(maxKeys);
      }

      const response = await requestCos(config, {
        method: "GET",
        key: "",
        query
      }, { request, now });

      return parseListObjectsXml(response.body.toString("utf8"));
    }
  };
}

export async function headCosFile(options = {}) {
  const client = options.client ?? createCosClient(options.config);
  const key = normalizeRemoteKey(options.remoteKey);
  const response = await client.headObject(key);

  return {
    remoteKey: key,
    exists: true,
    size: parseHeaderInteger(response.headers["content-length"]),
    lastModified: response.headers["last-modified"],
    etag: response.headers.etag,
    statusCode: response.statusCode
  };
}

export async function pushCosFile(options = {}) {
  const client = options.client ?? createCosClient(options.config);
  const filePath = options.filePath;
  const key = normalizeRemoteKey(options.remoteKey);
  const body = await readFile(filePath);
  const response = await client.putObject(key, body, {
    contentType: options.contentType ?? guessContentType(filePath)
  });

  return {
    remoteKey: key,
    filePath,
    size: body.length,
    statusCode: response.statusCode,
    etag: response.headers.etag
  };
}

export async function pullCosFile(options = {}) {
  const client = options.client ?? createCosClient(options.config);
  const key = normalizeRemoteKey(options.remoteKey);
  const outputPath = options.outputPath;
  const body = await client.getObject(key);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body);

  return {
    remoteKey: key,
    outputPath,
    size: body.length
  };
}

export async function deleteCosFile(options = {}) {
  const client = options.client ?? createCosClient(options.config);
  const key = normalizeRemoteKey(options.remoteKey);
  const response = await client.deleteObject(key);

  return {
    remoteKey: key,
    statusCode: response.statusCode
  };
}

export async function listCosFiles(options = {}) {
  const client = options.client ?? createCosClient(options.config);
  return client.listObjects({
    prefix: options.prefix,
    maxKeys: options.maxKeys
  });
}

export function isCosNotFoundError(error) {
  return error?.statusCode === 404 || /HTTP 404/u.test(error?.message ?? "");
}

export function createCosAuthorization(config, request) {
  const method = request.method.toLowerCase();
  const path = request.path || "/";
  const query = request.query ?? {};
  const headers = normalizeHeadersForSigning(request.headers);
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedQueryKeys = Object.keys(query).map((key) => key.toLowerCase()).sort();
  const keyTime = request.keyTime;
  const httpString = [
    method,
    path,
    formatKeyValuePairs(query, signedQueryKeys),
    formatKeyValuePairs(headers, signedHeaderKeys),
    ""
  ].join("\n");
  const stringToSign = [
    "sha1",
    keyTime,
    sha1Hex(httpString),
    ""
  ].join("\n");
  const signKey = hmacSha1Hex(keyTime, config.secretKey);
  const signature = hmacSha1Hex(stringToSign, signKey);

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${config.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${signedHeaderKeys.join(";")}`,
    `q-url-param-list=${signedQueryKeys.join(";")}`,
    `q-signature=${signature}`
  ].join("&");
}

function requestCos(config, operation, options) {
  const key = operation.key ? normalizeRemoteKey(operation.key) : "";
  const endpoint = buildEndpoint(config, key);
  const query = normalizeQuery(operation.query);
  const date = toHttpDate(options.now);
  const headers = normalizeRequestHeaders({
    host: endpoint.host,
    date,
    ...(operation.headers ?? {})
  });
  const nowSeconds = Math.floor((options.now ? new Date(options.now) : new Date()).getTime() / 1000);
  const keyTime = `${nowSeconds};${nowSeconds + 3600}`;

  if (config.securityToken) {
    headers["x-cos-security-token"] = config.securityToken;
  }

  headers.authorization = createCosAuthorization(config, {
    method: operation.method,
    path: endpoint.path,
    query,
    headers,
    keyTime
  });

  return options.request({
    protocol: endpoint.protocol,
    host: endpoint.host,
    method: operation.method,
    path: endpoint.path,
    query,
    headers,
    body: operation.body ?? Buffer.alloc(0)
  }).then((response) => {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response;
    }

    throw new CosError({
      method: operation.method,
      key,
      statusCode: response.statusCode,
      message: extractCosErrorMessage(response.body)
    });
  });
}

export class CosError extends Error {
  constructor(options) {
    super(`COS ${options.method} ${options.key || "/"} failed with HTTP ${options.statusCode}: ${options.message}`);
    this.name = "CosError";
    this.method = options.method;
    this.key = options.key;
    this.statusCode = options.statusCode;
  }
}

function requestHttp(request) {
  const transport = request.protocol === "http:" ? httpRequest : httpsRequest;
  const queryString = formatUrlQuery(request.query);
  const path = queryString ? `${request.path}?${queryString}` : request.path;

  return new Promise((resolve, reject) => {
    const req = transport({
      protocol: request.protocol,
      host: request.host,
      method: request.method,
      path,
      headers: request.headers
    }, (res) => {
      const chunks = [];

      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });

    req.on("error", reject);

    if (request.body.length > 0) {
      req.write(request.body);
    }

    req.end();
  });
}

function buildEndpoint(config, key) {
  const url = new URL(config.endpoint);
  const bucketPrefix = `${config.bucket}.`;
  const host = url.hostname === config.bucket || url.hostname.startsWith(bucketPrefix)
    ? url.host
    : `${config.bucket}.${url.host}`;

  return {
    protocol: url.protocol,
    host,
    path: key ? `/${encodeCosPath(key)}` : "/"
  };
}

function parseListObjectsXml(xml) {
  const objects = [];
  const contentsPattern = /<Contents>([\s\S]*?)<\/Contents>/gu;
  let match;

  while ((match = contentsPattern.exec(xml)) !== null) {
    const block = match[1];
    const key = readXmlValue(block, "Key");

    if (!key) {
      continue;
    }

    objects.push({
      key,
      size: Number.parseInt(readXmlValue(block, "Size") || "0", 10),
      lastModified: readXmlValue(block, "LastModified"),
      etag: readXmlValue(block, "ETag")
    });
  }

  return {
    name: readXmlValue(xml, "Name"),
    prefix: readXmlValue(xml, "Prefix"),
    truncated: readXmlValue(xml, "IsTruncated") === "true",
    objects
  };
}

function readXmlValue(xml, tagName) {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "u").exec(xml);
  return match ? unescapeXml(match[1]) : "";
}

function extractCosErrorMessage(body) {
  const text = body.toString("utf8");
  return readXmlValue(text, "Message") || text.slice(0, 300) || "empty response";
}

function parseHeaderInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeRemoteKey(value) {
  const key = String(value ?? "").trim().replace(/^\/+/u, "");

  if (!key) {
    throw new Error("Remote object key is required.");
  }

  return key;
}

function normalizeQuery(query = {}) {
  const normalized = {};

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }

    normalized[String(key).toLowerCase()] = String(value);
  }

  return normalized;
}

function normalizeRequestHeaders(headers) {
  const normalized = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) {
      continue;
    }

    normalized[String(key).toLowerCase()] = String(value);
  }

  return normalized;
}

function normalizeHeadersForSigning(headers) {
  const normalized = {};

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") {
      continue;
    }

    normalized[key.toLowerCase()] = String(value).trim().replace(/\s+/gu, " ");
  }

  return normalized;
}

function formatKeyValuePairs(values, sortedKeys) {
  return sortedKeys
    .map((key) => `${cosEncode(key)}=${cosEncode(values[key] ?? "")}`)
    .join("&");
}

function formatUrlQuery(query) {
  return Object.keys(query)
    .sort()
    .map((key) => `${cosEncode(key)}=${cosEncode(query[key])}`)
    .join("&");
}

function encodeCosPath(key) {
  return key.split("/").map((part) => cosEncode(part)).join("/");
}

function cosEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha1Hex(value) {
  return createHash("sha1").update(value).digest("hex");
}

function hmacSha1Hex(value, key) {
  return createHmac("sha1", key).update(value).digest("hex");
}

function toHttpDate(value) {
  return (value ? new Date(value) : new Date()).toUTCString();
}

function guessContentType(path) {
  const ext = extname(path).toLowerCase();

  if (ext === ".html" || ext === ".htm") {
    return "text/html; charset=utf-8";
  }

  if (ext === ".json") {
    return "application/json; charset=utf-8";
  }

  if (ext === ".txt") {
    return "text/plain; charset=utf-8";
  }

  return "application/octet-stream";
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null || value === true || value === false) {
    return "";
  }

  return String(value).trim();
}

function envKeyForConfigKey(key) {
  return {
    endpoint: "COS_ENDPOINT",
    region: "COS_REGION",
    bucket: "COS_BUCKET",
    secretId: "COS_SECRET_ID",
    secretKey: "COS_SECRET_KEY"
  }[key] ?? key;
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}
