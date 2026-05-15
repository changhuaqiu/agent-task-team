# 知识库

`docs/knowledge/` 用于沉淀可复用、可验证、可追溯的项目知识。它不是聊天记录归档，也不是临时计划目录。

## 入口

- `docs/knowledge/catalog.md`：知识索引，先读这里，再按需打开具体条目。
- `docs/knowledge/templates/knowledge-entry.md`：结构化知识条目模板。
- `docs/knowledge/public-lessons.md`：既有 lessons learned 条目，后续应逐步纳入 catalog。

## 使用规则

- 新增知识前，先查 `docs/knowledge/catalog.md`，优先更新已有条目。
- 知识条目必须遵守 `docs/standards/knowledge-governance.md`。
- 每轮迭代结束前，按 `docs/standards/iteration-knowledge.md` 判断是否需要沉淀。
- 当前实现事实优先写入 `docs/wiki/` 或 `docs/technical/`；`docs/knowledge/` 只沉淀可复用模型、经验、反模式、流程或跨场景原则。

## 推荐目录

```text
docs/knowledge/
  README.md
  catalog.md
  public-lessons.md
  templates/
    knowledge-entry.md
```

后续如果条目数量增长，再按主题拆分，例如：

- `docs/knowledge/collaboration/`
- `docs/knowledge/product/`
- `docs/knowledge/engineering/`
- `docs/knowledge/operations/`
