# 正式出口接入：独立复核与剩余实现

本轮工作基于 `174a702e1b9d156cbb1f4d320a0424891358a50b`，在 `feat/controlled-egress` 工作树实现并逐项验收。核心思想、宣传定位与 `11.md` 不改。

## 已验证

1. 路由进入实验身份，优化器和执行器真实凭证留在各自可信 broker；候选只收到占位值。控制 API 固定路径与外部模型路由分别声明，外部路由不能覆盖控制能力。
2. 正式 Controller 实际模型调用、工具写入、独立评分成立。宿主等待中断后接回原 worker/broker，attempt=0，4 次模型请求全部有结果；终态再次 pump 无新增请求。
3. 原生优化器通过实际 broker 完成控制 API 生命周期；独立容器测试检查直连拒绝、认证替换、外来端点、准备中断和原容器消失。
4. `prepareExecution` 的持久准备/创建意图/已创建状态已修复首次独立审查发现的准备窗口。复审确认本项解决，无新增阻断。

首次真实模型验收夹具遗漏构建脚本，构建即失败、0 模型调用；原报告保留。修正验收夹具后使用新目录，不覆盖失败或混合 attempt。[机读回执](../evidence/2026-10-28-controlled-controller-integration.json)

## 网络资源生命周期：问题与修复

原接线每次执行分配两个默认 bridge，并将停止的容器和网络完整保留。实际 Docker 默认只有 30 个 IPv4 `/24` 地址池；30 题并发需要至少 60 个网络，运行前就可能耗尽。串行实验也会积累。测试的 finally 清理仅清理测试夹具，不能代表正式系统具备回收能力。

现实现采用合同声明的有限私有 IPv4 地址池和持久 `/29` 租约，并将执行终态归档与资源回收分开：

```text
合同冻结地址池与容量 → 准备租约 → 运行原容器 → 收齐原始证据
                           │                    │
                     宿主中断保留          持久化执行终态
                     同一租约/容器               │
                                          解除端点并释放租约
                                               │
                                          归档证据可复查
                                  回收中断只继续清理，不重建执行
```

必须覆盖：目标并发容量、跨进程分配冲突、准备中断、运行中断、终态写入与回收之间的中断、重复清理，以及归档后恢复零新增模型请求。运行证据应保留原容器 ID、配置、日志、请求账本和内容身份。不得用自动重跑、无限扩池或只修改测试清理来通过验收。

实际已通过 62 网段容量、8 独立进程首选租约竞争、成功终态回收中断、失败回收中断和原 worker 恢复校验失败收尾。独立复审另外发现失败清理过早终态及恢复异常时原 worker 合同丢失，已新增 `execution-failure.json` 和创建前持久 `execution-spec.json`，Controller/优化器先接续清理，再记录业务失败，不进入新执行。Controller 故障注入确认一次 create、一次 collect、两次 cleanup。

真实模型新目录验收通过：原 worker/broker ID 保留，3 次调用全部返回，独立评分 1、attempt=0；归档后原容器移除，终态再次 pump 无新增请求。完整资源证据见[机读回执](../evidence/2026-10-28-egress-resource-lifecycle.json)。运行时间和调用次数仅报告；本项不是提分实验。

还实测了复用默认 `bridge` 作为 broker uplink 的方案：Docker 拒绝多网络创建同时附着默认网络与用户定义网络，原错误为 `cannot attach both user-defined and non-user-defined network-modes`。因此保持双用户网络，显式小网段分配与终态回收，无共享默认网络降级。池选择属于部署网络规划，Docker IPAM 只能检测 daemon 网络，不能替代 LAN/VPN 冲突核对。

## 核实来源

- Docker 官方 [网络及多网络网关优先级](https://docs.docker.com/engine/network/)；Docker 29.8.2 真实验证多次 `--network name=...,gw-priority=...,ip=...`。
- Docker 官方 [bridge 网络管理](https://docs.docker.com/engine/network/drivers/bridge/)：删除网络前解除容器连接；停止进程不等于资源回收。
- Docker 官方 [IPAM 配置](https://docs.docker.com/reference/compose-file/networks/#ipam)：显式 subnet / ip_range / gateway / aux_addresses；不能假设宿主默认地址池支持目标规模。
- 本机 `docker info --format '{{json .DefaultAddressPools}}'` 实测为 30 个 IPv4 `/24` 池，以及一个独立 IPv6 池；IPv6 不作为当前 IPv4 合同的替代。

行业方案和版本来源继续沿用 [受控出口研究](2026-10-28-controlled-egress.md)。以上发现改变的是正式基础设施实现，不更改项目的核心定位。
