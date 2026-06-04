import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const CLI_PATH = resolve("bin/markbridge.js");
const FIXTURE_PATH = resolve("fixtures/private-filter.html");
const DEMO_FIXTURE_PATH = resolve("fixtures/demo-bookmarks.html");
const CHROME_FIXTURE_PATH = resolve("fixtures/chrome-bookmarks.html");

test("CLI imports, persists, searches, edits, deletes, and exports", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-test-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    const imported = await runCli(["import", FIXTURE_PATH, "--json"], env);
    assert.equal(imported.imported.bookmarks, 3);
    assert.equal(imported.imported.folders, 1);
    assert.equal(imported.libraryPath, join(markbridgeHome, "library.json"));

    const libraryPath = join(markbridgeHome, "library.json");
    assert.equal(existsSync(libraryPath), true);

    const where = await runCli(["where", "--json"], env);
    assert.deepEqual(where, {
      libraryPath,
      exists: true,
      plaintext: true
    });

    const saved = await readFile(libraryPath, "utf8");
    assert.match(saved, /"format": "markbridge-library"/);
    assert.match(saved, /https:\/\/secret\.example\.com\/private/);

    const listed = await runCli(["list", "--json"], env);
    assert.deepEqual(listed.map((row) => row.title), ["Public Link", "Private Secret", "Temporary Link"]);

    const searchPublic = await runCli(["search", "public", "--json"], env);
    assert.deepEqual(searchPublic.map((row) => row.title), ["Public Link"]);

    const publicId = listed.find((row) => row.title === "Public Link").id;
    await runCli(["edit", publicId, "--title", "Renamed Public", "--url", "https://public.example.com/renamed", "--json"], env);

    const edited = await runCli(["search", "renamed", "--json"], env);
    assert.equal(edited.length, 1);
    assert.equal(edited[0].title, "Renamed Public");
    assert.equal(edited[0].url, "https://public.example.com/renamed");

    const exportPath = join(markbridgeHome, "all-export.html");
    await runCli(["export", exportPath, "--json"], env);
    const exported = await readFile(exportPath, "utf8");

    assert.match(exported, /Renamed Public/);
    assert.match(exported, /https:\/\/public\.example\.com\/renamed/);
    assert.match(exported, /Private Secret/);
    assert.match(exported, /https:\/\/secret\.example\.com\/private/);
    assert.match(exported, /Temporary Link/);
    assert.match(exported, /https:\/\/temporary\.example\.com/);

    await runCli(["delete", publicId, "--json"], env);

    const afterDelete = await runCli(["list", "--json"], env);
    assert.deepEqual(afterDelete.map((row) => row.title), ["Private Secret", "Temporary Link"]);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI import explains missing input files without creating a library", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-missing-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    const result = await execFileAsync(process.execPath, [CLI_PATH, "import", "~/Desktop/does-not-exist-bookmarks.html"], { env })
      .then(() => ({ code: 0, stderr: "" }))
      .catch((error) => ({ code: error.code, stderr: error.stderr }));

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Input bookmark file not found:/);
    assert.match(result.stderr, /No import was performed/);
    assert.match(result.stderr, /Current MarkBridge library path would be:/);
    assert.equal(existsSync(join(markbridgeHome, "library.json")), false);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI exports only a selected folder", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-folder-export-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    await runCli(["import", CHROME_FIXTURE_PATH, "--json"], env);

    const exportPath = join(markbridgeHome, "books-only.html");
    const exportedResult = await runCli(["export", exportPath, "--folder", "中文资料", "--json"], env);
    const exported = await readFile(exportPath, "utf8");

    assert.equal(exportedResult.outputPath, exportPath);
    assert.equal(exportedResult.folder.title, "中文资料");
    assert.equal(exportedResult.folder.path, "Bookmarks Bar / 中文资料");
    assert.match(exported, /中文资料/);
    assert.match(exported, /中文 &amp; Entity/);
    assert.match(exported, /Tom &amp; Jerry &lt;Dev&gt;/);
    assert.doesNotMatch(exported, /Example Docs/);
    assert.doesNotMatch(exported, /Bookmarks Bar/);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI export-browser exports a selected browser profile folder without writing a library", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-export-browser-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };
  const { browserRoot, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFileWithAllRoots());

  try {
    const dryRunPath = join(markbridgeHome, "dry-run.html");
    const dryRun = await runCli([
      "export-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Nested Other",
      "--output", dryRunPath,
      "--dry-run",
      "--json"
    ], env);

    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.browser, "chrome");
    assert.equal(dryRun.profile, "Default");
    assert.equal(dryRun.profileName, "Test Person");
    assert.equal(dryRun.folder.path, "Other bookmarks / Nested Other");
    assert.equal(dryRun.exportedBookmarks, 1);
    assert.equal(dryRun.pulled.bookmarks, 3);
    assert.equal(existsSync(dryRunPath), false);
    assert.equal(existsSync(join(markbridgeHome, "library.json")), false);

    const exportPath = join(markbridgeHome, "nested-other.html");
    const exportedResult = await runCli([
      "export-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Nested Other",
      "--output", exportPath,
      "--json"
    ], env);
    const exported = await readFile(exportPath, "utf8");

    assert.equal(exportedResult.dryRun, false);
    assert.equal(exportedResult.outputPath, exportPath);
    assert.equal(exportedResult.folder.path, "Other bookmarks / Nested Other");
    assert.equal(exportedResult.exportedBookmarks, 1);
    assert.match(exported, /Nested Other/);
    assert.match(exported, /Other Link/);
    assert.doesNotMatch(exported, /Bar Link/);
    assert.doesNotMatch(exported, /Synced Link/);
    assert.equal(existsSync(join(markbridgeHome, "library.json")), false);
  } finally {
    await cleanup();
  }
});

