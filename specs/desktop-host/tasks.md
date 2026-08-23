# 桌面 Host 任务

- [x] 审计 Buzz 的 Tauri setup、隐藏窗口、单实例、CSP 与退出处理。
- [x] 冻结 Host / Service / Renderer 责任边界。
- [x] 定义并实现 Host-Service handshake、严格 build/PID 门禁和 Host 退出 drain 协议。
- [x] 创建最小 Tauri Host、能力清单与配置。
- [x] 接入 Node Service 启动、ready 探测、隐藏窗口、随机 release 端口与显式退出 drain/兜底清理代码。
- [ ] 用 Windows Job Object/跨平台 process group 覆盖 Host crash 和强制退出的整个进程树。
- [ ] 将 renderer session 扩展到全部兼容 HTTP/WebSocket 接口。
- [x] 添加协议测试与 Windows standalone Service handshake smoke。
- [ ] 在具备 Rust toolchain 的环境执行 `cargo check`。
- [ ] 完成签名、更新、deep link 和安装矩阵后转为可发布状态。
