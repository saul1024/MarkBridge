import { createInterface } from "node:readline/promises";

import { listBrowserProfiles, normalizeBrowserKey, pullBrowserBookmarks } from "./browser.js";
import { listExportFolders, matchExportFolders, resolveExportFolder } from "./exporter.js";

const ALL_BOOKMARKS_LABEL = "all bookmarks";
const DEFAULT_MAX_ATTEMPTS = 5;

export function hasFlagValue(value) {
  return value !== undefined && value !== null && value !== true && value !== false && String(value).trim() !== "";
}

export function isInteractive(options = {}) {
  const stdin = options.stdin ?? options.input ?? process.stdin;
  const stdout = options.stdout ?? options.output ?? process.stdout;
  const env = options.env ?? process.env;
  const json = options.json ?? options.flags?.json;
  const noInteractive = options.noInteractive ?? options.flags?.noInteractive;
  const envValue = env?.MARKBRIDGE_NO_INTERACTIVE;
  const envDisabled = envValue === "1" || String(envValue ?? "").toLowerCase() === "true";

  return Boolean(stdin?.isTTY) && Boolean(stdout?.isTTY) && !json && !noInteractive && !envDisabled;
}

export async function pickFromList(options = {}) {
  const items = Array.isArray(options.items) ? options.items : [];
  const formatItem = options.formatItem ?? ((item) => String(getItemIds(item, options)[0] ?? item));
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const title = options.title ?? "Select an option";
  const promptText = options.promptText ?? "Enter number or exact id/path: ";

  if (items.length === 0) {
    throw new Error(options.emptyMessage ?? "No items available to select.");
  }

  writeLine(output, title);

  items.forEach((item, index) => {
    writeLine(output, `  ${index + 1}. ${formatItem(item, index)}`);
  });

  const ask = options.question ?? createQuestionReader({
    input,
    output,
    createInterface: options.createInterface ?? createInterface
  });

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let raw;

      try {
        raw = await ask(promptText);
      } catch (error) {
        if (error?.code === "ERR_USE_AFTER_CLOSE") {
          throw new Error("Too many invalid selections.");
        }

        throw error;
      }

      const answer = String(raw ?? "").trim();

      if (!answer) {
        writeLine(output, "Please enter a number or exact id/path.");
        continue;
      }

      const selected = matchListAnswer(items, answer, { ...options, formatItem });

      if (selected) {
        return selected;
      }

      writeLine(output, "Invalid selection. Try again.");
    }

    throw new Error("Too many invalid selections.");
  } finally {
    await ask.close?.();
  }
}

export async function resolveExportFolderInteractively(library, exportOptions = {}, options = {}) {
  const matched = matchExportFolders(library, exportOptions);

  if (matched.reason === "none" || matched.reason === "ok") {
    return matched.reason === "none" ? null : matched.matches[0];
  }

  if (matched.reason === "ambiguous" && (options.interactive ?? isInteractive(options))) {
    const pick = options.pick ?? pickFromList;

    return pick({
      title: `Folder selector is ambiguous: ${matched.selector}`,
      items: matched.matches,
      formatItem: (item) => item.path,
      getId: (item) => item.path,
      input: options.input,
      output: options.output
    });
  }

  return resolveExportFolder(library, exportOptions);
}

