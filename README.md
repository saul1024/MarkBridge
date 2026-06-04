# MarkBridge

MarkBridge 是一个面向跨浏览器、跨 Profile 书签迁移的 CLI。它把浏览器书签和浏览器账号解耦：你可以先把书签拉入 MarkBridge 本地库，再按需要导出 HTML 或投递到指定 Chrome / Edge Profile。

当前实现是 CLI MVP。它支持本地导入导出、Chrome / Edge Profile 投递，以及腾讯云 COS 上传、下载、列表。它不包含图形界面、浏览器扩展、本地加密、Safari / Firefox Profile 投递，也不通过浏览器运行时 API 写书签。

## 当前支持

- 一条命令从 Chrome / Edge 指定 Profile 导出整库或指定文件夹为 HTML。
- 一条命令将 HTML 导入指定 Chrome / Edge Profile，并支持 `merge` 去重和 `replace-folder` 替换目标目录。
- 导入浏览器导出的 Netscape Bookmark HTML。
- 从 Chrome / Edge Profile 拉取本地 `Bookmarks` 文件到 MarkBridge。
- 将 MarkBridge 中的书签投递到指定 Chrome / Edge Profile。
- 导出整库或指定文件夹为浏览器可导入的 HTML 文件。
- 搜索、列表、编辑、删除书签。
- MarkBridge 本地库重复导入控制：`merge`、`append`、`replace`。
- `--dry-run` 预览导入、拉取和一键工作流结果，不写目标文件。
- 写浏览器前自动备份，并支持列出和恢复备份。
- 保存默认同步配置后，用短命令完成日常 COS 上传、预览拉取和正式导入。
- 一条命令将浏览器指定书签目录同步上传到腾讯云 COS。
- 一条命令从腾讯云 COS 拉取 HTML 并预览或导入指定浏览器 Profile。
- 将导出的 HTML 上传到腾讯云 COS，并从 COS 下载到本地。

## 数据流向

普通用户优先使用一键命令：

```text
markbridge sync setup
    -> save browser/profile/folder defaults
Chrome / Edge Profile
    -> markbridge sync push
Tencent Cloud COS
    -> markbridge sync pull --dry-run
    -> markbridge sync pull --apply
Chrome / Edge Profile
```

也可以使用两段式命令，手动保留中间 HTML 文件：

```text
Chrome / Edge Profile
    -> markbridge export-browser
Browser HTML file
    -> markbridge cloud push
Tencent Cloud COS
    -> markbridge cloud pull
Browser HTML file
    -> markbridge import-browser
Chrome / Edge Profile
```

底层高级命令仍然保留：

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

