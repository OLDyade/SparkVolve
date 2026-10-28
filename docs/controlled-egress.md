# 受控出口：让可变插件使用服务，凭证留在边界之外

出口组件已接入 Controller 和优化器会话；合同显式声明各自路由，执行器网络为 `controlled` 或 `none`，优化器使用 `controlled`，QA/评分禁网。真实 Controller 已完成模型 → 工具 → 私有评分，并在宿主等待中断后接回同一 worker 和 broker。runc 与 gVisor 均已有正式链路及恢复证据；当前版本测试与剩余项以[完成状态](completion.md)为准，磁盘硬配额和可选 MicroVM 不由出口验证替代。

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
| 协议头 | `forwardHeaders` 显式声明需透传的协议头；例如 Messages 的版本、beta 与 Accept。未声明的客户端头不传；认证、Host 与 HTTP 传输头由代理持有 |
| 地址 | 公网 HTTPS 或显式 IP 范围；任一 DNS 结果越界即拒绝；连接固定到本次已核实地址 |
| TLS | 原生 Node 校验证书与目标身份；不禁用验证；不将上游改为明文 |
| 流 | 原始响应流按背压转发；客户端关闭与超时会取消上游；HTTP 错误状态保留 |
| 账本 | 独立 UUID；记录路由 ID、地址、HTTP 状态、终态和原生传输阶段时刻，不记正文/凭证；写入后 fsync；写失败停止代理并报错 |
| 关闭 | 等待在途请求写完终态后关闭账本；SIGTERM 中止流式请求也保留 `cancelled` |

HTTP `cancelled` 表示消费者关闭连接，不能单独判定模型任务失败。原生 SSE SDK 可在消费结束后关闭 HTTP；任务结论同时核对 DSH 原生结束事件、用量账本与实际交付。代理保留原始传输终态，不将其改写成成功。

`transport` 字段提供相对请求开始的单调毫秒时刻：读取正文、解析、socket 分配、TCP 连接、TLS 握手、向操作系统写完请求、响应头和响应体完成。未观察到的事件不填值；`requestFlushedMs` 不证明上游收到正文。旧记录的 `stage=connect` 包含响应头前整段等待，不能据此推断 TCP 故障。详见[阶段诊断](research/2026-10-28-public-ci-and-transport.md)。

## 验收与复现

早期接入版本通过 53 项单测、9 项原生测试，同一当时镜像分别通过 12 项 runc 和 12 项 gVisor 容器回归；这些数量属于历史版本。测试覆盖固定路由、模型/输出范围、注入认证、完整 DNS 答案、流式首事件、取消、超时、重定向、不重试、账本故障，以及真实 HTTPS 子进程中的不受信证书拒绝和流式 SIGTERM。TLS 测试使用临时自签测试证书，开发环境需安装 OpenSSL。

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

### Controller / 优化器接线验收

- `Experiment.egress` 冻结两类外部路由；控制 API 的固定路径由可信启动器产生，禁止外部路由覆盖控制能力。
- `execution-intent.json` 区分准备、已发出创建意图、已创建。准备阶段中断可继续同一网络/代理；创建意图之后原 worker 缺失即失败，不生成替代任务。
- 每个运行保留网络 ID、代理容器 ID、原配置、实际隔离回执和请求账本。恢复校验实际 Docker 状态，外来网络成员或原代理丢失会拒绝。
- `tests/container/egress-session.test.ts` 使用真实 Docker：验证凭证替换、直连拒绝、准备阶段中断、原容器恢复、停止幂等、外来网络成员和原容器丢失。原生优化器通过代理完成控制 API 生命周期。
- `scripts/verify-controlled-controller.mjs` 使用真实模型和正式 Controller，主动中断宿主等待，然后接续原容器；本次独立评分为 1，attempt=0，4 次模型请求均有结果，完成后再次 pump 不增加请求。这是工程接线验收，不是质量收益实验。首次验收夹具缺少 `scripts.build`，构建失败原记录保留，未发起模型请求。