test("CLI sync push-browser dry-run exports selected browser folder without uploading", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-sync-push-"));
  const env = {
    ...process.env,
    MARKBRIDGE_HOME: markbridgeHome,
    SYNC_PROVIDER: "cos",
    COS_ENDPOINT: "https://cos.ap-guangzhou.myqcloud.com",
    COS_REGION: "ap-guangzhou",
    COS_BUCKET: "markbridge-1250000000",
    COS_SECRET_ID: "AKIDEXAMPLE",
    COS_SECRET_KEY: "SECRETEXAMPLE"
  };
  const { browserRoot, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFileWithAllRoots());

  try {
    const result = await runCli([
      "sync",
      "push-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Nested Other",
      "--dry-run",
      "--json"
    ], env);

    assert.equal(result.provider, "cos");
    assert.equal(result.bucket, "markbridge-1250000000");
    assert.equal(result.dryRun, true);
    assert.equal(result.uploaded, false);
    assert.equal(result.remoteKey, "bookmarks/chrome/Test-Person/Other-bookmarks-Nested-Other.html");
    assert.equal(result.profileName, "Test Person");
    assert.equal(result.folder.path, "Other bookmarks / Nested Other");
    assert.equal(result.exportedBookmarks, 1);
    assert.equal(existsSync(join(markbridgeHome, "library.json")), false);
  } finally {
    await cleanup();
  }
});

test("CLI sync push-browser dry-run text explains the action without writing COS", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-sync-push-text-"));
  const env = {
    ...process.env,
    MARKBRIDGE_HOME: markbridgeHome,
    SYNC_PROVIDER: "cos",
    COS_ENDPOINT: "https://cos.ap-guangzhou.myqcloud.com",
    COS_REGION: "ap-guangzhou",
    COS_BUCKET: "markbridge-1250000000",
    COS_SECRET_ID: "AKIDEXAMPLE",
    COS_SECRET_KEY: "SECRETEXAMPLE"
  };
  const { browserRoot, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFileWithAllRoots());

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      CLI_PATH,
      "sync",
      "push-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Nested Other",
      "--dry-run"
    ], { env });

    assert.match(stdout, /Preview only: no COS object will be written/);
    assert.match(stdout, /Source: Google Chrome \/ Test Person \(Default\)/);
    assert.match(stdout, /Folder: Other bookmarks \/ Nested Other/);
    assert.match(stdout, /Remote: bookmarks\/chrome\/Test-Person\/Other-bookmarks-Nested-Other\.html/);
    assert.match(stdout, /Action: would overwrite COS object/);
  } finally {
    await cleanup();
  }
});

