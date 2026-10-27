# 真实模型元优化实验：终态与机制复核

本次真实模型实验完成了“元优化器修改优化器插件 → 两种优化方法分别搜索 Harness → 独立评估 → 选择方法 → 最终验证”的闭环。G0 与 G1 开发评估均为 **1.0**，同分保留 G0；G0 最终验证为 **1.0**。本轮没有证明优化方法带来质量提升。

实验状态为 `complete`；原验收驱动随后发生报告处理异常，原 `acceptance.json` 保留 `passed: false`。后续独立安装验收已完成：G1、G0、H0 的原 tarball 均成功安装并通过 DSH 原生装配检查，`inferenceRequested: false`。安装证明不改变 G1 的机制审查结论，也不代表该方法获得推荐或质量认证。

机器证据：[2026-10-28-optimizer-study.json](../evidence/2026-10-28-optimizer-study.json)。本报告保留失败证据，不修改冻结候选、不运行新模型、不读取封存任务内容或私有评分答案。

## 实际运行了什么

```text
真实模型元优化器（DSH 原生 Agent）
  │ 读取获准的开发证据，分叉 G0，编写并冻结 G1 插件代码
  ├── G0：systemPrompt 插件
  │     └── 独立开发搜索：H0 → H1 → 同分保留 H0 → 独立开发评估 1.0
  └── G1：systemPrompt + tools/fs 依赖 + observer + data_self_check
        └── 独立开发搜索：H0 → H1 → 同分保留 H0 → 独立开发评估 1.0
                            │
                     方法同分，选择 G0
                            │
                 注册的最终验证搜索与独立评估
                            │
                    1.0 / study complete
                            │
                 原驱动报告读取异常，验收失败
                            │
                 单独安装验收通过，不重跑模型实验
```

执行模型为 Venus `deepseek/deepseek-v4.1-flash-1017`，`reasoningEffort: off`、`maxTokens: 32768`。运行镜像为 `sha256:919839c0bf86ad018af4305b6a04af60ccb692ee341d3e2e1fcb53d1e6b6badc`。本次指标是合成结构化数据任务的 `structured_output_accuracy`，不能外推为商业 Excel 官方 Modif、星火适配收益或跨领域收益。

| 层级 | 方法 | 完整分母 | 均值 | 失败 | 结论 |
|---|---|---:|---:|---:|---|
| 开发方法评估 | G0 | 1 个搜索实例 / 1 次重复 | 1.0 | 0 | 保留 |
| 开发方法评估 | G1 | 1 个搜索实例 / 1 次重复 | 1.0 | 0 | 同分，未替换 G0 |
| 最终独立验证 | G0 | 1 个搜索实例 / 1 次重复 | 1.0 | 0 | 验证完成 |
| 最终独立验证 | G1 | 未执行 | — | — | 无最终验证结论 |

两组开发搜索各冻结并评估了 H0 与一个新 H 候选；新候选均为 1.0，未超过 H0。G1 开发搜索还提交了两个作者探针，两者均失败。作者探针的状态与独立任务评分分别保留。

## 自主变异证据及其边界

元优化器实际把 G0 的 25 行 `index.mjs` 改为 G1 的 359 行实现，新增 `defineTool`、`tools` / `fs` 注入、`tools/result` 观察器和 `data_self_check` 工具。冻结源码、构建身份、原生模型请求均可对应；这支持“模型自主修改了优化器插件实现并实际加载”的结论。

`plugins.yml` 仍是同一个 `evolution-research-method → ./index.mjs` 装配入口。新增依赖和工具面属于真实实现变化，本轮没有展示插件组合拓扑变化。方法身份、源码摘要与构建摘要详见机器证据。

以下路径均相对实验根 `.evolution/optimizer-study-live-contract-corrected-20261028/`：

- G0 源码：`study/inputs/bundles/g0/source/`。
- G1 源码：`study/methods/sources/e7ce41101edafc1147623fad26a7eb84c269d8eace5acc5c0a31a5abc2743570/`，下文简称 **G1 source**。
- 元优化器轨迹：`study/meta-optimizer/0/trace/notifications.jsonl`，下文简称 **meta trace**。
- G1 开发优化器轨迹：`study/children/acdc3e93d1731e5a44dd685dc9e6a56029b6576bec5fe73dd4c337bb2baec191/optimizer/0/trace/`，下文简称 **G1 trace**。

### 终态工具使用

