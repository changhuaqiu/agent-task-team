# Team-First Role Card Fusion Design

> 状态：Phase 1-3 implemented
> 日期：2026-05-06
> 决策：短期保留角色卡库，运行与项目创建链路改为团队优先；后续逐步下掉独立角色卡主入口。

---

## 1. 背景

当前系统同时有两个相近概念：

- **角色卡 RoleCard**：定义单个角色是谁、负责什么、怎么工作、能用哪些账号和技能。
- **团队套件 TeamPack**：定义一组角色如何协作，包括成员、流程、通信矩阵、团队规则和共享上下文。

产品叙事是“领养团队”，但现有实现仍让角色卡和团队套件并列，导致几个问题：

- 用户容易以为要先配置角色卡，再组装团队。
- TeamPack 角色在运行时需要回查全局 RoleCard 或合成临时角色。
- 账号、技能、角色切换等配置分散在全局角色卡、Agent 覆盖和 TeamPack 角色之间。
- 导入一个团队套件时，团队成员定义不够自包含，后续分享和迁移成本高。

本设计把 TeamPack 提升为项目运行的角色事实来源：**团队包含角色卡，角色卡是团队成员的身份定义。**

---

## 2. 产品原则

### 2.1 团队优先

主路径应是：

```text
创建项目 -> 选择团队套件 -> 团队成员自动可用 -> 给成员绑定账号/技能
```

用户不需要先理解“角色卡库”才能开始使用。

### 2.2 角色卡降级为素材库

短期保留角色卡库，避免破坏已有功能和数据。但它的产品定位从“主配置入口”降级为：

- 可复用角色素材
- 旧数据兼容入口
- 团队编辑器里的成员模板来源

后续版本可以隐藏或移除独立角色卡库入口。

### 2.3 TeamPack 自包含

一个团队套件应足以描述团队如何运行。导入、复制、分享团队时，不应依赖外部全局 RoleCard 才能恢复成员身份。

---

## 3. 推荐数据模型

### 3.1 TeamPackRole 扩展

```typescript
interface TeamPackRole {
  id: string;
  displayName: string;
  required: boolean;
  description?: string;

  // Legacy compatibility
  soul?: string;
  roleCardId?: string;

  // Team-owned role identity
  roleCardSnapshot?: RoleCardSnapshot;

  // Team member bindings
  accountIds?: string[];
  skillIds?: string[];
}
```

### 3.2 RoleCardSnapshot

`RoleCardSnapshot` 是团队内嵌角色定义。它应包含运行 prompt 和 UI 展示需要的稳定字段，但不必继承全局 RoleCard 的所有持久化元数据。

```typescript
type RoleCardSnapshot = Omit<RoleCard, 'id' | 'isPreset' | 'version' | 'createdAt' | 'updatedAt'> & {
  sourceRoleCardId?: string;
  snapshotVersion: number;
  snapshottedAt: string;
};
```

说明：

- `sourceRoleCardId` 只用于追踪来源，不是运行时必需依赖。
- `snapshotVersion` 用于未来迁移。
- `snapshottedAt` 让用户知道团队成员定义何时从素材库固化。

---

## 4. 运行时解析规则

项目内角色运行时只从当前项目的 TeamPack 开始解析。

```text
selected project
  -> teamPack
  -> teamPack.roles[agentId]
  -> roleCardSnapshot / global roleCardId / synthetic role
  -> accountIds / skillIds
```

解析优先级：

1. `TeamPackRole.roleCardSnapshot`
2. `TeamPackRole.roleCardId` 对应的全局 RoleCard
3. 由 `displayName`、`description`、`soul` 合成轻量角色定义

账号与技能优先级：

1. `TeamPackRole.accountIds` / `TeamPackRole.skillIds`
2. 当前兼容层中的 `agentAccountOverrides[agentId]` / `agentSkillIds[agentId]`
3. 全局 RoleCard 上的账号配置
4. 空配置

`AGENT_ROSTER` 只作为无 TeamPack 项目的 fallback，不再是项目角色主来源。

---

## 5. UI 信息架构

### 5.1 项目创建

项目创建只要求用户选择团队套件：

```text
项目名称
项目目标
团队套件
```