- `export-browser`：Chrome / Edge Profile -> HTML 文件。
- `import-browser`：HTML 文件 -> Chrome / Edge Profile。
- `import`：HTML 文件 -> MarkBridge 本地库。
- `pull-browser`：Chrome / Edge Profile -> MarkBridge 本地库。
- `export`：MarkBridge 本地库 -> HTML 文件。
- `push-browser`：MarkBridge 本地库 -> Chrome / Edge Profile。
- `sync setup`：保存默认浏览器、Profile、书签目录和 COS 对象 key。
- `sync push`：按默认配置从 Chrome / Edge Profile 上传到腾讯云 COS。
- `sync pull --dry-run`：按默认配置从腾讯云 COS 拉取并预览导入影响。
- `sync pull --apply`：按默认配置从腾讯云 COS 正式导入 Chrome / Edge Profile。
- `sync push-browser`：Chrome / Edge Profile -> 腾讯云 COS，高级命令，每次显式传参。
- `sync pull-browser`：腾讯云 COS -> Chrome / Edge Profile，高级命令，每次显式传参。
- `cloud push`：本地 HTML 文件 -> 腾讯云 COS。
- `cloud pull`：腾讯云 COS -> 本地 HTML 文件。
- `cloud list`：列出腾讯云 COS 上的对象。
- `cloud delete`：删除腾讯云 COS 上的指定对象。

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
npm run acceptance
```

`npm run acceptance` 会创建临时模拟 Chrome Profile，验证 `export-browser`、`import-browser --mode merge`、`import-browser --mode replace-folder` 和备份恢复端到端链路，不会读写你的真实浏览器 Profile。

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

## 5 分钟快速开始

先确认 Chrome Profile 名称：

```sh
markbridge browser profiles --browser chrome
```

假设你要同步 `Huu Quang` Profile 下的 `Books` 目录，第一次只需要配置一次：

```sh
markbridge sync setup --browser chrome --profile "Huu Quang" --folder "Books" --mode merge
```

配置后先跑健康检查：

```sh
markbridge sync check
```

如果检查通过，上传当前设备的 `Books`：

```sh
markbridge sync push
```

在另一台设备上，同样先配置一次默认 Profile 和目录，然后预览远端导入影响：

```sh
markbridge sync pull --dry-run
```

确认预览无误后正式写入浏览器：

```sh
markbridge sync pull --apply --quit-browser --reopen
```

正式写入后，打开：

```text
chrome://bookmarks
```

检查 `Bookmarks Bar / Books`。

## 日常使用

日常从当前设备上传：

```sh
markbridge sync push
```

查看当前绑定的浏览器、Profile、目录和 COS key：

```sh
markbridge sync status
```

同时检查 COS 远端对象是否存在：

```sh
markbridge sync status --remote
```

做完整安全验收，不写浏览器：

```sh
markbridge sync verify
```

从 COS 拉取前先预览：

```sh
markbridge sync pull --dry-run
```

正式导入：

```sh
markbridge sync pull --apply --quit-browser --reopen
```

## 人工验收

推荐按这个顺序验收：

```sh
markbridge sync check
markbridge sync status --remote
markbridge sync verify
markbridge sync push --dry-run
markbridge sync pull --dry-run
```

预期：

- `sync check` 输出 `Sync check: passed`。
- `sync status --remote` 显示 `Remote status: exists`。
- `sync verify` 输出 `Sync verify: passed`，并显示 `Browser changes: no`。
- `sync push --dry-run` 显示 `Preview only: no COS object will be written.`。
- `sync pull --dry-run` 显示预计新增和跳过重复数量，不会修改浏览器。

只有当 `sync pull --dry-run` 的结果符合预期，才执行：

```sh
markbridge sync pull --apply --quit-browser --reopen
```

## 常见报错

远端对象不存在：

```text
Remote object not found.
Next: markbridge sync push
```

含义是当前 COS key 下还没有 HTML，先在有源书签的设备上执行：

```sh
markbridge sync push
```

浏览器正在运行：

```text
Google Chrome appears to be running.
```

正式写浏览器时加：

```sh
--quit-browser --reopen
```

找不到 Profile：

```sh
markbridge browser profiles --browser chrome
```

用输出里的 Profile 目录名或唯一显示名重新执行 `sync setup`。

找不到书签目录：

```sh
markbridge sync setup --browser chrome --profile "Huu Quang" --folder "Books"
```

如果同名目录不唯一，改用完整路径：

```sh
markbridge sync setup --browser chrome --profile "Huu Quang" --folder-path "书签栏 / Books"
```

## 命令总览

### export-browser

从指定 Chrome / Edge Profile 直接导出 HTML。这个命令会在内存里完成 `pull-browser -> export`，不会写入 MarkBridge 本地库。

```sh
markbridge export-browser --browser chrome --profile "Huu Quang" --output ~/Desktop/bookmarks.html
markbridge export-browser --browser chrome --profile "Huu Quang" --folder "Books" --output ~/Desktop/books.html
markbridge export-browser --browser chrome --profile "Huu Quang" --folder-path "书签栏 / Books" --output ~/Desktop/books.html
```

参数：

- `--browser chrome|edge`：来源浏览器。
- `--profile <profile>`：来源 Profile，可以填 Profile 目录名或显示名，只要能唯一匹配。
- `--output <output.html>`：输出 HTML 路径。
- `--folder <name|path>`：只导出某个文件夹。可以填唯一文件夹名，也可以填完整路径。
- `--folder-path <path>`：只导出某个完整路径文件夹。
- `--include-empty-folders`：导出空文件夹。
- `--dry-run`：只预览来源 Profile、命中文件夹和输出路径，不写 HTML。
- `--browser-root <path>`：高级参数，用于测试或自定义 Profile 根目录。
- `--json`：输出 JSON。

### import-browser

从 HTML 直接导入指定 Chrome / Edge Profile。这个命令会在内存里完成 `import -> push-browser`，不会写入 MarkBridge 本地库。

```sh
markbridge import-browser --input ~/Desktop/books.html --browser chrome --profile "Default" --folder MarkBridge --mode merge --dry-run
markbridge import-browser --input ~/Desktop/books.html --browser chrome --profile "Default" --folder MarkBridge --mode merge --quit-browser --reopen
markbridge import-browser --input ~/Desktop/books.html --browser chrome --profile "Default" --folder MarkBridge --mode replace-folder --quit-browser --reopen
```

参数：

- `--input <bookmarks.html>`：输入 HTML 路径。
- `--browser chrome|edge`：目标浏览器。
- `--profile <profile>`：目标 Profile，可以填 Profile 目录名或显示名，只要能唯一匹配。
- `--folder <name>`：写入浏览器书签栏下的文件夹名，默认 `MarkBridge`。
- `--mode merge`：默认模式。合并到目标文件夹，同名子目录会递归合并，已存在 URL 会跳过，重复执行不会叠加。
- `--mode replace-folder`：替换模式。删除浏览器书签栏下同名目标文件夹，再写入当前 HTML；不会影响其他文件夹或同级书签。
- `--mode append`：高级模式。追加一个新的同名目标文件夹，重复执行会叠加。
- `--quit-browser`：如果目标浏览器正在运行，先自动退出再写入。
- `--reopen`：写入后重新打开浏览器书签页。
- `--dry-run`：只预览输入 HTML、目标 Profile、目标文件夹、预计新增数量和重复数量，不写浏览器。
- `--skip-running-check`：高级参数，跳过运行中检查。真实使用不建议。
- `--browser-root <path>`：高级参数，用于测试或自定义 Profile 根目录。
- `--json`：输出 JSON。

### sync

`sync` 是跨设备最推荐的主流程。它把浏览器和 COS 串起来，不需要你手动管理中间 HTML 文件。

第一次使用先保存默认配置：

```sh
markbridge sync setup --browser chrome --profile "Huu Quang" --folder "Books" --mode merge
```

以后日常上传：

```sh
markbridge sync push
```

在另一台设备上先预览导入影响：

```sh
markbridge sync pull --dry-run
```

确认预览没问题后正式导入浏览器：

```sh
markbridge sync pull --apply --quit-browser --reopen
```

这四条命令的含义：

- `sync setup`：保存默认浏览器、Profile、书签目录、导入模式和 COS 对象 key。它只做本地预览校验，不上传 COS。
- `sync push`：按保存的配置，从浏览器指定书签目录导出 HTML 并覆盖上传到 COS。
- `sync pull --dry-run`：按保存的配置，从 COS 下载 HTML 到内存并预览会新增、创建、跳过多少书签，不写浏览器。
- `sync pull --apply`：按保存的配置，把 COS 中的书签正式导入浏览器。正式写浏览器时建议加 `--quit-browser --reopen`。

`sync pull` 必须显式选择 `--dry-run` 或 `--apply`。这样可以避免误操作直接改浏览器书签。

保存后的默认配置文件：

```text
~/.markbridge/sync-config.json
```

这个文件只保存浏览器、Profile、目录、导入模式和 COS 对象 key，不保存 COS 密钥。COS 密钥仍然来自 `.env` 或真实环境变量。

查看当前默认配置：

```sh
markbridge sync status
markbridge sync status --remote
```

做完整安全检查：

```sh
markbridge sync check
markbridge sync verify
```

两者区别：

- `sync check`：检查本地默认配置、COS 配置、浏览器 Profile、书签目录、COS 远端对象是否存在。
- `sync verify`：在 `sync check` 基础上，再执行一次 `sync pull --dry-run` 等价预览，证明远端 HTML 能被导入目标 Profile。它不写浏览器。

如果想临时跳过默认配置，也可以继续使用底层高级命令：

```sh
markbridge sync push-browser --browser chrome --profile "Huu Quang" --folder "Books"
markbridge sync pull-browser --browser chrome --profile "Huu Quang" --folder "Books" --mode merge --dry-run
```

`--dry-run` 是预览模式：只告诉你会操作哪个浏览器、哪个 Profile、哪个 COS 对象、会新增或跳过多少书签，不上传 COS，也不修改浏览器。

如果正式写入浏览器时 Chrome / Edge 正在运行，MarkBridge 会拒绝直接改书签文件，并在输出里给出可复制的重试命令。通常直接加：

```sh
--quit-browser --reopen
```

正式导入成功后，输出里会包含 `Restore:`，那一行就是出问题时的恢复命令。

参数：

- `sync setup --browser chrome|edge`：来源和目标浏览器。
- `sync setup --profile <profile>`：来源和目标 Profile，可以填 Profile 目录名或显示名，只要能唯一匹配。
- `sync setup --folder <name|path>`：要同步的书签文件夹，也是默认导入到浏览器书签栏下的目标文件夹名。
- `sync setup --folder-path <path>`：用完整路径指定来源文件夹。
- `sync setup --mode merge`：默认导入模式，合并并跳过重复 URL。
- `sync setup --mode replace-folder`：正式 pull 时替换目标文件夹，不影响其他文件夹。
- `sync setup --remote <object-key>`：手动指定 COS 对象 key。省略时自动生成并保存。
- `sync status --remote`：在本地默认配置基础上，检查 COS 远端对象是否存在。
- `sync check`：检查默认配置、COS 配置、浏览器目录和远端对象。
- `sync verify`：执行安全端到端验证，不上传 COS，不写浏览器。
- `sync push --dry-run`：只预览来源、命中文件夹和对象 key，不上传 COS。
- `sync pull --dry-run`：只预览 COS 导入影响，不写浏览器。
- `sync pull --apply`：正式写浏览器。
- `--quit-browser` / `--reopen`：正式写浏览器时自动退出并重新打开。
- `--env-file <path>`：使用指定 env 文件，默认读取当前目录 `.env`。
- `--json`：输出 JSON。

默认 key 格式：

```text
bookmarks/<browser>/<profile>/<folder-path>.html
```

例如 `Huu Quang` Profile 下的 `Books` 文件夹会生成类似：

```text
bookmarks/chrome/Huu-Quang/Books.html
```

如果来源路径包含浏览器根目录名，输出可能是：

```text
bookmarks/chrome/Huu-Quang/Bookmarks-Bar-Books.html
```

同一个默认 key 会直接覆盖上传，不保留历史版本。

### cloud

将导出的 HTML 文件同步到腾讯云 COS，或者从 COS 下载 HTML 到本地。

COS 配置来自当前工作目录的 `.env`，字段按 `.env.example`：

```env
SYNC_PROVIDER=cos
COS_ENDPOINT=https://cos.<region>.myqcloud.com
COS_REGION=<region>
COS_BUCKET=<bucket>-<appid>
COS_SECRET_ID=<secret-id>
COS_SECRET_KEY=<secret-key>
```

`.env` 已在 `.gitignore` 中忽略，不要提交真实密钥。也可以用真实环境变量覆盖 `.env` 中的同名字段。

上传：

```sh
markbridge cloud push --file ~/Desktop/books.html --remote books.html
```

下载：

```sh
markbridge cloud pull --remote books.html --output ~/Desktop/books-from-cos.html
```

列表：

```sh
markbridge cloud list
markbridge cloud list --prefix markbridge/ --max-keys 20
```

删除：

```sh
markbridge cloud delete --remote books.html
```

参数：

- `cloud push --file <local-file>`：要上传的本地文件。
- `cloud push --remote <object-key>`：COS 对象 key，例如 `books.html` 或 `markbridge/books.html`。
- `cloud pull --remote <object-key>`：要下载的 COS 对象 key。
- `cloud pull --output <local-file>`：下载后的本地输出路径。
- `cloud list --prefix <prefix>`：只列出指定前缀。
- `cloud list --max-keys <n>`：限制最多返回的对象数量。
- `cloud delete --remote <object-key>`：删除指定 COS 对象。
- `--env-file <path>`：使用指定 env 文件，默认读取当前目录 `.env`。
- `--json`：输出 JSON。

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
markbridge push-browser --browser chrome --profile "Default" [--folder MarkBridge] [--mode merge|replace-folder|append] [--quit-browser] [--reopen]
```

