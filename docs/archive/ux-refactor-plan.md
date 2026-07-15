# UI/UX 重构修改方案

## 概述

本文档定义了基于 ui-ux-pro-max 技能审查的全面修复方案，旨在提升 Agent Task Hub 的可访问性、响应式设计、视觉一致性和用户体验。

---

## 修改优先级矩阵

| 优先级 | 问题 | 影响范围 | 预估工作量 | 风险等级 |
|---------|------|-----------|-----------|----------|
| P0 | 触控目标尺寸不足 | 全局 | 1.5h | 低 |
| P0 | 响应式水平滚动 | 移动端 | 2h | 中 |
| P0 | 状态色对比度 | 全局 | 1h | 低 |
| P1 | 主字体改为 Sans | 全局 | 4h | 低 |
| P1 | 表单标签关联 | SettingsDrawer | 1h | 低 |
| P1 | 骨架屏加载状态 | ClientHome | 2h | 低 |
| P2 | 面包屑导航 | Settings | 1.5h | 低 |
| P2 | 右侧面板信息过载 | ProjectRightPanel | 4h | 中 |
| P3 | 动画时长标准化 | globals.css | 0.5h | 低 |
| P3 | 空状态 emoji 替换 | GlobalChatRoom | 1h | 低 |

**总预估工作量：约 18.5 小时**

---

## 详细修改方案

---

### P0-1: 触控目标尺寸不足

**问题描述**
当前图标按钮（如删除、编辑）使用较小的图标（14px），不满足最小 44×44px 的触控目标要求。

**影响组件**
- `SettingsDrawer.tsx` - 删除、编辑按钮
- `TaskDetailPanel.tsx` - 关闭按钮
- `AccountCard` - 操作按钮

**修改方案**

```tsx
// 修改前
<button className="p-1.5 rounded ...">
  <Trash2 className="w-3.5 h-3.5" />
</button>

// 修改后
<button className="min-h-[44px] min-w-[44px] flex items-center justify-center p-3 rounded ...">
  <Trash2 className="w-4 h-4" />
</button>
```

**新增可复用工具类**
```css
/* globals.css 新增 */
.touch-target-sm {
  min-height: 44px;
  min-width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**使用方式**
```tsx
<button className="touch-target-sm rounded hover:bg-[hsl(var(--bg-muted))]">
  <Icon className="w-4 h-4" />
</button>
```

---

### P0-2: 响应式水平滚动修复

**问题描述**
右侧面板使用固定 440px 宽度，在小屏幕上会导致水平滚动。

**影响组件**
- `ProjectRightPanel.tsx` - 主详情面板
- `TaskDetailPanel.tsx` - 任务详情抽屉

**修改方案**

```tsx
// ProjectRightPanel.tsx
// 修改前
className="w-[440px] shrink-0 h-full ..."

// 修改后 - 响应式宽度
className={cn(
  'shrink-0 h-full border-l border-[hsl(var(--border))]',
  'bg-[hsl(var(--bg-muted))] flex flex-col',
  'w-full md:w-[400px] lg:w-[440px]'
)}
```

**修改 TaskDetailPanel.tsx**
```tsx
// 修改前
className="fixed top-0 right-0 h-full w-full max-w-[450px] ..."

// 修改后
className={cn(
  'fixed top-0 right-0 h-full border-l border-[hsl(var(--border))]',
  'bg-[hsl(var(--bg-elevated))] shadow-[var(--shadow-lg)] z-50 flex flex-col',
  'w-full max-w-[90vw] md:max-w-[450px]'
)}
```

**新增断点标准**
```css
/* globals.css 新增断点变量 */
:root {
  --breakpoint-sm:  640px;  /* 手机横屏 */
  --breakpoint-md:  768px;  /* 平板竖屏 */
  --breakpoint-lg:  1024px; /* 平板横屏/小桌面 */
  --breakpoint-xl: 1280px; /* 桌面 */
}
```

---

### P0-3: 状态色对比度提升

**问题描述**
黄色状态色在亮色背景上对比度可能低于 WCAG AA 标准（4.5:1）。

**修改方案**

```css
/* globals.css 修改状态色定义 */

/* --- Status Colors (Elemental) --- */
/* Pending: Geo Yellow - 提高对比度 */
--status-pending:       38 70% 45%;     /* #E4B43F 改为更深的橙黄 */
--status-pending-bg:    38 60% 96%;
--status-pending-border:38 65% 80%;

