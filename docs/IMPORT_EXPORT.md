# Import / Export

## 1. HTML 导入

```sh
markbridge import <bookmarks.html> [--mode merge|append|replace] [--dry-run]
```

输入格式是浏览器通用的 Netscape Bookmark HTML。

当前支持：

- Chrome 风格 HTML。
- Edge 风格 HTML。
- Firefox 风格 HTML。
- 中文标题。
- HTML entity 解码。
- 空文件夹。
- 重复 URL 统计。

## 2. 导入模式

### merge

默认模式。

按 `normalizedUrl` 去重，已有 URL 会跳过。不会覆盖已有书签标题和目录。

### append

追加模式。

重复导入会叠加，适合需要保留重复副本的场景。

### replace

替换模式。

用当前导入源替换整个 MarkBridge 本地库。

## 3. dry-run

```sh
markbridge import fixtures/demo-bookmarks.html --dry-run
```

只预览导入结果，不创建或修改本地库。

## 4. HTML 导出

```sh
markbridge export <output.html> [--folder name|path] [--folder-path path] [--include-empty-folders]
```

默认导出整个 MarkBridge 本地库。

指定文件夹导出：

```sh
markbridge export ~/Desktop/books.html --folder "Books"
markbridge export ~/Desktop/books.html --folder-path "书签栏 / Books"
```

规则：

- `--folder` 可以匹配唯一文件夹名，也可以匹配完整路径。
- 如果文件夹名不唯一，会报错并提示使用 `--folder-path`。
- `--folder-path` 只做完整路径匹配。
- 指定文件夹导出时，输出 HTML 包含命中的文件夹本身及其子树。
- 默认不导出空文件夹，除非使用 `--include-empty-folders`。

## 5. 导出内容

导出的 HTML 包含浏览器可识别的：

- `<H3>` 文件夹。
- `<A HREF>` 书签。
- `ADD_DATE`。
- `LAST_MODIFIED`。

不会输出 MarkBridge 内部字段，例如：

- `id`
- `normalizedUrl`
- `description`
- `tagIds`
- `source`
- `rawMeta`

## 6. 验收用例

```sh
export MARKBRIDGE_HOME="$(mktemp -d -t markbridge-export)"
markbridge import fixtures/demo-bookmarks.html --mode merge
markbridge export "$MARKBRIDGE_HOME/all.html"
markbridge export "$MARKBRIDGE_HOME/personal-vault.html" --folder "Personal Vault"
```

预期：

- `all.html` 包含 5 条 demo 书签。
- `personal-vault.html` 只包含 `Personal Vault` 文件夹及其 2 条子书签。
- `personal-vault.html` 不包含 `Work Tools` 和 `Read Later` 的书签。
