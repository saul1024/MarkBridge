# Security Notes

## 1. 当前边界

当前 MVP 的安全目标是减少浏览器账号和浏览器地址栏带来的暴露面。

MarkBridge 当前不是加密保险箱：

- 本地库是明文 JSON。
- 不做书签类型分级。
- 不做本地加密。
- COS 上存放的是明文 HTML 快照（文件夹导出结果），不是加密对象。
- 不做端到端加密。

当前已支持腾讯云 COS 上传 / 下载 / 列表 / 删除，以及基于默认配置的 `sync push` / `sync pull`。同步对象是浏览器指定文件夹的 HTML，不是完整 `library.json`。`sync push` 已用 ETag 做覆盖门禁，默认拒绝覆盖已变化的远端对象；`--force` 仍可强制覆盖。`sync pull` 会提示远端相对本机 `lastRemoteEtag` 是否变化，但不因此拒绝拉取；写入浏览器失败且已创建备份时，会给出 Backup 路径和 restore 命令。

## 2. 当前可控点

用户可以通过流程控制降低浏览器侧暴露：

- 不把某些书签写回浏览器 Profile。
- 只导出指定文件夹。
- 用独立 Profile 接收 MarkBridge 投递结果。
- 写入浏览器前自动备份，便于恢复。
- 使用 `export-browser` / `import-browser` 缩短操作链路，减少误选本地库的风险。
- 使用 `sync pull --dry-run` 先预览再 `--apply`，降低误写浏览器的风险。dry-run 会说明远端相对上次同步是未变化、已变化还是首次见到。
- 写入浏览器失败时，按输出的 Backup / Restore 命令回滚，而不是再拉一次远端。

## 3. COS 与凭据

- COS 密钥来自工作目录 `.env`（或真实环境变量）：`COS_SECRET_ID` / `COS_SECRET_KEY` 等。`.env` 应被 gitignore，不要提交真实密钥。
- 默认同步配置文件 `~/.markbridge/sync-config.json` 只保存浏览器、Profile、目录、导入模式、COS 对象 key，以及上次成功同步的 `lastRemoteEtag` / `lastRemoteKey`，**不保存** COS 密钥。`lastRemoteEtag` 不是密钥。
- `markbridge web` 只绑定 `127.0.0.1`。API 响应会去掉 `secretId` / `secretKey` / `COS_SECRET_*`，密钥仍只在本机 Node 进程里从 `.env` 或环境变量读取。
- COS 对象内容是明文 Netscape Bookmark HTML；能访问该 Bucket / key 的人可以直接看到书签标题和 URL。
- `sync push` 默认按 ETag 拒绝覆盖已变化的远端对象；传入 `--force` 仍会覆盖，误用 `--force` 可能覆盖远端快照。
- 删除远端对象使用 `cloud delete`，操作不可从 MarkBridge 侧自动回滚。

## 4. 风险

- 本地库文件包含书签标题和 URL，能读到文件的人可以直接看到内容。
- COS 上的 HTML 同样明文，Bucket 权限过宽或密钥泄露会导致书签外泄。
- 如果用户把敏感书签写入 Chrome / Edge，浏览器同步、地址栏补全、历史记录仍可能暴露。
- 如果目标 Profile 开启浏览器云同步，MarkBridge 写入的书签可能被浏览器账号同步。
- 即使有 ETag 门禁，`--force` 仍会覆盖同 key 的远端 HTML；多设备不要同时强推。
- `sync pull` 的 ETag 比较只是提示：远端未变化时 `--apply` 仍会按 merge 写入浏览器；不要把它理解成自动跳过或自动合并。

## 5. 当前建议

- 敏感书签不长期保存在公司电脑浏览器 Profile 中。
- 使用 `export-browser --folder` / `sync setup --folder` 只迁移需要的目录。
- 使用 `import-browser` / `sync pull --apply` 前确认目标 Profile，并先跑 `--dry-run`。
- 写入浏览器时使用 `--quit-browser --reopen`。
- 妥善保管 `.env` 中的 COS 密钥；不要把 `.env` 或密钥写入仓库、聊天记录或 `sync-config.json`。
- 收紧 COS Bucket 权限，避免公开读；定期轮换密钥。
- 多设备共用同一 key 时，先 `sync pull` 再 `sync push`；只有确认要覆盖远端时才使用 `--force`。

## 6. 后续增强

可作为后续版本考虑：

- 本地库加密。
- COS 同步 / 对象加密。
- 书签内容自动合并、版本历史，以及更细的冲突策略（当前 push 侧有 ETag 覆盖门禁，pull 侧仅提示变化，`--force` 仍可覆盖远端）。
- 打开书签时使用指定浏览器 Profile。
- 无痕打开。
- 图形界面中的会议模式。
