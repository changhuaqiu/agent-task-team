# 四 Agent PR 交付与评审技术设计

> 状态：第一阶段实施中

## 背景

现有 Task Graph 用 `implementation_evidence` 和 `delivery_evidence` 控制 `in_review`/`done`，但证据字段仍可由调用者直接提供；Task Action/Artifact 能表达 review/url，却没有 Git provider 回执模型。聊天已有 TaskActionCard seam，可扩展为交付卡，但不得把 UI metadata 变成事实源。

## 决策

引入一个深模块 `EngineeringCollaborationService`：

```ts
interface EngineeringCollaborationService {
  recordPullRequest(input: PullRequestSubmission): Promise<PullRequestReceipt>;
  recordReview(input: ReviewSubmission): Promise<ReviewReceipt>;
  recordMerge(input: MergeSubmission): Promise<MergeReceipt>;
}
```

服务依赖窄接口 `GitProviderVerifier` 读取 provider 当前事实。生产 GitHub adapter 优先使用 `gh`；测试注入内存 verifier。调用者不能提交 provider actor、state、head SHA 等权威字段，只能提交 task/URL 和本轮本地测试证据。

每次成功记录在一个数据库事务内完成：

1. 校验 task、actor、TeamPack gate authority；
2. 从 provider 读取 PR/review/merge；
3. 追加 Task Action；
4. 添加 Task Artifact；
5. 写入带结构化 `collaborationCard` metadata 的 chat message 并绑定 task/action；
6. 通过现有 task mutation/wakeup 边界推进状态；
7. 追加 proof event。

## 事实源

- PR/review/merge 的当前事实：Git provider；
- task 生命周期：Task Graph；
- 四角色职责和 gate owner：Team Runtime；
- 卡片展示：持久化 chat message snapshot；
- 转换审计：Task Action + Proof Log。

卡片是 provider 事实的有界快照，不是 provider 的替代事实源。重新评审或合并前必须再次查询 provider。

## 数据与动作

第一阶段复用 `task_action`、`task_artifact_ref`、`chat_message.metadata`，扩展类型：

- actions：`task.pull_request_submitted`、`task.review_recorded`、`task.pull_request_merged`；
- artifacts：`pull_request`、`review`、`merge`；
- metadata：版本化 `collaborationCard` union。

如后续需要查询多个 review、head 失效历史和 provider webhook，再引入专用 receipt table；第一阶段不能把同一事实重复存入多个可写 owner。

## 安全与一致性

- provider CLI 参数使用参数数组，不拼接 shell；
- URL 必须属于 conversation 的 `git_repo_root` remote；
- 不持久化 token、完整 diff 或评论正文，只存有界摘要和 canonical URL；
- review 必须匹配当前 PR head SHA；
- 新 head SHA 出现时，approved card 标记 stale 并重新打开 gate；
- provider 不可达时失败关闭，不接受调用者自报字段。

## 测试策略

- 纯服务测试：actor authority、repo mismatch、head stale、reject/approve、事务回滚；
- API/tool 集成：真实 task/action/artifact/message/proof 一致；
- React：三类卡片与 stale/error；
- Playwright：浏览器中提交 receipt、卡片跳转与状态变化；
- 真实演练：测试仓库 PR + GitHub review/comment，并核对 exact task/PR/SHA。