/* Progress: Electro Purple */
--status-progress:     278 60% 50%;     /* 保持 */
--status-progress-bg:  278 45% 95%;
--status-progress-border:278 50% 80%;

/* Review: Hydro/Anemo Blue */
--status-review:       200 70% 50%;     /* 提高饱和度 */
--status-review-bg:    200 55% 95%;
--status-review-border: 200 50% 80%;

/* Done: Dendro Green - 提高对比度 */
--status-done:         145 65% 40%;     /* #3D9142 更深的绿 */
--status-done-bg:      145 50% 94%;
--status-done-border:  145 55% 75%;

/* Rejected: Pyro Red - 提高对比度 */
--status-rejected:     0 80% 55%;      /* #E64A4D 更深 */
--status-rejected-bg:  0 65% 96%;
--status-rejected-border:0 60% 75%;

/* Blocked: Pyro Dark Red */
--status-blocked:      0 85% 50%;      /* 保持 */
--status-blocked-bg:   0 70% 95%;
--status-blocked-border:0 65% 75%;
```

**文本颜色对比度调整**
```css
/* --- Text --- */
--text-primary:   240 8% 13%;     /* 保持 */
--text-secondary: 240 6% 38%;     /* 从 42% 提高对比度 */
--text-tertiary:  240 6% 58%;     /* 从 60% 提高对比度 */
--text-inverse:   0 0% 100%;       /* 保持 */
```

---

### P1-1: 主字体改为 Sans-Serif

**问题描述**
当前全局使用 Monospace 字体，不适合长文本阅读。

**修改方案**

**步骤 1：更新 globals.css 字体定义**
```css
:root {
  /* --- Typography --- */
  --font-sans: var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI',
                system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), 'Courier New', Courier, monospace;

  /* 默认使用 Sans 字体 */
  --font-body: var(--font-sans);
}

body {
  background: hsl(var(--bg-app));
  color: hsl(var(--text-primary));
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 代码块专用 */
code, pre, .font-mono, [class*="language-"],
.monaco-editor, .cm-editor {
  font-family: var(--font-mono);
}

/* 数字表格等需要等宽数字的情况 */
.tabular-nums {
  font-feature-settings: 'tnum';
  font-variant-numeric: tabular-nums;
}
```

**步骤 2：更新 Tailwind 主题**
```tsx
// tailwind.config.ts
export default {
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
    },
  },
};
```

**步骤 3：保留 Monospace 的场景**
- 代码编辑器（TerminalView.tsx）
- 代码块（MarkdownContent.tsx）
- 任务 ID、时间戳等数据展示
- Tabular 数据列

---

### P1-2: 表单标签关联

**问题描述**
部分表单输入框的 label 和 input 缺少显式的 htmlFor/id 关联。

**修改方案**

```tsx
// SettingsDrawer.tsx - AccountDialog

// 修改前
<label className="text-[11px] font-semibold ...">账号名称</label>
<input value={name} onChange={(e) => setName(e.target.value)} ... />

// 修改后
<label htmlFor="account-name" className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
  账号名称
</label>
<input
  id="account-name"
  value={name}
  onChange={(e) => setName(e.target.value)}
  aria-required="true"
  aria-invalid={!name.trim()}
  placeholder="如 my-claude-account"
  className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]"
/>
```

**新增表单辅助工具组件**
```tsx
// components/ui/FormField.tsx (新建)
export function FormField({
  id,
  label,
  error,
  required,
  helper,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))] flex items-center gap-1"
      >
        {label}
        {required && <span className="text-red-400" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && (
        <div className="text-[10px] text-[hsl(var(--status-rejected))] mt-0.5" role="alert">
          {error}
        </div>
      )}
      {helper && !error && (
        <div className="text-[10px] text-[hsl(var(--text-tertiary))] mt-0.5">
          {helper}
        </div>
      )}
    </div>
  );
}
```

**使用方式**
```tsx
<FormField
  id="account-name"
  label="账号名称"
  error={errors.name}
  required
  helper="用于标识该账号的友好名称"
>
  <input
    id="account-name"
    value={name}
    onChange={(e) => setName(e.target.value)}
    className="w-full h-9 px-3 ..."
  />
</FormField>
```

---

### P1-3: 骨架屏加载状态

**问题描述**
当前加载状态只有文字提示，缺乏视觉层次。

**修改方案**

```tsx
// ClientHome.tsx - 加载状态重构

