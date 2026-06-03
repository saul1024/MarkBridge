#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

import { exportBookmarksHtml, importBookmarksHtml, listBrowserBackups, listBrowserProfiles, pullBrowserBookmarks, pushLibraryToBrowser, resolveExportFolder, restoreBrowserBackup } from "../src/index.js";
import {
  applyImportedLibrary,
  libraryStats,
  listBookmarks,
  removeBookmarks,
  searchBookmarks,
  updateBookmark
} from "../src/library.js";
import { getDefaultLibraryPath, loadLibrary, saveLibrary } from "../src/store.js";

main(process.argv.slice(2)).catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

async function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  const command = positionals[0];
  const libraryPath = flags.library ?? getDefaultLibraryPath(process.env);

  if (!command || flags.help || command === "help") {
    printHelp();
    return;
  }

  if (command === "import") {
    await commandImport(positionals.slice(1), flags, libraryPath);
    return;
  }

  if (command === "list") {
    await commandList(flags, libraryPath);
    return;
  }

  if (command === "search") {
    await commandSearch(positionals.slice(1), flags, libraryPath);
    return;
  }

  if (command === "export") {
    await commandExport(positionals.slice(1), flags, libraryPath);
    return;
  }

  if (command === "export-browser") {
    await commandExportBrowser(positionals.slice(1), flags);
    return;
  }

  if (command === "import-browser") {
    await commandImportBrowser(positionals.slice(1), flags);
    return;
  }

  if (command === "edit") {
    await commandEdit(positionals.slice(1), flags, libraryPath);
    return;
  }

  if (command === "delete") {
    await commandDelete(positionals.slice(1), flags, libraryPath);
    return;
  }

  if (command === "status") {
    await commandStatus(flags, libraryPath);
    return;
  }

  if (command === "where") {
    await commandWhere(flags, libraryPath);
    return;
  }

  if ((command === "browser" && positionals[1] === "profiles") || command === "browser-profiles") {
    await commandBrowserProfiles(flags);
    return;
  }

  if (command === "browser" && positionals[1] === "backups") {
    await commandBrowserBackups(flags);
    return;
  }

  if (command === "browser" && positionals[1] === "restore") {
    await commandBrowserRestore(flags);
    return;
  }

  if (command === "pull-browser") {
    await commandPullBrowser(flags, libraryPath);
    return;
  }

  if (command === "push-browser") {
    await commandPushBrowser(flags, libraryPath);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function commandImport(args, flags, libraryPath) {
  const inputPath = expandUserPath(args[0]);

  if (!inputPath) {
    throw new Error("Usage: markbridge import <bookmarks.html>");
  }

  if (!existsSync(inputPath)) {
    throw new Error([
      `Input bookmark file not found: ${inputPath}`,
      "No import was performed.",
      "Export bookmarks from your browser first, then run: markbridge import <bookmarks.html>",
      `Current MarkBridge library path would be: ${libraryPath}`
    ].join("\n"));
  }

  const html = await readFile(inputPath, "utf8");
  const imported = importBookmarksHtml(html, {
    sourceFileName: basename(inputPath),
    sourceBrowser: flags.browser
  });
  const existing = await loadLibrary(libraryPath);
  const mode = flags.mode ?? "merge";
  const workingLibrary = flags.dryRun && existing ? structuredClone(existing) : existing;
  const applied = applyImportedLibrary(workingLibrary, imported, { mode });

  if (!flags.dryRun) {
    await saveLibrary(applied.library, libraryPath);
  }

  printImportResult(flags, {
    libraryPath,
    mode,
    dryRun: Boolean(flags.dryRun),
    source: basename(inputPath),
    imported: imported.importBatch.stats,
    summary: applied.summary,
    verb: "import"
  });
}

async function commandList(flags, libraryPath) {
  const library = await requireLibrary(libraryPath);
  const rows = listBookmarks(library);

  printRows(flags, rows);
}

async function commandSearch(args, flags, libraryPath) {
  const query = args.join(" ");

  if (!query) {
    throw new Error("Usage: markbridge search <query>");
  }

  const library = await requireLibrary(libraryPath);
  const rows = searchBookmarks(library, query);

  printRows(flags, rows);
}

async function commandExport(args, flags, libraryPath) {
  const outputPath = expandUserPath(args[0]);

  if (!outputPath) {
    throw new Error("Usage: markbridge export <output.html> [--folder name|path] [--folder-path path]");
  }

  if (flags.folder === true || flags.folderPath === true) {
    throw new Error("Usage: markbridge export <output.html> [--folder name|path] [--folder-path path]");
  }

  const library = await requireLibrary(libraryPath);
  const exportOptions = {
    includeEmptyFolders: Boolean(flags.includeEmptyFolders),
    folder: flags.folder,
    folderPath: flags.folderPath
  };
  const folderScope = resolveExportFolder(library, exportOptions);
  const html = exportBookmarksHtml(library, {
    ...exportOptions,
    folderId: folderScope?.id
  });

  await writeFile(outputPath, html, "utf8");
  printJsonOrText(flags, {
    outputPath,
    folder: folderScope
  }, folderScope ? `Exported ${outputPath}\nFolder: ${folderScope.path}` : `Exported ${outputPath}`);
}

async function commandExportBrowser(args, flags) {
  const outputPath = expandUserPath(valueFromFlagOrArg(flags.output, args[0]));

  if (!flags.browser || !flags.profile || !outputPath) {
    throw new Error("Usage: markbridge export-browser --browser chrome --profile <profile> --output <output.html> [--folder name|path] [--folder-path path] [--dry-run]");
  }

  if (flags.output === true || flags.folder === true || flags.folderPath === true) {
    throw new Error("Usage: markbridge export-browser --browser chrome --profile <profile> --output <output.html> [--folder name|path] [--folder-path path] [--dry-run]");
  }

  const pulled = await pullBrowserBookmarks({
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    env: process.env
  });
  const exportOptions = {
    includeEmptyFolders: Boolean(flags.includeEmptyFolders),
    folder: flags.folder,
    folderPath: flags.folderPath
  };
  const folderScope = resolveExportFolder(pulled.library, exportOptions);
  const result = {
    dryRun: Boolean(flags.dryRun),
    outputPath,
    browser: pulled.browser,
    browserName: pulled.browserName,
    profile: pulled.profile,
    profileName: pulled.profileName,
    bookmarksPath: pulled.bookmarksPath,
    folder: folderScope,
    pulled: pulled.importBatch.stats
  };

  if (!flags.dryRun) {
    const html = exportBookmarksHtml(pulled.library, {
      ...exportOptions,
      folderId: folderScope?.id
    });

    await writeFile(outputPath, html, "utf8");
  }

  printJsonOrText(flags, result, formatExportBrowserResult(result));
}

async function commandImportBrowser(args, flags) {
  const inputPath = expandUserPath(valueFromFlagOrArg(flags.input, args[0]));

  if (!inputPath || !flags.browser || !flags.profile) {
    throw new Error("Usage: markbridge import-browser --input <bookmarks.html> --browser chrome --profile <profile> [--folder MarkBridge] [--quit-browser] [--reopen] [--dry-run]");
  }

  if (flags.input === true || flags.folder === true) {
    throw new Error("Usage: markbridge import-browser --input <bookmarks.html> --browser chrome --profile <profile> [--folder MarkBridge] [--quit-browser] [--reopen] [--dry-run]");
  }

  if (!existsSync(inputPath)) {
    throw new Error(`Input bookmark file not found: ${inputPath}`);
  }

  const html = await readFile(inputPath, "utf8");
  const imported = importBookmarksHtml(html, {
    sourceFileName: basename(inputPath),
    sourceBrowser: flags.browser
  });
  const targetFolder = flags.folder ?? "MarkBridge";

  if (flags.dryRun) {
    const profile = await resolveBrowserProfileForCli(flags);
    const result = {
      dryRun: true,
      inputPath,
      browser: profile.browser,
      browserName: profile.browserName,
      profile: profile.profile,
      profileName: profile.name,
      bookmarksPath: profile.bookmarksPath,
      folder: targetFolder,
      imported: imported.importBatch.stats
    };

    printJsonOrText(flags, result, formatImportBrowserDryRunResult(result));
    return;
  }

  const pushed = await pushLibraryToBrowser(imported.library, {
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    folder: targetFolder,
    quitBrowser: Boolean(flags.quitBrowser),
    reopen: Boolean(flags.reopen),
    skipRunningCheck: Boolean(flags.skipRunningCheck),
    env: process.env
  });
  const result = {
    dryRun: false,
    inputPath,
    imported: imported.importBatch.stats,
    ...pushed
  };

  printJsonOrText(flags, result, formatImportBrowserResult(result));
}

async function commandEdit(args, flags, libraryPath) {
  const id = args[0];

  if (!id || (flags.title === undefined && flags.url === undefined && flags.description === undefined)) {
    throw new Error("Usage: markbridge edit <bookmark-id> [--title text] [--url url] [--description text]");
  }

  const library = await requireLibrary(libraryPath);
  const updated = updateBookmark(library, id, {
    title: flags.title,
    url: flags.url,
    description: flags.description
  });

  if (!updated) {
    throw new Error(`Bookmark not found: ${id}`);
  }

  await saveLibrary(library, libraryPath);
  printJsonOrText(flags, {
    id: updated.id,
    title: updated.title,
    url: updated.url
  }, `Updated ${updated.id}`);
}

async function commandDelete(args, flags, libraryPath) {
  const ids = args.filter((arg) => !arg.startsWith("-"));

  if (ids.length === 0) {
    throw new Error("Usage: markbridge delete <bookmark-id...>");
  }

  const library = await requireLibrary(libraryPath);
  const removed = removeBookmarks(library, ids);

  await saveLibrary(library, libraryPath);
  printJsonOrText(flags, {
    removed: removed.map((item) => ({ id: item.id, title: item.title, url: item.url }))
  }, `Deleted ${removed.length} bookmark(s)`);
}

async function commandStatus(flags, libraryPath) {
  const library = await requireLibrary(libraryPath);
  const stats = libraryStats(library);

  printJsonOrText(flags, { libraryPath, stats }, [
    `Library: ${libraryPath}`,
    `Bookmarks: ${stats.bookmarks}`,
    `Folders: ${stats.folders}`
  ].join("\n"));
}

async function commandWhere(flags, libraryPath) {
  const exists = Boolean(await loadLibrary(libraryPath));

  printJsonOrText(flags, {
    libraryPath,
    exists,
    plaintext: true
  }, [
    `Library: ${libraryPath}`,
    `Exists: ${exists ? "yes" : "no"}`,
    "Local storage: plaintext",
    exists ? "Verify with: markbridge status && markbridge list" : "Run first: markbridge import <bookmarks.html>"
  ].join("\n"));
}

async function commandBrowserProfiles(flags) {
  const profiles = await listBrowserProfiles({
    browser: flags.browser,
    browserRoot: expandUserPath(flags.browserRoot),
    env: process.env
  });

  if (flags.json) {
    console.log(JSON.stringify(profiles, null, 2));
    return;
  }

  if (profiles.length === 0) {
    console.log(flags.browser ? `No ${flags.browser} profiles found.` : "No supported browser profiles found.");
    return;
  }

  for (const profile of profiles) {
    console.log([
      profile.browser,
      profile.profile,
      profile.name,
      profile.hasBookmarks ? "bookmarks=yes" : "bookmarks=no",
      profile.bookmarksPath
    ].join("\t"));
  }
}

async function resolveBrowserProfileForCli(flags) {
  const profiles = await listBrowserProfiles({
    browser: flags.browser,
    browserRoot: expandUserPath(flags.browserRoot),
    env: process.env
  });
  const requested = String(flags.profile);
  const matches = profiles.filter((profile) => profile.profile === requested || profile.name === requested);

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(`Browser profile is ambiguous: ${requested}. Use the profile directory name instead.`);
  }

  throw new Error(`Browser profile not found: ${requested}. Run markbridge browser profiles --browser ${flags.browser} first.`);
}

