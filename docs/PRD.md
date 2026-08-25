# MarkBridge PRD

## 1. 背景

浏览器书签和浏览器账号强绑定，跨浏览器、跨设备、跨 Profile 使用时存在两个问题：

- 不同浏览器和账号体系之间迁移成本高。
- 某些书签不希望长期保存在浏览器账号里，避免地址栏补全、会议投屏、搜索建议暴露个人信息。

MarkBridge 的 MVP 目标不是做完整书签应用，而是提供一个可控的本地中转层，并支持通过腾讯云 COS 在多台设备间传递指定书签目录的 HTML 快照。

## 2. 当前产品定位

MarkBridge 是一个 Node.js ≥22 的本地 CLI 工具（无 npm 运行时依赖），用于在浏览器 Profile、HTML 文件、MarkBridge 本地库和腾讯云 COS 之间迁移书签。

当前 MVP 已支持：

- 本地库导入导出、搜索编辑。
- Chrome / Edge Profile 文件级读写，以及写入前备份与恢复。
- 腾讯云 COS 的 `cloud push` / `pull` / `list` / `delete`。
- 基于默认配置的 `sync setup` / `status` / `check` / `verify` / `push` / `pull`。

当前 MVP 不做书签类型分级，不做本地加密，不做图形界面，不做浏览器扩展。

同步语义澄清：

- COS / sync 同步的是**浏览器指定文件夹导出的 HTML 快照**，上传到 COS 对象 key。
- `sync push` 已做 ETag 冲突检测：远端不存在则允许首次上传；本机上次记录的 ETag 与远端一致则允许覆盖；否则默认拒绝，需 `--force` 才能覆盖。
- `sync pull` 会对比本机上次记录的 ETag，提示远端是首次见到、未变化还是已变化；这只是提示，**不阻止**拉取。未变化时仍会下载，并在 `--apply` 时按原有 merge 语义写入浏览器。
- 冲突拒绝仍只发生在 `sync push`。`sync pull` 不做自动合并，也不因为 ETag 未变化而跳过写入。
- **不是**同步完整 `library.json`，也**不做**书签内容自动合并或版本历史。

## 3. 核心目标

1. 从浏览器导出的 HTML 导入 MarkBridge 本地库。
2. 从 Chrome / Edge 指定 Profile 拉取书签到 MarkBridge。
3. 从 MarkBridge 导出整库或指定文件夹为浏览器 HTML。
4. 将 MarkBridge 本地库写入指定 Chrome / Edge Profile 的指定文件夹。
5. 支持一键从浏览器 Profile 导出 HTML。
6. 支持一键从 HTML 导入浏览器 Profile。
7. 写浏览器前自动备份，并支持恢复备份。
8. 支持 `merge` / `append` / `replace`，避免重复导入语义不清。
9. 将导出的 HTML 上传到腾讯云 COS，并从 COS 下载、列表、删除。
10. 保存默认同步配置后，用短命令完成浏览器指定文件夹 → COS → 另一台设备浏览器的日常同步。

## 4. 非目标

- 不做浏览器扩展。
- 不做 GUI。
- 不做本地加密。
- 不做端到端加密的 COS 对象。
- 不做书签类型分级。
- 不直接支持 Safari / Firefox Profile 写入。
- 不通过浏览器运行时 API 写书签。
- 不做完整 `library.json` 的云端双向同步。
- 不做书签内容自动合并，也不做版本历史；`sync push` 的 ETag 覆盖门禁除外。
- 不做后台自动双向同步。

## 5. 用户流程

### 5.1 浏览器到 HTML

```sh
markbridge export-browser --browser chrome --profile "Huu Quang" --folder "Books" --output ~/Desktop/books.html
```

### 5.2 HTML 到浏览器

```sh
markbridge import-browser --input ~/Desktop/books.html --browser chrome --profile "Default" --folder MarkBridge --quit-browser --reopen
```

### 5.3 浏览器到 MarkBridge

```sh
markbridge browser profiles --browser chrome
markbridge pull-browser --browser chrome --profile "Huu Quang" --mode replace
markbridge list
```

