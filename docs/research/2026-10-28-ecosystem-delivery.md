# 从研究结果到可使用能力：新近生态核查

核查日期：2026-10-28。范围为两项与当前交付直接相关的实现；项目核心思想、宣传定位及 `11.md` 保持不动。

## 借鉴实际机制

| 项目与固定版本 | 已核实现 | 本项目的决定 |
|---|---|---|
| [Hermit](https://github.com/Infini-AI-Lab/hermit/tree/6957141db1bda07877e0b989bea375eaf9b7cec2) | [能力卡](https://github.com/Infini-AI-Lab/hermit/blob/6957141db1bda07877e0b989bea375eaf9b7cec2/hermit/trainer/card.py#L8-L41)从运行记录列出来源、训练、评价与使用范围 | 将可读能力卡与机器研究档案一起交付；放在已冻结 Bundle 旁，不重新打包改变被验收的能力 |
| Hermit 同一版本 | [Evolver 接口](https://github.com/Infini-AI-Lab/hermit/blob/6957141db1bda07877e0b989bea375eaf9b7cec2/hermit/evolver/base.py#L56-L114)表达工作区、工具、取消、会话恢复及结果 | 原生 G/DSH 已具备对应入口，继续采用现有运行时；不增加并行 Trainer 或外层适配器系统 |
| [ActiveSaddler](https://github.com/microsoft/AutoSaddler/tree/30f6e53e44d844c6adedad9cbcb03f26bead11fa) | [课程选择](https://github.com/microsoft/AutoSaddler/blob/30f6e53e44d844c6adedad9cbcb03f26bead11fa/src/autosaddler/v2/core/curriculum.py#L406-L416)记录训练案例支持集与本轮优先级；[配置](https://github.com/microsoft/AutoSaddler/blob/30f6e53e44d844c6adedad9cbcb03f26bead11fa/configs/v2/meta_are_activesaddler_full.yaml#L63-L89)分别声明选择、接受、评价与预算 | 后续可作为原生 G 的研究方法插件，选择诊断对象；正式完整题集和最终评价继续由合同固定。本次反馈对照不同时加入课程机制 |

ActiveSaddler 上述代码位于 `feat/activesaddler` 分支；核查时 AutoSaddler main 为 `e841543ce6cf6bdf690e65134b12a829ec9f66d1`。不能将研究分支写成主线已发布能力。

不照搬 Hermit 的有损输出选项和缺失费用默认值；本项目继续保留原始证据、未知用量和未知费用。ActiveSaddler 的[决策失败默认分支](https://github.com/microsoft/AutoSaddler/blob/30f6e53e44d844c6adedad9cbcb03f26bead11fa/src/autosaddler/v2/core/curriculum.py#L557-L565)也不移植，失败须保留并暴露。

## 能力卡的交付约定

能力卡由真实导出记录确定性生成，帮助安装者直接回答：这个包来自哪里、在什么合同中运行、实际测了什么、还有哪些边界。模型生成的用途或假设保持来源标注，不转述为已验证功能。

- 绑定源码、构建、依赖锁和原始 tarball；不改变能力包字节。
- 保留任务完整分母、失败及当前实验用途；搜索成绩不自动变为独立验证或安装推荐。
- 原始调用账本缺失时显示未知；整个搜索的优化器成本不冒充单个能力的推理成本。
- 构建失败候选仍可交付研究档案，但不能展示不存在的可安装包。
- 模型文本按数据呈现；不允许其破坏卡片结构或成为执行指令。

卡片属于开发者交付，不构成新的质量门槛，不改变版本选择策略。其实现和验收单独记录。

## 社区信号与研究结论分别使用

[Hermit 官方发布](https://x.com/InfiniAILab/status/2114763933064089697)和[作者介绍](https://x.com/haizhong_zheng/status/2114769723879464983)是本次发现线索；实查 GitHub 为 247 stars / 18 forks，搜索缓存仍显示 140 stars，说明热度数据会过时。互动与星数不作为方法收益证据。

[ActiveSaddler 作者介绍](https://x.com/sunghopark20124/status/2107493614364631136)聚焦下一步应诊断什么；应进一步以原代码和冻结实验核实价值。[评测研究作者讨论](https://x.com/yikewang_/status/2107150404819812399)则提示必须核对反馈、推理预算及任务分区；本项目据此保留[宿主反馈比较](2026-10-28-feedback-causal-protocol.md)与独立评估。以上社区观点均不进入本项目成绩表。
