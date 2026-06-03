# MarkBridge Data Model

## 1. 本地库文件

默认路径：

```text
~/.markbridge/library.json
```

可通过 `MARKBRIDGE_HOME` 或 `--library` 指定。

当前阶段本地库是明文 JSON，不做本地加密。

## 2. Library

```ts
type Library = {
  schemaVersion: 1;
  libraryId: string;
  rootId: string;
  items: Record<string, BookmarkItem | FolderItem>;
  tags: Record<string, unknown>;
  imports: ImportBatch[];
  devices: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

## 3. FolderItem

```ts
type FolderItem = {
  id: string;
  parentId: string | null;
  type: "folder";
  title: string;
  children: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  source?: SourceInfo;
  rawMeta?: Record<string, unknown>;
};
```

根节点 `rootId` 是 MarkBridge 内部根目录，不会作为浏览器书签文件夹导出。

## 4. BookmarkItem

```ts
type BookmarkItem = {
  id: string;
  parentId: string;
  type: "bookmark";
  title: string;
  url: string;
  normalizedUrl: string;
  description?: string;
  tagIds?: string[];
  favicon?: FaviconInfo;
  lastOpenedAt?: string;
  openCount?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  source?: SourceInfo;
  rawMeta?: Record<string, unknown>;
};
```

当前 MVP 不维护书签类型分级。历史库中如果残留额外字段，当前列表、搜索、导出和投递逻辑会忽略这些字段。

## 5. ImportBatch

```ts
type ImportBatch = {
  id: string;
  sourceType: "html" | "browser-profile";
  sourceBrowser?: string;
  sourceFileName?: string;
  importedAt: string;
  importedByDeviceId: string;
  itemIds: string[];
  stats: {
    folders: number;
    bookmarks: number;
    duplicates: number;
    skipped: number;
  };
  browserProfile?: string;
  browserProfileName?: string;
};
```

## 6. URL 归一化

`normalizedUrl` 用于重复检测。当前规则：

- host 小写。
- 去掉 hash。
- 保留 query。
- 去掉末尾无意义 `/`。

## 7. 删除语义

删除书签使用逻辑删除：

```ts
deletedAt?: string;
```

列表、搜索、导出和投递会忽略已删除项。

## 8. 浏览器写入

`push-browser` 会将 MarkBridge 本地库转换成 Chrome / Edge `Bookmarks` 文件里的一个目标文件夹，默认文件夹名为 `MarkBridge`。

写入前会创建备份：

```text
Bookmarks.markbridge-backup-<timestamp>
```

恢复备份前还会创建 safety backup。
