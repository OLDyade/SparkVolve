# 受控出口：让可变插件使用服务，凭证留在边界之外

出口组件已实现并完成真实 DSH 模型调用验收。**正式实验 Controller 的自动装配、持久恢复尚未接入**；现有实验合同中的 `bridge` 权限不会因安装此组件自动变成受控网络。

```text
冻结路由：方法 / 本地路径 / 上游 / 地址范围 / 模型 / 输出额度
                              │
候选 DSH                      ▼                    可信出口进程
┌─────────────────────┐      唯一入口       ┌─────────────────────────┐
│ 原生 Provider + Loop │ ─────────────────► │ 检查路径和请求合同        │
│ 原生工具与候选插件    │   internal         │ 解析一次 → 核实全部地址   │
│ 占位凭证，无真实 Key  │   + isolated       │ 固定连接 IP，保留 TLS 校验│
└─────────────────────┘                    │ 从自身环境注入真实凭证    │
  DNS 回环 / 显式 hosts                    │ 原字节流式转发、取消传播  │
  无直接公网路由                           └───────────┬─────────────┘
                                                        │ uplink
                                                        ▼
                                                  合同内上游服务

  UUID started（落盘） → 请求 → finished（落盘）
  停止接收 → 取消连接 → 等待请求收尾 → 关闭账本
```

`src/egress.ts` 提供严格的路由配置、地址验证和流式转发；`src/runtime/egress.ts` 是独立进程入口。模型凭证通过环境传给可信代理，候选仅使用原生 Provider 的本地占位值。网络 namespace 的约束由部署方实施，单独运行一个代理不能约束插件直连。

| 行为 | 合同与实现 |
|---|---|
| 目的地 | 精确方法/路径匹配；候选不能提供 URL；不支持 CONNECT、Upgrade、转发重定向或失败重试 |
| 请求 | 限制字节数、JSON 顶层固定字段和整数上限；不改写请求正文；客户端认证头不会透传 |
| 地址 | 公网 HTTPS 或显式 IP 范围；任一 DNS 结果越界即拒绝；连接固定到本次已核实地址 |
| TLS | 原生 Node 校验证书与目标身份；不禁用验证；不将上游改为明文 |
| 流 | 原始响应流按背压转发；客户端关闭与超时会取消上游；HTTP 错误状态保留 |
| 账本 | 独立 UUID；只记路由 ID、地址、HTTP 状态和终态，不记正文/凭证；写入后 fsync；写失败停止代理并报错 |
| 关闭 | 等待在途请求写完终态后关闭账本；SIGTERM 中止流式请求也保留 `cancelled` |

HTTP `cancelled` 表示消费者关闭连接，不能单独判定模型任务失败。原生 SSE SDK 可在消费结束后关闭 HTTP；任务结论同时核对 DSH 原生结束事件、用量账本与实际交付。代理保留原始传输终态，不将其改写成成功。

## 验收与复现

`npm run check` 当前通过 46 项单测、9 项原生测试；另通过 7 项 runc 容器回归和实际 npm 包原生安装调用。新增测试覆盖固定路由、模型/输出范围、注入认证、完整 DNS 答案、流式首事件、取消、超时、重定向、不重试、账本故障，以及真实 HTTPS 子进程中的不受信证书拒绝和流式 SIGTERM。TLS 测试使用临时自签测试证书，开发环境需安装 OpenSSL。

以下脚本使用真实模型，有调用费用。凭证文件仅在可信启动器读取；输出目录必须全新。Docker 镜像需来自仓库 Dockerfile 的实际构建，Node 原生依赖与当前架构匹配。

```bash
npm ci
npm run build
mkdir -p .evolution
HE_TEST_IMAGE=$(docker image inspect harness-evolution:local --format '{{.Id}}') \
  node --env-file=/absolute/private/venus.env \
  scripts/verify-egress-native.mjs .evolution/egress-native-acceptance
```

脚本建立独立网络、双网卡代理和非 root DSH 容器，真实调用模型并执行工具生成 JSON 文件。代理只监听候选网段地址；候选未收到真实凭证，直连公共地址失败，未许可路径拒绝。结束保存原始回执和日志，再清理本次容器/网络；不覆盖失败结果，不重跑业务样本。

最终实测：2 次模型请求、2 次原生结果、0 失败/未完成；工具写出 `{"sum":55}`；3 条 HTTP 请求都有终态（含一次拒绝路径探测），代理退出码 0。镜像固定，新增编译文件以只读挂载运行，源码与实际编译文件摘要分别记录。[机读证据](evidence/2026-10-28-egress-native-transport.json)同时保留早期验收脚本的 tmpfs 与 SSE 断言问题。该结果证明传输与接线，不作为正确率增益。

正式接入还需要：将路由纳入实验身份、按 execution intent 持久装配代理/网络、恢复时核验原拓扑和剩余期限、冻结优化器控制 API 路由，并在原生 gVisor 运行链复验。目前 gVisor 的出口证据仍是[HTTP 夹具架构实验](research/2026-10-28-controlled-egress.md)。磁盘配额、MicroVM 后端另见[完成标准](completion.md)，未由本项代替。

设计依据：Node 24 [连接与地址族](https://nodejs.org/docs/latest-v24.x/api/net.html#socketconnectoptions-connectlistener)、[HTTPS](https://nodejs.org/docs/latest-v24.x/api/https.html)、[流式取消](https://nodejs.org/docs/latest-v24.x/api/stream.html#streampipelinesource-transforms-destination-options)；地址分类采用精确依赖 [ipaddr.js 2.5.0](https://github.com/whitequark/ipaddr.js)。部署与凭证边界的行业依据、版本和社区线索见[受控出口研究](research/2026-10-28-controlled-egress.md)。
