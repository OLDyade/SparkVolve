# 公开仓库、云端 CI 与原包真实交付

2026-10-28 按用户明确授权，`OLDyade/spark-harness-evolution` 已改为公开仓库。核心思想与 `11.md` 原文不变；公开源码不等于发布 npm 或 GitHub Release。

## 云端工程

原私有 CI 因付款／额度而没有执行步骤。公开后标准 GitHub runner 实际启动，额度报错未再出现；真实运行暴露了以下工程问题：

- macOS ARM64 没有预装 Go：工作流显式安装固定 Go 版本执行 actionlint。
- gVisor 安装后只 reload Docker，`host-gateway` 解析成 `invalid IP`：安装脚本在专用宿主完整重启 Docker。测试的 HTTP fixture 在创建后立即注册清理，初始化失败不会遗留监听服务拖住 CI。即时 TAP 和容器日志保留原失败。见[诊断依据](../research/2026-10-28-public-ci-and-transport.md)。
- gVisor 中 Landlock 不可用且镜像缺少 Bubblewrap：补齐 DSH 原生后端依赖。原生 Bubblewrap 每次重建 `/tmp` 会遮住旧 HOME，因此统一改用工作区内独立限额的临时挂载。连续原生工具调用和交付不携带 HOME 内容均纳入回归。

`0b67a10` 的 [CI 40625648430](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40625648430) 中，Linux 与 macOS 各通过 255 单元、26 原生及同包安装检查；runc 23 项通过。gVisor 当时失败后被取消。`d222dfd` 的[完整矩阵](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40627364489)中，其他三路通过，gVisor 21/23，暴露原生工具后端缺失。

`9ba0e38` 的[修正运行](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40628650904)中，Linux/macOS 与 gVisor 均通过，gVisor **23/23**；runc **22/23**，暴露取消测试在实验初始化尚未提交时就打开严格数据库读取器的竞态。测试改为观察 `initialization.sqlite` 的已提交 `prepared` 状态，再核对原始执行容器并发送 SIGINT；本地真实 runc 的完整中断、取消、幂等及禁止新增臂断言通过。没有吞掉合同不匹配错误、延长等待以掩盖问题或重试任务。各提交结果独立保留，最新主分支矩阵可从 [Actions](https://github.com/OLDyade/spark-harness-evolution/actions/workflows/verify.yml) 查看。

Linux x64 与 macOS ARM64 从干净提交 `0b67a10` 构建出的实际 npm tarball 逐字节一致：SHA256 `055ac14a3232325d25d35af596e55393f1407dfd662f5a452a123aaccd927696`，两平台都安装并调用同一归档。原 manifest、SBOM 与归档从 CI 下载核对，见[可复现构建回执](../evidence/public-delivery-20261028/reproducible-package.json)。此证据只覆盖对应提交和两种实际环境，不保证任意未来环境。

修正后的 `48e835c` 在 [CI 40629306937](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40629306937) **四路全部通过**：Linux/macOS 各 255 单元、26 原生和 1 项实际分发包安装；runc/gVisor 各 23 项容器测试。终态由 GitHub API 和各作业实际日志交叉核实，见[机器回执](../evidence/public-delivery-20261028/cloud-ci-40629306937.json)。此前失败与取消记录完整保留；没有停用失败测试或降低隔离要求。

## 600 秒真实模型验收

原生运行时冻结在 `0b67a10`，实际镜像 `sha256:f4a77050fd1a786c983e2b4a2e08ff117f6db5332e35ab61cfa87a99625f2de9`。新合同登记四类任务、两份候选预算与独立验证；没有重跑旧 optimizer 或失败任务，也没有切换服务或模型。

| 阶段 | 实际结果 | 调用：开始／返回／失败／未闭合 |
| --- | --- | --- |
| 搜索 H0 与优化器 | H0 四题得分 0.25、1、1、1；G 上游流缺少结束标记，未提交候选 | 54／53／1／0 |
| 原登记的独立验证 | 8 槽全部终态，6 评分、2 执行失败；两臂均是同一 H0，完整均值 81.25%／50% | 32／30／2／0 |
| 原包安装后的独立交付 | 四个干净 DSH Profile 安装并执行，4 评分、0 执行失败；得分 0、1、1、1，均值 75% | 24／24／0／0 |

搜索原计划 12 个任务槽中实际执行 4 个 H0 槽，其余 8 个候选槽没有发生；独立验证的 8 个原注册槽全部结算。因此原计划共 20 槽中实际执行 12 槽，另有 4 个独立安装交付槽。未执行槽不冒充观测，安装分数不补入搜索或验证。

模型使用量分别为：搜索输入 86810／输出 17245 tokens；验证输入 28053／输出 7349；独立安装交付输入 20400／输出 5827。原始失败验收文件摘要仍为 `6a40ba913bfd72868de6d088a6cc00bd2b666fa986e51ca99b40ad91a3ef34f4`，续做验证与交付没有改写它。

## 传输证据与剩余边界

G 的失败请求在约 70ms 完成 TCP、212ms 完成已授权 TLS 和请求写入；约 301132ms 才收到 HTTP 200，随后响应结束，模型适配器报告 `Stream ended without finish_reason`。验证归一化任务出现同类约 301 秒无结束标记；另一任务在 TLS 阶段 `ECONNRESET`，出口生成 502，**没有上游 HTTP 502 的证据**。这与本地 600 秒截止不同；无法仅靠这些日志确定远端哪个组件终止了请求。

安装交付使用原 H0 归档 `27acd1a2cbc6f3c222d54e3022406f210855af948fb6169800573363aab20f3a`。四个 Profile 均经原生加载器解析到安装包，执行前后文件摘要一致；执行不挂载 `/candidate`。安装机制通过与业务正确率分别报告，归一化得分为零保留原样。

**完整自主变异验收仍未通过，稳定质量增益与复杂跨插件自主重构仍需真实证据。** 当前已完成原注册且可独立执行的验证和同包交付；没有用夹具、手写候选或自动重试替代失败的模型实验。机器摘要与原件摘要见[真实验收](../evidence/public-delivery-20261028/real-acceptance.json)、[来源索引](../evidence/public-delivery-20261028/sources.json)。
