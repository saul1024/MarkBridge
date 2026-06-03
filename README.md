# MarkBridge

MarkBridge 是一个面向跨浏览器、跨 Profile 书签迁移的 CLI。它把浏览器书签和浏览器账号解耦：你可以先把书签拉入 MarkBridge 本地库，再按需要导出 HTML 或投递到指定 Chrome / Edge Profile。

当前实现是本地 CLI MVP。它不包含图形界面、COS 同步、浏览器扩展、本地加密、Safari / Firefox Profile 投递，也不通过浏览器运行时 API 写书签。

## 当前支持

- 导入浏览器导出的 Netscape Bookmark HTML。
- 从 Chrome / Edge Profile 拉取本地 `Bookmarks` 文件到 MarkBridge。
- 将 MarkBridge 中的书签投递到指定 Chrome / Edge Profile。
- 导出整库或指定文件夹为浏览器可导入的 HTML 文件。
- 搜索、列表、编辑、删除书签。
- 重复导入控制：`merge`、`append`、`replace`。
- `--dry-run` 预览导入或拉取结果，不写本地库。
- 写浏览器前自动备份，并支持列出和恢复备份。

## 数据流向

```text
Browser HTML file
    -> markbridge import
MarkBridge local library
    -> markbridge export
Browser HTML file

Chrome / Edge Profile
    -> markbridge pull-browser
MarkBridge local library
    -> markbridge push-browser
Chrome / Edge Profile
```

几个命令的方向不要混：

- `import`：HTML 文件 -> MarkBridge 本地库。
- `pull-browser`：Chrome / Edge Profile -> MarkBridge 本地库。
- `export`：MarkBridge 本地库 -> HTML 文件。
- `push-browser`：MarkBridge 本地库 -> Chrome / Edge Profile。

## 安装和运行

项目要求 Node.js 22+。

### 推荐安装方式

进入项目根目录，也就是包含 `package.json` 的目录：

```sh
cd /path/to/MarkBridge
```

安装到当前用户目录：

```sh
npm install -g --prefix "$HOME/.local" .
```

这个命令会把 `markbridge` 安装到：

```text
$HOME/.local/bin/markbridge
```

如果执行 `markbridge help` 提示 `command not found`，说明 `$HOME/.local/bin` 还没有加入 `PATH`。macOS 默认 shell 是 zsh，可以执行：

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

验证安装：

```sh
markbridge help
```

如果能看到命令列表，安装完成。

### 免安装运行

也可以不全局安装，直接在项目目录里运行：

```sh
node bin/markbridge.js help
```

这种方式后续所有命令都要把 `markbridge` 换成 `node bin/markbridge.js`，例如：

```sh
node bin/markbridge.js status
```

### 更新和卸载

代码有更新后，重新执行安装命令即可覆盖旧版本：

```sh
npm install -g --prefix "$HOME/.local" .
```

卸载：

```sh
npm uninstall -g --prefix "$HOME/.local" markbridge
```

### 开发验证

修改代码后运行测试：

```sh
npm test
```

## 本地存储

默认本地库位置：

```text
~/.markbridge/library.json
```

当前阶段本地库是明文 JSON。当前 MVP 不做书签类型分级，也不做本地加密。