async function commandBrowserBackups(flags) {
  if (!flags.browser || !flags.profile) {
    throw new Error("Usage: markbridge browser backups --browser chrome --profile <profile>");
  }

  const backups = await listBrowserBackups({
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    env: process.env
  });

  if (flags.json) {
    console.log(JSON.stringify(backups, null, 2));
    return;
  }

  if (backups.length === 0) {
    console.log(`No backups found for ${flags.browser} / ${flags.profile}.`);
    return;
  }

  for (const backup of backups) {
    console.log([
      backup.browser,
      backup.profile,
      backup.modifiedAt,
      `${backup.size} bytes`,
      backup.path
    ].join("\t"));
  }
}

async function commandBrowserRestore(flags) {
  if (!flags.browser || !flags.profile || !flags.backup) {
    throw new Error("Usage: markbridge browser restore --browser chrome --profile <profile> --backup <path>");
  }

  const result = await restoreBrowserBackup({
    browser: flags.browser,
    profile: flags.profile,
    backupPath: expandUserPath(flags.backup),
    browserRoot: expandUserPath(flags.browserRoot),
    quitBrowser: Boolean(flags.quitBrowser),
    reopen: Boolean(flags.reopen),
    skipRunningCheck: Boolean(flags.skipRunningCheck),
    env: process.env
  });
  const output = [
    `Restored ${result.browserName} / ${result.profile} bookmarks.`,
    `Bookmarks file: ${result.bookmarksPath}`,
    `Restored from: ${result.restoredFrom}`,
    `Safety backup: ${result.safetyBackupPath}`
  ];

  if (result.quitBrowser) {
    output.push(`Closed ${result.browserName}: yes`);
  }

  if (result.reopened) {
    output.push(`Reopened ${result.browserName}: yes`);
  }

  output.push(
    "Verify:",
    result.reopened ? `  ${result.browserName} should open ${result.verifyUrl}` : `  Open ${result.verifyUrl}`
  );

  printJsonOrText(flags, result, output.join("\n"));
}