test("CLI sync setup saves defaults and short push uses them", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-sync-setup-"));
  const env = {
    ...process.env,
    MARKBRIDGE_HOME: markbridgeHome,
    SYNC_PROVIDER: "cos",
    COS_ENDPOINT: "https://cos.ap-guangzhou.myqcloud.com",
    COS_REGION: "ap-guangzhou",
    COS_BUCKET: "markbridge-1250000000",
    COS_SECRET_ID: "AKIDEXAMPLE",
    COS_SECRET_KEY: "SECRETEXAMPLE"
  };
  const { browserRoot, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFileWithAllRoots());

  try {
    const setup = await runCli([
      "sync",
      "setup",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Nested Other",
      "--mode", "merge",
      "--json"
    ], env);

    assert.equal(setup.provider, "cos");
    assert.equal(setup.bucket, "markbridge-1250000000");
    assert.equal(setup.configPath, join(markbridgeHome, "sync-config.json"));
    assert.equal(setup.config.browser, "chrome");
    assert.equal(setup.config.profile, "Default");
    assert.equal(setup.config.browserRoot, browserRoot);
    assert.equal(setup.config.folder, "Nested Other");
    assert.equal(setup.config.mode, "merge");
    assert.equal(setup.config.remoteKey, "bookmarks/chrome/Test-Person/Other-bookmarks-Nested-Other.html");
    assert.equal(setup.preview.dryRun, true);
    assert.equal(setup.preview.uploaded, false);
    assert.equal(existsSync(join(markbridgeHome, "sync-config.json")), true);

    const status = await runCli(["sync", "status", "--json"], env);
    assert.equal(status.configPath, join(markbridgeHome, "sync-config.json"));
    assert.equal(status.config.remoteKey, "bookmarks/chrome/Test-Person/Other-bookmarks-Nested-Other.html");

    const push = await runCli(["sync", "push", "--dry-run", "--json"], env);
    assert.equal(push.provider, "cos");
    assert.equal(push.bucket, "markbridge-1250000000");
    assert.equal(push.configPath, join(markbridgeHome, "sync-config.json"));
    assert.equal(push.dryRun, true);
    assert.equal(push.uploaded, false);
    assert.equal(push.remoteKey, "bookmarks/chrome/Test-Person/Other-bookmarks-Nested-Other.html");
    assert.equal(push.profileName, "Test Person");
    assert.equal(push.folder.path, "Other bookmarks / Nested Other");
    assert.equal(push.exportedBookmarks, 1);
    assert.equal(existsSync(join(markbridgeHome, "library.json")), false);
  } finally {
    await cleanup();
  }
});

