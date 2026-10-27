# Round179 固定五题受控对照

2026-09-22；正式来源：`runs/spreadsheetbench2-round179-controlled-ablation/ablation-report.json`。三臂各五题一次，不补题、不重试、不晋级。真实控制器已退出，容器已排空。

| 同题 | off | source | live |
|---|---:|---:|---:|
| Template/13_04 | 53.52% | 76.06% | 67.61% |
| Debugging/09_01 | 62.02% | 34.92% | 18.89% |
| Debugging/04_05 | 88.98% | 88.98% | 88.98% |
| Financial_Model/17_02 | 100% | 100% | 0%：启动失败 |
| Financial_Model/05_01 | 73.45% | 18.84% | 0%：启动失败 |
| 完整五题均值 | **75.594%** | **63.760%** | **35.096%** |

source-off=-11.834pp，live-source=-28.664pp。off/source比较整套启动辅助（自动open、路由、逐行语义、上下文），并非Jev模型独立效应；source/live只差交付观察开关，但live包含两个启动协议故障，不能把其全部损失归为审阅语义。每题每臂仅一次，无法宣称统计显著、模型上限或普遍负效应。off与冠军150也非相同Harness，不能把本次五题结果晋级为30题冠军。

## 成本与故障分层

| 组 | HTTP started/result | 原记录transport/HTTP failed | 本地协议拒绝 | unfinished | 输入token | 输出token | 请求耗时和ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| off | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 |
| source | 269/269 | 0 | 0 | 0 | 2492158 | 155826 | 178304.343 |
| live | 435/435 | 0 | 2 | 0 | 4793718 | 177498 | 280329.072 |

共704次HTTP；已返回不等于验证成功。原collector未计入本地choice分布校验拒绝，原统计保持不改，单列补充。两例详见DIAGNOSIS-Round179-Interim-Protocol.md，均在启动阶段。官方API要求choice为最高概率选项；不以argmax覆盖、归一化、吞错或重试修补供应商返回。

## 轨迹与真实交付核验

使用只读脚本 `scripts/benchmark-server/spreadsheetbench2/inspect_round179.py` 提取各臂workspace/input.xlsx和实际output.xlsx的OOXML原文、完整公式、缓存，不读参考答案。结合各题logs/stdout.log和changes.json。失败任务workspace的中间工作副本不等于正式交付，官方两例无交付仍计0。

- Financial_Model/05_01：原Dashboard D40/F40/H40分别是First/Second/Third Tranche；D/F/H列为日期，E/G/I列为倍数。source将E44/E45原数值2改成公式=2，并在最终声明中称Second/Third倍数；实际G43:G45、I43:I44保持空白。off填写这些后续批次列。证实二维身份映射失败，不能归全部低分于这几格。
- Debugging/09_01 source：原H8=1；原G67为IF(circ=0,0,-G179)，交付反转为IF(circ=0,-G179,0)，缓存0。G133/G143/G150也包IF(circ=0,原关系,0)。确有关闭业务链以消错的行为。source仍修复Financials J18重复扣J17，证明并非所有修改都无价值。
- Debugging/09_01 live：G156从G123+G133+G134+G143+G150改成G143+G150；G143/G150还款转基于G123；G164/G170删除还款项；Financials J18重复扣除仍保留。off修正Financials J18，但也把平均现金利息改为期初现金，off较高分不能证明所有业务修改正确。
- Template/13_04：off覆盖原C13=18为税率乘整体基数，并把后期增长放在C20，后续G:H指标多为空。source保留C13且D/E历史增长、F:H预测指标位置更完整；E13仍写E35+(28+15)*E36。live的C20引用后期增长、E20空白、税额仅链接报税额。源辅助对该题有正向观察，不能被其他题的负收益抹去；也不能由此认定逐行分类的独立因果。
- Debugging/04_05：三臂相同官方88.98%；实际Summary H13都保留H12/H11-1，缓存约0.230523；三臂未解决同一剩余偏差。
- Financial_Model/17_02：off/source均官方100%，source额外117次启动Jev没有观察到质量增益；live启动失败无正式交付。100%仅是官方指标，不认证所有语义。

## 决策

优先承担设计责任：全表预判给了辅助模型过宽、过间接的任务，又把大量解释灌入主模型，局部正确判断也未稳定转化为正确交付。现有证据不足以断言Jev整体无用或星火能力到顶。撤销这一默认介入模式，不继续叠全局审阅。

下一候选研究并实施“显式疑问、原始矩形、独立支持判断”的协作方式：不自动替星火选目标，不预填运算类别，不把概率当正确性门；让源证据和具体疑问同处一次工具返回。是否实际采用及质量收益由后续独立单题验证。仍可能被星火漏调用或问错问题，需如实计数，不靠强制步骤掩盖。

## 当前资料

- [Jev 1.13已知边界](https://docs.typesafe.ai/model-jaggedness/jev-1.13)：官方2026-09-17复核，当前访问2026-09-22。建议具体问题、减少间接引用和无关状态，算术归代码。
- [Noul接口](https://docs.typesafe.ai/primitives/noul)：返回0..1的yes概率，无null语义；支持不足不能自动解释为反证，概率不能认证公式正确。Context7官方文档同步核实。
- 既有社区、X和源码索引见RESEARCH-Jev-Case-Library-20260922.md；热度不当作本地收益证据。
