# 公开 CI 与传输阶段诊断

用户于 2026-10-28 明确授权公开 `OLDyade/spark-harness-evolution` 并重新运行 CI。实际 API 返回 `isPrivate=false`；主分支 `a42416c` 的运行 `40624792713` 第二次 attempt 四个作业全部启动，第一 attempt 的账单拒绝仍保留。

macOS runner `macos-26-arm64` 的 actionlint 步骤报告 `go: command not found`。此前工作流假定 Go 预装；现在显式使用官方 `actions/setup-go` v7.0.0（固定提交 `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e`）安装 Go 1.27.3。版本来自官方 `actions/go-versions` release；actionlint v1.7.12 的 go.mod 要求至少 Go 1.25。两个宿主平台各自完成，不让一个失败取消另一个。

## 传输证据的修正

旧 `stage=connect` 从创建 HTTP 请求一直持续到收到响应头，因此旧记录只能证明 **响应头之前 ECONNRESET**，无法区分 TCP、TLS 或服务处理阶段。此前文字中“建连失败”的说法过于具体；原账本未补写不存在的观测。

当前原生 broker 记录单调时钟偏移：请求读取、DNS 策略解析、socket 分配、TCP connect、TLS secureConnect、请求 finish、响应头、响应体完成和总耗时。TLS 授权状态单独记录；没有响应头时不制造 HTTP 状态。字段缺失表示没有观察到，不能当零耗时。

按 [Node HTTP 文档](https://nodejs.org/docs/latest-v24.x/api/http.html#event-finish)，request finish 只表示交给操作系统，不证明服务端接收。按 [Node TLS 文档](https://nodejs.org/docs/latest-v24.x/api/tls.html#event-secureconnect)，握手事件与证书授权是不同事实。当前 HTTPS 验证行为保持，凭证和请求正文不写入传输账本。

11 项实际 HTTP/TLS 回归通过：DNS 拒绝、握手拒绝、握手成功、延迟响应头、已连通后重置、超时、取消和无重试。仅增强观测，不改路由、凭证、模型、超时、地址选择或错误裁决。

## gVisor 安装后的 Docker 网络初始化

公开 CI `40626981748` 的 gVisor 作业在启动编译容器时直接失败：`could not parse extra host IP invalid IP: ParseAddr("invalid IP")`。同一矩阵 runc 作业不执行运行时安装脚本。脚本原来注册 runsc 后只调用 `systemctl reload docker`。

[Docker 官方说明](https://docs.docker.com/reference/cli/dockerd/#configure-host-gateway-ip)明确 `host-gateway` 默认取默认 bridge 的地址；[GitHub gh-aw 的运行时集成记录](https://github.com/github/gh-aw/issues/44795)记录了 reload 后同一错误及完整 restart 的要求。安装脚本改为在专用宿主机完整重启 Docker，不写固定网关 IP，不更换运行时，不降低隔离。脚本头部明确告知 Docker 重启副作用。

同时修正测试自身资源生命周期：本地 HTTP fixture 创建后立即注册清理，保证在 host-gateway 探测失败、尚未进入后续测试体时也关闭服务。CI 使用 TAP 即时输出失败堆栈，保留容器 stdout/stderr；失败不会因为测试服务残留而长期隐藏。

## 原生工具沙箱与临时 HOME

修正网关后，公开 CI `40627364489` 的 gVisor 矩阵完成 23 项测试，21 项通过；原生 bash/LibreOffice HOME 和依赖 bash 的反馈协议测试失败。专用 gVisor 20261019.0/systrap 宿主实测：DSH Landlock probe 返回 `unusable`，镜像中没有 `bwrap`。安装 Debian Bubblewrap 后，DSH 原生只读探测命令成功；保留 `--cap-drop=ALL`、非 root、只读根、`no-new-privileges`，未放宽容器权限。

[DSH 官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/README.md)及锁定的 `@deepseek-ai/dsh-sandbox-local@0.2.1-rc.4` 实现都说明 Linux 原生选择 Bubblewrap/Landlock；无可用实现时明确失败。镜像现在安装 [Bubblewrap](https://github.com/containers/bubblewrap)，继续使用原生选择机制，不新增自定义执行器或绕过内层隔离。

该版本 `bwrapProfileArgs` 对 workspace-write 创建独立 `/tmp`，再 bind 工作区。实测这会遮住先前的 `/tmp/evolution-home`。因此 HOME/XDG 统一迁到 `/workspace/.harness-home` 的独立 128MiB、0700 tmpfs：原生工作区 bind 保留该挂载及配额，工具调用间持久，容器销毁即释放。实际探测确认其容量为 134217728 字节、可写且外部路径仍拒绝写入。宿主仅保留空挂载点，HOME 内容不进入交付快照。回归通过连续两次真实原生 bash 检查配置可用性、配额、跨调用内容和容器删除后的空挂载点；完整矩阵以新提交实际结果为准。
