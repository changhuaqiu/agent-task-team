# Agent Session Identity Tasks

## 契约与模型

- [x] 建立活动规格并冻结 Session identity 不变量。
- [x] 更新长期 Session 生命周期设计。

## ACP

- [x] 根据 initialize capability 实现 `session/load`。
- [x] 忽略 load 阶段历史 replay，只转发当前 prompt updates。
- [x] 增加 resume unsupported、load failed、identity changed reason code。
- [x] 更新 mock agent 与 ACP resume/隔离测试。

## Server 与数据库

- [x] 增加 active `(conversation_id, agent_id)` 唯一约束及历史重复数据迁移。
- [x] Session 首次绑定改为 compare-and-set，禁止静默覆盖。
- [x] daemon 仅使用 server binding 作为 resume 来源。
- [x] 删除自动 fresh-session retry 和正式路径的 client session fallback。
- [x] 区分 confirmed 与 unconfirmed runtime binding。
- [x] 首次 Invocation 未成功时 compare-and-clear unconfirmed binding。
- [x] dispatch 前修复“有失败历史但从未成功”的遗留 binding。
- [x] 固定无 taskId 的 Session cwd，区分 `Resource not found` 并封存失效 generation。
- [x] 将持久化的普通 load failure 作为下一次独立 dispatch 的安全换代依据。

## 前端

- [x] hydration 以 server Session 数据替换本地缓存，不合并 persisted Session。
- [x] 新项目初始化独立 Session 展示 scope。
- [x] socket 收到 session id 时保持 conversation + agent 隔离。
- [ ] 将 Agent 实时状态、active run、stream、CLI Trace 与 watchdog 改为 conversation + agent 作用域。
- [ ] 修复成员条目只从当前 conversation 选择执行中任务。

## 验证

- [x] repository 并发/唯一性/identity 测试。
- [x] 两项目 × 两 Agent × 多轮 Session 矩阵测试。
- [x] timeout/cancel/load failure 测试。
- [x] OpenCode、Claude、Codex 真实 resume smoke。
- [x] 安装、类型检查、测试和构建通过。
- [x] 首轮 cancel/timeout 后下一轮重新 provision 测试。
- [x] 稳定 cwd 与失效 runtime resource 自动换代测试。
- [x] `Internal error` load failure 后下一次 dispatch 的 generation 换代测试。
- [ ] 两项目同名 Agent 并发 event/activity/exit 与 UI 切换回归测试。
