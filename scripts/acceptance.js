import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = join(REPO_ROOT, "bin", "markbridge.js");

const workdir = await mkdtemp(join(tmpdir(), "markbridge-acceptance-"));
const browserRoot = join(workdir, "Chrome");
const profileDir = join(browserRoot, "Default");
const bookmarksPath = join(profileDir, "Bookmarks");
const outputPath = join(workdir, "books.html");
const env = {
  ...process.env,
  MARKBRIDGE_HOME: join(workdir, "markbridge-home")
};

await createChromeProfile();

const exportPreview = await runJson([
  "export-browser",
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--folder", "Books",
  "--output", outputPath,
  "--dry-run",
  "--json"
]);

assert.equal(exportPreview.dryRun, true);
assert.equal(exportPreview.profileName, "Acceptance User");
assert.equal(exportPreview.folder.path, "Bookmarks Bar / Books");
assert.equal(exportPreview.exportedBookmarks, 2);
assert.equal(existsSync(outputPath), false);
assert.equal(existsSync(join(env.MARKBRIDGE_HOME, "library.json")), false);

const exported = await runJson([
  "export-browser",
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--folder", "Books",
  "--output", outputPath,
  "--json"
]);

assert.equal(exported.dryRun, false);
assert.equal(exported.exportedBookmarks, 2);
const html = await readFile(outputPath, "utf8");
assert.match(html, /Books/);
assert.match(html, /Node Handbook/);
assert.match(html, /SQLite Notes/);
assert.doesNotMatch(html, /Outside Link/);
assert.doesNotMatch(html, /Bookmarks Bar/);
assert.equal(existsSync(join(env.MARKBRIDGE_HOME, "library.json")), false);

const importPreview = await runJson([
  "import-browser",
  "--input", outputPath,
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--folder", "ImportedBooks",
  "--dry-run",
  "--json"
]);

assert.equal(importPreview.dryRun, true);
assert.equal(importPreview.imported.bookmarks, 2);
assert.equal(importPreview.folder, "ImportedBooks");
assert.equal(importPreview.mode, "merge");
assert.equal(importPreview.summary.addedBookmarks, 2);
assert.equal(importPreview.summary.skippedDuplicates, 0);
assert.doesNotMatch(await readFile(bookmarksPath, "utf8"), /ImportedBooks/);

const imported = await runJson([
  "import-browser",
  "--input", outputPath,
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--folder", "ImportedBooks",
  "--skip-running-check",
  "--json"
]);

assert.equal(imported.dryRun, false);
assert.equal(imported.pushed, 2);
assert.equal(imported.mode, "merge");
assert.equal(imported.summary.addedBookmarks, 2);
assert.equal(existsSync(imported.backupPath), true);
assert.equal(existsSync(join(env.MARKBRIDGE_HOME, "library.json")), false);

let browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
const importedFolder = browserBookmarks.roots.bookmark_bar.children.find((item) => item.name === "ImportedBooks");

assert.ok(importedFolder);
assert.deepEqual(importedFolder.children.map((item) => item.name), ["Books"]);
assert.match(JSON.stringify(importedFolder), /Node Handbook/);
assert.match(JSON.stringify(importedFolder), /SQLite Notes/);

const duplicatePreview = await runJson([
  "import-browser",
  "--input", outputPath,
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--folder", "ImportedBooks",
  "--mode", "merge",
  "--dry-run",
  "--json"
]);

assert.equal(duplicatePreview.summary.addedBookmarks, 0);
assert.equal(duplicatePreview.summary.skippedDuplicates, 2);
assert.equal(duplicatePreview.summary.changed, false);

const duplicateImport = await runJson([
  "import-browser",
  "--input", outputPath,
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--folder", "ImportedBooks",
  "--mode", "merge",
  "--skip-running-check",
  "--json"
]);

assert.equal(duplicateImport.pushed, 0);
assert.equal(duplicateImport.summary.skippedDuplicates, 2);
assert.equal(duplicateImport.backupPath, null);

browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
const currentTargetFolder = browserBookmarks.roots.bookmark_bar.children.find((item) => item.name === "ImportedBooks");

assert.equal(countUrlOccurrences(currentTargetFolder, "https://nodejs.org/docs"), 1);
assert.equal(countUrlOccurrences(currentTargetFolder, "https://sqlite.org/docs.html"), 1);
currentTargetFolder.children.push({
  date_added: "13370000000000000",
  guid: "99999999-9999-4999-8999-999999999999",
  id: "99",
  name: "Stale Link",
  type: "url",
  url: "https://stale.example.com"
});
await writeFile(bookmarksPath, JSON.stringify(browserBookmarks, null, 2), "utf8");

const replaced = await runJson([
  "import-browser",
  "--input", outputPath,
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--folder", "ImportedBooks",
  "--mode", "replace-folder",
  "--skip-running-check",
  "--json"
]);

assert.equal(replaced.mode, "replace-folder");
assert.equal(replaced.summary.replacedFolder, true);
assert.equal(replaced.pushed, 2);
assert.equal(existsSync(replaced.backupPath), true);

browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
const replacedTargetFolder = browserBookmarks.roots.bookmark_bar.children.find((item) => item.name === "ImportedBooks");

assert.doesNotMatch(JSON.stringify(browserBookmarks), /Stale Link/);
assert.match(JSON.stringify(browserBookmarks), /Outside Link/);
assert.equal(countUrlOccurrences(replacedTargetFolder, "https://nodejs.org/docs"), 1);

const backups = await runJson([
  "browser",
  "backups",
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--json"
]);

assert.ok(backups.some((backup) => backup.path === imported.backupPath));

const restored = await runJson([
  "browser",
  "restore",
  "--browser", "chrome",
  "--profile", "Acceptance User",
  "--browser-root", browserRoot,
  "--backup", imported.backupPath,
  "--skip-running-check",
  "--json"
]);

assert.equal(restored.restoredFrom, imported.backupPath);
assert.equal(existsSync(restored.safetyBackupPath), true);

browserBookmarks = JSON.parse(await readFile(bookmarksPath, "utf8"));
assert.doesNotMatch(JSON.stringify(browserBookmarks), /ImportedBooks/);
assert.match(JSON.stringify(browserBookmarks), /Outside Link/);

console.log(`Acceptance passed: ${workdir}`);

async function runJson(args) {
  const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, ...args], { env });
  return JSON.parse(stdout);
}

async function createChromeProfile() {
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "Preferences"), JSON.stringify({ profile: { name: "Acceptance User" } }, null, 2), "utf8");
  await writeFile(bookmarksPath, JSON.stringify(createChromeBookmarksFile(), null, 2), "utf8");
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

function countUrlOccurrences(value, url) {
  let count = 0;

  visitChromeNodes(value, (node) => {
    if (node.type === "url" && node.url === url) {
      count += 1;
    }
  });

  return count;
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
