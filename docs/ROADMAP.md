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

说明：当前 COS / sync 同步的是文件夹 HTML 快照（覆盖上传），不是完整 `library.json`，也不含冲突检测。

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
- 书签文件夹选择的交互体验。
- 更清晰的本地库迁移策略。

## Phase 2: COS 同步

状态：基础能力已落地；冲突检测 / 本地库级同步 / 自动合并仍未做。

已完成：

- `.env` COS 配置解析与请求签名。
- `cloud push` / `pull` / `list` / `delete`。
- `sync setup`：保存默认同步配置（不含 COS 密钥）。
- `sync status` / `status --remote`。
- `sync check` / `sync verify`。
- `sync push`：浏览器指定文件夹 -> HTML -> COS（同 key 覆盖）。
- `sync pull --dry-run` / `--apply`：COS -> HTML -> 浏览器 Profile。
- 高级显式传参：`sync push-browser` / `sync pull-browser`。

尚未完成：

- 冲突检测：本地和远端都有改动时拒绝自动覆盖。
- 完整 `library.json` 级别的云端同步。
- 自动双向合并。
- 后台自动同步。
- 端到端加密（归 Phase 3）。

当前语义提醒：

- 同步对象是浏览器文件夹 HTML 快照，不是 MarkBridge 本地库整文件。
- 同一默认 key 会直接覆盖上传，不保留历史版本。

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
- 快速选择 Profile 和文件夹。
- 可视化导入、导出、备份恢复与同步流程。

## 当前优先级

1. 保持 CLI 使用路径简单，巩固 README 与验收用例。
2. 稳定 Chrome / Edge Profile 读写与备份恢复。
3. 巩固已落地的 COS / sync 工作流（文件夹 HTML 覆盖同步）。
4. 再设计冲突检测与（可选）`library.json` 级同步，而不是从零开始做 COS。
