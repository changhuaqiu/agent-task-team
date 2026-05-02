# 三列布局 Bug 修复与视觉优化

> 日期: 2026-05-02
> 状态: 待实现
> 范围: ClientHome, GlobalChatRoom, ProjectRightPanel, ProjectChatPanel
> 类型: Bug 修复 + 视觉优化

---

## 问题诊断

### 根因

`ClientHome.tsx` 第 54 行使用 `min-h-screen` 而非 `h-screen`。页面高度随内容增长，导致所有子元素的 `h-full`、`flex-1 min-h-0`、`overflow-y-auto` 失效。

### 症状

| # | 症状 | 原因 |
|---|------|------|
| 1 | 聊天面板无滚动条 | 消息区从不触发 overflow |
| 2 | 消息增多后输入框被推到视口下方 | flex-1 跟着内容撑高 |
| 3 | 无消息时输入框在最上面 | flex-1 高度为 0 |
| 4 | 三列排版乱 | 列高不受视口约束 |

### 视觉问题

- 右侧面板 `overflow-y-auto` 在根元素，整体一块滚动
- 聊天 Header 区域 padding 过大
- AgentBar 占用纵向空间过多

---

## 修复方案

### 改动 1：核心修复 — 视口固定

**文件:** `src/app/ClientHome.tsx` 第 54 行

```diff
- <main className="min-h-screen bg-[...] text-[...] flex flex-col">
+ <main className="h-screen overflow-hidden bg-[...] text-[...] flex flex-col">
```

效果：页面固定为视口高度，所有子元素的 flex 布局和 overflow 正常工作。

同步修复加载态（同文件第 29 行左右的 hydration fallback）的 `min-h-screen` → `h-screen overflow-hidden`。

### 改动 2：空状态垂直居中

**文件:** `src/components/task-hub/GlobalChatRoom.tsx`

消息列表区域（`ref={scrollRef}` 的 div）已有 `flex flex-col`。确保空状态内容使用 `flex-1 flex items-center justify-center` 使欢迎界面垂直居中。空聊天时输入框自然在底部。

### 改动 3：右侧面板 header/body 分离

**文件:** `src/components/project/ProjectRightPanel.tsx`

当前：`<aside className="... overflow-y-auto">` 整体滚动

改为：
```
<aside className="... flex flex-col">
  <header className="shrink-0 ...">标题区</header>
  <div className="flex-1 overflow-y-auto scrollbar-thin">内容区</div>
</aside>
```

### 改动 4：聊天 Header 紧凑化

**文件:** `src/components/project/ProjectChatPanel.tsx`

Header 区域 `px-5 pt-4 pb-3` → `px-4 pt-2.5 pb-2`，减少纵向占用。

---

## 影响范围

| 文件 | 改动类型 | 改动量 |
|------|---------|--------|
| `src/app/ClientHome.tsx` | CSS class 替换 | 1 行 |
| `src/components/task-hub/GlobalChatRoom.tsx` | 空状态 className | ~2 行 |
| `src/components/project/ProjectRightPanel.tsx` | 结构调整 | ~10 行 |
| `src/components/project/ProjectChatPanel.tsx` | padding 调整 | 1 行 |

总计约 14 行改动，无新文件，无数据模型变更，无新增依赖。
