import { escapeHtmlAttribute, escapeHtmlText } from "./entities.js";
import { getChildren, isBookmark, isFolder } from "./model.js";

export function exportBookmarksHtml(library, options = {}) {
  const folderScope = resolveExportFolder(library, options);
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>"
  ];

  if (folderScope) {
    appendItem(lines, library, library.items[folderScope.id], 1, options);
  } else {
    for (const child of getChildren(library, library.rootId)) {
      appendItem(lines, library, child, 1, options);
    }
  }

  lines.push("</DL><p>");
  return `${lines.join("\n")}\n`;
}

export function matchExportFolders(library, options = {}) {
  if (options.folderId) {
    const item = library.items[options.folderId];

    if (!isFolder(item) || item.deletedAt) {
      return {
        selector: String(options.folderId),
        matches: [],
        folders: listExportFolders(library),
        reason: "not-found"
      };
    }

    return {
      selector: String(options.folderId),
      matches: [describeFolder(library, item)],
      folders: listExportFolders(library),
      reason: "ok"
    };
  }

  const folderPath = normalizeFolderPath(options.folderPath);
  const folder = normalizeFolderPath(options.folder);

  if (!folderPath && !folder) {
    return {
      selector: "",
      matches: [],
      folders: listExportFolders(library),
      reason: "none"
    };
  }

  const selector = folderPath || folder;
  const folders = listExportFolders(library);
  const matches = folderPath
    ? folders.filter((candidate) => candidate.path === selector)
    : findFolderMatches(folders, selector);

  if (matches.length === 1) {
    return { selector, matches, folders, reason: "ok" };
  }

  if (matches.length > 1) {
    return { selector, matches, folders, reason: "ambiguous" };
  }

  return { selector, matches: [], folders, reason: "not-found" };
}

export function resolveExportFolder(library, options = {}) {
  const matched = matchExportFolders(library, options);

  if (matched.reason === "none") {
    return null;
  }

  if (matched.reason === "ok") {
    return matched.matches[0];
  }

  if (matched.reason === "ambiguous") {
    throw new Error([
      `Folder selector is ambiguous: ${matched.selector}`,
      "Matched folders:",
      ...matched.matches.map((match) => `  ${match.path}`),
      "Use --folder-path with one exact path."
    ].join("\n"));
  }

  throw new Error([
    `Folder not found: ${matched.selector}`,
    "Available folders:",
    ...formatFolderList(matched.folders),
    "Retry with --folder-path and one exact path."
  ].join("\n"));
}

export function listExportFolders(library) {
  const folders = [];

  collectFolders(library, library.rootId, [], folders);
  return folders;
}

export function countExportedBookmarks(library, options = {}) {
  const folderScope = resolveExportFolder(library, options);
  const root = folderScope ? library.items[folderScope.id] : library.items[library.rootId];

  return countBookmarksUnder(library, root);
}

export function shouldExportBookmark(bookmark, options = {}) {
  return !bookmark.deletedAt;
}

function appendItem(lines, library, item, depth, options) {
  if (!item || item.deletedAt) {
    return false;
  }

  if (isBookmark(item)) {
    if (!shouldExportBookmark(item, options)) {
      return false;
    }

    lines.push(`${indent(depth)}<DT><A HREF="${escapeHtmlAttribute(item.url)}" ADD_DATE="${dateToBookmarkSeconds(item.createdAt)}">${escapeHtmlText(item.title)}</A>`);
    return true;
  }

  if (isFolder(item)) {
    const folderLines = [];
    let exportedChildren = 0;

    for (const child of getChildren(library, item.id)) {
      if (appendItem(folderLines, library, child, depth + 1, options)) {
        exportedChildren += 1;
      }
    }

    if (exportedChildren === 0 && !options.includeEmptyFolders) {
      return false;
    }

    lines.push(`${indent(depth)}<DT><H3 ADD_DATE="${dateToBookmarkSeconds(item.createdAt)}" LAST_MODIFIED="${dateToBookmarkSeconds(item.updatedAt)}">${escapeHtmlText(item.title)}</H3>`);
    lines.push(`${indent(depth)}<DL><p>`);
    lines.push(...folderLines);
    lines.push(`${indent(depth)}</DL><p>`);
    return true;
  }

  return false;
}

function collectFolders(library, folderId, parentPath, results) {
  for (const child of getChildren(library, folderId)) {
    if (!isFolder(child) || child.deletedAt) {
      continue;
    }

    const pathParts = [...parentPath, child.title];
    results.push({
      id: child.id,
      title: child.title,
      path: pathParts.join(" / ")
    });
    collectFolders(library, child.id, pathParts, results);
  }
}

function findFolderMatches(folders, selector) {
  const pathMatches = folders.filter((folder) => folder.path === selector);

  if (pathMatches.length > 0) {
    return pathMatches;
  }

  return folders.filter((folder) => folder.title === selector);
}

function describeFolder(library, folder) {
  const path = [];
  let current = folder;

  while (current && current.id !== library.rootId) {
    path.unshift(current.title);
    current = library.items[current.parentId];
  }

  return {
    id: folder.id,
    title: folder.title,
    path: path.join(" / ")
  };
}

function countBookmarksUnder(library, item) {
  if (!item || item.deletedAt) {
    return 0;
  }

  if (isBookmark(item)) {
    return shouldExportBookmark(item) ? 1 : 0;
  }

  if (!isFolder(item)) {
    return 0;
  }

  return getChildren(library, item.id)
    .reduce((total, child) => total + countBookmarksUnder(library, child), 0);
}

function formatFolderList(folders) {
  if (folders.length === 0) {
    return ["  <none>"];
  }

  return folders.slice(0, 25).map((folder) => `  ${folder.path}`);
}

function normalizeFolderPath(value) {
  if (value === undefined || value === null || value === true || value === false) {
    return "";
  }

  return String(value)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" / ");
}

function indent(depth) {
  return "    ".repeat(depth);
}

function dateToBookmarkSeconds(value) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "0";
  }

  return String(Math.floor(timestamp / 1000));
}