test("CLI short sync pull requires explicit preview or apply", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-sync-pull-guard-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    const result = await execFileAsync(process.execPath, [CLI_PATH, "sync", "pull"], { env })
      .then(() => ({ code: 0, stderr: "" }))
      .catch((error) => ({ code: error.code, stderr: error.stderr }));

    assert.equal(result.code, 1);
    assert.match(result.stderr, /sync pull --dry-run/);
    assert.match(result.stderr, /sync pull --apply/);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI sync check explains missing defaults with the next command", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-sync-check-missing-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    const result = await execFileAsync(process.execPath, [CLI_PATH, "sync", "check"], { env })
      .then((output) => ({ code: 0, stdout: output.stdout, stderr: output.stderr }))
      .catch((error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));

    assert.equal(result.code, 1);
    assert.match(result.stdout, /Sync check: failed/);
    assert.match(result.stdout, /\[FAIL\] Sync defaults/);
    assert.match(result.stdout, /Next: markbridge sync setup --browser chrome --profile <profile> --folder <folder>/);
    assert.equal(result.stderr, "");
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI import-browser imports HTML directly into a browser profile", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-import-browser-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };
  const { browserRoot, bookmarksPath, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFile());

  try {
    const dryRun = await runCli([
      "import-browser",
      "--input", CHROME_FIXTURE_PATH,
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Imported",
      "--dry-run",
      "--json"
    ], env);

    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.imported.bookmarks, 3);
    assert.equal(dryRun.imported.folders, 3);
    assert.equal(dryRun.folder, "Imported");
    assert.equal(dryRun.mode, "merge");
    assert.equal(dryRun.summary.addedBookmarks, 3);
    assert.equal(dryRun.summary.skippedDuplicates, 0);
    assert.equal(dryRun.summary.targetFolderCreated, true);

    const beforePush = await readFile(bookmarksPath, "utf8");
    assert.doesNotMatch(beforePush, /Imported/);

    const pushed = await runCli([
      "import-browser",
      "--input", CHROME_FIXTURE_PATH,
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Imported",
      "--skip-running-check",
      "--json"
    ], env);

    assert.equal(pushed.dryRun, false);
    assert.equal(pushed.browser, "chrome");
    assert.equal(pushed.profile, "Default");
    assert.equal(pushed.profileName, "Test Person");
    assert.equal(pushed.folder, "Imported");
    assert.equal(pushed.mode, "merge");
    assert.equal(pushed.imported.bookmarks, 3);
    assert.equal(pushed.pushed, 3);
    assert.equal(pushed.summary.addedBookmarks, 3);
    assert.equal(pushed.summary.skippedDuplicates, 0);
    assert.equal(existsSync(pushed.backupPath), true);
    assert.equal(existsSync(join(markbridgeHome, "library.json")), false);

    const browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
    const importedFolder = browserBookmarks.roots.bookmark_bar.children.find((item) => item.name === "Imported");

    assert.ok(importedFolder);
    assert.deepEqual(importedFolder.children.map((item) => item.name), ["Bookmarks Bar"]);
    assert.match(JSON.stringify(importedFolder), /Example Docs/);
    assert.match(JSON.stringify(importedFolder), /中文资料/);
    assert.match(JSON.stringify(importedFolder), /Tom & Jerry <Dev>/);

    const secondDryRun = await runCli([
      "import-browser",
      "--input", CHROME_FIXTURE_PATH,
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Imported",
      "--mode", "merge",
      "--dry-run",
      "--json"
    ], env);

    assert.equal(secondDryRun.summary.addedBookmarks, 0);
    assert.equal(secondDryRun.summary.skippedDuplicates, 3);
    assert.equal(secondDryRun.summary.changed, false);

    const secondPush = await runCli([
      "import-browser",
      "--input", CHROME_FIXTURE_PATH,
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Imported",
      "--mode", "merge",
      "--skip-running-check",
      "--json"
    ], env);

    assert.equal(secondPush.pushed, 0);
    assert.equal(secondPush.summary.skippedDuplicates, 3);
    assert.equal(secondPush.summary.changed, false);
    assert.equal(secondPush.backupPath, null);

    const afterSecondPush = JSON.parse(await readFile(bookmarksPath, "utf8"));
    assert.equal(countUrlOccurrences(afterSecondPush, "https://Example.com/docs/#intro"), 1);
    assert.equal(countUrlOccurrences(afterSecondPush, "https://example.com/zh?name=%E6%B5%8B%E8%AF%95&mode=1"), 1);
    assert.equal(countUrlOccurrences(afterSecondPush, "https://example.com/escaped?name=Tom&role=dev"), 1);
  } finally {
    await cleanup();
  }
});

test("CLI import-browser replace-folder replaces only the selected target folder", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-import-browser-replace-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };
  const { browserRoot, bookmarksPath, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFile());

  try {
    await runCli([
      "import-browser",
      "--input", CHROME_FIXTURE_PATH,
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Imported",
      "--skip-running-check",
      "--json"
    ], env);

    const replaced = await runCli([
      "import-browser",
      "--input", FIXTURE_PATH,
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--folder", "Imported",
      "--mode", "replace-folder",
      "--skip-running-check",
      "--json"
    ], env);

    assert.equal(replaced.mode, "replace-folder");
    assert.equal(replaced.summary.replacedFolder, true);
    assert.equal(replaced.pushed, 3);
    assert.equal(existsSync(replaced.backupPath), true);

    const browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
    const serialized = JSON.stringify(browserBookmarks);

    assert.match(serialized, /Existing Bookmark/);
    assert.match(serialized, /Public Link/);
    assert.match(serialized, /Private Secret/);
    assert.doesNotMatch(serialized, /Example Docs/);
    assert.doesNotMatch(serialized, /Tom & Jerry <Dev>/);
    assert.equal(countDirectFolders(browserBookmarks, "Imported"), 1);
  } finally {
    await cleanup();
  }
});

