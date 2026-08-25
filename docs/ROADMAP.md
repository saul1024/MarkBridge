# MarkBridge Roadmap

## 当前原则

MVP 先把迁移链路和跨设备文件夹同步做清楚，不做书签类型分级。

当前核心能力：

- HTML -> MarkBridge
- Chrome / Edge Profile -> MarkBridge
- MarkBridge -> HTML
- MarkBridge -> Chrome / Edge Profile
- Chrome / Edge Profile -> HTML
- HTML -> Chrome / Edge Profile
- 指定文件夹导出
- 浏览器写入前备份和恢复
- 本地 HTML <-> 腾讯云 COS（`cloud push` / `pull` / `list` / `delete`）
- 浏览器指定文件夹 HTML <-> COS（`sync setup` / `push` / `pull` / `status` / `check` / `verify`）

说明：当前 COS / sync 同步的是文件夹 HTML 快照，不是完整 `library.json`。`sync push` 已做 ETag 冲突检测（默认拒绝覆盖，`--force` 可强制覆盖）；`sync pull` 已做远端变化提示（信息不阻断），写入失败时给出备份和 restore 命令。仍无自动合并和版本历史。

## Phase 1: 本地 CLI MVP

状态：已完成。

已完成：

- HTML 导入。
- 本地库持久化。
- `merge` / `append` / `replace`。
- `list` / `search` / `status` / `where`。
- HTML 整库导出。
- HTML 指定文件夹导出：`--folder` / `--folder-path`。
- Chrome / Edge Profile 列表。
- Chrome / Edge Profile 拉取：`pull-browser`。
- Chrome / Edge Profile 投递：`push-browser`。
- 一键浏览器导出：`export-browser`。
- 一键浏览器导入：`import-browser`。
- 写入前备份：`.markbridge-backup-*`。
- 备份恢复：`browser restore`。

可选补强（不阻塞进入下一阶段）：

- 更完整的人工验收脚本。
- 书签文件夹选择的交互体验：已落地 TTY 编号选择器（`sync setup` / `export-browser` / `sync push-browser`）。无 TUI 库；flags、`--json`、非 TTY 行为不变。
- 更清晰的本地库迁移策略。

## Phase 2: COS 同步

状态：基础能力已落地；`sync push` 的 ETag 冲突检测已落地；`sync pull` 的远端变化提示与写入失败备份提示已落地。完整 `library.json` 级同步 / 自动合并 / 版本历史仍未做。

已完成：

- `.env` COS 配置解析与请求签名。
- `cloud push` / `pull` / `list` / `delete`。
- `sync setup`：保存默认同步配置（不含 COS 密钥）。
- `sync status` / `status --remote`。
- `sync check` / `sync verify`。
- `sync push`：浏览器指定文件夹 -> HTML -> COS；ETag 冲突检测默认拒绝覆盖，`--force` 可强制覆盖。
- `sync pull --dry-run` / `--apply`：COS -> HTML -> 浏览器 Profile；对比上次记录的 ETag 提示远端是否变化，但不因此拒绝拉取。
- `sync pull --apply` 写入失败时给出 Backup 路径和 restore 命令，不更新 `lastRemoteEtag`。
- 高级显式传参：`sync push-browser` / `sync pull-browser`。

尚未完成：

- 完整 `library.json` 级别的云端同步。
- 自动双向合并。
- 版本历史。
- 后台自动同步。
- 端到端加密（归 Phase 3）。

当前语义提醒：

- 同步对象是浏览器文件夹 HTML 快照，不是 MarkBridge 本地库整文件。
- `sync push` 在远端对象已变化且 ETag 不匹配时拒绝覆盖，可用 `--force` 强制覆盖；不保留历史版本。
- `sync pull` 只提示远端相对上次 ETag 的变化，不阻断；冲突拒绝仍只在 push 侧。

## Phase 3: 安全增强

目标：减少本地库和云端对象的泄露风险。

候选能力：

- 本地库加密。
- COS 对象加密。
- 敏感字段脱敏日志。
- 打开书签时选择浏览器 Profile 或无痕窗口。

这些能力作为后续增强，不进入当前已落地的 CLI / COS MVP。

## Phase 4: 更好的使用界面

候选方向：

- TUI 或轻量 GUI。
- 浏览器扩展。
- 完整 TUI / 可视化选择 Profile 和文件夹（当前仅有 TTY 编号列表，不是 TUI）。
- 可视化导入、导出、备份恢复与同步流程。

## 当前优先级

1. 保持 CLI 使用路径简单，巩固 README 与验收用例。
2. 稳定 Chrome / Edge Profile 读写与备份恢复。
3. 巩固已落地的 COS / sync 工作流（文件夹 HTML + push ETag 冲突检测 + pull 变化提示）。
4. 再设计（可选）`library.json` 级同步与内容合并，而不是从零开始做 COS。