参数：

- `--browser chrome|edge`：浏览器类型。
- `--profile <profile>`：目标 Profile。
- `--folder <name>`：写入浏览器书签栏下的文件夹名，默认 `MarkBridge`。
- `--mode replace-folder`：默认模式。替换浏览器书签栏下的目标文件夹。
- `--mode merge`：合并到目标文件夹，并按 URL 跳过重复书签。
- `--mode append`：追加新的同名目标文件夹。
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

### 1. 查看可用 Profile

```sh
markbridge browser profiles --browser chrome
```

预期：

- 能看到 Chrome Profile 目录名和显示名。
- 后续 `--profile` 可以使用目录名，例如 `Default`、`Profile 1`，也可以使用唯一的显示名。

### 2. 保存默认同步配置

```sh
markbridge sync setup --browser chrome --profile "Default" --folder "Books" --mode merge
markbridge sync status
markbridge sync check
```

预期：

- `sync setup` 显示来源 Profile、命中文件夹、默认对象 key 和导出书签数量，但不上传 COS。
- `sync status` 能看到保存的浏览器、Profile、文件夹、导入模式和远端 key。
- 第一次上传前，`sync check` 可能提示远端对象不存在，这是正常的；按提示执行 `markbridge sync push`。

### 3. 一键从 Chrome 指定文件夹上传到 COS