// 新增骨架屏组件
function LoadingSkeleton() {
  return (
    <main className="h-screen overflow-hidden bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] flex flex-col">
      {/* Header Skeleton */}
      <header className="h-[64px] px-6 flex items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]">
        <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[hsl(var(--bg-muted))] animate-pulse" />
        <div className="h-6 w-32 bg-[hsl(var(--bg-muted))] rounded animate-pulse" />
      </header>

      {/* Main Content Skeleton */}
      <div className="flex-1 flex gap-px">
        {/* Sidebar Skeleton */}
        <aside className="w-[248px] border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 space-y-3">
          <div className="h-10 w-full bg-[hsl(var(--bg-muted))] rounded animate-pulse" />
          {[1,2,3].map(i => (
            <div key={i} className="h-12 w-full bg-[hsl(var(--bg-app))] rounded animate-pulse" />
          ))}
        </aside>

        {/* Chat Skeleton */}
        <section className="flex-1 bg-[hsl(var(--bg-app))] p-6 space-y-4">
          <div className="h-8 w-48 bg-[hsl(var(--bg-muted))] rounded animate-pulse" />
          {[1,2,3].map(i => (
            <div key={i} className="space-y-2">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-[hsl(var(--bg-muted))] shrink-0 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-[hsl(var(--bg-muted))] rounded animate-pulse" />
                  <div className="h-3 w-64 bg-[hsl(var(--bg-muted))] rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* Right Panel Skeleton */}
        <aside className="w-[440px] border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] p-4 space-y-4 hidden md:block">
          <div className="h-24 w-full bg-[hsl(var(--bg-card))] rounded-xl animate-pulse" />
          {[1,2,3].map(i => (
            <div key={i} className="h-16 w-full bg-[hsl(var(--bg-card))] rounded-lg animate-pulse" />
          ))}
        </aside>
      </div>
    </main>
  );
}

// 修改 ClientHome 组件
if (!hasHydrated) {
  return <LoadingSkeleton />;
}
```

**新增骨架屏动画**
```css
/* globals.css */
@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 0.3; }
}

.animate-pulse-skeleton {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
```

---

### P2-1: 面包屑导航

**问题描述**
设置页面缺乏导航层级提示，用户无法快速返回或理解当前位置。

**修改方案**

**步骤 1：新增面包屑组件**
```tsx
// components/ui/Breadcrumb.tsx (新建)
interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="面包屑导航" className="flex items-center gap-2 text-[11px] text-[hsl(var(--text-tertiary))] mb-4">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-[hsl(var(--text-primary))] transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-[hsl(var(--text-secondary))]">
              {item.label}
            </span>
          )}
          {index < items.length - 1 && (
            <span aria-hidden="true" className="text-[hsl(var(--border))]">
              /
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
```

**步骤 2：在 SettingsDrawer 中使用**
```tsx
// SettingsDrawer.tsx
import { Breadcrumb } from '@/components/ui/Breadcrumb';

// 在设置抽屉内容区域顶部添加
<div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin">
  <Breadcrumb
    items={[
      { label: '主页', href: '/' },
      { label: '设置' },
      { label: activeTab === 'accounts' ? '模型账号' :
                activeTab === 'roles' ? '角色素材' :
                activeTab === 'skills' ? '技能' : '团队套件' },
    ]}
  />
  {/* 原有内容 */}
</div>
```

**步骤 3：在 IntegrationSettingsPage 中使用**
```tsx
// IntegrationSettingsPage.tsx
<Breadcrumb
  items={[
    { label: '返回工作台', href: '/' },
    { label: '集成配置中心' },
  ]}
/>
```

---

### P2-2: 右侧面板信息过载优化

**问题描述**
右侧面板同时展示 Team Info、MiniKanban、待办、风险，信息密度过高。

**修改方案 - Tab 分组设计**

```tsx
// ProjectRightPanel.tsx 重构

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';

type TabValue = 'board' | 'tasks' | 'risks';

export function ProjectRightPanel({ teamPackId }: { teamPackId: string }) {
  const [activeTab, setActiveTab] = useState<TabValue>('board');
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const selectedConversation = useTaskHubStore((s) => s.conversations.find((c) => c.id === s.selectedConversationId));
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.getOpenBlockersForSelectedConversation());

  const scopedTasks = useMemo(
    () => tasks.filter((task) => task.conversationId === selectedConversationId),
    [tasks, selectedConversationId],
  );

  const nextItems = useMemo(() => buildNextItems(scopedTasks), [scopedTasks]);

  const openBlockers = useMemo(
    () => blockers.filter((blocker) => blocker.conversationId === selectedConversationId),
    [blockers, selectedConversationId],
  );

  const tabs = [
    { value: 'board' as TabValue, label: '看板', count: scopedTasks.length },
    { value: 'tasks' as TabValue, label: '待办', count: nextItems.length },
    { value: 'risks' as TabValue, label: '风险', count: openBlockers.length },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'shrink-0 h-full flex items-center justify-center',
          'w-6 border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-app))]',
          'hover:bg-[hsl(var(--bg-muted))] transition-colors',
          'text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]',
        )}
        title={open ? '收起面板' : '展开面板'}
      >
        {open ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
      </button>

      {open && (
        <aside className="w-full md:w-[360px] lg:w-[440px] shrink-0 h-full border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] flex flex-col animate-slide-in-r">
          {/* Tab Header - Team Info (始终显示) */}
          <div className="shrink-0 px-4 py-3 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-[hsl(var(--text-tertiary))]">
                  Project Board
                </div>
                <div className="text-sm font-semibold text-[hsl(var(--text-primary))] truncate mt-0.5">
                  {selectedConversation?.title ?? '项目侧栏'}
                </div>
              </div>
              <SyncStatusBar />
            </div>
          </div>

          {/* Tab Content - 使用 Tabs 组件 */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="flex-1 flex flex-col">
            <TabsList className="shrink-0 px-4 py-2 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="ml-1.5 rounded-full bg-[hsl(var(--accent-soft))] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--accent))]">
                      {tab.count}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Board Tab */}
            <TabsContent value="board" className="flex-1 overflow-y-auto scrollbar-thin p-3">
              {/* Team Info */}
              {teamPack && (
                <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] shadow-sm p-3 mb-3">
                  {/* ... 原有 Team Info 内容 */}
                </section>
              )}

              {/* MiniKanban */}
              <MiniKanban expanded={true} />
            </TabsContent>

            {/* Tasks Tab */}
            <TabsContent value="tasks" className="flex-1 overflow-y-auto scrollbar-thin p-3">
              <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] shadow-sm overflow-hidden">
                <div className="px-3 py-2 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
                  <div className="text-[11px] font-bold tracking-[0.16em] uppercase text-[hsl(var(--text-tertiary))]">下一步</div>
                  <span className="text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">{nextItems.length}</span>
                </div>
                <div className="p-2 flex flex-col gap-1.5">
                  {nextItems.length === 0 ? (
                    <div className="text-xs text-[hsl(var(--text-tertiary))] p-4 text-center">
                      暂无待办事项
                    </div>
                  ) : (
                    nextItems.map((item, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => item.taskId && setSelectedTaskId(item.taskId)}
                        className="text-left rounded-md border px-3 py-2 transition-colors bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))] border-[hsl(var(--border-subtle))] w-full text-left"
                      >
                        <div className="text-xs text-[hsl(var(--text-secondary))] line-clamp-2">{item.label}</div>
                      </button>
                    ))
                  )}
                </div>
              </section>
            </TabsContent>

            {/* Risks Tab */}
            <TabsContent value="risks" className="flex-1 overflow-y-auto scrollbar-thin p-3">
              {openBlockers.length === 0 ? (
                <div className="text-center py-8">
                  <ShieldCheck className="w-12 h-12 mx-auto text-[hsl(var(--status-done))] mb-3" />
                  <div className="text-sm font-semibold text-[hsl(var(--text-primary))]">暂无风险</div>
                  <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">所有任务进展顺利</div>
                </div>
              ) : (
                <section className="rounded-xl border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] shadow-sm overflow-hidden">
                  <div className="px-3 py-2 border-b border-[hsl(var(--status-rejected-border))] flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--danger))]" />
                    <div className="text-[11px] font-bold tracking-[0.16em] uppercase text-[hsl(var(--danger))]">
                      风险 / 阻塞
                    </div>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {openBlockers.map((blocker) => (
                      <button
                        key={blocker.id}
                        type="button"
                        onClick={() => setSelectedTaskId(blocker.taskId)}
                        className="w-full text-left rounded-md border px-3 py-2 transition-colors bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))] border-[hsl(var(--status-rejected-border))]"
                      >
                        <div className="text-xs text-[hsl(var(--text-primary))]">
                          {blocker.taskId} · {blocker.reasonSummary}
                        </div>
                        {blocker.evidenceRef && (
                          <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">{blocker.evidenceRef}</div>
                        )}
                      </button>
                    ))}
                    {openBlockers.length > 6 && (
                      <div className="text-center text-[10px] text-[hsl(var(--text-tertiary))] py-1">
                        还有 {openBlockers.length - 6} 条未显示
                      </div>
                    )}
                  </div>
                </section>
              )}
            </TabsContent>
          </Tabs>
        </aside>
      )}
    </>
  );
}
```

**新增 Tabs 组件**
```tsx
// components/ui/Tabs.tsx (新建)
import { createContext, useContext, useState } from 'react';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({ value, onValueChange, children, className }: TabsContextValue & { children: React.ReactNode; className?: string }) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1', className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, disabled = false }: { value: string; children: React.ReactNode; disabled?: boolean }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabsTrigger must be used within Tabs');

  const { value: currentValue, onValueChange } = context;
  const isActive = currentValue === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      disabled={disabled}
      onClick={() => !disabled && onValueChange(value)}
      className={cn(
        'px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]',
        isActive
          ? 'bg-[hsl(var(--accent))] text-white'
          : 'bg-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabsContent must be used within Tabs');

  const { value: currentValue } = context;
  const isActive = currentValue === value;

  if (!isActive) return null;

  return (
    <div role="tabpanel" className={cn('animate-fade-in', className)}>
      {children}
    </div>
  );
}
```

---

### P3-1: 动画时长标准化

**修改方案**

```css
/* globals.css - 在 CSS 变量区域新增动画时间 */

