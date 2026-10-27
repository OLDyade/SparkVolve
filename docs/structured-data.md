# 第二领域：结构化事件与日志

本适配器复用同一 DSH 优化器、实验合同、冻结构建、原生装配 QA、独立评分与 Bundle 分发。控制器没有增加领域分支。输入为 JSON / JSONL，交付为 JSON，无需 Excel 或 LibreOffice。

```text
事件 / 日志 / 清单 → 原生数据工具 Bundle → DSH 执行器 → result.json
                            ▲                              │
                            │                              ▼
                      优化器自主变异 ← 原有实验控制器 ← 禁网独立裁判
                            │
                            └── 同一冻结产物 → 原生安装与复用
```

## 任务与评分

| 公开合成任务 | 验证的业务机制 |
|---|---|
| revision-events | 事件去重、按版本归并、删除与恢复、保留 null 和空字符串 |
| request-logs | 复合分组、服务端错误定义、零延迟、均值和 nearest-rank 分位数 |
| dependency-join | 多字段精确关联、精确例外匹配、未匹配记录 |

种子仅提供 `data_read` 原文读取与 `data_write` 显式 JSON 写入。优化器可自行增加通用操作、修改实现或装配，不预设变异答案。每轮预算含基线共两个候选，每候选三题、每题一次，最多六次任务执行；失败保留，不重抽。

评分器只解析交付数据，不执行候选提供的程序。每个任务的三个顶层结果字段各算一项，顶层字段集合另算一项，四项等权；嵌套数组顺序和内容按任务规则比较。数字按精确数值比较，布尔值独立；重复 JSON 键和非标准 NaN / Infinity 拒绝。缺失或错误交付是业务零分，评分材料损坏会直接失败。反馈只给各项是否匹配，不返回预期值。

生成器与答案算法为公开开发样例，故这些任务**不属于未见测试集**。本实验验证跨领域接入、真实自主变异和交付链路；同分与退步照实保留，不据此宣称稳定跨领域收益。

## 运行

在仓库根目录执行；依赖版本和凭证配置沿用主 README。镜像直接使用通用基础镜像，不安装表格依赖。

```bash
npm ci
npm run check
docker build -t harness-evolution:local .
mkdir -p .evolution/data
node examples/isolation.mjs runc "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" > .evolution/data/isolation.json
python3 examples/structured-data/generate.py .evolution/data/dataset
node examples/structured-data/prepare.mjs .evolution/data/dataset \
  "$(docker image inspect harness-evolution:local --format '{{.Id}}')" \
  examples/venus/model.json .evolution/data/spec.json .evolution/data/isolation.json
node dist/cli.js init --root .evolution/data/search \
  --spec .evolution/data/spec.json --dataset .evolution/data/dataset \
  --seed examples/structured-data/seed
node --env-file=/absolute/private/venus.env dist/cli.js evolve \
  --root .evolution/data/search --host 0.0.0.0 --port 18949 \
  --endpoint "http://${HE_CONTROLLER_IP}:18949"
node dist/cli.js report --root .evolution/data/search --output .evolution/data/report.json
```

`HE_CONTROLLER_IP` 必须是代理容器可达的明确 IP；可通过 README 的 `scripts/controller-address.mjs` 读取 Docker 已配置的宿主映射，或指定已配置的可达接口。数据目录、合同和报告均要求新路径；停止后恢复原实验使用相同 `evolve` 命令，不能重建目录伪装重试。通过 `export` 输出冻结候选后，可沿用[原生能力入口](use-capability.md)安装，把工作簿输入换成对应 JSON 数据与任务即可。

## 实现依据

- Python 官方 [`json` 文档](https://docs.python.org/3/library/json.html)：默认解码会合并重复成员、接受非标准常量；本裁判用 `object_pairs_hook` / `parse_constant` 明确拒绝，`parse_float=Decimal` 避免数值舍入成为隐藏评分条件。实际只使用当前运行版本支持的接口。
- DSH `0.2.1-rc.4` 原生 `defineTool`、SDK Profile、Cordis `inject=['tools']` 和 Bundle patch；新领域没有实现另一套 Agent Loop。
- 种子锁文件采用与主仓库一致的 Zod `4.6.7`，规避已核实的 [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)，依赖审计零告警。

真实实验已完成：[结果与独立审查](acceptance-structured-data.md)。基线三题全通过，变异两题通过、一题执行超时，按完整分母拒绝；已验证导出基线包的原生安装和真实工具调用。负结果与算法反例完整保留。