test("CLI import merge mode deduplicates repeated imports", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-merge-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    const first = await runCli(["import", DEMO_FIXTURE_PATH, "--mode", "merge", "--json"], env);
    assert.equal(first.added.bookmarks, 5);
    assert.equal(first.skippedDuplicates, 0);

    const second = await runCli(["import", DEMO_FIXTURE_PATH, "--mode", "merge", "--json"], env);
    assert.equal(second.added.bookmarks, 0);
    assert.equal(second.skippedDuplicates, 5);

    const status = await runCli(["status", "--json"], env);
    assert.equal(status.stats.bookmarks, 5);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI import append mode keeps repeated imports", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-append-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    await runCli(["import", DEMO_FIXTURE_PATH, "--mode", "append", "--json"], env);
    await runCli(["import", DEMO_FIXTURE_PATH, "--mode", "append", "--json"], env);

    const status = await runCli(["status", "--json"], env);
    assert.equal(status.stats.bookmarks, 10);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI import replace mode replaces the current library", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-replace-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    await runCli(["import", DEMO_FIXTURE_PATH, "--json"], env);
    await runCli(["import", FIXTURE_PATH, "--mode", "replace", "--json"], env);

    const status = await runCli(["status", "--json"], env);
    assert.equal(status.stats.bookmarks, 3);

    const listed = await runCli(["list", "--json"], env);
    assert.deepEqual(listed.map((row) => row.title), ["Public Link", "Private Secret", "Temporary Link"]);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI import dry-run does not write a library and reports duplicate preview", async () => {
  const emptyHome = await mkdtemp(join(tmpdir(), "markbridge-cli-dry-empty-"));
  const existingHome = await mkdtemp(join(tmpdir(), "markbridge-cli-dry-existing-"));

  try {
    const emptyEnv = { ...process.env, MARKBRIDGE_HOME: emptyHome };
    const preview = await runCli(["import", DEMO_FIXTURE_PATH, "--dry-run", "--json"], emptyEnv);

    assert.equal(preview.dryRun, true);
    assert.equal(preview.added.bookmarks, 5);
    assert.equal(existsSync(join(emptyHome, "library.json")), false);

    const existingEnv = { ...process.env, MARKBRIDGE_HOME: existingHome };
    await runCli(["import", DEMO_FIXTURE_PATH, "--json"], existingEnv);

    const duplicatePreview = await runCli(["import", DEMO_FIXTURE_PATH, "--dry-run", "--json"], existingEnv);
    assert.equal(duplicatePreview.added.bookmarks, 0);
    assert.equal(duplicatePreview.skippedDuplicates, 5);

    const status = await runCli(["status", "--json"], existingEnv);
    assert.equal(status.stats.bookmarks, 5);
  } finally {
    await rm(emptyHome, { recursive: true, force: true });
    await rm(existingHome, { recursive: true, force: true });
  }
});

