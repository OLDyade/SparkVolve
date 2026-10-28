# 官方 DeepSeek：传输定位、原生协议与语义修正

按用户授权，新增官方 DeepSeek 提供方。没有备用服务、响应修补或自动重试。原 Venus 失败产物保留，后续实验使用新目录和新合同。

## 传输层事实

旧 Venus 优化器请求约 70ms 完成 TCP，212ms 完成授权 TLS 和请求写入，301132ms 才返回 HTTP 200，随后结束而缺少 `finish_reason`。另一个任务在 TLS 阶段 `ECONNRESET`，由本地 broker 返回 502。600 秒任务截止尚未触发；已有日志不能定位远端具体故障组件，不能声称所有链路问题都已修复。

2026-10-28 对官方地址进行无重试实测：

| 路径 | 实际观测 |
| --- | --- |
| `/models` | HTTP 200，返回 `deepseek-flash`，显示名 DeepSeek-V4.1-Flash |
| 原生 Messages 第一次 | HTTP 200，约 693ms，实际返回加法工具调用，收到 `message_stop` |
| 原生 Messages 工具结果续接 | HTTP 200，约 677ms，返回 95 并正常结束 |
| Chat Completions | HTTP 200，约 1456ms，`finish_reason=stop`、`[DONE]` 均存在 |

这些测试证明官方入口当时可用，不能反推旧网关故障根因，也不构成长期服务可靠性保证。

## 原生接入与合同

- 锁定 `@deepseek-ai/dsh-llm-deepseek-api-key@0.2.1-rc.4`，使用原生 `deepseek-official` 服务及 Messages 流处理，保留 DSH Agent Loop、工具执行与上下文投影。
- SDK Profile 的连接插件 ID 是 `llm-deepseek`。环境 patch 显式声明模型目录、off 推理、32768 输出预算、600000ms 流空闲限制和零自动重试。执行与优化使用同一官方模型合同。
- 官方 `/models` 当日目录声明上下文 1048576、最大输出 393216、text/image 输入，system 更新为 in-history、工具更新为 addition-only。服务端提供模型别名，冻结客户端目录不等于冻结远端权重。
- `forwardHeaders` 作为受控出口合同的一部分，仅转发声明的非认证协议头；禁止覆盖凭证、Host、传输与长度字段，禁止重复名称。真实 key 由可信 broker 注入，工作进程只持有占位值。
- 官方明确 `anthropic-version` 当前忽略，`anthropic-beta` 除 Files API 图片场景外忽略。保留这些头属于原生请求合同完整性，未被认定为旧故障修复原因。
- 场景准备器接收显式 provider 目录。研究者提供的 `egress.mjs` 属于可信配置代码，冻结后装配；没有按名称猜测提供方、自动切换或向后兼容分支。

实际 DSH adapter → 真实 broker → Messages HTTP fixture 已覆盖两次请求、原生工具执行、结果续接、认证注入与协议头。该确定性测试与真实官方调用分开记账。

## 语义错误与归因边界

首轮官方实验的两个自主候选引入自写公式解释器。独立合成工作簿与实际 LibreOffice 对照证实 ROUND、IF 未选分支、跨表范围及幂运算四类差异；两个简单算术控制通过。基线没有该解释器，不适用这些反例。原失败报告中基线的 `resolve` 缺失只是探测接口不适用，不计作基线算法错误。

候选 1 的两次工具参数生成以 `MALFORMED_RESPONSE` 结束，用量不可用；未使用 JSON 修复。嵌套 schema 与故障同时出现，缺少受控比较，不能宣布嵌套是已证实原因。候选 2 完成四题，但错误解释器仍在。优化器随后留下的新草稿也保留该解释器，未作为合格能力发布。

新一轮采用冻结的[开发证据简报](../experiments/2026-10-28-native-semantics-brief.md)。它只提供合成反例、工具声明边界及已核生态资料，不包含验证答案。优化器自主选择工具、接口及实现；要求计算遵循原生引擎，不接受启发式公式改写和以自填预期证明业务正确。任务与评分合同独立不变。

## 安装辅助进程的 HOME 生命周期

首次安装后业务验收的四个安装容器都在创建阶段失败：原辅助进程把 `/workspace` 绑定为只读，runc 无法为独立 HOME tmpfs 建立 `.harness-home` 挂载点，模型任务执行次数为零。该失败完整保留。

安装和完整性核验现在各自使用独立临时工作目录，交付目录不挂入辅助进程；Profile、原归档及文件摘要检查保持。其他构建、QA、评分与导出安装路径已逐项检查其工作区挂载。修正通过新安装验收验证，不放宽原归档和实际交付的读写边界。

## 官方资料

- [DeepSeek 模型目录](https://api-docs.deepseek.com/api/list-models/)、[原生 Messages 兼容](https://api-docs.deepseek.com/guides/anthropic_api/)、[Thinking 与工具调用](https://api-docs.deepseek.com/guides/thinking_mode/)
- [DSH 上游源码快照](https://github.com/deepseek-ai/deepseek-harness/tree/00d541438b9beabb4d876a14371aea69f58c397a/packages/llm)：调研时已有 0.2.2-alpha.2，本实验继续锁定实际验证的 0.2.1-rc.4，没有在途升级
- [LibreOffice 参数与独立用户目录](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html)、[openpyxl 不计算公式](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html)、[Excel ROUND](https://support.microsoft.com/en-us/excel/functions/round-function)

GitHub 与 X 的相关搜索未取得足以定位此次网关故障的公开事件证据；讨论热度不计作修复或性能证明。
