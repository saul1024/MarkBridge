import { addBookmark, addFolder, createEmptyLibrary, createRandomIdFactory, getChildren, isBookmark, isFolder } from "./model.js";
import { normalizeUrl } from "./normalize.js";

export const IMPORT_MODES = new Set(["merge", "append", "replace"]);

export function applyImportedLibrary(existing, importedResult, options = {}) {
  const mode = normalizeImportMode(options.mode);
  const imported = importedResult.library ?? importedResult;
  const importBatch = importedResult.importBatch ?? imported.imports?.at(-1);
  const input = {
    bookmarks: importBatch?.stats?.bookmarks ?? countImportedItems(imported).bookmarks,
    folders: importBatch?.stats?.folders ?? countImportedItems(imported).folders,
    sourceDuplicates: importBatch?.stats?.duplicates ?? 0,
    skipped: importBatch?.stats?.skipped ?? 0
  };

  if (!existing || mode === "replace") {
    return {
      library: imported,
      summary: {
        mode,
        input,
        addedBookmarks: input.bookmarks,
        addedFolders: input.folders,
        skippedDuplicates: 0,
        replaced: Boolean(existing && mode === "replace")
      }
    };
  }

  const { stats } = importLibraryIntoTarget(existing, imported, {
    mode,
    now: options.now
  });

  return {
    library: existing,
    summary: {
      mode,
      input,
      addedBookmarks: stats.addedBookmarks,
      addedFolders: stats.addedFolders,
      skippedDuplicates: stats.skippedDuplicates,
      replaced: false
    }
  };
}

export function mergeImportedLibrary(target, imported, options = {}) {
  return importLibraryIntoTarget(target, imported, {
    mode: options.mode ?? "append",
    now: options.now
  }).library;
}

export function importLibraryIntoTarget(target, imported, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const mode = normalizeImportMode(options.mode ?? "append");
  const dedupe = mode === "merge";
  const existingUrls = dedupe ? collectActiveNormalizedUrls(target) : new Set();
  const stats = {
    addedBookmarks: 0,
    addedFolders: 0,
    skippedDuplicates: 0
  };

  for (const childId of imported.items[imported.rootId]?.children ?? []) {
    const importedChild = imported.items[childId];
    const cloned = cloneTreeIntoLibrary(target, imported, importedChild, target.rootId, {
      dedupe,
      existingUrls,
      stats
    });

    if (cloned) {
      target.items[target.rootId].children.push(cloned.id);
    }
  }

  target.imports.push(...(imported.imports ?? []));
  target.updatedAt = now;
  target.items[target.rootId].updatedAt = now;
  return { library: target, stats };
}

export function listBookmarks(library) {
  const results = [];
  walkLibrary(library, (item, path) => {
    if (isBookmark(item) && !item.deletedAt) {
      results.push({
        id: item.id,
        title: item.title,
        url: item.url,
        path: path.join(" / "),
        normalizedUrl: item.normalizedUrl
      });
    }
  });
  return results;
}

export function searchBookmarks(library, query) {
  const needle = String(query ?? "").trim().toLowerCase();

  if (!needle) {
    return [];
  }

  return listBookmarks(library).filter((bookmark) => {
    return [bookmark.title, bookmark.url, bookmark.path, bookmark.normalizedUrl]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(needle));
  });
}

export function updateBookmark(library, id, changes, options = {}) {
  const item = library.items[id];

  if (!isBookmark(item) || item.deletedAt) {
    return null;
  }

  const now = options.now ?? new Date().toISOString();

  if (changes.title !== undefined) {
    item.title = changes.title;
  }

  if (changes.url !== undefined) {
    item.url = changes.url;
    item.normalizedUrl = normalizeUrl(changes.url);
  }

  if (changes.description !== undefined) {
    item.description = changes.description;
  }

  item.updatedAt = now;
  library.updatedAt = now;
  return item;
}

export function libraryStats(library) {
  const stats = {
    folders: 0,
    bookmarks: 0,
    deleted: 0
  };

  for (const item of Object.values(library.items)) {
    if (item.deletedAt) {
      stats.deleted += 1;
      continue;
    }

    if (isFolder(item)) {
      stats.folders += 1;
      continue;
    }

    if (isBookmark(item)) {
      stats.bookmarks += 1;
    }
  }

  return stats;
}