test("CLI import merge preserves existing edited titles", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-preserve-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };

  try {
    await runCli(["import", DEMO_FIXTURE_PATH, "--json"], env);

    const before = await runCli(["list", "--json"], env);
    const docs = before.find((row) => row.title === "MarkBridge Public Docs");
    assert.ok(docs);
    await runCli(["edit", docs.id, "--title", "Custom Public Docs", "--json"], env);

    const duplicateImport = await runCli(["import", DEMO_FIXTURE_PATH, "--mode", "merge", "--json"], env);
    assert.equal(duplicateImport.skippedDuplicates, 5);

    const after = await runCli(["list", "--json"], env);
    assert.equal(after.find((row) => row.url === "https://docs.example.com/markbridge").title, "Custom Public Docs");
    assert.equal(after.length, 5);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI lists browser profiles and pushes bookmarks to Chrome profile", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-browser-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };
  const browserRoot = join(markbridgeHome, "Chrome");
  const profileDir = join(browserRoot, "Default");
  const bookmarksPath = join(profileDir, "Bookmarks");

  try {
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "Preferences"), JSON.stringify({ profile: { name: "Test Person" } }), "utf8");
    await writeFile(bookmarksPath, JSON.stringify(createChromeBookmarksFile(), null, 2), "utf8");

    const profiles = await runCli(["browser", "profiles", "--browser", "chrome", "--browser-root", browserRoot, "--json"], env);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].browser, "chrome");
    assert.equal(profiles[0].profile, "Default");
    assert.equal(profiles[0].name, "Test Person");
    assert.equal(profiles[0].hasBookmarks, true);

    await runCli(["import", DEMO_FIXTURE_PATH, "--json"], env);

    const pushed = await runCli([
      "push-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--skip-running-check",
      "--json"
    ], env);

    assert.equal(pushed.browser, "chrome");
    assert.equal(pushed.profile, "Default");
    assert.equal(pushed.profileName, "Test Person");
    assert.equal(pushed.folder, "MarkBridge");
    assert.equal(pushed.pushed, 5);
    assert.equal(existsSync(pushed.backupPath), true);

    const browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
    assert.equal(browserBookmarks.checksum, undefined);

    const markBridgeFolder = browserBookmarks.roots.bookmark_bar.children.find((item) => item.name === "MarkBridge");
    assert.ok(markBridgeFolder);
    assert.deepEqual(markBridgeFolder.children.map((item) => item.name), ["Work Tools", "Personal Vault", "Read Later"]);
    assert.deepEqual(markBridgeFolder.children[0].children.map((item) => item.name), [
      "MarkBridge Public Docs",
      "Engineering Search"
    ]);

    const serialized = JSON.stringify(browserBookmarks);
    assert.match(serialized, /Private Bank Portal/);
    assert.match(serialized, /Private Health Notes/);
    assert.match(serialized, /Temporary Article/);
    assert.match(serialized, /Personal Vault/);
    assert.match(serialized, /Read Later/);
    assert.match(serialized, /Existing Bookmark/);
  } finally {
    await rm(markbridgeHome, { recursive: true, force: true });
  }
});

test("CLI pull-browser imports Chrome bookmark_bar, other, and synced roots", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-pull-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };
  const { browserRoot, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFileWithAllRoots());

  try {
    const preview = await runCli([
      "pull-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--dry-run",
      "--json"
    ], env);

    assert.equal(preview.dryRun, true);
    assert.equal(preview.imported.bookmarks, 3);
    assert.equal(preview.imported.folders, 4);
    assert.equal(existsSync(join(markbridgeHome, "library.json")), false);

    const pulled = await runCli([
      "pull-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--mode", "merge",
      "--json"
    ], env);

    assert.equal(pulled.added.bookmarks, 3);
    assert.equal(pulled.added.folders, 4);

    const second = await runCli([
      "pull-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--mode", "merge",
      "--json"
    ], env);

    assert.equal(second.added.bookmarks, 0);
    assert.equal(second.skippedDuplicates, 3);

    const listed = await runCli(["list", "--json"], env);
    assert.deepEqual(listed.map((row) => `${row.path}:${row.title}`), [
      "Bookmarks bar:Bar Link",
      "Other bookmarks / Nested Other:Other Link",
      "Mobile bookmarks:Synced Link"
    ]);
  } finally {
    await cleanup();
  }
});

test("CLI pull-browser append and replace modes are explicit", async () => {
  const appendHome = await mkdtemp(join(tmpdir(), "markbridge-cli-pull-append-"));
  const replaceHome = await mkdtemp(join(tmpdir(), "markbridge-cli-pull-replace-"));

  try {
    const appendEnv = { ...process.env, MARKBRIDGE_HOME: appendHome };
    const appendProfile = await createTestChromeProfile(appendHome, createChromeBookmarksFileWithAllRoots());

    await runCli([
      "pull-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", appendProfile.browserRoot,
      "--mode", "append",
      "--json"
    ], appendEnv);
    await runCli([
      "pull-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", appendProfile.browserRoot,
      "--mode", "append",
      "--json"
    ], appendEnv);

    const appendStatus = await runCli(["status", "--json"], appendEnv);
    assert.equal(appendStatus.stats.bookmarks, 6);

    const replaceEnv = { ...process.env, MARKBRIDGE_HOME: replaceHome };
    const replaceProfile = await createTestChromeProfile(replaceHome, createChromeBookmarksFileWithAllRoots());

    await runCli(["import", DEMO_FIXTURE_PATH, "--json"], replaceEnv);
    await runCli([
      "pull-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", replaceProfile.browserRoot,
      "--mode", "replace",
      "--json"
    ], replaceEnv);

    const replaceStatus = await runCli(["status", "--json"], replaceEnv);
    assert.equal(replaceStatus.stats.bookmarks, 3);

    const replaceList = await runCli(["list", "--json"], replaceEnv);
    assert.deepEqual(replaceList.map((row) => row.title), ["Bar Link", "Other Link", "Synced Link"]);
  } finally {
    await rm(appendHome, { recursive: true, force: true });
    await rm(replaceHome, { recursive: true, force: true });
  }
});