async function commandPullBrowser(flags, libraryPath) {
  if (!flags.browser || !flags.profile) {
    throw new Error("Usage: markbridge pull-browser --browser chrome --profile <profile>");
  }

  const pulled = await pullBrowserBookmarks({
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    env: process.env
  });
  const existing = await loadLibrary(libraryPath);
  const mode = flags.mode ?? "merge";
  const workingLibrary = flags.dryRun && existing ? structuredClone(existing) : existing;
  const applied = applyImportedLibrary(workingLibrary, pulled, { mode });

  if (!flags.dryRun) {
    await saveLibrary(applied.library, libraryPath);
  }

  printImportResult(flags, {
    libraryPath,
    mode,
    dryRun: Boolean(flags.dryRun),
    source: `${pulled.browserName} / ${pulled.profile}`,
    imported: pulled.importBatch.stats,
    summary: applied.summary,
    verb: "pull",
    extra: {
      browser: pulled.browser,
      browserName: pulled.browserName,
      profile: pulled.profile,
      profileName: pulled.profileName,
      bookmarksPath: pulled.bookmarksPath
    }
  });
}

async function commandPushBrowser(flags, libraryPath) {
  if (!flags.browser || !flags.profile) {
    throw new Error("Usage: markbridge push-browser --browser chrome --profile <profile>");
  }

  const library = await requireLibrary(libraryPath);
  const result = await pushLibraryToBrowser(library, {
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    folder: flags.folder,
    quitBrowser: Boolean(flags.quitBrowser),
    reopen: Boolean(flags.reopen),
    skipRunningCheck: Boolean(flags.skipRunningCheck),
    env: process.env
  });

  const output = [
    `Pushed ${result.pushed} bookmark(s) to ${result.browserName} / ${result.profile}.`,
    `Folder: Bookmarks Bar / ${result.folder}`,
    `Bookmarks file: ${result.bookmarksPath}`,
    `Backup: ${result.backupPath}`
  ];

  if (result.quitBrowser) {
    output.push(`Closed ${result.browserName}: yes`);
  }

  if (result.reopened) {
    output.push(`Reopened ${result.browserName}: yes`);
  }

  output.push(
    "Verify:",
    result.reopened ? `  ${result.browserName} should open ${result.verifyUrl}` : `  Open ${result.verifyUrl}`,
    `  Check folder: Bookmarks Bar / ${result.folder}`
  );

  printJsonOrText(flags, result, output.join("\n"));
}

