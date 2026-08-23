# 桌面 Host 实施规格

> Status: active
> Date: 2026-08-23
> Branch: `codex/unified-event-agent-runtime`

## 目标

把现有 Web + Node 内核装入可恢复的本地桌面 Host。桌面版定位为本地 Agent OS Host，而不是网页安装包。

## 冻结边界

1. Tauri Host 只拥有单实例、窗口、系统集成、Service 生命周期、一次性启动凭据和退出栅栏。
2. Node Service 继续独占 Workspace Command、Collaboration Kernel、Platform Event、Agent Runtime 与 SQLite 事实。
3. Renderer 只消费 `project:view` / Workspace View 并提交 Workspace Command；不得直接读数据库、凭据或管理 Agent 进程。
4. Host 与 Service 必须以 protocol version、build revision 和一次性 secret 完成 ready handshake 后再显示主窗口。
5. 主窗口关闭默认隐藏；显式退出才执行有界 drain。Host 崩溃不得留下无 owner 的长期 Service。

## 本轮范围

- `src-tauri` crate、最小权限 capability、CSP、单实例和隐藏启动窗口；
- Node Service 的 `/api/desktop/handshake` 与 `/api/desktop/shutdown`；
- Host 启动/健康探测/版本校验/认证 drain 与直接子进程兜底；
- 开发脚本、协议契约测试和 Windows standalone Service smoke；真实 Host 冷启动 smoke 等待 Rust toolchain。

## 后续发布范围

签名、公证、自动更新、托盘图标、deep link 与跨平台安装矩阵属于发布工程；完成这些门禁前只能称为“桌面开发版”，不能称为可发布桌面版。

## 验收

- 无 secret 或版本不匹配时握手 fail closed；
- 窗口显示前 Service 已 ready；重复启动只激活现有窗口；
- Renderer 断开不影响内核运行；显式退出终止 Service 进程树；
- Web build、Rust check（有 Rust toolchain 的环境）和 Windows 启动 smoke 均通过。
