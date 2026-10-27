# 事件、等待与恢复

```text
候选 / 任务状态变更
        │ 同一 SQLite 事务
        ▼
持久事件 seq ── COMMIT ──→ 唤醒等待者
        │                    │
        └─ 按游标读原始事件 ←──┘
                 │
       原生 evolution_wait 返回
                 │
       DSH 下一次模型请求 → 归因与变异

连接中断 → 保留游标 → 重连补读
控制器中断 → 重启原实验 → 收集原容器 → 继续记账
```

`evolution_status` 同时返回状态和 `cursor: { experimentId, sequence }`。将这两个字段传给 `evolution_wait`，它调用带 capability 的 `POST /events`，最长等待 30 秒。收到事件后保存返回游标；`hasMore=true` 时继续读取剩余页。没有事件时返回空页及原游标。

事件页最多 100 条，游标停在实际返回的最后一条。错误实验 ID、超前游标直接报错。取消等待、连接断开和等待超时均不会取消任务、复制 attempt 或触发重试。请求失败后保留最后成功接收的游标，恢复连接时重放；客户端重复接收时按 `(experimentId, sequence)` 去重。协议不承诺一次且仅一次的网络投递。

状态和事件在事务提交后才可见；回滚不通知。订阅后重新读取事件，覆盖“查状态后、开始等待前”发生的变更。内存通知用于降低延迟，SQLite 才是权威；每次有界等待结束再次读取日志，覆盖其他连接提交等情况。实验只有一个持租约的控制器写入。

`serve` 和 `evolve` 空闲时等待事件；正在运行时等待原容器的真实结果。优化器会话结束后，宿主接续器通过同一事件 API 等待未决候选，结论或预算触发下一次决定。基础设施错误仍向上抛出，原运行资料保留。

独立部署需区分宿主地址与容器地址：

```sh
harness-evolve serve --root ./experiment --host 0.0.0.0 --port 8787
harness-evolve optimize --root ./experiment \
  --control-endpoint http://127.0.0.1:8787 \
  --endpoint "http://${HE_CONTROLLER_IP}:8787"
```

`control-endpoint` 供宿主接续器访问，`endpoint` 写入优化器容器的 Preset。地址应与实际部署网络匹配。`evolve` 自动从监听地址构造宿主入口，仍由用户提供容器入口。

真实模型生命周期验收显式运行，不进入默认离线测试：

```sh
HE_TEST_IMAGE=sha256:<运行镜像摘要> node --env-file=/安全目录/venus.env \
  --import tsx --test tests/live/events.test.ts
```

此验收要求模型实际等待、收到宿主随机 nonce 并写入结束原因；不提交变异、不执行测评题、不声称质量提高。
