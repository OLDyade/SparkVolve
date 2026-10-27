# 从搜索结果到可信结论

搜索找到候选，独立复验检验它。发布成绩时区分运行链路通过、开发集改进、复验收益与跨领域迁移。

## 冻结比较协议

开始前固定任务、重复次数、模型、镜像、指标、失败规则和候选选择方式。基线和候选使用相同任务合同；每个比较组重新运行完整题集，不能混入搜索中的旧分数。模型温度和后端服务波动可能影响结果，保留每个重复。

已完成的搜索可使用新生成的公开任务准备复验。以下命令在仓库根运行；`<digest>` 为搜索结束前选定的已完成变异。

```bash
# 新任务目录；development 与 validation 生成不同数值
docker run --rm \
  --mount type=bind,src="$PWD/examples/spreadsheet",dst=/example,readonly \
  --mount type=bind,src="$PWD/.evolution/business",dst=/workspace \
  harness-evolution-spreadsheet:local \
  python3 /example/research.py /workspace/validation-data validation

node examples/spreadsheet/validation.mjs \
  .evolution/business/search <digest> .evolution/business/validation-data \
  .evolution/business/validation-plan 2

node --env-file=/absolute/private/venus.env dist/cli.js validate \
  --root .evolution/business/validation-study \
  --spec .evolution/business/validation-plan/spec.json \
  --dataset .evolution/business/validation-plan/dataset \
  --arms .evolution/business/validation-plan/arms.json
```

`registration.json` 在任务执行前写入；`comparison.json` 包含每组完整分母、逐题逐次配对、平均差、样本标准差和失败数。执行顺序记录在报告中，不声称已消除时段混杂。样本标准差不等于置信区间；重复共享任务，不能把它们当独立任务数量。

每个 arm 登记 `source`、源码 `digest`、`artifact` 路径及完整 `build` 身份。复验直接复制搜索时已经冻结的包，逐一核对原 lock、产物树和 tarball 哈希，运行相同产物。复验不执行构建脚本；即使构建脚本包含时间或随机输出，也不能改变被选版本。源码导入后修改属于新的搜索候选。

`validation` 不开启优化器 API。对同一个 study 再运行命令只恢复原执行，不额外抽样。评分故障导致报告未完成，不隐式丢弃失败题。新一轮搜索若使用这些结果，必须将该数据标为已见并另建后续复验集。

## 研究资产与复用

```bash
node dist/cli.js remember --root .evolution/business/search \
  --candidate <digest> --library .evolution/library
node dist/cli.js library --library .evolution/library --query "spreadsheet"
node dist/cli.js import --root <another-initialized-search> \
  --archive .evolution/library/<archive-id> --draft imported-mechanism
```

档案含冻结 Bundle、谱系、合同、结果、事件和用量证据。不同实验的同一候选分别保存；负结果同样可查询。导入的草稿须重新提交和验证，不携带旧成绩作为当前收益。

## 优化器自身的比较

`optimizerHarness` 是独立原生 Bundle，可以改变研究方法实现与组合。比较优化器版本时，应在相同初始能力、开发任务、模型和总预算下分别搜索，然后把各自预先选定的候选放入同一独立复验。需报告整个搜索成本及所有失败候选，不能只对比最好一次。当前 CLI 提供这些运行与复验组件；自动选择下一代优化器的研究策略需要单独验证，尚无收益结论。

## 发表最小证据

提交版本、DSH/模型/镜像身份、数据来源与权限、预注册协议、全部配对结果、成本及失败、消融和复现命令。历史 SpreadsheetBench 结果与本仓库的新验收分开引用。合成用例的满分只说明该组任务通过；公开材料不声称达到通用商业表格质量上限。