async function requireLibrary(libraryPath) {
  const library = await loadLibrary(libraryPath);

  if (!library) {
    throw new Error(`No MarkBridge library found at ${libraryPath}. Run markbridge import <bookmarks.html> first.`);
  }

  return library;
}

function expandUserPath(value) {
  if (!value) {
    return value;
  }

  if (value === "~") {
    return process.env.HOME;
  }

  if (value.startsWith("~/")) {
    return `${process.env.HOME}${value.slice(1)}`;
  }

  return value;
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = argv[index + 1];

    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { flags, positionals };
}

function valueFromFlagOrArg(flagValue, positionalValue) {
  if (flagValue === true) {
    return undefined;
  }

  return flagValue ?? positionalValue;
}

function printRows(flags, rows) {
  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  for (const row of rows) {
    console.log(`${row.id}\t${row.title}\t${row.url}\t${row.path}`);
  }
}

function printJsonOrText(flags, object, text) {
  if (flags.json) {
    console.log(JSON.stringify(object, null, 2));
    return;
  }

  console.log(text);
}

function printImportResult(flags, result) {
  const object = {
    libraryPath: result.libraryPath,
    mode: result.mode,
    dryRun: result.dryRun,
    source: result.source,
    imported: result.imported,
    added: {
      bookmarks: result.summary.addedBookmarks,
      folders: result.summary.addedFolders
    },
    skippedDuplicates: result.summary.skippedDuplicates,
    replaced: result.summary.replaced,
    ...result.extra
  };
  const action = result.dryRun
    ? (result.verb === "pull" ? "Would pull" : "Would import")
    : (result.verb === "pull" ? "Pulled" : "Imported");
  const output = [
    `${action} ${result.imported.bookmarks} bookmarks and ${result.imported.folders} folders from ${result.source}.`,
    `Mode: ${result.mode}`,
    `Added: ${result.summary.addedBookmarks} bookmark(s), ${result.summary.addedFolders} folder(s)`,
    `Skipped duplicates: ${result.summary.skippedDuplicates}`,
    `Source duplicates: ${result.imported.duplicates ?? 0}`,
    result.dryRun ? "No library changes were written." : `Library: ${result.libraryPath}`
  ];

  if (!result.dryRun) {
    output.push(
      "Verify:",
      "  markbridge status",
      "  markbridge list"
    );
  }

  printJsonOrText(flags, object, output.join("\n"));
}