可以用环境变量隔离测试库：

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-demo)"
```

也可以指定库文件：

```sh
markbridge status --library /path/to/library.json
```

## Demo 数据

项目内置 demo：

```text
fixtures/demo-bookmarks.html
```

内容包括：

- `Work Tools`：`MarkBridge Public Docs`、`Engineering Search`
- `Personal Vault`：`Private Bank Portal`、`Private Health Notes`
- `Read Later`：`Temporary Article`

## 命令总览

### where

查看当前 MarkBridge 本地库路径。

```sh
markbridge where
```

输出会说明：

- 当前库路径。
- 该库是否存在。
- 当前阶段是否明文存储。

### status

查看当前本地库统计。

```sh
markbridge status
```

输出示例：

```text
Bookmarks: 5
Folders: 4
```

### import

从浏览器导出的 HTML 文件导入到 MarkBridge。

```sh
markbridge import <bookmarks.html> [--mode merge|append|replace] [--dry-run]
```

参数：

- `<bookmarks.html>`：浏览器导出的 Netscape Bookmark HTML 文件路径。
- `--mode merge`：默认模式。按 `normalizedUrl` 去重，已存在 URL 会跳过，不覆盖已有 title / folder。
- `--mode append`：追加模式。保留旧行为，重复导入会叠加。
- `--mode replace`：替换模式。用当前导入源替换整个 MarkBridge 本地库。
- `--dry-run`：只预览导入结果，不创建或修改 `library.json`。
- `--library <path>`：使用指定 MarkBridge 库文件。
- `--json`：输出 JSON。

示例：

```sh
markbridge import fixtures/demo-bookmarks.html
markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge import fixtures/demo-bookmarks.html --mode append
markbridge import fixtures/demo-bookmarks.html --mode replace
markbridge import fixtures/demo-bookmarks.html --dry-run
```

### list

列出本地库中的书签。

```sh
markbridge list [--json]
```

参数：

- `--json`：输出 JSON。

### search

搜索本地库中的书签。

```sh
markbridge search <query> [--json]
```

搜索范围包括标题、URL、路径、normalized URL。

### edit

编辑书签。

```sh
markbridge edit <bookmark-id> [--title text] [--url url] [--description text]
```

参数：

- `--title`：新标题。
- `--url`：新 URL，会重新计算 `normalizedUrl`。
- `--description`：备注。

### delete

删除书签。当前是逻辑删除，书签会标记 `deletedAt`。

```sh
markbridge delete <bookmark-id...>
```

### export

从 MarkBridge 本地库导出浏览器可导入的 HTML 文件。

```sh
markbridge export <output.html> [--folder name|path] [--folder-path path] [--include-empty-folders]
```

参数：

- `<output.html>`：输出文件路径。
- `--folder`：只导出某个文件夹。可以填文件夹名，例如 `Books`；也可以填路径，例如 `书签栏 / Books`。如果同名文件夹不唯一，会报错并要求改用 `--folder-path`。
- `--folder-path`：只导出某个完整路径文件夹，路径分隔符为 ` / `。路径可以从 `markbridge list` 输出的最后一列确认。
- `--include-empty-folders`：导出空文件夹。
- `--json`：输出 JSON。

示例：

```sh
markbridge export ~/Desktop/markbridge-all.html
markbridge export ~/Desktop/books.html --folder "Books"
markbridge export ~/Desktop/books.html --folder-path "书签栏 / Books"
```

指定文件夹导出时，输出 HTML 只包含命中的文件夹本身及其子树。

### browser profiles

列出本机 Chrome / Edge Profile。

```sh
markbridge browser profiles --browser chrome
markbridge browser profiles --browser edge
```

输出列含义：

```text
browser  profile-directory  display-name  bookmarks=yes|no  bookmarks-path
```

使用 `push-browser` 或 `pull-browser` 时，`--profile` 可以填第二列 Profile 目录名，例如 `Default`、`Profile 1`，也可以填第三列显示名，只要能唯一匹配。

参数：

- `--browser chrome|edge`：指定浏览器。
- `--browser-root <path>`：高级参数，用于测试或自定义 Profile 根目录。
- `--json`：输出 JSON。

### pull-browser

从指定 Chrome / Edge Profile 拉取书签到 MarkBridge。

```sh
markbridge pull-browser --browser chrome --profile "Default" [--mode merge|append|replace] [--dry-run]
```

参数：

- `--browser chrome|edge`：浏览器类型。
- `--profile <profile>`：目标 Profile。
- `--mode merge`：默认模式。按 `normalizedUrl` 跳过已存在书签。
- `--mode append`：追加拉取，会叠加。
- `--mode replace`：用浏览器 Profile 里的书签替换当前 MarkBridge 本地库。
- `--dry-run`：只预览，不写 MarkBridge 本地库。
- `--browser-root <path>`：高级参数，用于测试或自定义 Profile 根目录。
- `--json`：输出 JSON。

示例：

```sh
markbridge pull-browser --browser chrome --profile "Default" --dry-run
markbridge pull-browser --browser chrome --profile "Default" --mode merge
```

### push-browser

把 MarkBridge 的书签写入指定 Chrome / Edge Profile。

```sh
markbridge push-browser --browser chrome --profile "Default" [--folder MarkBridge] [--quit-browser] [--reopen]
```

参数：

- `--browser chrome|edge`：浏览器类型。
- `--profile <profile>`：目标 Profile。
- `--folder <name>`：写入浏览器书签栏下的文件夹名，默认 `MarkBridge`。
- `--quit-browser`：如果目标浏览器正在运行，先自动退出再写入。
- `--reopen`：写入后重新打开浏览器书签页。
- `--skip-running-check`：高级参数，跳过运行中检查。真实使用不建议。
- `--browser-root <path>`：高级参数，用于测试或自定义 Profile 根目录。
- `--json`：输出 JSON。

为什么默认要求浏览器关闭：

Chrome / Edge 运行时可能会把内存里的书签状态重新写回 `Bookmarks` 文件。如果 MarkBridge 在浏览器运行时直接改文件，可能被覆盖。建议使用：

```sh
markbridge push-browser --browser chrome --profile "Default" --quit-browser --reopen
```

投递后查看：

```text
Chrome: chrome://bookmarks -> Bookmarks Bar -> MarkBridge
Edge: edge://favorites -> Favorites bar -> MarkBridge
```

### browser backups

列出 MarkBridge 创建的浏览器 `Bookmarks` 备份。

```sh
markbridge browser backups --browser chrome --profile "Default"
```

输出包含：

- browser
- profile
- modifiedAt
- size
- backup path

### browser restore

恢复某个浏览器 `Bookmarks` 备份。

```sh
markbridge browser restore --browser chrome --profile "Default" --backup <backup-path> [--quit-browser] [--reopen]
```

参数：

- `--browser chrome|edge`：浏览器类型。
- `--profile <profile>`：目标 Profile。
- `--backup <path>`：要恢复的备份文件。
- `--quit-browser`：如果目标浏览器运行中，先退出再恢复。
- `--reopen`：恢复后打开书签页。
- `--skip-running-check`：高级参数，跳过运行中检查。真实使用不建议。
- `--browser-root <path>`：高级参数，用于测试或自定义 Profile 根目录。
- `--json`：输出 JSON。

恢复前会再创建一份 safety backup，避免恢复操作本身不可逆。

## 典型验收流程

### 1. 重复导入不叠加

```sh
cd /path/to/MarkBridge
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-merge)"

markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge status
```

预期：

```text
Bookmarks: 5
```

### 2. append 明确叠加

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-append)"

markbridge import fixtures/demo-bookmarks.html --mode append
markbridge import fixtures/demo-bookmarks.html --mode append
markbridge status
```

预期：

```text
Bookmarks: 10
```

### 3. HTML 导出和指定文件夹导出

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-export)"

markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge status
```

预期：

```text
Bookmarks: 5
```

导出并检查：

```sh
markbridge export "$MARKBRIDGE_HOME/all-export.html"
markbridge export "$MARKBRIDGE_HOME/personal-vault.html" --folder "Personal Vault"

grep -E "MarkBridge Public Docs|Engineering Search|Private Bank Portal|Private Health Notes|Temporary Article" "$MARKBRIDGE_HOME/all-export.html"
grep -E "Private Bank Portal|Private Health Notes" "$MARKBRIDGE_HOME/personal-vault.html"
grep -E "MarkBridge Public Docs|Engineering Search|Temporary Article" "$MARKBRIDGE_HOME/personal-vault.html"
```

预期：

- 第一条 `grep` 有输出。
- 第二条 `grep` 有输出。
- 第三条 `grep` 没有输出。

### 4. 从 Chrome 拉取到 MarkBridge

```sh
markbridge browser profiles --browser chrome

export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-pull)"
markbridge pull-browser --browser chrome --profile "Default" --dry-run
markbridge pull-browser --browser chrome --profile "Default" --mode merge
markbridge status
markbridge list
```

预期：

- `--dry-run` 不写库。
- 正式 `pull-browser` 后能在 `status` / `list` 里看到 Chrome Profile 的书签。
- 重复 `pull-browser --mode merge` 不叠加。

### 5. 推送回 Chrome 并查看

```sh
markbridge push-browser --browser chrome --profile "Default" --quit-browser --reopen
```

在 Chrome 查看：

```text
chrome://bookmarks -> Bookmarks Bar -> MarkBridge
```

预期：

- 能看到 MarkBridge 本地库里的书签目录。
- 命令输出里会显示写入的书签数量、目标文件夹、浏览器 `Bookmarks` 文件路径和备份路径。

### 6. 备份和恢复

```sh
markbridge browser backups --browser chrome --profile "Default"
markbridge browser restore --browser chrome --profile "Default" --backup <backup-path> --quit-browser --reopen
```

预期：

- `backups` 能列出 `.markbridge-backup-*` 文件。
- `restore` 输出 `Restored from` 和 `Safety backup`。
- 浏览器重新打开后书签恢复到备份状态。

## 自动验证

```sh
npm test
node --check src/*.js bin/markbridge.js test/*.js
```

当前通过：

```text
npm test: 27 tests passed
node --check src/*.js bin/markbridge.js test/*.js: passed
```

覆盖范围包括：

- Chrome / Edge / Firefox 风格 HTML 导入。
- 重复 URL 检测。
- `merge` / `append` / `replace` / `dry-run`。
- 保留已有 title。
- 整库导出和指定文件夹导出。
- Chrome / Edge Profile pull / push。
- browser backups / restore。
- 浏览器运行中拒绝写入，及 `--quit-browser --reopen`。

## 当前限制

- 不做 COS 同步。
- 不做图形界面。
- 不做浏览器扩展。
- 不做本地加密。
- 不支持 Safari / Firefox Profile 直接投递。
- 不通过 Chrome / Edge 运行时 API 写书签；当前是文件级写入，所以建议使用 `--quit-browser --reopen`。
