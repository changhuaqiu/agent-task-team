# Agent Session Identity Checklist

## 隔离

- [x] 新项目首次执行不携带其他项目 runtime session id。
- [x] 同一项目不同 Agent 的 runtime session id 不同。
- [x] 不同项目同一 Agent 的 runtime session id 不同。
- [x] 缺少 project/conversation id 的正式 dispatch 被拒绝。

## 稳定

- [x] 同项目同 Agent 多轮执行始终 load 同一 runtime session id。
- [x] timeout、cancel、adapter 退出不会静默轮换 session。
- [x] daemon/浏览器重启后仍恢复同一 session。
- [x] load 失败不会自动执行 `session/new`。
- [x] 未确认的新 Session 在首轮 cancel/timeout 后不会被当作可恢复资源。
- [x] 已确认 Session 的 load 失败仍然失败关闭，不在同一 Invocation 内静默轮换或重放 prompt。
- [x] 无 taskId 的多轮执行不会因 cwd 漂移导致 runtime resource 丢失。
- [x] `Resource not found` 立即封存失效 generation；普通 load 错误持久化并只在下一次独立 dispatch 前换代。

## 一致性

- [x] server repository 是唯一执行事实源。
- [x] active `(conversation_id, agent_id)` 有数据库唯一约束。
- [x] runtime session id 使用 compare-and-set 绑定。
- [x] identity mismatch 返回稳定 reason code 且不覆盖状态。
- [x] invocation、session binding 和 socket 展示一致。
- [ ] 同名 Agent 的实时状态、stream、CLI Trace 与退出事件不会跨 conversation 覆盖。
- [ ] daemon 重连快照不会丢失同名 Agent 的并发项目运行。

## 验证

- [x] ACP resume 单元/集成测试通过。
- [x] 两项目 × 两 Agent × 三轮矩阵通过。
- [x] 三个真实 runtime 的 new + load smoke 通过。
- [x] 类型检查、全量测试和生产构建通过。
- [ ] 真实 Web 双项目并发运行只展示当前 conversation 的轨迹。
