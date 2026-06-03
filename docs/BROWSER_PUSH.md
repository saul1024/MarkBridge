# Browser Pull / Push

## 1. 支持范围

当前支持：

- Google Chrome
- Microsoft Edge

当前只支持 macOS 下的本地 Profile `Bookmarks` 文件读写。

## 2. 列出 Profile

```sh
markbridge browser profiles --browser chrome
markbridge browser profiles --browser edge
```

输出列：

```text
browser  profile-directory  display-name  bookmarks=yes|no  bookmarks-path
```

`--profile` 可以填 Profile 目录名，也可以填显示名，只要能唯一匹配。

## 3. 一键导出浏览器书签

```sh
markbridge export-browser --browser chrome --profile "Default" --output ~/Desktop/bookmarks.html
markbridge export-browser --browser chrome --profile "Default" --folder "Books" --output ~/Desktop/books.html
```

方向：

```text
Chrome / Edge Profile -> HTML
```

这个命令不会写 MarkBridge 本地库。

## 4. 一键导入浏览器书签

```sh
markbridge import-browser --input ~/Desktop/books.html --browser chrome --profile "Default" --folder MarkBridge --quit-browser --reopen
```

方向：

```text
HTML -> Chrome / Edge Profile
```

这个命令不会写 MarkBridge 本地库，但会写目标浏览器 Profile，因此会先创建备份。

## 5. 从浏览器拉取到 MarkBridge

```sh
markbridge pull-browser --browser chrome --profile "Default" [--mode merge|append|replace] [--dry-run]
```

方向：

```text
Chrome / Edge Profile -> MarkBridge local library
```

拉取会读取目标 Profile 的 `Bookmarks` 文件，不会写浏览器。

## 6. 从 MarkBridge 写入浏览器

```sh
markbridge push-browser --browser chrome --profile "Default" [--folder MarkBridge] [--quit-browser] [--reopen]
```

方向：

```text
MarkBridge local library -> Chrome / Edge Profile
```

默认写入：

```text
Bookmarks Bar / MarkBridge
```

可用 `--folder <name>` 修改目标文件夹名。

## 7. 为什么要求浏览器关闭

Chrome / Edge 运行时可能会把内存中的书签状态重新写回 `Bookmarks` 文件。

如果 MarkBridge 在浏览器运行时直接改文件，可能被浏览器覆盖。因此默认检测到浏览器运行中会拒绝写入。

推荐命令：

```sh
markbridge push-browser --browser chrome --profile "Default" --quit-browser --reopen
```

## 8. 备份

写入前会自动创建备份：

```text
Bookmarks.markbridge-backup-<timestamp>
```

列出备份：

```sh
markbridge browser backups --browser chrome --profile "Default"
```

恢复备份：

```sh
markbridge browser restore --browser chrome --profile "Default" --backup <backup-path> --quit-browser --reopen
```

恢复前会再创建 safety backup。

## 9. 验收用例

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-browser)"
markbridge import fixtures/demo-bookmarks.html --mode replace
markbridge push-browser --browser chrome --profile "Default" --quit-browser --reopen
```

预期：

- 命令输出显示写入书签数量。
- 命令输出显示 `Bookmarks` 文件路径。
- 命令输出显示备份路径。
- Chrome 打开后能在 `chrome://bookmarks` 看到 `Bookmarks Bar / MarkBridge`。
