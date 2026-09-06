# 工作结果的只读聚合与安全阅读

> 状态：代码与测试已实现，2026-09-06；历史契约见[归档规格](../../archive/specs/ux-journey-completion/spec.md)。

导航与桌面身份共享 URL fragment，但职责分离：写入项目/全局定位时必须原样保留当前 `ath-desktop-session` 参数，返回仅带该参数的初始地址时恢复全局动态。该值不进入项目数据、日志或持久存储；纯工作项定位函数不生成身份凭据。桌面命令仍由现有 Renderer 校验认证，不因页面跳转降级为免认证请求。

结果读取模块以 Project + Conversation + Task 校验作用域。旧 Project workspace 只读取指定 Task，新 workstream 汇总该工作项任务。Task Gate 仍由 QualityGateRepository 持有；聚合层只读取已记录 decision 及其 evidenceIds，不生成验收决定。冻结 DeliveryBundle 只来自已完成且 rootTask 在当前范围内的 Delivery Run。

ProjectReview 目前没有 WorkItem 关联字段，因此只返回同项目分支评审数量及独立导航，不把它计为本工作验收。历史工作没有结构化证据时返回缺口，不扫描聊天文字补证据。

交付件继续由 Artifact Ledger 维护贡献者与登记状态。DTO 同时保留贡献来源的 id、conversationId 与 workId，使共享历史空间、跨任务引用能准确导航。展示层可按日志、已知配置用途细分“文件”，不能升级登记或验收状态。

文件预览仅接受当前 Project Ledger 中存在的对象 identity，或本工作已接纳 Gate evidence 中的精确文件引用。用户不能传任意磁盘路径绕过来源校验。读取前校验 canonical 路径与 realpath 都在 Project 根内，拒绝敏感/内部目录、越界和不支持类型，限制读取大小；文本使用已有秘密遮蔽模块，HTML/SVG 只以文本阅读，禁止执行。预览为当前磁盘版本，附带内容哈希和修改时间，明确不等于已冻结验收版本。

该模块不承担任务终态、派发、权限、Gate 或 Artifact owner。Web/Desktop 只消费同一 GET 投影；失败与缺证据分开，异步响应按对象取消/隔离，不以空数组掩盖读取错误。

## 边界与复用约束

- 冻结结果包逐字段遮蔽敏感字符串，保留对象/数组结构；不把截断的 JSON 重新解析。脱敏测试必须断言原凭据不存在，不能只检查出现 REDACTED。
- 文件预览上限：文本 256 KiB、图片 4 MiB。外部链接仅接受无用户名/密码的 HTTP(S)，服务端不代抓取。不存在/移动/拒绝/不支持均可见，不伪造空白预览。
- 目录选择保持既有用户目录限制，补上 realpath 与路径分段边界；文件夹别名不能越界。
- 收件箱按 thread root 或一次 Invocation 聚合，只投影最后一条可见消息，重放不增长未读；迁移到聚合身份时，全部旧源已读才继承已读标记。
- 不改写 Task/Gate 终态，不新增权限，不发送隐式安排请求。安排按钮重试复用该浏览器标签页保存的完整命令键与时间；不同目标内容/协调者为不同意图。
- 本机文件预览不是对不可信执行程序的文件系统沙箱；文件系统并发替换/恶意本机进程仍受操作系统权限边界约束。
