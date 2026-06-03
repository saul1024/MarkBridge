import { decodeHtmlEntities, stripHtmlTags } from "./entities.js";
import { addBookmark, addFolder, createEmptyLibrary, createRandomIdFactory } from "./model.js";
import { normalizeUrl } from "./normalize.js";

const TOKEN_PATTERN = /<DL\b[^>]*>|<\/DL\s*>|<DT>\s*<H3\b([^>]*)>([\s\S]*?)<\/H3\s*>|<DT>\s*<A\b([^>]*)>([\s\S]*?)<\/A\s*>/giu;

export function importBookmarksHtml(html, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? createRandomIdFactory();
  const library = createEmptyLibrary({
    idFactory,
    now,
    libraryId: options.libraryId
  });
  const batchId = options.batchId ?? idFactory();
  const sourceBrowser = options.sourceBrowser ?? detectSourceBrowser(html);
  const importBatch = {
    id: batchId,
    sourceType: "bookmark-html",
    sourceBrowser,
    sourceFileName: options.sourceFileName,
    importedAt: now,
    importedByDeviceId: options.deviceId ?? "local",
    itemIds: [],
    stats: {
      folders: 0,
      bookmarks: 0,
      duplicates: 0,
      skipped: 0
    }
  };

  const folderStack = [library.rootId];
  const seenUrls = new Map();
  let pendingFolderId = null;

  for (const match of String(html ?? "").matchAll(TOKEN_PATTERN)) {
    const token = match[0];

    if (/^<DL\b/iu.test(token)) {
      if (pendingFolderId) {
        folderStack.push(pendingFolderId);
        pendingFolderId = null;
      }

      continue;
    }

    if (/^<\/DL/iu.test(token)) {
      pendingFolderId = null;

      if (folderStack.length > 1) {
        folderStack.pop();
      }

      continue;
    }

    const parentId = folderStack.at(-1);

    if (typeof match[1] === "string") {
      const attrs = parseAttributes(match[1]);
      const title = decodeTitle(match[2]);
      const createdAt = bookmarkDateToIso(attrs.ADD_DATE, now);
      const updatedAt = bookmarkDateToIso(attrs.LAST_MODIFIED, createdAt);
      const folder = addFolder(
        library,
        parentId,
        {
          title,
          createdAt,
          updatedAt,
          source: createImportSource(batchId, attrs, folderStack.map((id) => library.items[id]?.title).filter(Boolean)),
          rawMeta: { attrs }
        },
        idFactory
      );

      importBatch.itemIds.push(folder.id);
      importBatch.stats.folders += 1;
      pendingFolderId = folder.id;
      continue;
    }

    if (typeof match[3] === "string") {
      const attrs = parseAttributes(match[3]);
      const href = attrs.HREF;

      if (!href) {
        importBatch.stats.skipped += 1;
        pendingFolderId = null;
        continue;
      }

      const url = decodeHtmlEntities(href);
      const normalizedUrl = normalizeUrl(url);
      const duplicateOf = seenUrls.get(normalizedUrl);
      const title = decodeTitle(match[4]);
      const createdAt = bookmarkDateToIso(attrs.ADD_DATE, now);
      const rawMeta = { attrs };

      if (duplicateOf) {
        importBatch.stats.duplicates += 1;
        rawMeta.duplicateOf = duplicateOf;
      } else {
        seenUrls.set(normalizedUrl, null);
      }

      const bookmark = addBookmark(
        library,
        parentId,
        {
          title,
          url,
          normalizedUrl,
          favicon: parseFavicon(attrs),
          createdAt,
          updatedAt: bookmarkDateToIso(attrs.LAST_MODIFIED, createdAt),
          source: createImportSource(batchId, attrs, folderStack.map((id) => library.items[id]?.title).filter(Boolean)),
          rawMeta
        },
        idFactory
      );

      if (!duplicateOf) {
        seenUrls.set(normalizedUrl, bookmark.id);
      }

      importBatch.itemIds.push(bookmark.id);
      importBatch.stats.bookmarks += 1;
      pendingFolderId = null;
    }
  }

  library.imports.push(importBatch);
  return { library, importBatch };
}

export function parseAttributes(source) {
  const attrs = {};
  const pattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;

  for (const match of String(source ?? "").matchAll(pattern)) {
    const key = match[1].toUpperCase();
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = decodeHtmlEntities(rawValue);
  }

  return attrs;
}

function decodeTitle(source) {
  return decodeHtmlEntities(stripHtmlTags(source)).trim();
}

function createImportSource(batchId, attrs, originalPath) {
  return {
    batchId,
    originalAddDate: attrs.ADD_DATE,
    originalLastModified: attrs.LAST_MODIFIED,
    originalPath
  };
}

function bookmarkDateToIso(value, fallback) {
  if (!value) {
    return fallback;
  }

  const seconds = Number.parseInt(value, 10);

  if (!Number.isFinite(seconds)) {
    return fallback;
  }

  return new Date(seconds * 1000).toISOString();
}

function parseFavicon(attrs) {
  if (attrs.ICON) {
    const mimeType = attrs.ICON.match(/^data:([^;,]+)/iu)?.[1];

    return {
      mode: "inline-data",
      mimeType,
      dataUrl: attrs.ICON
    };
  }

  if (attrs.ICON_URI) {
    return {
      mode: "remote-url",
      uri: attrs.ICON_URI
    };
  }

  return undefined;
}

function detectSourceBrowser(html) {
  const source = String(html ?? "");

  if (/firefox|mozilla/i.test(source)) {
    return "firefox";
  }

  if (/edge/i.test(source)) {
    return "edge";
  }

  if (/chrome/i.test(source)) {
    return "chrome";
  }

  return "unknown";
}
