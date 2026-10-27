# 持久事件驱动接续：查证与验收

## 已核来源

- [Node 24 events](https://nodejs.org/docs/latest-v24.x/api/events.html)：监听器同步执行；依次等待 `events.once` 可能错过连续事件。因此采用数据库序号补读、提交后通知、订阅后复查。
- [Node 24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html)：`ServerResponse.close` 覆盖正常完成及连接提前终止；`server.close` 不立即终止所有活动请求。因此请求断开解除等待，服务停机显式传递 AbortSignal。
- 本项目实际 DSH `0.2.1-rc.4` 的工具注册、执行与会话循环未替换。`evolution_wait` 通过已有 Cordis `tools` 服务注册，返回内容随原生工具结果进入下一模型请求。

## 改动与证据

SQLite 事件包含实验 ID 对应的递增序号；HTTP 长轮询每页最多 100 条、最长 30 秒。优化器宿主通过控制 API 等待，容器访问地址独立声明。控制器空闲等待持久事件，不再执行 250/500/1000 毫秒状态轮询。QA 失败状态与通知改为同事务提交。

- 22 项单元与 8 项原生测试通过；包含 205 事件分页、回滚、错误游标、跨连接提交、重启、HTTP 重放和取消。
- 控制器在等待中接收新候选，自动构建、执行、评分并裁决；取消等待后再次 pump 没有增加执行次数。
- 3 项真实容器测试通过。运行镜像：`sha256:247237d62c837ad39a80959ce8ca2986e278222d6ee7adab39adc92ce4bd5011`。
- 确定性 Provider 仅驱动协议；真实原生优化器容器执行 status → wait → finish，宿主提交 `acceptance.wakeup`，第四次模型请求前完成接续。原生调用一共四次模型请求、一次等待请求。
- [真实模型验收](../evidence/2026-10-27-event-acceptance.json)：Venus DeepSeek V4.1 Flash 1017、thinking off；1 会话、1 次等待、4 次模型请求均成功，容器 7.024 秒。结束原因准确包含宿主随机 nonce；输入 10,265 / 输出 561 tokens，0 候选、0 测评题。此为生命周期证据，不能当作质量收益。

事件恢复重放与任务恢复分开：前者补读通知，后者沿原容器身份收集结果；两者均不允许据此重抽任务。跨进程通知延迟最多一个长轮询周期。研究收益与全项目其他缺口继续见完成账本。