```sh
markbridge sync push --dry-run
markbridge sync push
markbridge sync status --remote
```

预期：

- `--dry-run` 不上传 COS。
- 正式执行后 COS 中出现默认对象 key。
- `sync status --remote` 显示 `Remote status: exists`。
- 上传的 HTML 只包含 `Books` 文件夹及其子树。

### 4. 安全验证远端导入链路

确认 `.env` 已配置 COS：

```sh
markbridge cloud list --max-keys 5
```

```sh
markbridge sync verify
```

预期：

- 输出 `Sync verify: passed`。
- 输出目标 Profile、目标文件夹、预计新增书签和重复书签。
- 输出 `Browser changes: no`。

### 5. 从 COS 拉取并预览导入 Chrome

```sh
markbridge sync pull --dry-run
```

预期：

- 命令会按默认对象 key 从 COS 下载 HTML 到内存。
- 输出目标 Profile、目标文件夹、预计新增书签和重复书签。
- `--dry-run` 不写浏览器。

### 6. 从 COS 正式导入 Chrome

```sh
markbridge sync pull --apply --quit-browser --reopen
```

预期：

- 正式执行会创建备份。
- Chrome 打开后，在 `chrome://bookmarks` 可以看到 `Bookmarks Bar / Books`。

### 7. 重复从 COS 导入不叠加

