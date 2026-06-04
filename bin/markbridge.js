#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

import { countExportedBookmarks, deleteCosFile, exportBookmarksHtml, getSyncRemoteStatus, importBookmarksHtml, isCosNotFoundError, listBrowserBackups, listBrowserProfiles, listCosFiles, loadCosConfig, loadEnvironment, previewLibraryToBrowser, pullBrowserBookmarks, pullCosFile, pushLibraryToBrowser, pushCosFile, resolveExportFolder, restoreBrowserBackup, syncPullCloudToBrowser, syncPushBrowserToCloud } from "../src/index.js";
import {
  applyImportedLibrary,
  libraryStats,
  listBookmarks,
  removeBookmarks,
  searchBookmarks,
  updateBookmark
} from "../src/library.js";
import { getDefaultLibraryPath, getDefaultSyncConfigPath, loadLibrary, loadSyncConfig, saveLibrary, saveSyncConfig } from "../src/store.js";

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

  if (command === "cloud") {
    await commandCloud(positionals.slice(1), flags);
    return;
  }

  if (command === "sync") {
    await commandSync(positionals.slice(1), flags);
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
  const exportedBookmarks = countExportedBookmarks(library, {
    ...exportOptions,
    folderId: folderScope?.id
  });
  const html = exportBookmarksHtml(library, {
    ...exportOptions,
    folderId: folderScope?.id
  });

  await writeFile(outputPath, html, "utf8");
  printJsonOrText(flags, {
    outputPath,
    folder: folderScope,
    exportedBookmarks
  }, folderScope ? `Exported ${outputPath}\nFolder: ${folderScope.path}\nBookmarks exported: ${exportedBookmarks}` : `Exported ${outputPath}\nBookmarks exported: ${exportedBookmarks}`);
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
  const exportedBookmarks = countExportedBookmarks(pulled.library, {
    ...exportOptions,
    folderId: folderScope?.id
  });
  const result = {
    dryRun: Boolean(flags.dryRun),
    outputPath,
    browser: pulled.browser,
    browserName: pulled.browserName,
    profile: pulled.profile,
    profileName: pulled.profileName,
    bookmarksPath: pulled.bookmarksPath,
    folder: folderScope,
    exportedBookmarks,
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
  const usage = "Usage: markbridge import-browser --input <bookmarks.html> --browser chrome --profile <profile> [--folder MarkBridge] [--mode merge|replace-folder|append] [--quit-browser] [--reopen] [--dry-run]";

  if (!inputPath || !flags.browser || !flags.profile) {
    throw new Error(usage);
  }

  if (flags.input === true || flags.folder === true || flags.mode === true) {
    throw new Error(usage);
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
  const mode = flags.mode ?? "merge";

  if (flags.dryRun) {
    const preview = await previewLibraryToBrowser(imported.library, {
      browser: flags.browser,
      profile: flags.profile,
      browserRoot: expandUserPath(flags.browserRoot),
      folder: targetFolder,
      mode,
      env: process.env
    });
    const result = {
      dryRun: true,
      inputPath,
      imported: imported.importBatch.stats,
      ...preview,
      folder: targetFolder,
    };

    printJsonOrText(flags, result, formatImportBrowserDryRunResult(result));
    return;
  }

  const pushed = await pushLibraryToBrowser(imported.library, {
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    folder: targetFolder,
    mode,
    quitBrowser: Boolean(flags.quitBrowser),
    reopen: Boolean(flags.reopen),
    skipRunningCheck: Boolean(flags.skipRunningCheck),
    retryHint: buildRetryCommand("import-browser", flags, { quitBrowser: true, reopen: true }),
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

async function commandCloud(args, flags) {
  const subcommand = args[0];

  if (subcommand === "push") {
    await commandCloudPush(args.slice(1), flags);
    return;
  }

  if (subcommand === "pull") {
    await commandCloudPull(args.slice(1), flags);
    return;
  }

  if (subcommand === "list") {
    await commandCloudList(flags);
    return;
  }

  if (subcommand === "delete") {
    await commandCloudDelete(args.slice(1), flags);
    return;
  }

  throw new Error("Usage: markbridge cloud push|pull|list|delete");
}

async function commandCloudPush(args, flags) {
  const filePath = expandUserPath(valueFromFlagOrArg(flags.file, args[0]));
  const remoteKey = valueFromFlagOrArg(flags.remote, args[1]);
  const usage = "Usage: markbridge cloud push --file <local-file> --remote <object-key>";

  if (!filePath || !remoteKey || flags.file === true || flags.remote === true) {
    throw new Error(usage);
  }

  if (!existsSync(filePath)) {
    throw new Error(`Local file not found: ${filePath}`);
  }

  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  const result = await pushCosFile({
    config,
    filePath,
    remoteKey,
    contentType: flags.contentType === true ? undefined : flags.contentType
  });

  printJsonOrText(flags, {
    provider: "cos",
    bucket: config.bucket,
    ...result
  }, [
    "Uploaded file to COS.",
    `Bucket: ${config.bucket}`,
    `Remote: ${result.remoteKey}`,
    `Local file: ${result.filePath}`,
    `Size: ${result.size} bytes`
  ].join("\n"));
}

async function commandCloudPull(args, flags) {
  const remoteKey = valueFromFlagOrArg(flags.remote, args[0]);
  const outputPath = expandUserPath(valueFromFlagOrArg(flags.output, args[1]));
  const usage = "Usage: markbridge cloud pull --remote <object-key> --output <local-file>";

  if (!remoteKey || !outputPath || flags.remote === true || flags.output === true) {
    throw new Error(usage);
  }

  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  const result = await pullCosFile({
    config,
    remoteKey,
    outputPath
  });

  printJsonOrText(flags, {
    provider: "cos",
    bucket: config.bucket,
    ...result
  }, [
    "Downloaded file from COS.",
    `Bucket: ${config.bucket}`,
    `Remote: ${result.remoteKey}`,
    `Output: ${result.outputPath}`,
    `Size: ${result.size} bytes`
  ].join("\n"));
}

async function commandCloudList(flags) {
  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  const result = await listCosFiles({
    config,
    prefix: flags.prefix === true ? undefined : flags.prefix,
    maxKeys: flags.maxKeys === true ? undefined : flags.maxKeys
  });

  if (flags.json) {
    console.log(JSON.stringify({
      provider: "cos",
      bucket: config.bucket,
      ...result
    }, null, 2));
    return;
  }

  if (result.objects.length === 0) {
    console.log(`No COS objects found in ${config.bucket}${result.prefix ? ` with prefix ${result.prefix}` : ""}.`);
    return;
  }

  for (const object of result.objects) {
    console.log([
      object.key,
      `${object.size} bytes`,
      object.lastModified
    ].join("\t"));
  }
}

async function commandCloudDelete(args, flags) {
  const remoteKey = valueFromFlagOrArg(flags.remote, args[0]);
  const usage = "Usage: markbridge cloud delete --remote <object-key>";

  if (!remoteKey || flags.remote === true) {
    throw new Error(usage);
  }

  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  const result = await deleteCosFile({
    config,
    remoteKey
  });

  printJsonOrText(flags, {
    provider: "cos",
    bucket: config.bucket,
    ...result
  }, [
    "Deleted COS object.",
    `Bucket: ${config.bucket}`,
    `Remote: ${result.remoteKey}`
  ].join("\n"));
}

async function commandSync(args, flags) {
  const subcommand = args[0];

  if (subcommand === "setup") {
    await commandSyncSetup(flags);
    return;
  }

  if (subcommand === "status") {
    await commandSyncStatus(flags);
    return;
  }

  if (subcommand === "check") {
    await commandSyncCheck(flags);
    return;
  }

  if (subcommand === "verify") {
    await commandSyncVerify(flags);
    return;
  }

  if (subcommand === "push") {
    await commandSyncPush(flags);
    return;
  }

  if (subcommand === "pull") {
    await commandSyncPull(flags);
    return;
  }

  if (subcommand === "push-browser") {
    await commandSyncPushBrowser(flags);
    return;
  }

  if (subcommand === "pull-browser") {
    await commandSyncPullBrowser(flags);
    return;
  }

  throw new Error("Usage: markbridge sync setup|status|check|verify|push|pull|push-browser|pull-browser");
}

async function commandSyncSetup(flags) {
  const usage = "Usage: markbridge sync setup --browser chrome --profile <profile> [--folder name|path] [--folder-path path] [--mode merge|replace-folder|append] [--remote <object-key>]";

  if (!flags.browser || !flags.profile) {
    throw new Error(usage);
  }

  if (flags.browser === true || flags.profile === true || flags.remote === true || flags.folder === true || flags.folderPath === true || flags.mode === true) {
    throw new Error(usage);
  }

  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  const preview = await syncPushBrowserToCloud({
    config,
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    folder: flags.folder,
    folderPath: flags.folderPath,
    includeEmptyFolders: Boolean(flags.includeEmptyFolders),
    remoteKey: flags.remote,
    dryRun: true,
    env: process.env
  });
  const syncConfigPath = getDefaultSyncConfigPath(process.env);
  const saved = await saveSyncConfig({
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    folder: flags.folder,
    folderPath: flags.folderPath,
    includeEmptyFolders: Boolean(flags.includeEmptyFolders),
    mode: flags.mode ?? "merge",
    remoteKey: preview.remoteKey
  }, syncConfigPath);
  const result = {
    provider: "cos",
    bucket: config.bucket,
    configPath: syncConfigPath,
    config: saved.config,
    preview
  };

  printJsonOrText(flags, result, formatSyncSetupResult({
    bucket: config.bucket,
    configPath: syncConfigPath,
    config: saved.config,
    ...preview
  }));
}

async function commandSyncStatus(flags) {
  const syncConfigPath = getDefaultSyncConfigPath(process.env);
  const syncConfig = await loadRequiredSyncConfig(syncConfigPath);
  let remote = null;
  let cosBucket = null;

  if (flags.remote) {
    const env = await loadEnvironmentForCli(flags);
    const config = loadCosConfig(env);

    cosBucket = config.bucket;
    remote = await getSyncRemoteStatus({
      config,
      remoteKey: syncConfig.remoteKey,
      browser: syncConfig.browser,
      profile: syncConfig.profile,
      folder: syncConfig.folder
    });
  }

  printJsonOrText(flags, {
    configPath: syncConfigPath,
    config: syncConfig,
    bucket: cosBucket,
    remote
  }, formatSyncStatusResult({
    configPath: syncConfigPath,
    config: syncConfig,
    bucket: cosBucket,
    remote
  }));
}

async function commandSyncCheck(flags) {
  const result = await buildSyncCheckResult(flags);

  printJsonOrText(flags, result, formatSyncCheckResult(result));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function commandSyncVerify(flags) {
  const result = await buildSyncVerifyResult(flags);

  printJsonOrText(flags, result, formatSyncVerifyResult(result));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function commandSyncPush(flags) {
  if (flags.remote === true || flags.folder === true || flags.folderPath === true) {
    throw new Error("Usage: markbridge sync push [--dry-run] [--remote <object-key>] [--folder name|path] [--folder-path path]");
  }

  const syncConfigPath = getDefaultSyncConfigPath(process.env);
  const syncConfig = await loadRequiredSyncConfig(syncConfigPath);
  const options = mergeSyncConfigWithFlags(syncConfig, flags);
  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  const result = await syncPushBrowserToCloud({
    config,
    browser: options.browser,
    profile: options.profile,
    browserRoot: expandUserPath(options.browserRoot),
    folder: options.folder,
    folderPath: options.folderPath,
    includeEmptyFolders: Boolean(options.includeEmptyFolders),
    remoteKey: options.remoteKey,
    dryRun: Boolean(flags.dryRun),
    env: process.env
  });

  printJsonOrText(flags, {
    provider: "cos",
    bucket: config.bucket,
    configPath: syncConfigPath,
    ...result
  }, formatSyncPushBrowserResult({
    bucket: config.bucket,
    configPath: syncConfigPath,
    ...result
  }));
}

async function commandSyncPull(flags) {
  if (flags.remote === true || flags.folder === true || flags.mode === true) {
    throw new Error("Usage: markbridge sync pull --dry-run|--apply [--remote <object-key>] [--folder MarkBridge] [--mode merge|replace-folder|append] [--quit-browser] [--reopen]");
  }

  if (flags.dryRun && flags.apply) {
    throw new Error("Use either markbridge sync pull --dry-run or markbridge sync pull --apply, not both.");
  }

  if (!flags.dryRun && !flags.apply) {
    throw new Error("Use markbridge sync pull --dry-run to preview, or markbridge sync pull --apply to write browser bookmarks.");
  }

  const syncConfigPath = getDefaultSyncConfigPath(process.env);
  const syncConfig = await loadRequiredSyncConfig(syncConfigPath);
  const options = mergeSyncConfigWithFlags(syncConfig, flags);
  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  let result;

  try {
    result = await syncPullCloudToBrowser({
    config,
    remoteKey: options.remoteKey,
    browser: options.browser,
    profile: options.profile,
    browserRoot: expandUserPath(options.browserRoot),
    folder: options.folder,
    mode: options.mode,
    dryRun: Boolean(flags.dryRun),
    quitBrowser: Boolean(flags.quitBrowser),
    reopen: Boolean(flags.reopen),
    skipRunningCheck: Boolean(flags.skipRunningCheck),
    retryHint: buildRetryCommand("sync pull", flags, { apply: true, quitBrowser: true, reopen: true, dryRun: false }),
    env: process.env
    });
  } catch (error) {
    throwFriendlyRemoteNotFound(error, options.remoteKey, "markbridge sync push");
    throw error;
  }

  printJsonOrText(flags, {
    provider: "cos",
    bucket: config.bucket,
    configPath: syncConfigPath,
    ...result
  }, result.dryRun
    ? formatSyncPullBrowserDryRunResult({
      bucket: config.bucket,
      configPath: syncConfigPath,
      ...result
    })
    : formatSyncPullBrowserResult({
      bucket: config.bucket,
      configPath: syncConfigPath,
      ...result
    }));
}

async function commandSyncPushBrowser(flags) {
  const usage = "Usage: markbridge sync push-browser --browser chrome --profile <profile> [--remote <object-key>] [--folder name|path] [--folder-path path] [--dry-run]";

  if (!flags.browser || !flags.profile) {
    throw new Error(usage);
  }

  if (flags.remote === true || flags.folder === true || flags.folderPath === true) {
    throw new Error(usage);
  }

  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  const result = await syncPushBrowserToCloud({
    config,
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    folder: flags.folder,
    folderPath: flags.folderPath,
    includeEmptyFolders: Boolean(flags.includeEmptyFolders),
    remoteKey: flags.remote,
    dryRun: Boolean(flags.dryRun),
    env: process.env
  });

  printJsonOrText(flags, {
    provider: "cos",
    bucket: config.bucket,
    ...result
  }, formatSyncPushBrowserResult({
    bucket: config.bucket,
    ...result
  }));
}

async function commandSyncPullBrowser(flags) {
  const usage = "Usage: markbridge sync pull-browser [--remote <object-key>] --browser chrome --profile <profile> [--folder MarkBridge] [--mode merge|replace-folder|append] [--dry-run] [--quit-browser] [--reopen]";

  if (!flags.browser || !flags.profile) {
    throw new Error(usage);
  }

  if (flags.remote === true || flags.folder === true || flags.mode === true) {
    throw new Error(usage);
  }

  const env = await loadEnvironmentForCli(flags);
  const config = loadCosConfig(env);
  let result;

  try {
    result = await syncPullCloudToBrowser({
    config,
    remoteKey: flags.remote,
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    folder: flags.folder,
    mode: flags.mode,
    dryRun: Boolean(flags.dryRun),
    quitBrowser: Boolean(flags.quitBrowser),
    reopen: Boolean(flags.reopen),
    skipRunningCheck: Boolean(flags.skipRunningCheck),
    retryHint: buildRetryCommand("sync pull-browser", flags, { quitBrowser: true, reopen: true, dryRun: false }),
    env: process.env
    });
  } catch (error) {
    throwFriendlyRemoteNotFound(error, flags.remote, "markbridge sync push-browser --browser <browser> --profile <profile> --folder <folder>");
    throw error;
  }

  printJsonOrText(flags, {
    provider: "cos",
    bucket: config.bucket,
    ...result
  }, result.dryRun
    ? formatSyncPullBrowserDryRunResult({
      bucket: config.bucket,
      ...result
    })
    : formatSyncPullBrowserResult({
      bucket: config.bucket,
      ...result
    }));
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
    retryHint: buildRetryCommand("browser restore", flags, { quitBrowser: true, reopen: true }),
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
    throw new Error("Usage: markbridge push-browser --browser chrome --profile <profile> [--folder MarkBridge] [--mode merge|replace-folder|append]");
  }

  const library = await requireLibrary(libraryPath);
  const result = await pushLibraryToBrowser(library, {
    browser: flags.browser,
    profile: flags.profile,
    browserRoot: expandUserPath(flags.browserRoot),
    folder: flags.folder,
    mode: flags.mode,
    quitBrowser: Boolean(flags.quitBrowser),
    reopen: Boolean(flags.reopen),
    skipRunningCheck: Boolean(flags.skipRunningCheck),
    retryHint: buildRetryCommand("push-browser", flags, { quitBrowser: true, reopen: true }),
    env: process.env
  });

  const output = [
    `Pushed ${result.pushed} bookmark(s) to ${result.browserName} / ${result.profile}.`,
    `Mode: ${result.mode}`,
    `Folders created: ${result.summary.addedFolders}`,
    `Skipped duplicates: ${result.summary.skippedDuplicates}`,
    `Target folder action: ${describeFolderAction(result.summary)}`,
    `Folder: Bookmarks Bar / ${result.folder}`,
    `Bookmarks file: ${result.bookmarksPath}`,
    result.backupPath ? `Backup: ${result.backupPath}` : "Backup: not created because no browser changes were needed"
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

  if (result.backupPath) {
    output.push(
      "Restore:",
      `  ${buildRestoreCommand(result)}`
    );
  }

  printJsonOrText(flags, result, output.join("\n"));
}

async function buildSyncCheckResult(flags) {
  const syncConfigPath = getDefaultSyncConfigPath(process.env);
  const checks = [];
  const syncConfig = await loadSyncConfig(syncConfigPath);

  if (!syncConfig) {
    checks.push(createCheck("config", "Sync defaults", "fail", `Missing config: ${syncConfigPath}`, "markbridge sync setup --browser chrome --profile <profile> --folder <folder>"));

    return {
      ok: false,
      configPath: syncConfigPath,
      config: null,
      checks
    };
  }

  checks.push(createCheck("config", "Sync defaults", "pass", syncConfigPath));

  const options = mergeSyncConfigWithFlags(syncConfig, flags);
  let env;
  let cosConfig;

  try {
    env = await loadEnvironmentForCli(flags);
    cosConfig = loadCosConfig(env);
    checks.push(createCheck("cos-config", "COS configuration", "pass", `Bucket: ${cosConfig.bucket}`));
  } catch (error) {
    checks.push(createCheck("cos-config", "COS configuration", "fail", error.message, "Check .env against .env.example"));
  }

  let sourcePreview = null;

  try {
    sourcePreview = await syncPushBrowserToCloud({
      config: cosConfig ?? {},
      browser: options.browser,
      profile: options.profile,
      browserRoot: expandUserPath(options.browserRoot),
      folder: options.folder,
      folderPath: options.folderPath,
      includeEmptyFolders: Boolean(options.includeEmptyFolders),
      remoteKey: options.remoteKey,
      dryRun: true,
      env: process.env
    });
    checks.push(createCheck("browser-source", "Browser profile and folder", "pass", `${sourcePreview.browserName} / ${sourcePreview.profileName} (${sourcePreview.profile}), ${sourcePreview.folder?.path ?? "all bookmarks"}, ${sourcePreview.exportedBookmarks} bookmark(s)`));
  } catch (error) {
    checks.push(createCheck("browser-source", "Browser profile and folder", "fail", error.message, `markbridge browser profiles --browser ${options.browser ?? "chrome"}`));
  }

  let remote = null;
  const remoteKey = sourcePreview?.remoteKey ?? options.remoteKey;

  if (cosConfig && remoteKey) {
    try {
      remote = await getSyncRemoteStatus({
        config: cosConfig,
        remoteKey
      });
      checks.push(remote.exists
        ? createCheck("remote-object", "COS remote object", "pass", formatRemoteSummary(remote))
        : createCheck("remote-object", "COS remote object", "fail", `Missing: ${remote.remoteKey}`, "markbridge sync push"));
    } catch (error) {
      checks.push(createCheck("remote-object", "COS remote object", "fail", error.message, "Check COS configuration and network access"));
    }
  } else {
    checks.push(createCheck("remote-object", "COS remote object", "fail", "Remote key is not available because source validation failed.", "Fix browser/profile/folder, then run markbridge sync setup again"));
  }

  return {
    ok: checks.every((check) => check.status === "pass"),
    configPath: syncConfigPath,
    config: syncConfig,
    bucket: cosConfig?.bucket,
    sourcePreview,
    remote,
    checks
  };
}

async function buildSyncVerifyResult(flags) {
  const check = await buildSyncCheckResult(flags);

  if (!check.ok || !check.remote?.exists) {
    return {
      ok: false,
      check,
      pullPreview: null
    };
  }

  const env = await loadEnvironmentForCli(flags);
  const cosConfig = loadCosConfig(env);
  const options = mergeSyncConfigWithFlags(check.config, flags);
  let pullPreview;

  try {
    pullPreview = await syncPullCloudToBrowser({
      config: cosConfig,
      remoteKey: check.remote.remoteKey,
      browser: options.browser,
      profile: options.profile,
      browserRoot: expandUserPath(options.browserRoot),
      folder: options.folder,
      mode: options.mode,
      dryRun: true,
      env: process.env
    });
  } catch (error) {
    if (isCosNotFoundError(error)) {
      return {
        ok: false,
        check,
        pullPreview: null,
        error: `Remote object not found: ${check.remote.remoteKey}`,
        next: "markbridge sync push"
      };
    }

    return {
      ok: false,
      check,
      pullPreview: null,
      error: error.message,
      next: "Fix the failed verify item, then run markbridge sync verify again"
    };
  }

  return {
    ok: true,
    check,
    pullPreview
  };
}

function createCheck(id, label, status, detail, next) {
  return {
    id,
    label,
    status,
    detail,
    next
  };
}

async function requireLibrary(libraryPath) {
  const library = await loadLibrary(libraryPath);

  if (!library) {
    throw new Error(`No MarkBridge library found at ${libraryPath}. Run markbridge import <bookmarks.html> first.`);
  }

  return library;
}

async function loadRequiredSyncConfig(syncConfigPath) {
  const config = await loadSyncConfig(syncConfigPath);

  if (!config) {
    throw new Error(`No MarkBridge sync defaults found at ${syncConfigPath}. Run markbridge sync setup --browser chrome --profile <profile> --folder <folder> first.`);
  }

  if (!config.browser || !config.profile) {
    throw new Error(`Invalid MarkBridge sync defaults at ${syncConfigPath}. Run markbridge sync setup again.`);
  }

  return config;
}

function mergeSyncConfigWithFlags(config, flags) {
  const merged = { ...config };
  const valueKeys = ["browser", "profile", "browserRoot", "folder", "folderPath", "mode"];
  const sourceOverridden = flags.browser !== undefined
    || flags.profile !== undefined
    || flags.folder !== undefined
    || flags.folderPath !== undefined;

  for (const key of valueKeys) {
    const value = flags[key];

    if (value !== undefined && value !== true) {
      merged[key] = value;
    }
  }

  if (flags.includeEmptyFolders) {
    merged.includeEmptyFolders = true;
  }

  if (flags.remote !== undefined && flags.remote !== true) {
    merged.remoteKey = flags.remote;
  } else if (sourceOverridden) {
    delete merged.remoteKey;
  }

  return merged;
}

function throwFriendlyRemoteNotFound(error, remoteKey, nextCommand) {
  if (!isCosNotFoundError(error)) {
    return;
  }

  const key = remoteKey || error.key || "(auto-generated remote key)";

  throw new Error([
    "Remote object not found.",
    `Remote: ${key}`,
    `Next: ${nextCommand}`
  ].join("\n"));
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

function buildRetryCommand(command, flags, overrides = {}) {
  const merged = {
    ...flags,
    ...overrides
  };
  const parts = ["markbridge", ...command.split(" ")];
  const orderedKeys = [
    "input",
    "remote",
    "browser",
    "profile",
    "folder",
    "folderPath",
    "mode",
    "backup",
    "browserRoot",
    "envFile"
  ];

  for (const key of orderedKeys) {
    const value = merged[key];

    if (value === undefined || value === null || value === false || value === true) {
      continue;
    }

    parts.push(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, shellQuote(value));
  }

  if (merged.quitBrowser) {
    parts.push("--quit-browser");
  }

  if (merged.reopen) {
    parts.push("--reopen");
  }

  if (merged.apply) {
    parts.push("--apply");
  }

  if (merged.dryRun) {
    parts.push("--dry-run");
  }

  return parts.join(" ");
}

function buildRestoreCommand(result) {
  return [
    "markbridge",
    "browser",
    "restore",
    "--browser",
    shellQuote(result.browser),
    "--profile",
    shellQuote(result.profile),
    "--backup",
    shellQuote(result.backupPath),
    "--quit-browser",
    "--reopen"
  ].join(" ");
}

async function loadEnvironmentForCli(flags) {
  if (flags.envFile === true) {
    throw new Error("Usage: --env-file <path>");
  }

  return loadEnvironment({
    env: process.env,
    cwd: process.cwd(),
    envFile: expandUserPath(flags.envFile)
  });
}

function shellQuote(value) {
  const text = String(value);

  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) {
    return text;
  }

  return `'${text.replace(/'/gu, "'\\''")}'`;
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
    result.dryRun ? "Would export browser bookmarks." : "Exported browser bookmarks.",
    `Source: ${result.browserName} / ${result.profileName} (${result.profile})`,
    `Source file: ${result.bookmarksPath}`,
    `Source folder: ${result.folder?.path ?? "all bookmarks"}`,
    `Bookmarks exported: ${result.exportedBookmarks}`,
    `Output: ${result.outputPath}`,
    result.dryRun ? "Output written: no" : "Output written: yes"
  ].join("\n");
}

function formatImportBrowserDryRunResult(result) {
  return [
    "Preview only: no browser bookmarks will be changed.",
    `Input: ${result.inputPath}`,
    `Target: ${result.browserName} / ${result.profileName} (${result.profile})`,
    `Mode: ${result.mode}`,
    `Target folder: Bookmarks Bar / ${result.folder}`,
    `Target file: ${result.bookmarksPath}`,
    `Bookmarks imported: ${result.imported.bookmarks}`,
    `Folders imported: ${result.imported.folders}`,
    `Bookmarks to add: ${result.summary.addedBookmarks}`,
    `Folders to create: ${result.summary.addedFolders}`,
    `Duplicates to skip: ${result.summary.skippedDuplicates}`,
    `Target folder exists: ${result.summary.targetFolderExisted ? "yes" : "no"}`,
    `Action: ${describeFolderAction(result.summary)}`
  ].join("\n");
}

function formatImportBrowserResult(result) {
  const output = [
    "Imported bookmarks into browser.",
    `Input: ${result.inputPath}`,
    `Target: ${result.browserName} / ${result.profileName} (${result.profile})`,
    `Mode: ${result.mode}`,
    `Bookmarks imported: ${result.imported.bookmarks}`,
    `Folders imported: ${result.imported.folders}`,
    `Bookmarks written: ${result.pushed}`,
    `Folders created: ${result.summary.addedFolders}`,
    `Duplicates skipped: ${result.summary.skippedDuplicates}`,
    `Target folder action: ${describeFolderAction(result.summary)}`,
    `Target folder: Bookmarks Bar / ${result.folder}`,
    `Target file: ${result.bookmarksPath}`,
    result.backupPath ? `Backup: ${result.backupPath}` : "Backup: not created because no browser changes were needed"
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

  if (result.backupPath) {
    output.push(
      "Restore:",
      `  ${buildRestoreCommand(result)}`
    );
  }

  return output.join("\n");
}

function formatSyncSetupResult(result) {
  return [
    "Saved sync defaults.",
    `Config: ${result.configPath}`,
    `Source: ${result.browserName} / ${result.profileName} (${result.profile})`,
    `Folder: ${result.folder?.path ?? "all bookmarks"}`,
    `Mode: ${result.config.mode ?? "merge"}`,
    `Bucket: ${result.bucket}`,
    `Remote: ${result.remoteKey}`,
    "Setup preview: no COS object was written.",
    "Next:",
    "  markbridge sync push",
    "  markbridge sync pull --dry-run",
    "  markbridge sync pull --apply --quit-browser --reopen"
  ].join("\n");
}

function formatSyncStatusResult(result) {
  const config = result.config;
  const output = [
    "Sync defaults:",
    `Config: ${result.configPath}`,
    `Source: ${config.browser} / ${config.profile}`,
    `Folder: ${config.folderPath ?? config.folder ?? "all bookmarks"}`,
    `Mode: ${config.mode ?? "merge"}`,
    `Remote: ${config.remoteKey ?? "auto-generated on push"}`
  ];

  if (result.remote) {
    output.push(
      `Bucket: ${result.bucket}`,
      result.remote.exists ? `Remote status: exists (${formatRemoteSummary(result.remote)})` : "Remote status: missing"
    );

    if (!result.remote.exists) {
      output.push("Next: markbridge sync push");
    }
  }

  output.push(
    "Commands:",
    "  markbridge sync push",
    "  markbridge sync pull --dry-run",
    "  markbridge sync pull --apply --quit-browser --reopen"
  );

  return output.join("\n");
}

function formatSyncCheckResult(result) {
  const output = [
    result.ok ? "Sync check: passed" : "Sync check: failed",
    `Config: ${result.configPath}`
  ];

  if (result.bucket) {
    output.push(`Bucket: ${result.bucket}`);
  }

  for (const check of result.checks) {
    output.push(formatCheck(check));
  }

  if (!result.ok) {
    const next = result.checks.find((check) => check.status !== "pass" && check.next)?.next;

    if (next) {
      output.push(`Next: ${next}`);
    }
  }

  return output.join("\n");
}

function formatSyncVerifyResult(result) {
  const output = [
    result.ok ? "Sync verify: passed" : "Sync verify: failed"
  ];

  for (const check of result.check.checks) {
    output.push(formatCheck(check));
  }

  if (result.pullPreview) {
    output.push(
      "Pull preview:",
      `  Target: ${result.pullPreview.browserName} / ${result.pullPreview.profileName} (${result.pullPreview.profile})`,
      `  Target folder: Bookmarks Bar / ${result.pullPreview.folder}`,
      `  Bookmarks imported: ${result.pullPreview.imported.bookmarks}`,
      `  Bookmarks to add: ${result.pullPreview.summary.addedBookmarks}`,
      `  Duplicates to skip: ${result.pullPreview.summary.skippedDuplicates}`,
      "  Browser changes: no"
    );
  }

  if (result.error) {
    output.push(`Error: ${result.error}`);
  }

  if (!result.ok) {
    const next = result.next ?? result.check.checks.find((check) => check.status !== "pass" && check.next)?.next;

    if (next) {
      output.push(`Next: ${next}`);
    }
  }

  return output.join("\n");
}

function formatSyncPushBrowserResult(result) {
  return [
    result.dryRun ? "Preview only: no COS object will be written." : "Synced browser bookmarks to COS.",
    `Source: ${result.browserName} / ${result.profileName} (${result.profile})`,
    `Folder: ${result.folder?.path ?? "all bookmarks"}`,
    `Bookmarks exported: ${result.exportedBookmarks}`,
    `Bucket: ${result.bucket}`,
    `Remote: ${result.remoteKey}`,
    `Size: ${result.size} bytes`,
    result.dryRun ? "Action: would overwrite COS object" : "Action: COS object overwritten"
  ].join("\n");
}

function formatSyncPullBrowserDryRunResult(result) {
  return [
    "Preview only: no browser bookmarks will be changed.",
    `Bucket: ${result.bucket}`,
    `Remote: ${result.remoteKey}`,
    `Downloaded size: ${result.size} bytes`,
    `Target: ${result.browserName} / ${result.profileName} (${result.profile})`,
    `Mode: ${result.mode}`,
    `Target folder: Bookmarks Bar / ${result.folder}`,
    `Target file: ${result.bookmarksPath}`,
    `Bookmarks imported: ${result.imported.bookmarks}`,
    `Folders imported: ${result.imported.folders}`,
    `Bookmarks to add: ${result.summary.addedBookmarks}`,
    `Folders to create: ${result.summary.addedFolders}`,
    `Duplicates to skip: ${result.summary.skippedDuplicates}`,
    `Target folder exists: ${result.summary.targetFolderExisted ? "yes" : "no"}`,
    `Action: ${describeFolderAction(result.summary)}`
  ].join("\n");
}

function formatSyncPullBrowserResult(result) {
  const output = [
    "Synced COS bookmarks into browser.",
    `Bucket: ${result.bucket}`,
    `Remote: ${result.remoteKey}`,
    `Downloaded size: ${result.size} bytes`,
    `Target: ${result.browserName} / ${result.profileName} (${result.profile})`,
    `Mode: ${result.mode}`,
    `Bookmarks imported: ${result.imported.bookmarks}`,
    `Folders imported: ${result.imported.folders}`,
    `Bookmarks written: ${result.pushed}`,
    `Folders created: ${result.summary.addedFolders}`,
    `Duplicates skipped: ${result.summary.skippedDuplicates}`,
    `Target folder action: ${describeFolderAction(result.summary)}`,
    `Target folder: Bookmarks Bar / ${result.folder}`,
    `Target file: ${result.bookmarksPath}`,
    result.backupPath ? `Backup: ${result.backupPath}` : "Backup: not created because no browser changes were needed"
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

  if (result.backupPath) {
    output.push(
      "Restore:",
      `  ${buildRestoreCommand(result)}`
    );
  }

  return output.join("\n");
}

function describeFolderAction(summary) {
  if (summary.replacedFolder) {
    return "replace existing folder";
  }

  if (summary.targetFolderCreated) {
    return "create target folder";
  }

  if (summary.changed) {
    return "merge into existing folder";
  }

  return "no change needed";
}

function formatCheck(check) {
  const marker = check.status === "pass" ? "[PASS]" : "[FAIL]";
  const detail = check.detail ? `: ${check.detail}` : "";
  const next = check.status !== "pass" && check.next ? `\n  Next: ${check.next}` : "";

  return `${marker} ${check.label}${detail}${next}`;
}

function formatRemoteSummary(remote) {
  const parts = [remote.remoteKey];

  if (remote.size !== undefined) {
    parts.push(`${remote.size} bytes`);
  }

  if (remote.lastModified) {
    parts.push(remote.lastModified);
  }

  return parts.join(", ");
}

function printHelp() {
  console.log(`MarkBridge

Usage:
  markbridge export-browser --browser chrome|edge --profile <profile> --output <output.html> [--folder name|path] [--folder-path path] [--dry-run]
  markbridge import-browser --input <bookmarks.html> --browser chrome|edge --profile <profile> [--folder MarkBridge] [--mode merge|replace-folder|append] [--quit-browser] [--reopen] [--dry-run]
  markbridge cloud push --file <local-file> --remote <object-key>
  markbridge cloud pull --remote <object-key> --output <local-file>
  markbridge cloud list [--prefix prefix] [--max-keys n]
  markbridge cloud delete --remote <object-key>
  markbridge sync setup --browser chrome|edge --profile <profile> [--folder name|path] [--folder-path path] [--mode merge|replace-folder|append] [--remote <object-key>]
  markbridge sync status
  markbridge sync status --remote
  markbridge sync check
  markbridge sync verify
  markbridge sync push [--dry-run]
  markbridge sync pull --dry-run
  markbridge sync pull --apply [--quit-browser] [--reopen]
  markbridge sync push-browser --browser chrome|edge --profile <profile> [--remote <object-key>] [--folder name|path] [--folder-path path] [--dry-run]
  markbridge sync pull-browser [--remote <object-key>] --browser chrome|edge --profile <profile> [--folder MarkBridge] [--mode merge|replace-folder|append] [--dry-run] [--quit-browser] [--reopen]
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
  markbridge push-browser --browser chrome|edge --profile <profile> [--folder MarkBridge] [--mode merge|replace-folder|append] [--quit-browser] [--reopen]
  markbridge status
  markbridge where

Storage:
  Default library: ~/.markbridge/library.json
  Default sync config: ~/.markbridge/sync-config.json
  Override with MARKBRIDGE_HOME or --library.

Current phase stores local data in plaintext.`);
}
