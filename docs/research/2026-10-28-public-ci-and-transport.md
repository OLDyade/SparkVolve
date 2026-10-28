# 公开 CI 与传输阶段诊断

用户于 2026-10-28 明确授权公开 `OLDyade/spark-harness-evolution` 并重新运行 CI。实际 API 返回 `isPrivate=false`；主分支 `a42416c` 的运行 `40624792713` 第二次 attempt 四个作业全部启动，第一 attempt 的账单拒绝仍保留。

macOS runner `macos-26-arm64` 的 actionlint 步骤报告 `go: command not found`。此前工作流假定 Go 预装；现在显式使用官方 `actions/setup-go` v7.0.0（固定提交 `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e`）安装 Go 1.27.3。版本来自官方 `actions/go-versions` release；actionlint v1.7.12 的 go.mod 要求至少 Go 1.25。两个宿主平台各自完成，不让一个失败取消另一个。

## 传输证据的修正

旧 `stage=connect` 从创建 HTTP 请求一直持续到收到响应头，因此旧记录只能证明 **响应头之前 ECONNRESET**，无法区分 TCP、TLS 或服务处理阶段。此前文字中“建连失败”的说法过于具体；原账本未补写不存在的观测。

当前原生 broker 记录单调时钟偏移：请求读取、DNS 策略解析、socket 分配、TCP connect、TLS secureConnect、请求 finish、响应头、响应体完成和总耗时。TLS 授权状态单独记录；没有响应头时不制造 HTTP 状态。字段缺失表示没有观察到，不能当零耗时。

按 [Node HTTP 文档](https://nodejs.org/docs/latest-v24.x/api/http.html#event-finish)，request finish 只表示交给操作系统，不证明服务端接收。按 [Node TLS 文档](https://nodejs.org/docs/latest-v24.x/api/tls.html#event-secureconnect)，握手事件与证书授权是不同事实。当前 HTTPS 验证行为保持，凭证和请求正文不写入传输账本。

11 项实际 HTTP/TLS 回归通过：DNS 拒绝、握手拒绝、握手成功、延迟响应头、已连通后重置、超时、取消和无重试。仅增强观测，不改路由、凭证、模型、超时、地址选择或错误裁决。