function formatExportBrowserResult(result) {
  return [
    result.dryRun
      ? `Would export ${result.browserName} / ${result.profile} bookmarks to ${result.outputPath}.`
      : `Exported ${result.browserName} / ${result.profile} bookmarks to ${result.outputPath}.`,
    `Profile name: ${result.profileName}`,
    `Bookmarks file: ${result.bookmarksPath}`,
    `Folder: ${result.folder?.path ?? "all bookmarks"}`,
    `Pulled: ${result.pulled.bookmarks} bookmark(s), ${result.pulled.folders} folder(s)`,
    result.dryRun ? "No output file was written." : `Output: ${result.outputPath}`
  ].join("\n");
}

function formatImportBrowserDryRunResult(result) {
  return [
    `Would import ${result.inputPath} to ${result.browserName} / ${result.profile}.`,
    `Profile name: ${result.profileName}`,
    `Target folder: Bookmarks Bar / ${result.folder}`,
    `Bookmarks file: ${result.bookmarksPath}`,
    `Imported: ${result.imported.bookmarks} bookmark(s), ${result.imported.folders} folder(s)`,
    "No browser bookmarks were written."
  ].join("\n");
}

function formatImportBrowserResult(result) {
  const output = [
    `Imported ${result.inputPath} to ${result.browserName} / ${result.profile}.`,
    `Profile name: ${result.profileName}`,
    `Imported: ${result.imported.bookmarks} bookmark(s), ${result.imported.folders} folder(s)`,
    `Pushed: ${result.pushed} bookmark(s)`,
    `Target folder: Bookmarks Bar / ${result.folder}`,
    `Bookmarks file: ${result.bookmarksPath}`,
    `Backup: ${result.backupPath}`
  ];

  if (result.quitBrowser) {
    output.push(`Closed ${result.browserName}: yes`);
  }

  if (result.reopened) {
    output.push(`Reopened ${result.browserName}: yes`);
  }

  output.push(
    "Verify:",
    result.reopened ? `  ${result.browserName} should open ${result.verifyUrl}` : `  Open ${result.verifyUrl}`,
    `  Check folder: Bookmarks Bar / ${result.folder}`
  );

  return output.join("\n");
}

function printHelp() {
  console.log(`MarkBridge

Usage:
  markbridge export-browser --browser chrome|edge --profile <profile> --output <output.html> [--folder name|path] [--folder-path path] [--dry-run]
  markbridge import-browser --input <bookmarks.html> --browser chrome|edge --profile <profile> [--folder MarkBridge] [--quit-browser] [--reopen] [--dry-run]
  markbridge import <bookmarks.html> [--mode merge|append|replace] [--dry-run] [--library path]
  markbridge list [--json]
  markbridge search <query> [--json]
  markbridge edit <bookmark-id> [--title text] [--url url] [--description text]
  markbridge delete <bookmark-id...>
  markbridge export <output.html> [--folder name|path] [--folder-path path] [--include-empty-folders]
  markbridge browser profiles [--browser chrome|edge]
  markbridge browser backups --browser chrome|edge --profile <profile>
  markbridge browser restore --browser chrome|edge --profile <profile> --backup <path> [--quit-browser] [--reopen]
  markbridge pull-browser --browser chrome|edge --profile <profile> [--mode merge|append|replace] [--dry-run]
  markbridge push-browser --browser chrome|edge --profile <profile> [--folder MarkBridge] [--quit-browser] [--reopen]
  markbridge status
  markbridge where

Storage:
  Default library: ~/.markbridge/library.json
  Override with MARKBRIDGE_HOME or --library.

Current phase stores local data in plaintext.`);
}
