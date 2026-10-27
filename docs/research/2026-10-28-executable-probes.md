# 从机制叙述到原生可执行实验

## 问题证据

最近两次真实搜索能够新增工具，但缺少对新增算法的反例实验。结构化数据候选留下最大修订去重顺序、十进制舍入和缺省参数三个实际错误；原优化器还对未确认的超时原因作出解释。原源码、成绩和归因纠正均保留于 [第二领域验收](../acceptance-structured-data.md)。这支持补实验能力，尚不能证明补充后必然提分。

## 当前一手实现

| 来源与固定版本 | 核实的机制 | 本仓库采用范围 |
|---|---|---|
| [VERSE probes.py](https://github.com/wzekai/VERSE/blob/d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9/verse/evolution/probes.py) | 提供 replay、ablate、substitute、fix_probe；实验有次数与时间预算，证据绑定具体修改；复现轨迹本身不等于原因证明 | 借鉴可执行实验、独立预算和内容身份。此次没有复制任务重放、评分器访问或其 refutation gate |
| [AutoSaddler causal diagnosis](https://github.com/microsoft/AutoSaddler/blob/e841543ce6cf6bdf690e65134b12a829ec9f66d1/src/autosaddler/v2/prompting/methodology/skills/causal-diagnosis/SKILL.md) | 从可见输入、首个分歧、实现路径定位原因，并说明评测前如何检验干预 | 将机制假设与实际工具/服务观察连接，保留归因不确定性；不预写成功变异或固定只改一个插件 |
| [DSH tools 当前文档](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/tools/README.md) | 当前接口支持完整原始调用批次；无模型步日志的程序调用仍可拥有 Agent 作用域 | **安装版本是 `0.2.1-rc.4`**，实际声明使用单次 `ToolExecutionInput`。按已安装实现传 `callId/name/arguments/agent/signal`，不照搬最新批次接口 |

Context7 于 2026-10-28 检索 `/deepseek-ai/deepseek-harness`，随后核对安装包 `@deepseek-ai/dsh-tools`、Cordis 4.0.5 声明与代码。Cordis 动态读取服务使用 `ctx.get(name)`；未经 inject 的属性访问在原生验收中实际报错，已修正测试用法。

X 检索覆盖 2026-09-01 至 2026-10-28，关键词 AutoSaddler、Verified Self-Evolving、wzekai/VERSE。[Python Hub 的 AutoSaddler 介绍](https://x.com/PythonHub/status/2097931902594265474)检索时约 90 赞、12 转、1 万浏览，说明存在社区关注；[Sungho Park 的后续方向](https://x.com/sunghopark20124/status/2107493614364631136)提出随能力变化调整改进目标。两者仅作实践线索，热度不作为机制有效性或本仓库收益证据；当前任务集继续遵循预注册合同。

## 实现选择

以独立原生行为实验连接“诊断→变异”：优化器自行编写 JS 测试，实际加载草稿构建包、原生 Profile 和环境，观察服务与真实工具流水线。实验控制沿用现有单写租约、构建、Docker 隔离、持久事件与原容器接续，不增加第二套 Agent Loop。实验 API 不提供任务重跑或评分器入口。

与原生装配 QA 分工：QA 验证冻结候选能否装配，行为探针检验优化器主动提出的具体机制假设。没有为提高测试通过率添加自动修改、异常吞掉或分数门。

## 验收留痕

- 单测覆盖快照身份、预算、重复拒绝、原容器接续、准备快照与数据库登记间中断、失败不影响候选/分数。
- 原生 SDK 检查实际服务读取、工具错误结果和断言失败；真实容器检查服务→工具组合、参数校验、错误算法反例、缺失服务、挂载及凭证边界。
- 第一次容器命令错误使用 Docker config digest，daemon 明确报镜像不存在；保留 `/tmp/he-native-probes-gK5WBZ` 对应系统临时目录证据，改用 `docker image inspect` 实际返回的镜像 ID 后运行。该错误没有启动模型任务。
- 第一轮真实模型验收保留于 `he-live-probes-2iMUFS`：模型自行提出距离对称性，并通过原生调用观察到 `3/-3`；测试误用作者侧目录，写文件 ENOENT 先于断言，故验收失败。原优化器结论说明此限制，没有把断言写成已执行。
- 因此更新通用接口：明确作者/执行目录映射并向测试传实际 `workspace`。修改后另立运行身份验证，不覆盖原失败记录，不并入研究分数。

修改后的真实模型验收 `he-live-probes-hUD8Bp` 通过：模型自主推导距离非负性，通过原生工具观察 `d(3,2)=-1`，以预期 `1` 触发断言并读取原始证据。Probe 正确记为失败，协议集成验收通过；没有候选提交、任务执行或研究分数。两次原始运行已归档到本地 `.evolution/behavioral-probes-20261028`。

| 验收 | 结果与用量 |
|---|---|
| 首次真实模型 / 路径错误 | 未通过；10 started / 10 result；输入 20,477、输出 2,416 tokens |
| 改进接口后真实模型 | 通过；11 started / 11 result；输入 21,839、输出 2,497 tokens；原生断言反例完整保留 |
| 最终回归 | 36 单测、8 原生测试、7 个 runc 容器测试及一次干净分发安装测试全部通过 |
| 独立复核 | 子代理指出快照完成至数据库登记间的中断窗口；增加先持久意图与快照身份恢复，3 项定向测试通过，最终复核无必修项 |

调用单位是 DSH adapter stream attempt，网关内部 HTTP 重试不可观测。两次均无 unfinished/missing usage；费用未知。机器证据见 [2026-10-28-behavioral-probes.json](../evidence/2026-10-28-behavioral-probes.json)。完整项目的独立收益、联合拓扑变异及隔离剩余目标保持在 [completion.md](../completion.md)。