export function removeBookmarks(library, ids, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const removed = [];

  for (const id of ids) {
    const item = library.items[id];

    if (!isBookmark(item) || item.deletedAt) {
      continue;
    }

    item.deletedAt = now;
    item.updatedAt = now;
    removed.push(item);
  }

  if (removed.length > 0) {
    library.updatedAt = now;
  }

  return removed;
}

function cloneTreeIntoLibrary(target, imported, item, parentId, options = {}) {
  const idFactory = createRandomIdFactory();

  if (isFolder(item)) {
    const folder = addFolder(
      target,
      parentId,
      {
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        source: item.source,
        rawMeta: item.rawMeta
      },
      idFactory
    );

    // addFolder already appends to parent. Remove it here because mergeImportedLibrary
    // appends root children explicitly, while nested calls should preserve addFolder behavior.
    if (parentId === target.rootId) {
      target.items[parentId].children = target.items[parentId].children.filter((childId) => childId !== folder.id);
    }

    let retainedChildren = 0;

    for (const child of getChildren(imported, item.id)) {
      if (cloneTreeIntoLibrary(target, imported, child, folder.id, options)) {
        retainedChildren += 1;
      }
    }

    if (options.dedupe && retainedChildren === 0) {
      const parent = target.items[parentId];

      if (parent?.children) {
        parent.children = parent.children.filter((childId) => childId !== folder.id);
      }

      delete target.items[folder.id];
      return null;
    }

    options.stats.addedFolders += 1;
    return folder;
  }

  if (isBookmark(item)) {
    const normalizedUrl = item.normalizedUrl ?? normalizeUrl(item.url);

    if (options.dedupe && options.existingUrls.has(normalizedUrl)) {
      options.stats.skippedDuplicates += 1;
      return null;
    }

    const bookmark = addBookmark(
      target,
      parentId,
      {
        title: item.title,
        url: item.url,
        normalizedUrl,
        description: item.description,
        tagIds: item.tagIds,
        favicon: item.favicon,
        lastOpenedAt: item.lastOpenedAt,
        openCount: item.openCount,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        source: item.source,
        rawMeta: item.rawMeta
      },
      idFactory
    );

    if (parentId === target.rootId) {
      target.items[parentId].children = target.items[parentId].children.filter((childId) => childId !== bookmark.id);
    }

    options.existingUrls?.add(normalizedUrl);
    options.stats.addedBookmarks += 1;
    return bookmark;
  }

  throw new Error(`Unsupported item type while merging: ${item?.type}`);
}

function normalizeImportMode(mode) {
  const normalized = String(mode ?? "merge").toLowerCase();

  if (!IMPORT_MODES.has(normalized)) {
    throw new Error(`Unsupported import mode: ${mode}. Supported modes: ${Array.from(IMPORT_MODES).join(", ")}`);
  }

  return normalized;
}

function collectActiveNormalizedUrls(library) {
  const urls = new Set();

  walkLibrary(library, (item) => {
    if (isBookmark(item) && !item.deletedAt) {
      urls.add(item.normalizedUrl ?? normalizeUrl(item.url));
    }
  });

  return urls;
}

function countImportedItems(library) {
  const counts = {
    bookmarks: 0,
    folders: 0
  };

  for (const item of Object.values(library.items)) {
    if (isBookmark(item)) {
      counts.bookmarks += 1;
    } else if (isFolder(item) && item.id !== library.rootId) {
      counts.folders += 1;
    }
  }

  return counts;
}

function walkLibrary(library, visit) {
  const walk = (id, path) => {
    const item = library.items[id];

    if (!item || item.deletedAt) {
      return;
    }

    const nextPath = isFolder(item) && id !== library.rootId ? [...path, item.title] : path;
    visit(item, path);

    if (isFolder(item)) {
      for (const child of item.children) {
        walk(child, nextPath);
      }
    }
  };

  walk(library.rootId, []);
}
