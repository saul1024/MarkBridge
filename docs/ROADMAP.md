# MarkBridge Roadmap

## 当前原则

MVP 先把迁移链路做清楚，不做书签类型分级。

当前核心能力：

- HTML -> MarkBridge
- Chrome / Edge Profile -> MarkBridge
- MarkBridge -> HTML
- MarkBridge -> Chrome / Edge Profile
- Chrome / Edge Profile -> HTML
- HTML -> Chrome / Edge Profile
- 指定文件夹导出
- 浏览器写入前备份和恢复

## Phase 1: 本地 CLI MVP

状态：进行中，核心链路已实现。

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

待补强：

- 更完整的人工验收脚本。
- 书签文件夹选择的交互体验。
- 更清晰的本地库迁移策略。

## Phase 2: COS 同步

目标：让不同设备可以共享 MarkBridge 本地库。

预计能力：

- `sync push`：上传本地库到腾讯云 COS。
- `sync pull`：从 COS 拉取远端库。
- `sync status`：查看远端版本信息。
- 冲突检测：本地和远端都有改动时拒绝自动覆盖。

当前暂不引入：

- 自动双向合并。
- 后台同步。
- 端到端加密。

## Phase 3: 安全增强

目标：减少本地库和云端库的泄露风险。

候选能力：

- 本地库加密。
- COS 对象加密。
- 敏感字段脱敏日志。
- 打开书签时选择浏览器 Profile 或无痕窗口。

这些能力作为后续增强，不进入当前 MVP。

## Phase 4: 更好的使用界面

候选方向：

- TUI 或轻量 GUI。
- 浏览器扩展。
- 快速选择 Profile 和文件夹。
- 可视化导入、导出、备份恢复流程。

## 当前优先级

1. 保持 CLI 使用路径简单。
2. 完善 README 和验收用例。
3. 稳定 Chrome / Edge Profile 读写。
4. 再进入 COS 同步设计。