### 5.4 MarkBridge 到 HTML

```sh
markbridge export ~/Desktop/bookmarks.html
markbridge export ~/Desktop/books.html --folder "Books"
markbridge export ~/Desktop/books.html --folder-path "书签栏 / Books"
```

### 5.5 MarkBridge 到浏览器 Profile

```sh
markbridge push-browser --browser chrome --profile "Default" --folder MarkBridge --quit-browser --reopen
```

### 5.6 本地 HTML 与腾讯云 COS

```sh
markbridge cloud push --file ~/Desktop/books.html --remote books.html
markbridge cloud list
markbridge cloud pull --remote books.html --output ~/Desktop/books-from-cos.html
markbridge cloud delete --remote books.html
```

### 5.7 跨设备一键同步（文件夹 HTML ↔ COS）

第一次在本机保存默认配置（只写本地 `sync-config.json`，不上传 COS，不保存密钥）：

```sh
markbridge sync setup --browser chrome --profile "Huu Quang" --folder "Books" --mode merge
markbridge sync check
```

日常从当前设备上传指定文件夹 HTML 到 COS（默认按 ETag 拒绝覆盖已变化的远端对象）：

```sh
markbridge sync push --dry-run
markbridge sync push
markbridge sync push --force
```

在另一台设备上同样 `sync setup` 后，先预览再正式导入浏览器：

```sh
markbridge sync pull --dry-run
markbridge sync pull --apply --quit-browser --reopen
```

健康与验收辅助：

```sh
markbridge sync status
markbridge sync status --remote
markbridge sync verify
```

## 6. 验收标准

- `pull-browser` 能明确显示来源浏览器、Profile 和 `Bookmarks` 文件路径。
- `export-browser` 一条命令能从指定浏览器 Profile 导出 HTML。
- `import-browser` 一条命令能把 HTML 写入指定浏览器 Profile。
- `export-browser --dry-run` 不写输出文件。
- `import-browser --dry-run` 不写浏览器书签。
- `list` 能显示书签标题、URL、路径和 ID。
- `export --folder` 只导出命中文件夹及其子树。
- 同名文件夹不唯一时，`export --folder` 报错并提示使用 `--folder-path`。
- `push-browser` 写入前创建备份。
- 浏览器运行中写入会被拒绝，除非用户显式使用 `--quit-browser`。
- `restore` 会在恢复前创建 safety backup。
- `cloud push` / `pull` / `list` / `delete` 能按 `.env` 中的 COS 配置完成对象操作。
- `sync setup` 保存默认浏览器、Profile、文件夹、导入模式和 COS key，且不写入 COS 密钥。
- `sync push` 从浏览器指定文件夹导出 HTML 并上传到 COS；远端已变化且 ETag 不匹配时拒绝覆盖，可用 `--force` 强制覆盖；`--dry-run` 不上传，但仍计算冲突并以退出码 1 提示。
- `sync pull` 必须显式选择 `--dry-run` 或 `--apply`；`--dry-run` 不写浏览器。
- `sync pull` 显示远端 ETag、上次见到的 ETag，以及 Remote since last sync（unchanged / changed / first time seeing this object）；ETag 未变化时仍可 `--apply`。
- `sync pull --apply` 按默认配置把 COS 中的 HTML 导入目标 Profile，写入前创建备份；始终打印 Backup 行，若创建了备份则同时打印 Restore 命令。
- `sync pull --apply` 写入失败且已创建备份时，提示 Backup 路径和 restore 命令，且不更新 `lastRemoteEtag`。
- `sync check` 能检查本地默认配置、COS 配置、浏览器目录和远端对象。
- `sync verify` 在不写浏览器的前提下验证远端 HTML 可导入目标 Profile。
- 同步对象是文件夹 HTML 快照，不是完整 `library.json`；`sync push` 用 ETag 做覆盖门禁，默认拒绝覆盖已变化的远端对象，`--force` 可强制覆盖；`sync pull` 用 ETag 做变化提示但不阻断；无自动合并，无版本历史。
