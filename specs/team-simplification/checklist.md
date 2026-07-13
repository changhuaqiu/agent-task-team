# 验收清单 — 团队精简

## 数据层
- [ ] AGENT_ROSTER 只有 4 个（mario/dk/luigi/peach），无 toad/yoshi
- [ ] presetTeamPacks 只有 default-team（4 人 workflow），无 engineering-trio/research-team
- [ ] presetRoleCards 无 toad/yoshi 专用 roleCard
- [ ] seed-team-packs 只 seed default-team 4 人

## 提示词层
- [ ] roleLayer planner 分支：提 Luigi（不提"前端角色/后端角色"分离）
- [ ] roleLayer code_reviewer 分支：含测试职责（评审+测试合并）
- [ ] roleLayer 无 qa 分支（合并进 code_reviewer）
- [ ] teamPackLayer HARNESS_STAGE_GUIDANCE：只有 mario/dk/luigi/peach
- [ ] teamPackLayer workflow：implementing Luigi 独立、quality_gate 合并

## 前端层
- [ ] globals.css 无 toad/yoshi CSS 变量
- [ ] PixelAvatar 无 toad/yoshi 头像
- [ ] ChatMessageItem AVATAR_THEME_CLASSES 无 toad/yoshi

## 代码清理
- [ ] 全局 grep `toad` 无残留（src/ 内）
- [ ] 全局 grep `yoshi` 无残留
- [ ] 全局 grep `engineering-trio` 无残留
- [ ] 全局 grep `research-team` 无残留

## 构建 & 测试
- [ ] `pnpm build` 通过
- [ ] `pnpm test` 全绿
- [ ] DB 中 engineering-trio/research-team 的 team_pack + team_pack_role 已清

## UI 验证
- [ ] UI 显示 4 人组（mario⭐ / dk⚙️ / luigi⚡ / peach🌸）
- [ ] workflow 4 阶段（planning → implementing → quality_gate → done）
- [ ] 消息显示正确头像 + 名字

## 非目标确认
- [ ] team pack 系统机制（创建/选择/切换）保留
- [ ] 已完成的 spec（cli-bridge/context-budget/agent-session-stability）不碰
- [ ] 历史 conversation/chat_message 数据保留