test("CLI supports Edge profile pull and push with explicit browser root", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-edge-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };
  const { browserRoot, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFileWithAllRoots());

  try {
    const preview = await runCli([
      "pull-browser",
      "--browser", "edge",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--dry-run",
      "--json"
    ], env);

    assert.equal(preview.browser, "edge");
    assert.equal(preview.browserName, "Microsoft Edge");
    assert.equal(preview.imported.bookmarks, 3);

    await runCli(["import", DEMO_FIXTURE_PATH, "--json"], env);

    const pushed = await runCli([
      "push-browser",
      "--browser", "edge",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--skip-running-check",
      "--json"
    ], env);

    assert.equal(pushed.browser, "edge");
    assert.equal(pushed.browserName, "Microsoft Edge");
    assert.equal(pushed.verifyUrl, "edge://favorites");
    assert.equal(pushed.pushed, 5);
  } finally {
    await cleanup();
  }
});

test("CLI lists browser backups and restores a selected backup", async () => {
  const markbridgeHome = await mkdtemp(join(tmpdir(), "markbridge-cli-restore-"));
  const env = { ...process.env, MARKBRIDGE_HOME: markbridgeHome };
  const { browserRoot, bookmarksPath, cleanup } = await createTestChromeProfile(markbridgeHome, createChromeBookmarksFile());

  try {
    await runCli(["import", DEMO_FIXTURE_PATH, "--json"], env);

    const pushed = await runCli([
      "push-browser",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--skip-running-check",
      "--json"
    ], env);

    const backups = await runCli([
      "browser", "backups",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--json"
    ], env);

    assert.equal(backups.length, 1);
    assert.equal(backups[0].path, pushed.backupPath);

    const beforeRestore = await readFile(bookmarksPath, "utf8");
    assert.match(beforeRestore, /MarkBridge Public Docs/);

    const restored = await runCli([
      "browser", "restore",
      "--browser", "chrome",
      "--profile", "Default",
      "--browser-root", browserRoot,
      "--backup", pushed.backupPath,
      "--skip-running-check",
      "--json"
    ], env);

    assert.equal(restored.restoredFrom, pushed.backupPath);
    assert.equal(existsSync(restored.safetyBackupPath), true);

    const afterRestore = await readFile(bookmarksPath, "utf8");
    assert.doesNotMatch(afterRestore, /MarkBridge Public Docs/);
    assert.match(afterRestore, /Existing Bookmark/);
  } finally {
    await cleanup();
  }
});

async function runCli(args, env) {
  const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, ...args], { env });
  const output = stdout.trim();

  if (!output) {
    return null;
  }

  return JSON.parse(output);
}

async function createTestChromeProfile(home, bookmarksFile) {
  const browserRoot = join(home, "Chrome");
  const profileDir = join(browserRoot, "Default");
  const bookmarksPath = join(profileDir, "Bookmarks");

  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "Preferences"), JSON.stringify({ profile: { name: "Test Person" } }), "utf8");
  await writeFile(bookmarksPath, JSON.stringify(bookmarksFile, null, 2), "utf8");

  return {
    browserRoot,
    profileDir,
    bookmarksPath,
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

function countUrlOccurrences(value, url) {
  let count = 0;

  visitChromeNodes(value, (node) => {
    if (node.type === "url" && node.url === url) {
      count += 1;
    }
  });

  return count;
}

function countDirectFolders(bookmarksFile, name) {
  return bookmarksFile.roots.bookmark_bar.children
    .filter((node) => node.type === "folder" && node.name === name)
    .length;
}

function visitChromeNodes(value, visit) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (value.type) {
    visit(value);
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        visitChromeNodes(item, visit);
      }
    } else if (child && typeof child === "object") {
      visitChromeNodes(child, visit);
    }
  }
}