export async function resolveBrowserProfileFolder(flags = {}, options = {}) {
  const usage = options.usage ?? "Usage: markbridge --browser chrome --profile <profile>";
  const env = options.env ?? process.env;
  const interactive = options.interactive ?? isInteractive({ ...options, ...flags, env });
  const pick = options.pick ?? ((args) => pickFromList({
    input: options.input ?? process.stdin,
    output: options.output ?? process.stdout,
    ...args
  }));
  const listProfiles = options.listProfiles ?? listBrowserProfiles;
  const pullBookmarks = options.pullBookmarks ?? pullBrowserBookmarks;
  const promptFolder = Boolean(options.promptFolder);
  let browser = hasFlagValue(flags.browser) ? flags.browser : undefined;
  let profile = hasFlagValue(flags.profile) ? flags.profile : undefined;
  let folder = hasFlagValue(flags.folder) ? flags.folder : undefined;
  let folderPath = hasFlagValue(flags.folderPath) ? flags.folderPath : undefined;
  const browserRoot = flags.browserRoot;

  if (!browser || !profile) {
    if (!interactive) {
      throw new Error(usage);
    }

    const profiles = await listProfiles({
      browser,
      browserRoot,
      env
    });

    if (!browser) {
      const browsers = uniqueBrowsers(profiles);

      if (browsers.length === 0) {
        throw new Error("No Chrome or Edge profiles found.");
      }

      if (browsers.length === 1) {
        browser = browsers[0].key;
      } else {
        const selected = await pick({
          title: "Select browser",
          items: browsers,
          formatItem: (item) => `${item.name} (${item.key})`,
          getId: (item) => item.key
        });

        browser = selected.key;
      }
    }

    browser = normalizeBrowserKey(browser);

    if (!profile) {
      const browserProfiles = profiles.filter((item) => item.browser === browser);

      if (browserProfiles.length === 0) {
        throw new Error(`No profiles found for ${browser}.`);
      }

      const selected = await pick({
        title: "Select profile",
        items: browserProfiles,
        formatItem: (item) => `${item.name} (${item.profile})`,
        getId: (item) => item.profile,
        getIds: (item) => [item.profile, item.name]
      });

      profile = selected.profile;
    }
  } else {
    browser = normalizeBrowserKey(browser);
  }

  const needsFolderPrompt = promptFolder && !folder && !folderPath;
  const needsAmbiguousCheck = Boolean(folder && !folderPath);
  let pulled;

  if (interactive && (needsFolderPrompt || needsAmbiguousCheck)) {
    pulled = await pullBookmarks({
      browser,
      profile,
      browserRoot,
      env
    });

    if (needsFolderPrompt) {
      const selected = await pick({
        title: "Select folder",
        items: folderPickerItems(pulled.library),
        formatItem: formatFolderPickerItem,
        getId: folderPickerId
      });

      if (!selected.allBookmarks && selected.path) {
        folderPath = selected.path;
        folder = undefined;
      }
    } else {
      const matched = matchExportFolders(pulled.library, { folder, folderPath });

      if (matched.reason === "ambiguous") {
        const selected = await pick({
          title: `Folder selector is ambiguous: ${matched.selector}`,
          items: matched.matches,
          formatItem: (item) => item.path,
          getId: (item) => item.path
        });

        folderPath = selected.path;
        folder = undefined;
      }
    }
  }

  return {
    browser,
    profile,
    browserRoot,
    folder,
    folderPath,
    pulled
  };
}

function uniqueBrowsers(profiles) {
  const seen = new Map();

  for (const profile of profiles) {
    if (!seen.has(profile.browser)) {
      seen.set(profile.browser, {
        key: profile.browser,
        name: profile.browserName
      });
    }
  }

  return [...seen.values()];
}

function folderPickerItems(library) {
  return [
    {
      allBookmarks: true,
      title: ALL_BOOKMARKS_LABEL,
      path: null
    },
    ...listExportFolders(library)
  ];
}

function formatFolderPickerItem(item) {
  return item.allBookmarks ? ALL_BOOKMARKS_LABEL : item.path;
}

function folderPickerId(item) {
  return item.allBookmarks ? ALL_BOOKMARKS_LABEL : item.path;
}

function matchListAnswer(items, answer, options) {
  if (/^\d+$/u.test(answer)) {
    const index = Number(answer);

    if (index >= 1 && index <= items.length) {
      return items[index - 1];
    }
  }

  const exact = items.filter((item) => {
    const ids = getItemIds(item, options).map((value) => String(value));
    const label = options.formatItem(item);

    return ids.includes(answer) || label === answer;
  });

  if (exact.length === 1) {
    return exact[0];
  }

  return null;
}

function getItemIds(item, options = {}) {
  if (typeof options.getIds === "function") {
    return options.getIds(item).filter((value) => value !== undefined && value !== null && value !== "");
  }

  if (typeof options.getId === "function") {
    const value = options.getId(item);

    return value === undefined || value === null || value === "" ? [] : [value];
  }

  if (item && typeof item === "object") {
    return [item.id, item.path, item.key, item.profile].filter((value) => value !== undefined && value !== null && value !== "");
  }

  return [item];
}

function createQuestionReader(options) {
  const rl = options.createInterface({
    input: options.input,
    output: options.output,
    terminal: Boolean(options.output?.isTTY)
  });
  const ask = (promptText) => rl.question(promptText);

  ask.close = () => rl.close();
  return ask;
}

function writeLine(output, text) {
  if (!output) {
    return;
  }

  if (typeof output.write === "function") {
    output.write(`${text}\n`);
    return;
  }

  if (typeof output === "function") {
    output(`${text}\n`);
  }
}
