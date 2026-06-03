# Manual Acceptance

## 1. 准备

```sh
cd /path/to/MarkBridge
npm install -g --prefix "$HOME/.local" .
markbridge help
```

使用临时库避免影响默认数据：

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-acceptance)"
```

## 2. 导入 demo

```sh
markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge status
markbridge list
```

预期：

```text
Bookmarks: 5
Folders: 4
```

`list` 能看到 5 条 demo 书签。

## 3. 一键浏览器导出

```sh
markbridge browser profiles --browser chrome
markbridge export-browser --browser chrome --profile "Default" --folder "Books" --output ~/Desktop/books.html --dry-run
markbridge export-browser --browser chrome --profile "Default" --folder "Books" --output ~/Desktop/books.html
```

预期：

- `--dry-run` 不写 HTML。
- 正式执行写出 `~/Desktop/books.html`。
- 输出里显示来源 Profile、来源 `Bookmarks` 文件路径和命中文件夹。

## 4. 一键浏览器导入

```sh
markbridge import-browser --input ~/Desktop/books.html --browser chrome --profile "Default" --folder MarkBridge --dry-run
markbridge import-browser --input ~/Desktop/books.html --browser chrome --profile "Default" --folder MarkBridge --quit-browser --reopen
```

预期：

- `--dry-run` 不写浏览器。
- 正式执行创建备份。
- Chrome 打开后，在 `chrome://bookmarks` 可以看到 `Bookmarks Bar / MarkBridge`。

## 5. 重复导入不叠加

```sh
markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge status
```

预期仍然是：

```text
Bookmarks: 5
```

## 6. append 明确叠加

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

## 7. 整库导出

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-export)"
markbridge import fixtures/demo-bookmarks.html --mode replace
markbridge export "$MARKBRIDGE_HOME/all.html"
```

检查：

```sh
grep -E "MarkBridge Public Docs|Engineering Search|Private Bank Portal|Private Health Notes|Temporary Article" "$MARKBRIDGE_HOME/all.html"
```

预期有输出。

## 8. 指定文件夹导出

```sh
markbridge export "$MARKBRIDGE_HOME/personal-vault.html" --folder "Personal Vault"
```

检查：

```sh
grep -E "Private Bank Portal|Private Health Notes" "$MARKBRIDGE_HOME/personal-vault.html"
grep -E "MarkBridge Public Docs|Engineering Search|Temporary Article" "$MARKBRIDGE_HOME/personal-vault.html"
```

预期：

- 第一条 `grep` 有输出。
- 第二条 `grep` 没有输出。

## 9. Chrome Profile 拉取

```sh
markbridge browser profiles --browser chrome

export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-pull)"
markbridge pull-browser --browser chrome --profile "Default" --dry-run
markbridge pull-browser --browser chrome --profile "Default" --mode replace
markbridge status
markbridge list
```

预期：

- `profiles` 能看到可用 Profile。
- `--dry-run` 不写库。
- 正式拉取后 `status` 和 `list` 能看到浏览器书签。

## 10. Chrome Profile 投递

```sh
markbridge push-browser --browser chrome --profile "Default" --folder MarkBridge --quit-browser --reopen
```

预期：

- 命令输出写入数量。
- 命令输出 `Bookmarks` 文件路径。
- 命令输出备份路径。
- Chrome 打开后，在 `chrome://bookmarks` 可以看到 `Bookmarks Bar / MarkBridge`。

## 11. 备份恢复

```sh
markbridge browser backups --browser chrome --profile "Default"
markbridge browser restore --browser chrome --profile "Default" --backup <backup-path> --quit-browser --reopen
```

预期：

- `backups` 能列出 `.markbridge-backup-*`。
- `restore` 输出 `Restored from` 和 `Safety backup`。
