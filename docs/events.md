# 事件、等待与恢复

```text
候选 / 任务状态变更
        │ 同一 SQLite 事务
        ▼
持久原始事件 ── COMMIT ──→ 唤醒等待者
        │                    │
        └─ 宿主反馈视图投影 ←─┘
                 │ 连续视图游标
       原生 evolution_wait 返回
                 │
       DSH 下一次模型请求 → 归因与变异

连接中断 → 保留游标 → 重连补读
控制器中断 → 重启原实验 → 收集原容器 → 继续记账
```

`evolution_status` 同时返回状态和 `cursor: { experimentId, viewDigest, sequence }`。将三个字段完整传给 `evolution_wait`，它调用带 capability 的 `POST /events`，最长等待 30 秒。收到事件后保存返回游标；`hasMore=true` 时继续读取剩余页。没有可见事件时返回空页及原游标。

事件页最多 100 条，游标停在实际返回的最后一条。错误实验 ID、错误视图身份和超前游标直接报错。取消等待、连接断开和等待超时均不会取消任务、复制 attempt 或触发重试。请求失败后保留最后成功接收的游标，恢复连接时重放；客户端重复接收时按 `(experimentId, viewDigest, sequence)` 去重。协议不承诺一次且仅一次的网络投递。

宿主原始事件继续完整保存。模型游标绑定冻结的[反馈协议](feedback-views.md)，机械视图过滤评分与任务结果后重新连续编号，隐藏事件不推进模型游标。只读 `events` CLI 使用宿主原始游标；不要把它传入模型工具。

状态和事件在事务提交后才可见；回滚不通知。订阅后重新读取事件，覆盖“查状态后、开始等待前”发生的变更。内存通知用于降低延迟，SQLite 才是权威；每次有界等待结束再次读取日志，覆盖其他连接提交等情况。实验只有一个持租约的控制器写入。

`serve` 和 `evolve` 空闲时等待事件；正在运行时等待原容器的真实结果。优化器会话结束后，可信宿主接续器直接通过本地只读 Store 等待未决候选，并定期核实其他连接的已提交状态。它不依赖被裁剪的模型 API 判断评分或预算。基础设施错误仍向上抛出，原运行资料保留。

独立部署需区分宿主地址与容器地址：

```sh
harness-evolve serve --root ./experiment --host 0.0.0.0 --port 8787
harness-evolve optimize --root ./experiment \
  --endpoint "http://${HE_CONTROLLER_IP}:8787"
```

`endpoint` 写入优化器容器的 Preset，地址须与实际部署网络匹配。宿主接续器直接读取同一 `root` 的账本；`optimize` 不再接受 `--control-endpoint`。`evolve` 自动管理控制服务，仍由用户提供容器可达入口。

真实模型生命周期验收显式运行，不进入默认离线测试：

```sh
HE_TEST_IMAGE=sha256:<运行镜像摘要> node --env-file=/安全目录/venus.env \
  --import tsx --test tests/live/events.test.ts
```

此验收要求模型实际等待、收到宿主随机 nonce 并写入结束原因；不提交变异、不执行测评题、不声称质量提高。
