(() => {
  const state = {
    profiles: [],
    task: "copy",
    syncDir: "push",
    copyPreviewOk: false,
    exportPreviewOk: false,
    importPreviewOk: false,
    pushPreviewOk: false,
    pullPreviewOk: false,
    pushConflict: false,
    syncStatus: null,
    exportFoldersLoaded: false,
    pushFoldersLoaded: false,
    pullPrefillDone: false
  };

  const els = {
    healthLine: $("healthLine"),
    taskCopy: $("taskCopy"),
    taskExport: $("taskExport"),
    taskImport: $("taskImport"),
    taskSync: $("taskSync"),
    syncPush: $("syncPush"),
    syncPull: $("syncPull"),
    fromBrowser: $("fromBrowser"),
    fromProfile: $("fromProfile"),
    fromFolder: $("fromFolder"),
    toBrowser: $("toBrowser"),
    toProfile: $("toProfile"),
    toFolder: $("toFolder"),
    copyMode: $("copyMode"),
    copyQuit: $("copyQuit"),
    copyPreviewBtn: $("copyPreviewBtn"),
    copyApplyBtn: $("copyApplyBtn"),
    exportBrowser: $("exportBrowser"),
    exportProfile: $("exportProfile"),
    exportFolder: $("exportFolder"),
    exportPreviewBtn: $("exportPreviewBtn"),
    exportApplyBtn: $("exportApplyBtn"),
    importFile: $("importFile"),
    importBrowser: $("importBrowser"),
    importProfile: $("importProfile"),
    importFolder: $("importFolder"),
    importMode: $("importMode"),
    importQuit: $("importQuit"),
    importPreviewBtn: $("importPreviewBtn"),
    importApplyBtn: $("importApplyBtn"),
    pushBrowser: $("pushBrowser"),
    pushProfile: $("pushProfile"),
    pushFolder: $("pushFolder"),
    pushCosLine: $("pushCosLine"),
    forceWrap: $("forceWrap"),
    syncForce: $("syncForce"),
    pushPreviewBtn: $("pushPreviewBtn"),
    pushApplyBtn: $("pushApplyBtn"),
    pullCosLine: $("pullCosLine"),
    pullTargetLine: $("pullTargetLine"),
    pullFolder: $("pullFolder"),
    pullMode: $("pullMode"),
    pullQuit: $("pullQuit"),
    pullPreviewBtn: $("pullPreviewBtn"),
    pullApplyBtn: $("pullApplyBtn"),
    statusBox: $("statusBox"),
    clearLogBtn: $("clearLogBtn")
  };

  bind();
  boot();

  function $(id) {
    return document.getElementById(id);
  }

  function bind() {
    document.querySelector(".task-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-task]");
      if (button) {
        showTask(button.dataset.task);
      }
    });
    document.querySelector(".dir-toggle").addEventListener("click", (event) => {
      const button = event.target.closest("[data-sync-dir]");
      if (button) {
        showSyncDir(button.dataset.syncDir);
      }
    });

    els.fromBrowser.addEventListener("change", onCopySourceBrowserChange);
    els.fromProfile.addEventListener("change", onCopySourceProfileChange);
    els.fromFolder.addEventListener("change", invalidateCopy);
    els.toBrowser.addEventListener("change", () => {
      fillProfileSelect(els.toProfile, els.toBrowser.value);
      invalidateCopy();
    });
    els.toProfile.addEventListener("change", invalidateCopy);
    els.toFolder.addEventListener("input", invalidateCopy);
    els.copyMode.addEventListener("change", invalidateCopy);
    els.copyPreviewBtn.addEventListener("click", previewCopy);
    els.copyApplyBtn.addEventListener("click", applyCopy);

    els.exportBrowser.addEventListener("change", onExportBrowserChange);
    els.exportProfile.addEventListener("change", onExportProfileChange);
    els.exportFolder.addEventListener("change", invalidateExport);
    els.exportPreviewBtn.addEventListener("click", previewExport);
    els.exportApplyBtn.addEventListener("click", downloadExport);

    els.importBrowser.addEventListener("change", () => {
      fillProfileSelect(els.importProfile, els.importBrowser.value);
      invalidateImport();
    });
    els.importProfile.addEventListener("change", invalidateImport);
    els.importFolder.addEventListener("input", invalidateImport);
    els.importMode.addEventListener("change", invalidateImport);
    els.importFile.addEventListener("change", invalidateImport);
    els.importPreviewBtn.addEventListener("click", previewImport);
    els.importApplyBtn.addEventListener("click", applyImport);

    els.pushBrowser.addEventListener("change", onPushBrowserChange);
    els.pushProfile.addEventListener("change", onPushProfileChange);
    els.pushFolder.addEventListener("change", invalidatePush);
    els.pushPreviewBtn.addEventListener("click", previewPush);
    els.pushApplyBtn.addEventListener("click", applyPush);
    els.syncForce.addEventListener("change", syncPushApplyEnabled);

    els.pullFolder.addEventListener("input", invalidatePull);
    els.pullMode.addEventListener("change", invalidatePull);
    els.pullPreviewBtn.addEventListener("click", previewPull);
    els.pullApplyBtn.addEventListener("click", applyPull);

    els.clearLogBtn.addEventListener("click", () => setStatus(""));
  }

  async function boot() {
    try {
      const health = await api("/api/health");
      els.healthLine.textContent = health.localOnly
        ? "本机服务正常 · 仅 127.0.0.1"
        : "本机服务已响应";
      els.healthLine.classList.add("ok");
    } catch (error) {
      els.healthLine.textContent = `服务不可用：${error.message}`;
      els.healthLine.classList.add("bad");
      setStatus(error.message, { error: true });
      return;
    }

    await loadProfiles();
    await loadSyncStatus({ silent: true });
  }

  function showTask(task) {
    state.task = task;
    for (const button of document.querySelectorAll(".task-tab")) {
      const active = button.dataset.task === task;
      button.classList.toggle("active", active);
      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }
    els.taskCopy.classList.toggle("hidden", task !== "copy");
    els.taskExport.classList.toggle("hidden", task !== "export");
    els.taskImport.classList.toggle("hidden", task !== "import");
    els.taskSync.classList.toggle("hidden", task !== "sync");

    if (task === "export") {
      loadExportFolders();
    }
    if (task === "sync") {
      loadSyncStatus({ silent: true });
      loadPushFolders();
    }
  }

  function showSyncDir(dir) {
    state.syncDir = dir;
    for (const button of document.querySelectorAll(".dir-tab")) {
      button.classList.toggle("active", button.dataset.syncDir === dir);
    }
    els.syncPush.classList.toggle("hidden", dir !== "push");
    els.syncPull.classList.toggle("hidden", dir !== "pull");
    if (dir === "push") {
      loadPushFolders();
    }
  }

  async function loadProfiles() {
    try {
      const data = await api("/api/profiles");
      state.profiles = data.profiles ?? [];
      fillBrowserSelect(els.fromBrowser);
      fillBrowserSelect(els.toBrowser);
      fillBrowserSelect(els.exportBrowser);
      fillBrowserSelect(els.importBrowser);
      fillBrowserSelect(els.pushBrowser);

      fillProfileSelect(els.fromProfile, els.fromBrowser.value);
      fillProfileSelect(els.toProfile, els.toBrowser.value);
      fillProfileSelect(els.exportProfile, els.exportBrowser.value);
      fillProfileSelect(els.importProfile, els.importBrowser.value);
      fillProfileSelect(els.pushProfile, els.pushBrowser.value);

      if (state.profiles.length === 0) {
        els.fromFolder.innerHTML = "";
        addOption(els.fromFolder, "", "未找到书签文件夹");
        els.exportFolder.innerHTML = "";
        addOption(els.exportFolder, "", "未找到书签文件夹");
        els.pushFolder.innerHTML = "";
        addOption(els.pushFolder, "", "未找到书签文件夹");
        setStatus("没有读到 Chrome / Edge Profile。");
        return;
      }

      if (els.toProfile.options.length > 1) {
        els.toProfile.selectedIndex = Math.min(1, els.toProfile.options.length - 1);
      }
      if (els.importProfile.options.length > 1) {
        els.importProfile.selectedIndex = Math.min(1, els.importProfile.options.length - 1);
      }

      await loadFolders();
      setStatus(`已读取 ${state.profiles.length} 个本机 Profile。`);
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  function fillBrowserSelect(select) {
    const browsers = unique(state.profiles.map((item) => item.browser));
    const current = select.value;
    select.innerHTML = "";

    if (browsers.length === 0) {
      addOption(select, "chrome", "Chrome（未找到 Profile）");
      addOption(select, "edge", "Edge（未找到 Profile）");
      return;
    }

    for (const browser of browsers) {
      const sample = state.profiles.find((item) => item.browser === browser);
      addOption(select, browser, sample?.browserName ?? browser);
    }

    if (browsers.includes(current)) {
      select.value = current;
    }
  }

  function fillProfileSelect(select, browser) {
    const current = select.value;
    const profiles = state.profiles.filter((item) => item.browser === browser);
    select.innerHTML = "";

    if (profiles.length === 0) {
      addOption(select, "", "没有可用 Profile");
      return;
    }

    for (const profile of profiles) {
      const label = profile.name && profile.name !== profile.profile
        ? `${profile.name} (${profile.profile})`
        : profile.profile;
      addOption(select, profile.profile, label);
    }

    if (profiles.some((item) => item.profile === current)) {
      select.value = current;
    }
  }

  async function onCopySourceBrowserChange() {
    fillProfileSelect(els.fromProfile, els.fromBrowser.value);
    invalidateCopy();
    await loadFolders();
  }

  async function onCopySourceProfileChange() {
    invalidateCopy();
    await loadFolders();
  }

  async function onExportBrowserChange() {
    fillProfileSelect(els.exportProfile, els.exportBrowser.value);
    invalidateExport();
    await loadExportFolders({ force: true });
  }

  async function onExportProfileChange() {
    invalidateExport();
    await loadExportFolders({ force: true });
  }

  async function onPushBrowserChange() {
    fillProfileSelect(els.pushProfile, els.pushBrowser.value);
    invalidatePush();
    await loadPushFolders({ force: true });
  }

  async function onPushProfileChange() {
    invalidatePush();
    await loadPushFolders({ force: true });
  }

  async function loadFolders() {
    await loadFolderSelect(els.fromFolder, els.fromBrowser.value, els.fromProfile.value, "先选择源 Profile");
  }

  async function loadExportFolders(options = {}) {
    if (state.exportFoldersLoaded && !options.force) {
      return;
    }
    await loadFolderSelect(els.exportFolder, els.exportBrowser.value, els.exportProfile.value, "先选择 Profile");
    state.exportFoldersLoaded = true;
  }

  async function loadPushFolders(options = {}) {
    if (state.pushFoldersLoaded && !options.force) {
      return;
    }
    await loadFolderSelect(els.pushFolder, els.pushBrowser.value, els.pushProfile.value, "先选择 Profile");
    state.pushFoldersLoaded = true;
  }

  async function loadFolderSelect(select, browser, profile, emptyLabel) {
    select.innerHTML = "";

    if (!browser || !profile) {
      addOption(select, "", emptyLabel);
      return;
    }

    addOption(select, "", "正在读取文件夹…");

    try {
      const data = await api(`/api/folders?browser=${encodeURIComponent(browser)}&profile=${encodeURIComponent(profile)}`);
      select.innerHTML = "";
      for (const folder of data.folders ?? []) {
        const suffix = typeof folder.bookmarkCount === "number" ? ` · ${folder.bookmarkCount} 条` : "";
        addOption(select, folder.all ? "" : folder.path, `${folder.title}${suffix}`);
      }
    } catch (error) {
      select.innerHTML = "";
      addOption(select, "", "读取文件夹失败");
      setStatus(error.message, { error: true });
    }
  }

  async function previewCopy() {
    invalidateCopy();
    try {
      const data = await api("/api/copy/preview", { method: "POST", body: copyPayload() });
      state.copyPreviewOk = true;
      els.copyApplyBtn.disabled = false;
      setStatus(formatCopy(data), { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function applyCopy() {
    if (!state.copyPreviewOk) {
      return;
    }
    try {
      const data = await api("/api/copy", { method: "POST", body: copyPayload() });
      invalidateCopy();
      setStatus(formatCopy(data), { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  function copyPayload() {
    const payload = {
      fromBrowser: els.fromBrowser.value,
      fromProfile: els.fromProfile.value,
      toBrowser: els.toBrowser.value,
      toProfile: els.toProfile.value,
      toFolder: els.toFolder.value.trim() || "MarkBridge",
      mode: els.copyMode.value,
      quitBrowser: els.copyQuit.checked
    };
    if (els.fromFolder.value) {
      payload.fromFolderPath = els.fromFolder.value;
    }
    return payload;
  }

  async function previewExport() {
    invalidateExport();
    try {
      const data = await api("/api/export/preview", { method: "POST", body: exportPayload() });
      state.exportPreviewOk = true;
      els.exportApplyBtn.disabled = false;
      setStatus(`导出预览：${data.exportedBookmarks ?? "?"} 条 · ${data.folder?.path || "全部书签"}`, { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function downloadExport() {
    if (!state.exportPreviewOk) {
      return;
    }
    const payload = exportPayload();
    const params = new URLSearchParams({
      browser: payload.browser,
      profile: payload.profile
    });
    if (payload.folderPath) {
      params.set("folderPath", payload.folderPath);
    }

    try {
      const response = await fetch(`/api/export?${params}`);
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("text/html")) {
        let message = `导出失败（${response.status}）`;
        try {
          const payloadJson = await response.json();
          message = payloadJson.error || message;
        } catch {
          // Keep the HTTP status message when the body is not JSON.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get("content-disposition"));
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setStatus(`已下载 ${filename}`, { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  function exportPayload() {
    const payload = {
      browser: els.exportBrowser.value,
      profile: els.exportProfile.value
    };
    if (els.exportFolder.value) {
      payload.folderPath = els.exportFolder.value;
    }
    return payload;
  }

  async function previewImport() {
    invalidateImport();
    try {
      const data = await api("/api/import/preview", { method: "POST", body: await importPayload() });
      state.importPreviewOk = true;
      els.importApplyBtn.disabled = false;
      setStatus(formatImport(data), { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function applyImport() {
    if (!state.importPreviewOk) {
      return;
    }
    try {
      const data = await api("/api/import", { method: "POST", body: await importPayload() });
      invalidateImport();
      setStatus(formatImport(data), { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function importPayload() {
    const file = els.importFile.files[0];
    if (!file) {
      throw new Error("请选择 HTML 文件");
    }
    return {
      html: await file.text(),
      browser: els.importBrowser.value,
      profile: els.importProfile.value,
      folder: els.importFolder.value.trim() || "MarkBridge",
      mode: els.importMode.value,
      quitBrowser: els.importQuit.checked,
      sourceFileName: file.name
    };
  }

  async function loadSyncStatus(options = {}) {
    try {
      const data = await api("/api/sync/status");
      state.syncStatus = data;
      const line = formatCosLine(data);
      els.pushCosLine.textContent = line;
      els.pullCosLine.textContent = line;
      els.pullTargetLine.textContent = formatPullTarget(data);
      prefillPull(data.config);
      if (!options.silent) {
        setStatus(line, { ok: true });
      }
    } catch (error) {
      els.pushCosLine.textContent = "读取失败";
      els.pullCosLine.textContent = "读取失败";
      els.pullTargetLine.textContent = "目标：读取失败";
      setStatus(error.message, { error: true });
    }
  }

  function prefillPull(config) {
    if (!config || state.pullPrefillDone) {
      return;
    }
    if (config.folder) {
      els.pullFolder.value = config.folder;
    }
    if (config.mode && [...els.pullMode.options].some((option) => option.value === config.mode)) {
      els.pullMode.value = config.mode;
    }
    state.pullPrefillDone = true;
  }

  async function ensurePushSetup() {
    const payload = {
      browser: els.pushBrowser.value,
      profile: els.pushProfile.value,
      mode: "merge"
    };
    if (els.pushFolder.value) {
      payload.folderPath = els.pushFolder.value;
    }

    if (!state.syncStatus) {
      await loadSyncStatus({ silent: true });
    }
    const config = state.syncStatus?.config;
    const same = Boolean(
      config
      && config.browser === payload.browser
      && config.profile === payload.profile
      && String(config.folderPath || "") === String(payload.folderPath || "")
    );
    if (same) {
      return;
    }

    await api("/api/sync/setup", { method: "POST", body: payload });
    await loadSyncStatus({ silent: true });
  }

  async function previewPush() {
    invalidatePush();
    try {
      await ensurePushSetup();
      const data = await api("/api/sync/push/preview", { method: "POST", body: { force: false } });
      state.pushPreviewOk = true;
      state.pushConflict = Boolean(data.conflict);
      els.forceWrap.classList.toggle("hidden", !state.pushConflict);
      els.syncForce.checked = false;
      syncPushApplyEnabled();
      setStatus(formatPush(data), { ok: !data.conflict, error: Boolean(data.conflict) });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function applyPush() {
    if (!state.pushPreviewOk || (state.pushConflict && !els.syncForce.checked)) {
      return;
    }
    try {
      await ensurePushSetup();
      const data = await api("/api/sync/push", {
        method: "POST",
        body: { force: Boolean(state.pushConflict && els.syncForce.checked) }
      });
      invalidatePush();
      await loadSyncStatus({ silent: true });
      setStatus(formatPush(data), { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function previewPull() {
    invalidatePull();
    try {
      const data = await api("/api/sync/pull/preview", { method: "POST", body: pullPayload() });
      state.pullPreviewOk = true;
      els.pullApplyBtn.disabled = false;
      setStatus(formatPull(data), { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function applyPull() {
    if (!state.pullPreviewOk) {
      return;
    }
    try {
      const data = await api("/api/sync/pull", {
        method: "POST",
        body: { ...pullPayload(), apply: true }
      });
      invalidatePull();
      await loadSyncStatus({ silent: true });
      setStatus(formatPull(data), { ok: true });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  function pullPayload() {
    return {
      folder: els.pullFolder.value.trim() || "MarkBridge",
      mode: els.pullMode.value,
      quitBrowser: els.pullQuit.checked
    };
  }

  function invalidateCopy() {
    state.copyPreviewOk = false;
    els.copyApplyBtn.disabled = true;
  }

  function invalidateExport() {
    state.exportPreviewOk = false;
    els.exportApplyBtn.disabled = true;
  }

  function invalidateImport() {
    state.importPreviewOk = false;
    els.importApplyBtn.disabled = true;
  }

  function invalidatePush() {
    state.pushPreviewOk = false;
    state.pushConflict = false;
    els.pushApplyBtn.disabled = true;
    els.forceWrap.classList.add("hidden");
    els.syncForce.checked = false;
  }

  function invalidatePull() {
    state.pullPreviewOk = false;
    els.pullApplyBtn.disabled = true;
  }

  function syncPushApplyEnabled() {
    els.pushApplyBtn.disabled = !(state.pushPreviewOk && (!state.pushConflict || els.syncForce.checked));
  }

  function formatCopy(data) {
    const fromFolder = data.from?.folder?.path || "全部书签";
    const verb = data.dryRun ? "预览" : "已写入";
    const backup = data.to?.backupPath ? `\n备份：${data.to.backupPath}` : "";
    return `${verb} ${data.from?.exportedBookmarks ?? "?"} 条 · ${data.from?.browserName || data.from?.browser} / ${data.from?.profileName || data.from?.profile} ${fromFolder} → ${data.to?.browserName || data.to?.browser} / ${data.to?.profileName || data.to?.profile} ${data.to?.folder} · ${data.to?.mode}${backup}`;
  }

  function formatImport(data) {
    const verb = data.dryRun ? "预览" : "已写入";
    const backup = data.backupPath ? `\n备份：${data.backupPath}` : "";
    return `${verb} ${data.imported?.bookmarks ?? "?"} 条 → ${data.browserName || data.browser} / ${data.profileName || data.profile} ${data.folder} · ${data.mode}${backup}`;
  }

  function formatPush(data) {
    if (data.conflict) {
      return `远端已变化，勾选强制覆盖后再执行\n${data.remoteKey ?? "—"} · ${data.exportedBookmarks ?? "—"} 条`;
    }
    const verb = data.dryRun ? "上传预览" : "上传完成";
    return `${verb}\n${data.remoteKey ?? "—"} · ${data.exportedBookmarks ?? "—"} 条`;
  }

  function formatPull(data) {
    const verb = data.dryRun ? "下载预览" : "已写入";
    const backup = data.backupPath ? `\n备份：${data.backupPath}` : "";
    return `${verb} ${data.imported?.bookmarks ?? "?"} 条 → ${data.folder || data.profile} · ${data.mode ?? "merge"}\n${data.remoteKey ?? "—"}${backup}`;
  }

  function formatCosLine(status) {
    if (!status) {
      return "读取中…";
    }
    const key = status.config?.remoteKey || status.remote?.remoteKey;
    const parts = [];
    if (key) {
      parts.push(key);
    } else if (!status.setup) {
      parts.push("尚未保存");
    }
    if (status.cos && !status.cos.configured) {
      parts.push(status.cos.error || "未配置");
    } else if (status.remote) {
      parts.push(formatRemote(status.remote));
    }
    return parts.join(" · ") || "—";
  }

  function formatPullTarget(status) {
    const config = status?.config;
    if (!config?.browser || !config?.profile) {
      return "目标：尚未保存";
    }
    return `目标：${config.browser} / ${config.profile}`;
  }

  function formatRemote(remote) {
    if (!remote) {
      return "未查询";
    }
    if (remote.error) {
      return remote.error;
    }
    if (!remote.exists) {
      return "远端对象不存在";
    }
    return `存在 · ${remote.size ?? "?"} bytes`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text || `HTTP ${response.status}`);
    }
    if (!payload.ok) {
      throw new Error(payload.error || `请求失败（${response.status}）`);
    }
    return payload.data;
  }

  function setStatus(message, options = {}) {
    els.statusBox.textContent = message;
    els.statusBox.classList.toggle("error", Boolean(options.error));
    els.statusBox.classList.toggle("ok", Boolean(options.ok) && !options.error);
  }

  function filenameFromDisposition(header) {
    const match = String(header ?? "").match(/filename\*?=(?:UTF-8''|"?)([^";]+)/iu);
    return match ? decodeURIComponent(match[1].replace(/"/g, "").trim()) : "bookmarks.html";
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function unique(values) {
    return [...new Set(values)];
  }
})();
