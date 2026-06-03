# MarkBridge PRD

## 1. 背景

浏览器书签和浏览器账号强绑定，跨浏览器、跨设备、跨 Profile 使用时存在两个问题：

- 不同浏览器和账号体系之间迁移成本高。
- 某些书签不希望长期保存在浏览器账号里，避免地址栏补全、会议投屏、搜索建议暴露个人信息。

MarkBridge 的 MVP 目标不是做完整书签应用，而是提供一个可控的本地中转层。

## 2. 当前产品定位

MarkBridge 是一个本地 CLI 工具，用于在浏览器 Profile、HTML 文件和 MarkBridge 本地库之间迁移书签。

当前 MVP 不做书签类型分级，不做本地加密，不做 COS 同步。

## 3. 核心目标

1. 从浏览器导出的 HTML 导入 MarkBridge 本地库。
2. 从 Chrome / Edge 指定 Profile 拉取书签到 MarkBridge。
3. 从 MarkBridge 导出整库或指定文件夹为浏览器 HTML。
4. 将 MarkBridge 本地库写入指定 Chrome / Edge Profile 的指定文件夹。
5. 支持一键从浏览器 Profile 导出 HTML。
6. 支持一键从 HTML 导入浏览器 Profile。
7. 写浏览器前自动备份，并支持恢复备份。
8. 支持 `merge` / `append` / `replace`，避免重复导入语义不清。

## 4. 非目标

- 不做浏览器扩展。
- 不做 GUI。
- 不做本地加密。
- 不做云同步。
- 不做书签类型分级。
- 不直接支持 Safari / Firefox Profile 写入。
- 不通过浏览器运行时 API 写书签。

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
