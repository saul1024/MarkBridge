(() => {
  const state = {
    profiles: [],
    copyPreviewOk: false,
    pushPreviewOk: false,
    pullPreviewOk: false,
    pushConflict: false
  };

  const els = {
    healthLine: $("healthLine"),
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
    syncSetupState: $("syncSetupState"),
    syncCosState: $("syncCosState"),
    syncRemoteState: $("syncRemoteState"),
    syncRefreshBtn: $("syncRefreshBtn"),
    syncSetupBtn: $("syncSetupBtn"),
    forceWrap: $("forceWrap"),
    syncForce: $("syncForce"),
    pushPreviewBtn: $("pushPreviewBtn"),
    pushApplyBtn: $("pushApplyBtn"),
    pullQuit: $("pullQuit"),
    pullReopen: $("pullReopen"),
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
    els.fromBrowser.addEventListener("change", onSourceBrowserChange);
    els.fromProfile.addEventListener("change", onSourceProfileChange);
    els.fromFolder.addEventListener("change", invalidateCopy);
    els.toBrowser.addEventListener("change", () => {
      fillProfileSelect(els.toProfile, els.toBrowser.value);
      invalidateCopy();
    });
    els.toProfile.addEventListener("change", invalidateCopy);
    els.toFolder.addEventListener("input", invalidateCopy);
    els.copyMode.addEventListener("change", invalidateCopy);
    els.copyQuit.addEventListener("change", invalidateCopy);
    els.copyPreviewBtn.addEventListener("click", previewCopy);
    els.copyApplyBtn.addEventListener("click", applyCopy);
    els.syncRefreshBtn.addEventListener("click", () => loadSyncStatus({ silent: false }));
    els.syncSetupBtn.addEventListener("click", saveSetup);
    els.pushPreviewBtn.addEventListener("click", previewPush);
    els.pushApplyBtn.addEventListener("click", applyPush);
    els.pullPreviewBtn.addEventListener("click", previewPull);
    els.pullApplyBtn.addEventListener("click", applyPull);
    els.syncForce.addEventListener("change", () => {
      els.pushApplyBtn.disabled = !(state.pushPreviewOk && (!state.pushConflict || els.syncForce.checked));
    });
    els.pullQuit.addEventListener("change", invalidatePull);
    els.pullReopen.addEventListener("change", invalidatePull);
    els.clearLogBtn.addEventListener("click", () => setStatus("日志已清除。先预览，再执行。"));
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

  async function loadProfiles() {
    try {
      const data = await api("/api/profiles");
      state.profiles = data.profiles ?? [];
      fillBrowserSelect(els.fromBrowser);
      fillBrowserSelect(els.toBrowser);

      if (state.profiles.length === 0) {
        fillProfileSelect(els.fromProfile, els.fromBrowser.value);
        fillProfileSelect(els.toProfile, els.toBrowser.value);
        els.fromFolder.innerHTML = "";
        addOption(els.fromFolder, "", "未找到书签文件夹");
        setStatus("没有读到 Chrome / Edge Profile。请在有浏览器用户数据的这台电脑上运行 markbridge web。");
        return;
      }

      fillProfileSelect(els.fromProfile, els.fromBrowser.value);
      fillProfileSelect(els.toProfile, els.toBrowser.value);

      if (els.toProfile.options.length > 1) {
        els.toProfile.selectedIndex = Math.min(1, els.toProfile.options.length - 1);
      }

      await loadFolders();
      setStatus(`已读取 ${state.profiles.length} 个本机 Profile。跨账号复制请先点「预览复制」。`);
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

  async function onSourceBrowserChange() {
    fillProfileSelect(els.fromProfile, els.fromBrowser.value);
    invalidateCopy();
    invalidateSyncActions();
    await loadFolders();
  }

  async function onSourceProfileChange() {
    invalidateCopy();
    invalidateSyncActions();
    await loadFolders();
  }

  async function loadFolders() {
    const browser = els.fromBrowser.value;
    const profile = els.fromProfile.value;
    els.fromFolder.innerHTML = "";

    if (!browser || !profile) {
      addOption(els.fromFolder, "", "先选择源 Profile");
      return;
    }

    addOption(els.fromFolder, "", "正在读取文件夹…");

    try {
      const data = await api(`/api/folders?browser=${encodeURIComponent(browser)}&profile=${encodeURIComponent(profile)}`);
      els.fromFolder.innerHTML = "";

      for (const folder of data.folders ?? []) {
        const suffix = typeof folder.bookmarkCount === "number" ? ` · ${folder.bookmarkCount} 条` : "";
        addOption(els.fromFolder, folder.all ? "" : folder.path, `${folder.title}${suffix}`);
      }
    } catch (error) {
      els.fromFolder.innerHTML = "";
      addOption(els.fromFolder, "", "读取文件夹失败");
      setStatus(error.message, { error: true });
    }
  }

  async function previewCopy() {
    invalidateCopy();
    const body = copyPayload();

    if (body.fromBrowser === body.toBrowser && body.fromProfile === body.toProfile && body.toFolder === (body.fromFolderPath || "MarkBridge")) {
      setStatus("源和目标看起来相同。仍可预览，但执行会写回同一个 Profile。");
    }

    try {
      const data = await api("/api/copy/preview", { method: "POST", body });
      state.copyPreviewOk = true;
      els.copyApplyBtn.disabled = false;
      setStatus(formatCopy(data), { ok: true, details: data });
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
      setStatus(formatCopy(data), { ok: true, details: data });
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

  async function loadSyncStatus(options = {}) {
    try {
      const data = await api("/api/sync/status");
      els.syncSetupState.textContent = data.setup
        ? formatSetupSummary(data.config)
        : "尚未保存";
      els.syncCosState.textContent = data.cos?.configured
        ? `${data.cos.bucket} / ${data.cos.region}`
        : (data.cos?.error || "未配置（缺少 .env）");
      els.syncRemoteState.textContent = formatRemote(data.remote);

      if (!options.silent) {
        setStatus("已刷新 COS / setup 状态。", { ok: true, details: data });
      }
    } catch (error) {
      els.syncSetupState.textContent = "读取失败";
      els.syncCosState.textContent = "读取失败";
      setStatus(error.message, { error: true });
    }
  }

  async function saveSetup() {
    invalidateSyncActions();

    try {
      const payload = {
        browser: els.fromBrowser.value,
        profile: els.fromProfile.value,
        mode: els.copyMode.value
      };

      if (els.fromFolder.value) {
        payload.folderPath = els.fromFolder.value;
      }

      const data = await api("/api/sync/setup", { method: "POST", body: payload });
      await loadSyncStatus({ silent: true });
      setStatus(`已保存默认同步：${formatSetupSummary(data.config)}\n远端 key：${data.preview?.remoteKey ?? "（自动）"}\n这是 dry-run 预览，没有上传。`, {
        ok: true,
        details: data
      });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function previewPush() {
    invalidatePush();

    try {
      const data = await api("/api/sync/push/preview", { method: "POST", body: { force: false } });
      state.pushPreviewOk = true;
      state.pushConflict = Boolean(data.conflict);
      els.forceWrap.classList.toggle("hidden", !state.pushConflict);
      els.syncForce.checked = false;
      els.pushApplyBtn.disabled = state.pushConflict;
      const lines = [
        data.conflict ? "预览发现冲突：远端对象已变化，执行前必须勾选 force。" : "Push 预览完成，没有上传。",
        `对象：${data.remoteKey ?? "—"}`,
        `书签：${data.exportedBookmarks ?? "—"} 条 · ${data.size ?? "—"} bytes`,
        data.conflict ? `本地 ETag ${data.expectedEtag || "（无）"} / 远端 ${data.remoteEtag || "（无）"}` : `远端 ETag：${data.remoteEtag || "（不存在，将新建）"}`
      ];
      setStatus(lines.join("\n"), { ok: !data.conflict, error: Boolean(data.conflict), details: data });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function applyPush() {
    if (!state.pushPreviewOk || (state.pushConflict && !els.syncForce.checked)) {
      return;
    }

    try {
      const data = await api("/api/sync/push", {
        method: "POST",
        body: { force: Boolean(state.pushConflict && els.syncForce.checked) }
      });
      invalidatePush();
      await loadSyncStatus({ silent: true });
      setStatus(`Push 完成。\n对象：${data.remoteKey}\nETag：${data.etag || "—"}`, { ok: true, details: data });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  async function previewPull() {
    invalidatePull();

    try {
      const data = await api("/api/sync/pull/preview", { method: "POST", body: {} });
      state.pullPreviewOk = true;
      els.pullApplyBtn.disabled = false;
      setStatus(formatPull(data), { ok: true, details: data });
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
        body: {
          apply: true,
          quitBrowser: els.pullQuit.checked,
          reopen: els.pullReopen.checked
        }
      });
      invalidatePull();
      await loadSyncStatus({ silent: true });
      setStatus(formatPull(data), { ok: true, details: data });
    } catch (error) {
      setStatus(error.message, { error: true });
    }
  }

  function invalidateCopy() {
    state.copyPreviewOk = false;
    els.copyApplyBtn.disabled = true;
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

  function invalidateSyncActions() {
    invalidatePush();
    invalidatePull();
  }

  function formatCopy(data) {
    const fromFolder = data.from?.folder?.path || "全部书签";
    const verb = data.dryRun ? "预览复制（未写入目标 Bookmarks 文件）" : "已写入目标 Profile";
    return [
      verb,
      `源：${data.from?.browserName || data.from?.browser} / ${data.from?.profileName || data.from?.profile} · ${fromFolder} · ${data.from?.exportedBookmarks ?? "?"} 条`,
      `目标：${data.to?.browserName || data.to?.browser} / ${data.to?.profileName || data.to?.profile} → ${data.to?.folder} · 模式 ${data.to?.mode}`,
      `计划写入 ${data.to?.plannedBookmarks ?? data.to?.pushed ?? "?"} 条`,
      data.to?.backupPath ? `备份：${data.to.backupPath}` : "",
      data.quitBrowser ? "已勾选退出浏览器。" : "未勾选退出浏览器：若目标浏览器开着，写入可能被覆盖。"
    ].filter(Boolean).join("\n");
  }

  function formatPull(data) {
    const change = data.remoteStatus === "unchanged"
      ? "远端相对上次记录未变化（仍会按 merge 写入）。"
      : data.remoteStatus === "changed"
        ? "远端相对上次记录已变化。"
        : data.remoteStatus === "new-to-us"
          ? "本机还没有上次 ETag，将按新对象处理。"
          : "";
    return [
      data.dryRun ? "Pull 预览完成，没有写浏览器。" : "Pull 已写入浏览器。",
      `对象：${data.remoteKey ?? "—"}`,
      `导入 ${data.imported?.bookmarks ?? "?"} 条到 ${data.folder || data.profile} · 模式 ${data.mode ?? "merge"}`,
      change,
      data.backupPath ? `备份：${data.backupPath}` : ""
    ].filter(Boolean).join("\n");
  }

  function formatSetupSummary(config) {
    if (!config) {
      return "尚未保存";
    }

    const folder = config.folderPath || config.folder || "全部书签";
    return `${config.browser} / ${config.profile} · ${folder}`;
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
    els.statusBox.textContent = options.details
      ? `${message}\n\n${JSON.stringify(options.details, null, 2)}`
      : message;
    els.statusBox.classList.toggle("error", Boolean(options.error));
    els.statusBox.classList.toggle("ok", Boolean(options.ok) && !options.error);
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
