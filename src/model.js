import { normalizeUrl } from "./normalize.js";
import { randomUUID } from "node:crypto";

export const ROOT_FOLDER_TITLE = "Bookmarks";

export function createIdFactory(prefix = "item") {
  let nextId = 1;
  return () => `${prefix}-${nextId++}`;
}

export function createRandomIdFactory(prefix = "item") {
  return () => `${prefix}-${randomUUID()}`;
}

export function createEmptyLibrary(options = {}) {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? createRandomIdFactory();
  const rootId = options.rootId ?? idFactory();

  return {
    schemaVersion: 1,
    libraryId: options.libraryId ?? idFactory(),
    rootId,
    items: {
      [rootId]: {
        id: rootId,
        parentId: null,
        type: "folder",
        title: ROOT_FOLDER_TITLE,
        children: [],
        createdAt: now,
        updatedAt: now,
        rawMeta: {}
      }
    },
    tags: {},
    imports: [],
    devices: {},
    createdAt: now,
    updatedAt: now
  };
}

export function addFolder(library, parentId, fields, idFactory = createRandomIdFactory()) {
  const now = fields.now ?? new Date().toISOString();
  const folder = {
    id: fields.id ?? idFactory(),
    parentId,
    type: "folder",
    title: fields.title ?? "",
    children: [],
    createdAt: fields.createdAt ?? now,
    updatedAt: fields.updatedAt ?? fields.createdAt ?? now,
    source: fields.source,
    rawMeta: fields.rawMeta ?? {}
  };

  addItem(library, folder);
  return folder;
}

export function addBookmark(library, parentId, fields, idFactory = createRandomIdFactory()) {
  const now = fields.now ?? new Date().toISOString();
  const url = fields.url ?? "";
  const bookmark = {
    id: fields.id ?? idFactory(),
    parentId,
    type: "bookmark",
    title: fields.title ?? "",
    url,
    normalizedUrl: fields.normalizedUrl ?? normalizeUrl(url),
    description: fields.description,
    tagIds: fields.tagIds ?? [],
    favicon: fields.favicon,
    lastOpenedAt: fields.lastOpenedAt,
    openCount: fields.openCount ?? 0,
    createdAt: fields.createdAt ?? now,
    updatedAt: fields.updatedAt ?? fields.createdAt ?? now,
    source: fields.source,
    rawMeta: fields.rawMeta ?? {}
  };

  addItem(library, bookmark);
  return bookmark;
}

export function getChildren(library, folderId) {
  const folder = library.items[folderId];

  if (!folder || folder.type !== "folder") {
    return [];
  }

  return folder.children.map((id) => library.items[id]).filter(Boolean);
}

export function isBookmark(item) {
  return item?.type === "bookmark";
}

export function isFolder(item) {
  return item?.type === "folder";
}

function addItem(library, item) {
  if (library.items[item.id]) {
    throw new Error(`Duplicate item id: ${item.id}`);
  }

  const parent = item.parentId ? library.items[item.parentId] : null;

  if (item.parentId && (!parent || parent.type !== "folder")) {
    throw new Error(`Parent folder does not exist: ${item.parentId}`);
  }

  library.items[item.id] = item;

  if (parent) {
    parent.children.push(item.id);
    parent.updatedAt = item.updatedAt;
  }

  library.updatedAt = item.updatedAt;
}
