# 验收清单

- [x] Task/场景/`$skill-name` 强信号能确定性选择 Skill。
- [x] 未激活的已绑定 Skill 不进入 Prompt、不暴露工具、token 为 0。
- [x] required Skill 未绑定、未安装、损坏或被裁剪时 dispatch fail closed。
- [x] outcome recovery 不恢复实现型 Skill 或权限。
- [x] Web E2E 强信号加载 browser-verification，普通执行不加载。
- [x] 浏览器验证 capability 只放行受限 Playwright 测试命令。
- [x] WorkContract 可追溯 stage、capabilities、exit policy 与 Skill decision。
- [x] task-bound Work 不加载直接状态写入 Skill，Task mutation tool 不进入 WorkContract permissions。
- [x] planning 使用 `propose_task_graph` Outcome，不依赖直接 Task mutation tool。
- [x] 全量测试、类型检查、受影响路径 lint、build 通过（仓库全量 lint 仍有既有历史债务）。
- [x] 长期设计文档与实现一致。
- [ ] 合并重启后真实任务不再加载无关 Git Skill，且项目内 Codex edit / Playwright 验证不再误触发人工决策。