不在创建流程里要求用户先选择角色卡。

### 5.2 项目内团队成员配置

AgentBar 显示当前 TeamPack 的成员。点击成员头像打开“成员配置”：

- 当前成员身份
- 运行账号
- 技能
- 可选：从角色素材替换成员身份

文案使用“团队成员”“账号”“技能”，避免暴露 runtime、routing、providerHints 等内部概念。

### 5.3 设置页

短期保留现有入口：

- 团队套件：主入口
- 角色卡：兼容入口，可后续改名为“角色素材”
- 技能：保留
- 模型账号：保留

团队套件页已承担成员编辑能力。用户可以在设置抽屉中编辑套件名称、说明、团队模式、成员 ID、成员名称、职责说明、成员身份内容，以及工作流、通信矩阵、共享上下文和团队规则 JSON。保存会重建 TeamPackRole 并生成成员 snapshot，使编辑后的套件仍保持自包含。

---

## 6. 迁移策略

### 6.1 阶段一：兼容运行

目标：不破坏旧数据。

- 允许 TeamPackRole 只有 `roleCardId` 或 `soul`。
- 运行时按解析优先级生成成员身份。
- 新建或编辑团队成员时，可写入 `roleCardSnapshot`。
- 角色卡库继续显示和编辑旧 RoleCard。

### 6.2 阶段二：固化团队成员

目标：TeamPack 自包含。当前已提供固化与自包含导出能力。

- 已提供“固化团队成员”迁移，把 `roleCardId` 指向的 RoleCard 复制为 `roleCardSnapshot`，没有来源 RoleCard 的成员会生成合成 snapshot。
- 新建或导入团队套件时默认生成 `roleCardSnapshot`。
- 团队导出接口返回包含成员 snapshot 的自包含 TeamPack 数据。

### 6.3 阶段三：下掉独立角色卡主入口

目标：降低概念数量。当前采用降级命名与素材化能力，不删除旧数据入口。

- 设置页已将“角色卡”降级命名为“角色素材”。
- 成员配置面板保留“存为素材”，可从当前团队成员身份生成可编辑角色素材。
- 项目运行主路径通过 TeamPackRole 解析；全局 RoleCard 只作为素材来源和兼容 fallback。

---

## 7. 影响面

### 7.1 类型与存储

- 扩展 `TeamPackRole` 类型。
- TeamPack repository/API 需要保留 `roleCardSnapshot`、`accountIds`、`skillIds`。
- 后续迁移应支持从旧 TeamPack 生成 snapshot。

### 7.2 Store

- `getAgentRuntimeProfile(agentId)` 应优先读取当前 TeamPack role。
- `agentRoleCardOverrides` 可以作为短期 UI 覆盖，最终应落回 TeamPackRole。
- `agentSkillIds` 和 `agentAccountOverrides` 可以作为兼容缓存，最终应迁移为 TeamPackRole 字段。

### 7.3 Prompt Composer

- RoleLayer 接收的角色定义应来自 runtime profile。
- TeamPackLayer 继续负责团队协作规则。
- SkillLayer 接收的技能应来自 TeamPackRole 或 runtime profile。

### 7.4 UI

- ProjectCreateDialog 强化团队选择。
- AgentBindingPanel 从“角色卡绑定面板”逐步改成“团队成员配置面板”。
- SettingsDrawer 中角色入口已降级为“角色素材”，团队套件页提供完整编辑器、固化成员和导出。

---

## 8. 非目标

- 本设计不删除现有角色素材库和历史数据。
- 本设计不自动批量改写所有历史 TeamPack；历史数据通过“固化团队成员”逐步迁移。
- 本设计不实现团队市场。
- 本设计不改变模型账号创建流程。

---

## 9. 验收标准

- 创建项目时，用户只需要选择团队套件即可获得可运行团队成员。
- 一个 TeamPack 导出后，包含恢复成员身份所需的数据。
- 项目运行时不依赖 `AGENT_ROSTER` 作为 TeamPack 成员主来源。
- 角色卡库仍能打开和使用，但不是项目主流程的必需入口。
- 团队成员账号和技能配置可以逐步迁移到 TeamPackRole。
