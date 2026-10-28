# 全景方案落实状态

本页按 [`11.md`](../11.md) 的完整目标核对交付，核心思想原句保持不变。**项目尚未全部完工。** 工程验收、真实模型闭环和独立质量研究分别记录；单项通过不代表全部目标完成。

## 当前状态

| 范围 | 已核实状态 |
| --- | --- |
| 当前交付 | 原生插件开发能力接入及默认 600 秒预算链修复；本页列出的历史证据各自绑定源码、镜像或产物身份 |
| 最近本地检查 | 600 秒预算改动通过 **236 项单元测试、24 项原生测试、2 项容器回归**；全量检查启动后补入的 2 项截止测试另行通过 |
| 最近真实研究 | 原生开发能力验收完成 **20 次执行、19 次评分、1 次超时**；官方 Skill 与 inspection 均实际使用，两份新候选开发得分均为 81.25%，同分保留 H0；**总体验收未通过** |
| 原包交付 | G、H0 与两份所选 H 的 **5 个安装上下文全部通过**；原控制记录与冻结产物未变，休眠中断和命令超时两次失败完整保留 |
| 当前主线 | DSH 原生开发接入已有真实变异与评测；默认任务／示例模型请求与流空闲采用 600 秒，SDK 初始化和外层监督对齐，优化器按完整计划分配预算。新镜像预检及 1 次真实模型传输任务通过；原 300 秒实验结论保留 |
| 隔离路线 | runc／gVisor 主线已有实测；**MicroVM 为可选后端，不阻塞主线**，未验证的独立内核和磁盘硬限额不作已支持声明 |
| 外部工程状态 | GitHub 托管 CI 受账户支付／额度限制，私有仓库 Rulesets 受套餐限制；本地绿色记录不替代云端执行或分支保护 |

最近原生开发能力研究的[完整结果](experiments/2026-10-28-native-authoring-results.md)与[原始证据索引](evidence/native-authoring-20261028/index.json)可逐项核对：233 次请求开始、232 次返回、1 次未完成，原 H0 安装通过。此前[同 G 反馈研究](experiments/2026-10-28-paired-feedback-results.md)与[全部安装尝试](evidence/paired-feedback-20261028/index.json)独立保留；新代码和新验收不改写旧合同、镜像或结果。

## 能力与验收证据