G1 trace 的 `requests.jsonl:1` 中，首个真实模型请求包含 `data_self_check` schema，证明它已注册并对模型可见。完整 `notifications.jsonl` 中，按原生 `tool/call` 事件计数，**`data_self_check` 调用为 0**；工具名称出现在源码、提示和 Bash 内嵌文本中，均不算原生调用。G1 开发优化器共调用 77 次工具，并完成提交与结束流程。

因此，本次没有“该工具在真实搜索中发现或阻止错误”的执行证据。也不能仅因没有提分而否认代码变异确实发生。

## 机制审查发现

| 发现 | 可复核证据 | 影响与界限 |
|---|---|---|
| G1 把元研究角色指令装入子优化器 | G1 source `index.mjs:348–356`；G1 trace `requests.jsonl:1` | 提示要求 `optimizer_study_*`，实际子优化器只有 `evolution_*` 等工具。子优化器仍使用真实可用工具完成搜索，未观察到因该错位停机。 |
| 观察器作用域与提案不符 | G1 source `index.mjs:112–131` | `ctx.on('tools/result')` 监听当前 G Agent 工具结果；H 在独立任务进程运行，代码没有读取 H 轨迹的桥接。不能声称捕获了“内层 Harness 实际读取的原始内容”。 |
| 读写识别和缓存不能支撑“精确原文”承诺 | G1 source `index.mjs:39,106–131,303–318` | 读取匹配规则漏掉原生 `read`，却匹配 `data_write`；缓存取的是渲染后的 `result.content`。`pendingWrite` 没有驱动缓存失效或重读。这些是静态机制缺陷；本次没有真实 self-check 调用，不能伪称已经触发相应业务错误。 |
| 提案对 G0 证据的描述有误 | G1 source `index.mjs:10–14`；meta trace `:547`；G0 开发任务 `e987faad…/trace/notifications.jsonl:19` | G0 实际通过 Bash/Python 写了 `/workspace/result.json`。没有特定 `data_write` 工具事件不能推导出没有文件写入。 |
| 局部错误被吞掉，语义回退未经证明 | G1 source `index.mjs:79–98,129–131,220–228,337–341` | 注册异常只记录后继续；观察异常被吞掉；JSON 解析失败后转为逐行解析并丢弃坏行，后续重算未将 `badLines` 纳入失败检查。不符合项目明确暴露错误的准则。实际本轮工具注册成功。 |

作用域判断同时核对了本次安装的 DSH 工具实现：`node_modules/@deepseek-ai/dsh-tools/lib/index.js:3511–3516` 使用 `scopeTarget(this, exec.agent)` 派发结果；运行时审阅的项目源码 `src/preset.ts:15–27` 和 `src/optimizer.ts:113–119` 将方法安装在优化器作用域。这些行号对应上述 `919839c0…` 运行镜像使用的实现及当时源码，不代表后续工作树状态，也不作为未来版本 API 保证。

G1 的 `writeTo` 由调用者显式提供，代码没有发现自动生成任务答案或自动修复工作簿的路径。工具检查结果与显式写入没有构成强制保存门。提案声称“缺少 tools 则跳过注册”，但代码把 `tools` 声明为必需依赖；不能把提案文字当作 Cordis 实际生命周期。

### 原生验收与局部 mock 的区别

meta trace `:331` 的局部 smoke 构造了假的 `ctx`、`fs`、注册器，并手动发出 `data_read` 事件。它支持局部函数接口可调用，无法证明真实 G/H 跨进程观察或原生文件系统行为。候选构建和装载通过，以及模型请求确实含工具 schema，同样没有验证该观察器宣称的跨层机制。

### 分叉工具回执缺口

冻结运行中，meta trace `:215–216` 的 `optimizer_study_branch` 成功返回空文本。该次运行构建所对应的旧源码 `src/optimizer-study.ts:375–447` 返回 `Promise<void>`，API 对 `undefined` 序列化产生空响应，工具原样呈现空文本。它没有返回精确草稿路径、父身份和目标运行角色。此项描述被冻结轨迹和旧构建约束；当前工作树正在另行修正回执，不能把旧行号当作当前接口。

同一轨迹 `:229–230` 随后读取 `/workspace/g1-self-check/index.mjs`，内容是正确的 G0 子优化器源码；分叉实现也核验父源码摘要后复制。**未发现复制错父版本的证据。** 元优化器此前读过 `/method` 的元研究源码，随后写入角色错位指令；空回执与模型后续行为都应记录，不能声称空回执是唯一原因。后续应通过结构化分叉回执和真实作用域验收补齐接口，保持本轮冻结证据不变。

