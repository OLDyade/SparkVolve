# 原生启动与变异方法对照：设计依据

核查日期：2026-10-29。保留项目核心思想：插件是进化对象，进化能力通过原生 DSH 插件装配，有效成果交付为可安装 Bundle。

| 来源 | 采用的设计 | 本次落地 |
|---|---|---|
| [DSH](https://github.com/deepseek-ai/deepseek-harness/tree/f3803c96974ad4a94195fb97e5c637e9c2a3afe3) | 原生服务、systemPrompt、工具与插件开发能力；通过已有运行底座装配 | 启动器只编排已有 CLI；所有组共享原生 prompt 槽，不新建 Agent Loop |
| [GEPA](https://github.com/gepa-ai/gepa/tree/80a62c879ecdeb8741faac72a844dceb1c18691f) 与 [ICLR 2026 论文](https://arxiv.org/abs/2507.19457) | 从实际执行轨迹获得反馈，评估优化对象的变化；提示词是可研究的一种搜索空间 | 保持同一 G 与反馈，增加 prompt-only 对照；并未运行 GEPA 算法，不能称胜过 GEPA |
| [AutoSaddler](https://github.com/microsoft/AutoSaddler/tree/e841543ce6cf6bdf690e65134b12a829ec9f66d1) | 场景适配与候选产物边界，区分可运行演示和方法收益 | recipe 替换任务；正式对照冻结 G/H0 和数据，独立验证；不迁移其他项目的成绩 |
| [DeepSeek 官方 Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api) | 官方 Messages 接口和原生工具调用 | 默认官方 DeepSeek；模型与 Provider 成对接入，凭证由可信代理持有 |
| [Docker FROM 规范](https://docs.docker.com/reference/dockerfile/#from) | 构建引用为镜像名/标签/分发摘要；本地内容 ID 与仓库摘要语法有区别 | 内容对应的本地镜像名用于领域构建，实际执行仍冻结内容 ID |

GitHub 实查：DSH 264,887 stars，GEPA 7,185 stars，AutoSaddler 245 stars。数量是当日社区规模信号；AutoSaddler 的工程设计相关，但不能描述为高星项目。这些数字不作为采用机制的效果证据。运行版本继续固定 DSH 0.2.1-rc.4 / Cordis 4.0.5，主干更新不直接热替换实验依赖。

X 检索也出现了关于自进化与持续学习稳定性的[讨论线索](https://x.com/haginota/status/2114956574896840719)，以及从事 harness optimization 研究者的[公开交流](https://x.com/sunghopark20124/status/2115462880745423107)。前者互动很低，后者讨论方向但没有实验结论；本轮没有据此新增算法或宣称效果。关键词 GEPA 还混入同名环保机构结果，已排除。

本次实质增量是两项：**让真实运行可直接启动；让插件级变异优势成为能被对照检验的问题。** 单次高分、代码能构建、热门讨论都不能替代后者。主指标继续正确率导向，未擅自加入速度或保留率晋级硬门。

实际[三组结果](../experiments/2026-10-29-mutation-space-results.md)已完成。运行暴露了自由文本中的 `{{…}}` 被 DSH 当作模板变量的问题；随后通过 Context7 官方文档与安装版类型、实现交叉核实：段声明 `interpolate: false` 会原样保留文本。已修正后续种子并增加真实原生渲染测试，冻结实验不热改、不重跑。该修正没有新增模型收益证据。
