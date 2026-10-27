# 受控网络出口：生态核实与真实边界实验

2026-10-28。目标是让可变插件只能通过声明的服务出口访问网络，模型凭证留在可信进程中。本项完成架构实验与可重复验收脚本，**尚未接入正式实验控制器**。

## 资料、版本与选择

| 资料 | 核实事实 | 对本项目的影响 |
|---|---|---|
| Docker [gateway modes](https://docs.docker.com/engine/network/port-publishing/#gateway-modes)、[DNS](https://docs.docker.com/engine/network/#dns-services)；Context7 `/docker/docs` | 普通 internal 网络仍可访问宿主网关；Docker 28 起 isolated 网关模式不向 bridge 分配宿主地址。自定义网络通常使用内置 DNS，外部解析需要单独约束 | 每执行单元独立 internal + isolated 网络；明确设置 DNS，不把“无默认路由”当作全部网络边界 |
| Anthropic [sandbox-runtime Linux 接线](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/linux-sandbox-utils.ts#L1488)、[解析地址保护](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/resolved-address-guard.ts) | Linux 使用独立网络 namespace，经 Unix socket / socat 到可信 HTTP/SOCKS 代理；域名许可仍需约束实际解析地址。源码明确区分代理层与 namespace 层 | 复用“隔离网络 + 可信出口”分层；保留 Docker/gVisor 执行后端，不仅设置 HTTP_PROXY。未来通用联网接口必须处理 DNS 重绑定和私网目的地 |
| LangSmith [sandbox auth proxy](https://docs.langchain.com/langsmith/sandbox-auth-proxy) | 可信出口在沙箱外按规则注入认证；SDK 可使用占位凭证；网络许可和凭证注入分别配置 | 正式模型调用应通过明确服务路由；插件进程无需持有真实 Key。外部 API 自身仍可能回显数据，代理不等于任意上游可信 |
| X [开发者实践](https://x.com/kraitsura/status/2005394713864790247)、[Bubblewrap 讨论](https://x.com/xds2000/status/2044034948894732544) | 检索出现 headless Agent/worktree 与 Linux 沙箱应用讨论；本次返回的互动量有限 | 仅用作实践线索，未据此宣称最流行或安全效果，也未采用帖文中的性能比例 |

本机专用 Debian/OrbStack 实例没有 `/dev/kvm`。现有 runsc/systrap 有实际验收；本项没有把共享 OrbStack 内核改称 MicroVM，也未启动缺乏 KVM 的 Firecracker。

## 验收拓扑

```text
可信测试控制器（唯一持有 Docker socket；保存日志/回执）
        │ 创建并核实
        ├── 宿主 HTTP 服务夹具 ──随机测试凭证──┐
        │                                   │
        ├── 普通 internal 网络 → 正对照：宿主可达
        │
        └── 每执行单元 internal + isolated 网络
               │
          非 root 候选进程 ──唯一代理地址──► 可信代理夹具 ── uplink ──► 宿主服务
               │                             │
               ├─ 无真实模型密钥              └─ 代为认证，限制方法/路径
               ├─ 显式 hosts 绑定代理
               ├─ DNS 指向自身回环
               └─ 宿主直连 / 外网 IPv4、IPv6 / 外部 DNS：探测失败
```

运行 `HE_TEST_IMAGE=<本地不可变镜像ID> HE_TEST_RUNTIME=<精确运行时> node scripts/verify-egress-boundary.mjs <全新证据目录>`。只需镜像内具备 Node；不使用真实模型凭证、不调用付费模型。需要可信 Docker daemon，宿主网络夹具使用 runc，被测候选使用指定 runtime。脚本保留每容器原日志和白名单配置，最后删除本次唯一前缀的夹具与网络；输出目录存在则拒绝覆盖。

## 已观察结果

- Docker 29.8.2/runc 与专用 Debian Docker 29.9.2/gVisor `he-runsc-20261019` 均通过最终脚本。
- 普通 internal 正对照读取到了宿主服务的随机 nonce，证明服务真实可用；isolated 候选对宿主地址和外网 IPv4/IPv6 的直连失败。
- 候选未收到测试凭证；即使提交错误 Authorization，可信代理仍凭自身凭证完成同一上游认证；未许可路径被拒绝。
- 实际 Docker 配置核验单一候选网络、指定 runtime、DNS 和 hosts；读取 guest 路由/解析配置。外部默认 DNS 与指定公共 DNS 的解析请求均失败。
- 停止代理后调用失败，没有改走直连。代理停止导致夹具退出码 137 属于本项故障注入，不是业务实验失败。
- 初次 gVisor 实验无法解析 Docker 网络别名 `broker`，原失败报告保留。最终两个运行时统一使用控制器解析出的同网络代理 IP 写入 hosts，取消对 Docker 内置别名解析的依赖；没有失败后换 runtime 或改变访问权限。

机读摘要与原始回执摘要见 [网络实验记录](../evidence/2026-10-28-egress-boundary.json)。这证明指定宿主、镜像和探测场景中的网络行为，不证明抗容器逃逸、所有 DNS 隧道、恶意代理或生产凭证服务安全。HTTP 代理是测试夹具；脚本没有实现生产 HTTPS 身份代理或完整域名过滤。

## 正式实现必须继续完成

1. 合同显式冻结路由、上游、凭证环境变量名、请求范围；真实值只进入可信代理。模型、预算和评分身份继续由实验合同控制。
2. 按单个执行 intent 创建独立网络和代理；网络/代理/候选身份及地址写入持久证据；恢复核验实际拓扑，代理丢失直接暴露，不隐式重跑任务。
3. 原生 DSH Provider 使用固定代理入口；优化器控制 API 另设精确路由。构建源与研究访问走独立批准范围；QA、grader 和 probe 保持禁网。
4. 验证流式响应、取消、连接中断、地址重绑定、跨任务访问和清理，并完成真实 DSH 模型端到端验收。现有 bridge 路径在这部分完成前仍按原文标记限制。
