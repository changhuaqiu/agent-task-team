# 桌面 Host 目标架构

> 状态：Target（桌面壳尚未实现；本轮已落地其前置依赖：统一事件、Collaboration Kernel 与 Agent Runtime）
> 日期：2026-08-23
> 参考：Buzz `desktop-v0.5.18` 的 `desktop/src-tauri` 实现

## 1. 产品判断

Agent Task Hub 适合做桌面产品，因为它管理本地代码目录、Git Worktree、CLI/ACP 进程、凭据和长时间运行的
Agent 团队。桌面版的定位不是“网页的安装包”，而是本地 Agent OS Host：窗口关闭后仍能可靠管理工作，
重启后从持久事实恢复，并把操作系统能力以最小权限提供给 UI。

Buzz 可借鉴的不是其聊天 IA，而是桌面进程边界：native host 在 UI mount 之前完成 migration、稳定身份恢复和
runtime reconcile；单实例、deep link、窗口恢复、secret store、外部 binary、graceful shutdown 和 updater 都
由 Host 管理。恢复模式下跳过会产生外部副作用的工作，而不是用临时身份继续运行。

## 2. 选择

采用 `Tauri Host + 受监管的 Node Service sidecar + WebView`，不把现有服务内核重写到 Rust，也不让
Renderer 直接管理文件、SQLite、凭据或 Agent 子进程。

```text
Tauri Host
  - single instance / deep link / tray / notification / updater
  - sidecar lifecycle + app-data paths + secret bootstrap
  - boot and shutdown fencing
              |
              | authenticated loopback, version handshake
              v
Node Service Sidecar
  - Collaboration Kernel / Durable Inbox
  - Platform Event Dispatcher / Project View
  - Invocation Pipeline / Agent Runtime / ACP processes
  - SQLite facts and recovery
              |
              | one project:view presentation protocol
              v
WebView Renderer
  - delivery workspace
  - Human Command
  - read-only projections and explicit user decisions
```

选择 sidecar 而不是把 Next server API 重写为大量 Tauri command，原因是当前 Node 服务已经拥有一致的事务、
调度和 Runtime owner。跨语言复制这些状态机会重新制造两套事实源。Rust Host 只拥有 OS 生命周期；Node
Service 拥有业务与执行生命周期。

## 3. Boot contract

Host 必须按固定顺序启动：

1. 获取单实例锁，解析但暂存 deep link；
2. 解析 OS app-data、log 与 secret-store 路径；
3. 启动绑定 `127.0.0.1` 随机端口的 Service，并传入一次性 bootstrap secret；
4. Service 完成 schema migration、数据完整性检查、Inbox/Dispatcher claim recovery 和 Runtime reconcile；
5. Host 校验 service protocol/build revision，取得短期 renderer session token；
6. WebView 加载本地页面，完成首个稳定投影后再显示窗口；
7. 逐个消费并 ACK 暂存 deep link。

任一步失败都进入显式 recovery screen。不能加载一个可操作 UI，再在后台猜测 Service 是否已准备完成。

## 4. 生命周期与安全不变量

- Renderer 不直接接触 API key、数据库文件、shell、任意文件系统或子进程句柄。
- Service 只绑定 loopback；每个 HTTP/WebSocket 请求验证 Host 签发的短期 session，CSP 禁止任意远端脚本。
- OS app data 只保存应用事实、日志和缓存；用户 Project/Workspace 保持在用户选择的目录，不复制成隐式沙盒。
- 关闭主窗口默认隐藏，不等于终止 Agent 工作；“退出应用”才执行有界 drain、撤销未 ACK claim、kill process、
  WAL checkpoint 和幂等 shutdown。
- Host crash 后，Service 不允许成为无 owner 的长期孤儿；Service crash 后，Host 可按预算重启，恢复依据只来自
  Durable Inbox/Event/Invocation，而不是 Renderer Store。
- 更新前检查是否存在不可安全中断的外部动作；更新不能直接把“窗口已关闭”当作工作已停止。
- sidecar 和 Host 必须做 protocol version handshake；签名、安装和自动更新按平台分别验证。

## 5. 与当前实现的关系

本轮落地的 `EventEnvelope`、单一 `project:view`、`CollaborationKernel`、claim fencing、ACP readiness 和
orphan Invocation recovery 正是桌面 Host 的前置条件。它们使窗口、Socket 和 Runtime process 都不再是
协作事实源，因此未来增加 Tauri Host 不需要再改写领域触发协议。

当前尚未落地：Tauri crate、Node sidecar 打包、Host/Service handshake、tray/deep link/updater 和安装签名。
这些必须作为独立 active spec 实现，不能在没有 dirty-shutdown 与升级恢复测试时宣称“桌面版完成”。

## 6. 桌面验收门禁

- 冷启动、重复启动、窗口关闭/重开和 deep link 不会重复 WorkRequest。
- 在 ACP handshake 前强杀 Host/Service，重启后 orphan Invocation 被终结，同一工作有界重试。
- Renderer 断开 10 分钟，Agent 工作继续；重连只从 snapshot + durable cursor 对账。
- sidecar 端口不可被无 token 的本机进程调用，Renderer 不能读取 secret-store 内容。
- Windows/macOS 至少覆盖安装、签名、升级、卸载保留用户 Workspace 与显式数据清理。
- Host 与 Service 版本不兼容时 fail closed，并提供可诊断的恢复路径。