:root {
  /* --- Transitions --- */
  --duration-instant: 100ms;
  --duration-fast:    150ms;
  --duration-normal:  250ms;
  --duration-slow:    400ms;

  /* --- Easing --- */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in:  cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}

/* 使用标准动画时间的类 */
.transition-fast {
  transition-property: all;
  transition-duration: var(--duration-fast);
  transition-timing-function: var(--ease-out);
}

.transition-normal {
  transition-property: all;
  transition-duration: var(--duration-normal);
  transition-timing-function: var(--ease-out);
}

/* 状态过渡动画 */
.hover-lift:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
  transition: transform var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.press-scale:active {
  transform: scale(0.98);
  transition: transform var(--duration-instant) var(--ease-in-out);
}
```

---

### P3-2: 空状态 Emoji 替换

**修改方案**

```tsx
// GlobalChatRoom.tsx - 空状态重构

// 新增空状态组件
function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actions?: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 py-12 px-4">
      <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-[hsl(var(--bg-muted))]">
        <Icon className="w-10 h-10 text-[hsl(var(--text-secondary))]" />
      </div>
      <div className="text-center max-w-[320px]">
        <h3 className="text-[14px] font-bold text-[hsl(var(--text-primary))] mb-2">
          {title}
        </h3>
        <p className="text-[11px] text-[hsl(var(--text-tertiary))] leading-relaxed">
          {description}
        </p>
      </div>
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center mt-2">
          {actions.map((action) => (
            <button
              key={action.value}
              type="button"
              onClick={() => setInputValue(action.value)}
              className="text-[11px] px-4 py-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))] hover:text-[hsl(var(--text-primary))] transition-all duration-[var(--duration-fast)]"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 使用示例
{!selectedConversationId && chatMessages.length === 0 && (
  <EmptyState
    icon={Shield}
    title="作战指挥室"
    description="描述你想构建的东西，或 @Agent 下达具体指令。首次发送将自动创建项目。"
    actions={[
      { label: '@Mario 帮我规划一下…', value: '@Mario 帮我规划一下…' },
      { label: '@Luigi 写一个…', value: '@Luigi 写一个…' },
      { label: '@Peach 审查…', value: '@Peach 审查…' },
    ]}
  />
)}

{selectedConversationId && chatMessages.length === 0 && (
  <EmptyState
    icon={KeyRound}
    title="准备好开始"
    description={`@jean 可以帮你分析项目、出技术方案，或直接 @Agent 下达指令`}
    actions={[
      { label: '@Mario 帮我规划一下…', value: '@Mario 帮我规划一下…' },
      { label: '@Luigi 直接开始…', value: '@Luigi 直接开始…' },
    ]}
  />
)}
```

---

## 术语优化清单

| 当前术语 | 优化后的用户可见术语 | 说明 |
|----------|-------------------|------|
| Runtime | 执行环境 | 更直白，用户理解 |
| Channel | 渠道 | 保持简洁 |
| Routing | 路由策略 | 明确"策略"含义 |
| Provider | 模型提供商 | 明确角色 |
| Provider Profile | 供应商配置 | 简化表达 |
| Team Pack | 团队配置 | 去除"套件"术语 |
| Role Card | 智能体模板 | 更易理解 |
| Role Material | 角色素材 | 改为更自然的表达 |

---

## 实施顺序建议

### 阶段一：基础架构（不涉及 UI 变化）
1. 新增工具组件：`FormField`, `Tabs`, `Breadcrumb`, `EmptyState`
2. 更新 `globals.css` - 颜色、字体、动画变量
3. 更新 `tailwind.config.ts` - 字体配置

**预计时间：4h**

### 阶段二：P0 修复（影响用户体验）
1. 触控目标尺寸修复
2. 响应式宽度修复
3. 状态色对比度修复

**预计时间：4.5h**

### 阶段三：P1 修复（提升体验）
1. 字体系统迁移
2. 表单标签关联
3. 骨架屏加载状态

**预计时间：7h**

### 阶段四：P2 修复（信息架构优化）
1. 面包屑导航
2. 右侧面板 Tab 分组

**预计时间：5.5h**

### 阶段五：P3 修复（细节打磨）
1. 动画时长标准化应用
2. 空状态组件替换

**预计时间：1.5h**

### 阶段六：验证与测试
1. 对比度验证
2. 响应式测试（375, 768, 1024, 1440px）
3. 可访问性测试（键盘导航、Screen reader）
4. 深色模式测试

**预计时间：2h**

---

## 验证清单

完成后需验证以下项目：

### 视觉质量
- [ ] 无 emojis 作为图标（使用 SVG）
- [ ] 所有图标来自统一家族和风格
- [ ] 按下状态视觉不改变布局边界
- [ ] 语义主题标记一致使用

### 交互
- [ ] 所有可点击元素提供清晰的按下反馈
- [ ] 触控目标满足最小尺寸（≥44×44px）
- [ ] 微交互时间在 150-300ms 范围
- [ ] 禁用状态视觉清晰且不可交互
- [ ] 屏幕阅读器焦点顺序匹配视觉顺序
- [ ] 手势区域避免嵌套/冲突交互

### 亮色/暗色模式
- [ ] 主要文本对比度 ≥4.5:1（亮色模式）
- [ ] 主要文本对比度 ≥4.5:1（暗色模式）
- [ ] 次要文本对比度 ≥3:1（两种模式）
- [ ] 分隔符/边框在两种模式下可区分
- [ ] 两种模式均已测试

### 布局
- [ ] 375px 手机测试通过
- [ ] 768px 平板测试通过
- [ ] 1024px 桌面测试通过
- [ ] 1440px 大屏测试通过
- [ ] 无水平滚动问题
- [ ] 固定元素不遮挡内容

### 可访问性
- [ ] 所有有意义的图像/图标有可访问标签
- [ ] 表单字段有标签、提示、清晰错误信息
- [ ] 颜色不是唯一指示器
- [ ] 支持 reduced-motion
- [ ] 支持动态文字大小
- [ ] 键盘导航完整

---

## 回滚计划

每个修复点建议独立提交，便于回滚：

| 提交 | 内容 | 回滚命令 |
|-----|------|----------|
| feat/ux/touch-targets | 触控目标尺寸修复 | `git revert HEAD` |
| feat/ux/responsive | 响应式宽度修复 | `git revert HEAD` |
| feat/ux/contrast | 状态色对比度 | `git revert HEAD` |
| feat/ux/sans-font | 字体系统迁移 | `git revert HEAD` |
| feat/ux/form-labels | 表单标签关联 | `git revert HEAD` |
| feat/ux/skeleton | 骨架屏加载状态 | `git revert HEAD` |
| feat/ux/breadcrumbs | 面包屑导航 | `git revert HEAD` |
| feat/ux/tab-panel | 右侧面板 Tab | `git revert HEAD` |
| feat/ux/animations | 动画标准化 | `git revert HEAD` |
| feat/ux/no-emoji | 空状态组件 | `git revert HEAD` |