## 模型调用与成本

| 层级 | started / result | 输入 Token | 输出 Token | 请求时长之和 ms |
|---|---:|---:|---:|---:|
| 元优化器 | 112 / 112 | 151,182 | 29,294 | 322,597 |
| 三个子搜索合计（含最终验证搜索） | 203 / 203 | 343,802 | 61,974 | 584,039 |
| 三次独立评估合计 | 10 / 10 | 10,252 | 1,995 | 19,252 |
| **合计** | **325 / 325** | **505,236** | **93,263** | **925,888** |

计数单位为 **DSH adapter stream attempts**；提供商内部 HTTP 重试不可见。13 份账本汇总完整，`failed / unfinished / missingUsage` 均为 0；这描述记账闭合，不认证方法正确。请求时长是流时长求和，不能充当墙钟耗时；费用未知，构建、QA、评分器资源不计作模型 Token。

审查独立重算了元优化器及两组开发搜索的 7 份公开账本：275 started / 275 result、430,199 输入 / 78,867 输出 Token、793,563 ms，起止 ID 对齐。其余 50 次通过权威报告中的最终验证搜索和独立评估汇总交叉核对，未打开封存阶段的原始任务或请求材料。

## 验收状态与下一项工作

权威实验报告终态时间为 `2026-10-27T20:44:38.352Z`。原驱动于 `2026-10-27T20:44:39.108Z` 记录失败：`Cannot read properties of undefined (reading 'phase')`，位置为原驱动 `scripts/verify-optimizer-study.mjs:558:31`，其回执记录的驱动 SHA-256 为 `f1ca54d30799cf626f8e7cc2f43ab3dc87f84130e3d252fa13ee8cddccd6bc7c`。控制器命令记录覆盖了驱动中的报告值；这是实验完成之后的验收编排故障，行号对应该旧驱动。

后续单独验收 `.evolution/optimizer-study-completed-verification-20261028/acceptance.json` 也记录 `passed: false`；安装阶段 `installation/g1/execution/stderr.log:5` 明确报 `no adapter registered for provider "venus"`。该驱动选用了 `sdk-minimal`，未复用注册运行环境，不能据此认定冻结插件包自身错误。两个失败回执均保留。

纠正 profile 的后处理 `.evolution/optimizer-study-completed-verification-profile-corrected-20261028/acceptance.json` 已在 `2026-10-27T20:50:32.731Z` 完成，`passed: true`，SHA-256 为 `57348efdf48f6255b184bc7fe498a2e700580aaa03bd2e10b7663c2f7b5cd8b8`。G1、G0、H0 三项均为 `installed: true`、`nativeComposition: true`、`inferenceRequested: false`；各自 tarball 摘要与原冻结产物一致。该验收没有重做模型推理、验证工具业务效果或推翻 G1 未被选择的结果。

三项安装均使用原注册的 `sdk` profile。执行记录显示 `/environment` 只读挂载注册环境：G1/G0 来自开发搜索环境，H0 来自最终评估运行环境。复核只检查运行配置和挂载身份，没有读取最终评估任务内容。五个保留文件的 SHA-256 与原实验一致，包括原失败回执、权威报告、注册和研究数据库。

安装所需的框架支持包单独记账：它来自首次后处理的 `optimizer-study-completed-verification-20261028/framework/package.tgz`，实际 SHA-256 为 `f6663fab04188d4a6f270d75288c4b19857b8619d90d367ab197a1b7570ace89`。它用于此次独立安装验收，与原实验镜像内框架包身份不能混同。G1/G0/H0 使用的仍是各自原冻结 tarball；原实验结果和调用账本没有被安装后处理改写。

当前可成立的结论是：真实自主代码变异和方法比较闭环已发生，独立选择没有接受同分变异；本次 G1 机制存在具体缺陷，未取得质量收益证据。后续研究需要具备区分度的注册任务与重复实验，同时验证新增能力真实调用、作用域和原字节来源。

## 证据身份

所有完整身份和 SHA-256 见配套 JSON。权威报告 SHA-256 为 `d4c3c094266f2c09260a28002666236efb63a1c76f18c4e249562e579a4f653b`；原失败回执为 `7f97d6e2f8bfe68f51b1ffe8b3cccfbe13cd20a00df0bc0416815abbe3431d77`。报告仅提取公开源码、开发轨迹和获准的聚合结果，不公开密钥、完整模型提示、封存输入或评分答案。