首次方向审查发现默认地址池容量不足和终态网络积累，原始发现与前一轮回执保留在[接线证据](evidence/2026-10-28-controlled-controller-integration.json)。现已以明确地址分配和可恢复回收修复，详见[资源生命周期证据](evidence/2026-10-28-egress-resource-lifecycle.json)。

### 有限资源与证据归档

```text
冻结 egressPool → Docker IPAM 原子租用两个 /29 → 原 worker / broker
                          │                         │
                    准备中断接续               宿主中断接回
                                                    │
                              ┌─────────────────────┴─────────────────────┐
                              ▼                                           ▼
                    保存终态、隔离回执、日志                  保存失败原因与原 worker 合同
                              │                                           │
                    execution-completion.json               停止原进程、收集失败原始证据
                              └─────────────────────┬─────────────────────┘
                                                    ▼
                                      release.json 记录 ID 与证据摘要
                                                    │
                                     删除原容器 → 删除网络 → released
                                             中断后只接续清理
```

- `isolation.network.egressPool` 必须由部署方预留；每运行两个 `/29`，30 执行器加一个优化器需 62 个。合同拒绝容量不足；实际分配排除 daemon 已用 CIDR，Docker IPAM 裁决跨进程竞争。不会增大宿主默认池。
- `isolation.network.egressDns` 冻结可信 broker 使用的 1–3 个显式 IPv4 resolver；无公共 DNS 默认值，不允许与地址池重叠。部署发现只提供候选列表，最终受控网络还需实际解析验收，详见[出口 DNS](isolation.md#出口-dns)。
- 成功回执持久化后才删除容器。恢复读取原容器 ID、合同身份和完整日志摘要；归档被改动直接报错。失败原因先落盘，清理失败保持可接续状态，禁止重新准备或执行任务。
- 真容器验证 62 个独立网段；8 个进程同时申请相同首选网段后得到 8 个不同租约；耗尽明确失败。成功/失败回收均注入删除中断，恢复后原任务没有重跑。
- 正式 Controller 真实模型复验：3 次调用全部返回、独立评分 1、attempt=0；宿主中断后恢复原 worker/broker，完成归档回收，再次 pump 无新增请求。该算术任务验证工程链路，不支持质量收益结论。

正式 Controller 复现（需先 build）：

```bash
HE_TEST_RUNTIME=runc HE_TEST_IMAGE=$(docker image inspect harness-evolution:local --format '{{.Id}}') \
  HE_TEST_DNS="${HE_TEST_DNS:?Set approved IPv4 DNS servers}" \
  node --env-file=/absolute/private/venus.env --import tsx \
  scripts/verify-controlled-controller.mjs .evolution/controller-resource-acceptance
```

原生 gVisor 正式链复验已补齐：[实际模型证据](evidence/2026-10-28-gvisor-controlled-dns.json)包含 4 次模型请求、原 worker/broker 恢复、独立评分 1、终态回收和接续不增请求。早期 [HTTP 夹具架构实验](research/2026-10-28-controlled-egress.md)继续保留。磁盘配额、MicroVM 后端另见[完成标准](completion.md)，未由本项代替。

网络接线核对了 Docker [多网络和默认网关](https://docs.docker.com/engine/network/)、[bridge 管理和连接解除](https://docs.docker.com/engine/network/drivers/bridge/)及 [IPAM 配置](https://docs.docker.com/reference/compose-file/networks/#ipam)。Docker 29.8.2 实测支持多次 `--network name=...,gw-priority=...,ip=...`；文档明确要求移除网络前解除容器连接，不能仅凭容器停止就视为网络已回收。

设计依据：Node 24 [连接与地址族](https://nodejs.org/docs/latest-v24.x/api/net.html#socketconnectoptions-connectlistener)、[HTTPS](https://nodejs.org/docs/latest-v24.x/api/https.html)、[流式取消](https://nodejs.org/docs/latest-v24.x/api/stream.html#streampipelinesource-transforms-destination-options)；地址分类采用精确依赖 [ipaddr.js 2.5.0](https://github.com/whitequark/ipaddr.js)。部署与凭证边界的行业依据、版本和社区线索见[受控出口研究](research/2026-10-28-controlled-egress.md)。
