# 实施任务拆解 — 团队精简（6→4 人 + 移除其他团队）

> 分 5 阶段。每项完成同步 build + 测试。

## Phase 1：数据层（agentStore + presetTeamPacks）

- [ ] T1 `agentStore.ts`：AGENT_ROSTER 删除 toad、yoshi 定义（6→4）
- [ ] T2 `presetTeamPacks.ts`：default-team workflow 改 4 人（luigi 独立 implementing、quality_gate 合并 review+test）；更新 workflow stages + HARNESS_STAGE_GUIDANCE 引用
- [ ] T3 `presetTeamPacks.ts`：删除 engineering-trio、research-team 整个定义
- [ ] T4 `presetRoleCards.ts`：删除 preset-backend(toad)、preset-qa(yoshi) roleCard（如有）；更新 preset-frontend → luigi 全栈、preset-code-reviewer → peach 评审+测试
- [ ] T5 `seed-team-packs.ts`：只 seed default-team 4 人

## Phase 2：提示词层

- [ ] T6 `roleLayer.ts`：planner 分支改为"实现任务给 Luigi"（不再分前端/后端角色）
- [ ] T7 `roleLayer.ts`：code_reviewer 分支合并 qa 职责（评审通过后自己做集成测试）
- [ ] T8 `roleLayer.ts`：删除 qa 分支（合并进 code_reviewer）
- [ ] T9 `teamPackLayer.ts`：HARNESS_STAGE_GUIDANCE 改 4 人（删除 toad/yoshi、更新 luigi/peach guidance）
- [ ] T10 `teamPackLayer.ts`：workflow 描述改（"Luigi 独立 implementing"、"quality_gate"合并 review+test）
- [ ] T11 `collaborationLayer.ts`：检查并更新 6 人组硬编码引用

## Phase 3：前端层

- [ ] T12 `globals.css`：删除 `--agent-toad*`、`--agent-yoshi*` CSS 变量
- [ ] T13 `PixelAvatar.tsx`：删除 toad/yoshi 像素头像 + theme map
- [ ] T14 `ChatMessageItem.tsx`：AVATAR_THEME_CLASSES 删除 toad/yoshi
- [ ] T15 全局搜索组件中 toad/yoshi 引用，清理

## Phase 4：代码清理

- [ ] T16 全局搜索 `toad`：删除或替换为 `luigi`
- [ ] T17 全局搜索 `yoshi`：删除或替换为 `peach`
- [ ] T18 全局搜索 `engineering-trio`、`research-team`、`researcher`、`analyst`、`writer`、`coder`（非 category 用途）：删除
- [ ] T19 测试文件更新（`seed-team-packs.test.ts`、`team-runtime.test.ts`、`agent-context` 测试等）
- [ ] T20 `default-team-collaboration-template` spec：更新为 4 人组

## Phase 5：验证

- [ ] T21 `pnpm build` 通过（无类型错误）
- [ ] T22 `pnpm test` 通过（更新后的测试全绿）
- [ ] T23 grep 确认无 toad/yoshi/engineering-trio/research-team 残留
- [ ] T24 DB 清理（删除 engineering-trio/research-team 的 team_pack + team_pack_role）
- [ ] T25 重启 server，UI 显示 4 人组（mario⭐/dk⚙️/luigi⚡/peach🌸）