| 能力 | 已实现及实际验证 | 证据入口 |
| --- | --- | --- |
| 原生插件化进化闭环 | DSH 优化器自主修改插件实现并提交候选；控制器冻结、调度、独立评分和严格择优；真实连续搜索及双会话接续 | [连续搜索](acceptance-continuous.md)、[全项评审账本](review-ledger.md) |
| 实验身份与独立评分 | 固定输入、模型、镜像和完整分母；评测材料独立挂载；执行失败与业务得分分开；逐题和优化器用量来自持久账本 | [实验约束](constraints.md)、[研究协议](optimizer-studies.md) |
| 源码、构建与交付一致 | 独立构建、v3 lock、编译和依赖打包；QA、执行、复验及导出使用同一冻结产物；真实 TypeScript 构建、禁网安装调用、篡改拒绝与恢复通过 | [分发协议](releasing.md)、[原包交付回执](evidence/paired-feedback-20261028/artifact-installation.json) |
| 原生装配与领域 QA | 按实际 SDK Profile、环境和候选 patch 创建 Agent，审计依赖、插件树及 Preset；独立领域操作合同冻结源码和入口，禁网、无凭证执行；支持跨插件组合 | [领域验证](domain-verification.md)、[服务与作用域观察](research/2026-10-28-service-observations.md) |
| Evolution Preset 与工具语义 | 原生注册表、声明与 Include；会话隔离、子 Agent 继承、重启恢复及缺失定义拒绝；分叉返回真实草稿身份且重放不覆盖编辑，结束仅在宿主成功确认后生效 | [Preset](presets.md)、[普通结束工具验收](research/2026-10-28-evolution-finish-native-turn.md) |
| 原生插件开发资料与检查 | 接入锁定 DSH 的 inspection 与官方插件开发 Skill；真实模型实际读取、检查并自主修改实现，两份新候选进入原生 QA 和任务评测；端到端验收仍有失败 | [接入研究](research/2026-10-28-native-authoring-integration.md)、[真实验收](experiments/2026-10-28-native-authoring-results.md) |
| 中断、事件与取消 | SQLite 单写租约及持久提交意图；发布阶段 SIGKILL、并发与响应丢失恢复原 attempt；提交后唤醒、持久游标重放；后代按登记身份取消并分层记账 | [恢复协议](research/2026-10-28-publication-recovery.md)、[事件协议](events.md)、[命令生命周期](research/2026-10-28-command-process-groups.md) |
| 自主复用研究资产 | 授权库随合同冻结；真实模型检索、读取并导入负结果档案，来源进入新候选，旧成绩不进入本轮裁决 | [研究资产](research-assets.md) |
| 原字节证据访问 | `evolution_materialize` 发布只读原文件；描述符读取覆盖文件、清单和冻结复制；独立竞态、真实模型读取／复制／摘要／回收通过 | [证据接口](evidence-access.md) |
| 自主行为实验 | 优化器编写独立测试，在禁网、无凭证的真实 DSH 环境调用工具并观察服务、作用域和生命周期；失败、源码和原始观察保留 | [行为实验](behavioral-probes.md)、[实际失败与限制](research/2026-10-28-service-observations.md) |
| 优化器自身进化与固定比较 | G/H 独立版本与同预算协调；真实元优化器修改并运行 G1；独立协议登记全部固定方法、共同 H0 和完整失败分母；终态不重跑 | [研究接口](optimizer-studies.md#固定方法比较)、[元优化器终态记录](experiments/2026-10-28-optimizer-study-results.md) |
| 同 G 宿主反馈对照 | 同一源码／构建／装配下登记 full/mechanical 两臂；统一模型可见状态、事件和证据；原生双臂探测及真实配对搜索完成 | [反馈协议](feedback-views.md)、[真实对照结果](experiments/2026-10-28-paired-feedback-results.md) |
| 通用性与第二领域 | 结构化事件、日志、清单复用同一引擎和合同；真实自主变异、完整失败裁决及基线 Bundle 原生安装调用通过 | [非表格领域](acceptance-structured-data.md) |
| 可复用能力交付 | 原 Bundle 随附 `CAPABILITY.md`、实验报告、谱系及权限与用量说明；实际 npm 包、锁文件、CycloneDX SBOM 和摘要回执；独立能力入口完成原生安装及 headless 真实模型任务 | [能力卡](capability-cards.md)、[分发](releasing.md)、[独立使用](use-capability.md) |
| 开发者与首次体验 | 双语 README、组件／生命周期／时序图及实测图已渲染核验；公开冷启动流程完成搜索、同包复验和归档；只读事件观察不接管任务 | [用户旅程](research/2026-10-28-user-journey.md)、[组件索引](components.md) |
| 无凭证离线导览 | 原始历史记录驱动交互页面；桌面、移动、键盘、JSON 下载、零网络访问和图形渲染通过；`docs:check` 检查过期内容且不改写原文件 | [导览](tour.html)、[验收记录](evidence/2026-10-28-offline-tour.json) |
| 运行权限与受控出口 | runc/gVisor 真实模型中断后接回原 worker/broker，完成独立评分与回收；显式 DNS、有限地址池、跨进程竞争和回收中断恢复已验收 | [隔离合同](isolation.md)、[受控出口](controlled-egress.md)、[gVisor 回执](evidence/2026-10-28-gvisor-controlled-dns.json) |

## 研究结果与明确限制

当前证据**未证明稳定正确率收益或跨任务迁移**。以下研究均保留原候选、失败、负结果和完整成本，不能用开发集单次上涨代替独立结论。

| 研究 | 结果与边界 |
| --- | --- |
| [新开发集联合变异](acceptance-joint-development.md) | 均值 65.625% → 81.25%，最终候选含不接受的启发式自动恢复，保留分数和源码，不作为接受能力分发 |
| [联合候选独立复验](experiments/2026-10-28-joint-independent-results.md) | 24/24 执行成功；基线 93.75%、候选 77.08%，下降 16.67 个百分点，拒绝晋级；公式平移和文本错误分类反例保留 |
| [行为实验台对照](experiments/2026-10-28-native-probe-spreadsheet-results.md) | 已有自主新增插件、修改工具与 patch 的证据；未证明行为实验台提分，也不能据此宣称复杂拓扑的因果收益 |
| [优化器自身进化](experiments/2026-10-28-optimizer-study-results.md) | G0/G1 开发同分保留 G0，325 次请求完整记账；原 G1/G0/H0 安装通过，新增工具未实际调用及机制缺陷保留 |
| [同 G 反馈对照](experiments/2026-10-28-paired-feedback-results.md) | Full / Mechanical 独立均值 90.625% / 81.25%；差值全部来自两组选择相同 H0 的第一配对块，无法归因于反馈或变异。源码审查发现标签猜测、公式平移及保留检查缺陷；候选均作为研究产物保存 |
| [原生插件开发能力验收](experiments/2026-10-28-native-authoring-results.md) | 两份新候选与 H0 开发得分均为 81.25%，严格择优保留 H0；20 次执行中 1 次连接阶段挂起触发原 300 秒时限，19 次评分。两验证臂使用同一 H0，其 50% / 100% 差异不能归因为接入收益；候选通用算法反例和未闭合请求完整保留，总体验收失败 |

手写的服务接口迁移、隔离作用域和异步卸载测试证明原生机制可验证；真实模型也曾选择没有区分力的断言。两类证据分别保留，不能合并为自主复杂重构已经完成。

## 完整交付仍需补齐

| 范围 | 剩余工作与完成依据 |
| --- | --- |
| DSH 原生插件开发端到端验收 | 原生 inspection、官方 Skill、真实自主实现变异和原包安装已有证据；补齐全量任务评分与请求闭合。默认 600 秒配置及相关修复正在验证，新实验独立登记，不覆盖原超时或借用旧结果 |
| 配置／实现／装配联合进化 | 保持优化器自主选择变异；补复杂跨插件接口、配置、作用域及装配重构的真实调用和独立反例证据，串起原树、变异树、交付与同包复用 |
| 稳定收益与迁移研究 | 真实反馈比较已完成，结论仍受波动和样本限制。后续应基于明确机制改进预注册独立搜索与新任务实例；[完整反馈／盲变异／随机操作选择研究](research/2026-10-28-feedback-causal-protocol.md)尚未登记执行，不用重复抽样或确定性夹具替代研究 |
| 当前版本完整交付 | 按新配置完成对应原生／容器／真实模型验收、实际 tarball 安装及有界独立评审，再提交推送；同步 README、研究记录和复现入口，不把旧版本通过记录挪用到新代码 |
| GitHub 云端工程与治理 | [运行 40588018568](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40588018568) 未执行步骤，账户支付／额度需恢复；私有 Rulesets API 要求升级套餐。解除外部限制后实际通过 Linux/macOS 与运行时矩阵并启用分支规则。仓库保持私有，公开发布另需用户指令 |

**可选扩展：MicroVM 与更强磁盘边界。** [持久存储探测](research/2026-10-28-persistent-storage-boundary.md)保留 OrbStack loop 关联 `EPERM`，未到写满验收；[Apple 原生路线](research/2026-10-28-native-microvm.md)已核官方包摘要、签名和公证，但尚未启动 VM。安装需管理员认证，工作卷、日志边界和原任务恢复仍待实测。按用户裁决，这条扩展不阻塞主线，也不自动切换既有运行时。

## 版本化验收索引

历史测试数量仅在对应记录中解释，不累计为当前覆盖率。旧合同按原代码保留复核路径；新增 `hostSearchProtocol` 不自动改写旧注册。

| 记录 | 保留的版本证据 |
| --- | --- |
| [发布恢复](research/2026-10-28-publication-recovery.md) | 发布阶段故障注入、并发及原 attempt 恢复 |
| [早期研究分发](evidence/2026-10-28-study-delivery.json) | Python 缓存误入包的原失败及修正后的同包安装；明确记录未提交工作树身份 |
| [固定方法比较](evidence/2026-10-28-fixed-comparison.json) | 三臂完整分母、故意失败臂、终态重入无新请求；旧 Study 报告只读重建 |
| [宿主反馈视图](evidence/2026-10-28-feedback-views.json) | 确定性双臂与三臂原生容器验收、镜像及分发身份；不作为模型质量收益 |
| [反馈研究事前设计](experiments/2026-10-28-feedback-study-registration.md)与[执行登记](evidence/2026-10-28-paired-feedback-registration.json) | 同 G/H0、固定两臂与完整分母、AB／BA 配对块调度、运行提交 `cf32125` |
| [反馈研究终态索引](evidence/paired-feedback-20261028/index.json) | 原始报告、机制反例、休眠／超时两次失败和最终 5 个上下文安装通过；原件逐字节摘要可复核 |
| [原生开发能力终态索引](evidence/native-authoring-20261028/index.json) | 提交 `d8b11ec`、原 300 秒合同、实际 inspection／Skill 调用、两份同分候选、1 次超时、233 次请求及原 H0 安装；总体验收失败保留 |

每项完成由独立 subagent 检查方向和实质缺口。完整评审逐条决定见 [review-ledger.md](review-ledger.md)；核心思想、`11.md` 与宣传定位不在这些状态整理的改动范围内。
