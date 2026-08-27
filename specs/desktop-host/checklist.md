# 桌面 Host 验收清单

- [x] Host 不包含业务状态机或任务裁决（代码审查通过）。
- [x] Renderer 无文件系统、数据库、secret 和进程权限（capability 审查通过）。
- [ ] Service 仅监听 loopback，并校验 bootstrap secret/session。
- [x] protocol/build/PID 不兼容时 fail closed（代码、协议测试与真实 Rust Host smoke）。
- [x] 关闭窗口不终止工作，单实例再次启动恢复窗口；认证退出与直接子进程兜底已验证。
- [ ] 冷启动、重复启动、Service 崩溃和 Host 崩溃有恢复测试。
- [ ] Windows/macOS 安装、签名、升级与卸载策略通过发布门禁。
