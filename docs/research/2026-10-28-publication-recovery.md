# 冻结发布的进程崩溃一致性

原实现以固定 `destination.freeze-lock` 目录排他，依赖 `finally` 清理。进程在复制阶段被 SIGKILL 后不会执行清理；恢复会遇到 EEXIST，导致已经成功的构建或任务被误记失败。候选冻结与 SQLite 登记之间也存在中断窗口，原 proposal 没有持久记录。

## 当前协议

```text
提交原 proposal / 内容摘要
        │
        ▼
SQLite 预留一次候选预算 ──────────────────────────────┐
        │                                             │ 重启
        ▼                                             ▼
持久 publication intent → OS 写锁 → 复制并校验 → 原子 rename
        │                  │                           │
        │                  └─ 进程死亡由 OS 释放锁      │
        │                                              ▼
        └─ 同 intent 接续，已发布内容必须匹配 ──→ 发布登记
                                                       │
                                                       ▼
                            同一事务：候选入账 + 删除 pending
                                                       │
                                                       ▼
                                     原构建 / 原任务 / 原评分
```

- `freeze(source, destination, publicationRoot)` 要求调用方显式传入可信控制目录。本仓库统一使用所属实验的 `publications/`，控制文件不进入候选、构建或交付目录，不挂载到优化器或执行器。
- 目的地父目录解析为真实路径；每个目的地独立 SQLite 文件，使不同产物可以并行。同一目标必须始终使用同一控制目录，不能删除活跃数据库或通过另一目录绕开协调。
- intent 固定内容摘要和暂存路径；取得 `BEGIN IMMEDIATE` 后重新读取状态。活跃并发发布明确返回 SQLite busy，不按 PID、时间或目录年龄猜测接管。
- pending＋完整目的地存在：校验摘要后接续提交；pending＋目的地不存在：只重建该 intent 的暂存复制。published＋产物缺失或不符：明确失败，不重新生成掩盖损坏。
- 控制器启动接续持久候选提交，保留原 proposal、来源和预算。同身份请求重放返回原候选；同内容不同提交身份拒绝，不增加任务 attempt。
- `harness-evolution:publication` 原生 diagnostics channel 提供 reserved/copying/ready/published/committed 阶段、目的地及摘要。订阅者按 Node 原生规则同步执行；事件不包含文件正文，也不替代持久状态。

## 研究依据

| 一手资料 | 对设计的约束 |
|---|---|
| [Node 24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath) | rename API 未提供本项目所需的跨平台 no-replace 发布事务；仅靠检查后 rename 不能协调并发调用方 |
| [SQLite transactions](https://www.sqlite.org/lang_transaction.html) | BEGIN IMMEDIATE 立即取得写事务；并发写明确产生 SQLITE_BUSY，事务不跨异步过程自动提交 |
| [SQLite locking](https://www.sqlite.org/lockingv3.html) | 锁与进程、回滚日志分工；进程中断后重开数据库恢复事务，不需要应用猜测陈旧目录锁 |
| [Node 24 SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) | 使用项目已有的内置 DatabaseSync，显式零等待、事务状态和关闭，无新增原生锁依赖 |
| [Node diagnostics channel](https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html) | 同步观察发布边界，用于实际进程故障注入和运行诊断，不在生产逻辑设置测试专用降级路径 |

## 验收与边界

[机器证据与源码身份](../evidence/2026-10-28-publication-recovery.json)：最终工作树通过 67 项单元测试、10 项原生测试、16 项容器测试和 1 项实际安装包验收。源码、构建和交付三条恢复路径均保留原始进程终止记录与最终回执。独立只读复核通过。

五个阶段真实 SIGKILL 后，重新调用均完成同一 intent；活跃发布不能被第二进程抢占，另一个目标可以发布。原生容器验收分别在候选源码、成功构建输出和成功任务交付的复制中终止控制器，等待原控制器租约自然到期，再恢复：原 build/task 容器 ID 保持，attempt=0，评分完成，每题仍为原来的两次夹具模型请求。夹具驱动真实 DSH Agent Loop、工具和 Docker，不声称是真实模型质量实验。

首次新增测试的单任务 failureLimit 沿用两任务默认值，被合同解析拒绝；随后测试 fixture 缺少必需的 build 脚本，且 macOS 路径别名使阶段订阅未命中。均修正测试并保留原失败目录；没有修改生产合同放行，也没有重试真实模型任务。

本次证明 **进程崩溃恢复**，没有验证掉电、损坏磁盘、远程文件系统锁或跨主机协调。SQLite 控制状态、源目录与发布目录均属于可信宿主；候选容器无权修改。磁盘硬限额及 MicroVM 仍按独立交付缺口推进。