```sh
markbridge sync pull --dry-run
markbridge sync pull --apply --quit-browser --reopen
```

预期：

- 第二次 `--dry-run` 显示 `Bookmarks to add: 0`，`Duplicates to skip` 大于 0。
- 第二次正式导入不会在 `Books` 下生成重复书签。
- 如果没有任何新增内容，命令不会再创建无意义备份。

### 8. 从 COS 替换目标目录但不影响其他目录

```sh
markbridge sync setup --browser chrome --profile "Default" --folder "Books" --mode replace-folder
markbridge sync pull --dry-run
markbridge sync pull --apply --quit-browser --reopen
```

预期：

- `Bookmarks Bar / Books` 会被当前 HTML 重建。
- `Bookmarks Bar` 下其他文件夹和同级书签不受影响。
- 命令输出会显示 `Target folder action: replace existing folder`。

### 9. 备份和恢复

```sh
markbridge browser backups --browser chrome --profile "Default"
markbridge browser restore --browser chrome --profile "Default" --backup <backup-path> --quit-browser --reopen
```

预期：

- `backups` 能列出 `.markbridge-backup-*` 文件。
- `restore` 输出 `Restored from` 和 `Safety backup`。
- 浏览器重新打开后书签恢复到备份状态。

### 10. 本地库导入去重

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-merge)"

markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge status
```

预期：

```text
Bookmarks: 5
```

### 11. HTML 导出和指定文件夹导出

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-export)"

markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge status
markbridge export "$MARKBRIDGE_HOME/all-export.html"
markbridge export "$MARKBRIDGE_HOME/personal-vault.html" --folder "Personal Vault"
```

预期：

```sh
grep -E "MarkBridge Public Docs|Engineering Search|Private Bank Portal|Private Health Notes|Temporary Article" "$MARKBRIDGE_HOME/all-export.html"
grep -E "Private Bank Portal|Private Health Notes" "$MARKBRIDGE_HOME/personal-vault.html"
grep -E "MarkBridge Public Docs|Engineering Search|Temporary Article" "$MARKBRIDGE_HOME/personal-vault.html"
```

预期：

- 第一条 `grep` 有输出。
- 第二条 `grep` 有输出。
- 第三条 `grep` 没有输出。

### 12. 从 Chrome 拉取到 MarkBridge

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

### 13. 推送 MarkBridge 本地库回 Chrome

```sh
markbridge push-browser --browser chrome --profile "Default" --folder MarkBridge --mode replace-folder --quit-browser --reopen
```

在 Chrome 查看：

```text
chrome://bookmarks -> Bookmarks Bar -> MarkBridge
```

预期：

- 能看到 MarkBridge 本地库里的书签目录。
- 命令输出里会显示写入的书签数量、目标文件夹、浏览器 `Bookmarks` 文件路径和备份路径。

## 自动验证

```sh
npm test
npm run acceptance
node --check src/*.js bin/markbridge.js test/*.js scripts/*.js
```

当前通过：

```text
npm test: 49 tests passed
npm run acceptance: passed
node --check src/*.js bin/markbridge.js test/*.js scripts/*.js: passed
```

覆盖范围包括：

- Chrome / Edge / Firefox 风格 HTML 导入。
- 重复 URL 检测。
- `merge` / `append` / `replace` / `dry-run`。
- 保留已有 title。
- 整库导出和指定文件夹导出。
- Chrome / Edge Profile pull / push。
- `export-browser` / `import-browser` 一键工作流。
- `import-browser --mode merge` 重复导入去重。
- `import-browser --mode replace-folder` 只替换目标目录。
- browser backups / restore。
- 浏览器运行中拒绝写入，及 `--quit-browser --reopen`。
- `.env` COS 配置解析。
- COS 请求签名、上传、下载、列表解析。
- COS HEAD 元信息查询和 404 结构化识别。
- `sync setup` 默认同步配置读写，不保存 COS 密钥。
- `sync check` 健康检查和失败下一步提示。
- `sync status --remote` 远端对象状态查询。
- `sync verify` 安全端到端验证，不写浏览器。
- `sync push` 按默认配置上传浏览器文件夹到 COS。
- `sync pull` 强制要求 `--dry-run` 或 `--apply`。
- `sync push-browser` / `sync pull-browser` 高级显式传参工作流。
- sync 预览输出、运行中浏览器提示和恢复命令输出。

## 当前限制

- 不做图形界面。
- 不做浏览器扩展。
- 不做本地加密。
- COS 当前支持手动上传、下载、列表、删除，以及默认配置后的 `sync push` / `sync pull` 工作流；不做自动双向同步或冲突解决。
- 不支持 Safari / Firefox Profile 直接投递。
- 不通过 Chrome / Edge 运行时 API 写书签；当前是文件级写入，所以建议使用 `--quit-browser --reopen`。
