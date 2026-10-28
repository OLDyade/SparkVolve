# 从干净检出到可检查的能力交付

本页串起公开命令、实际状态和交付边界。模型自行选择插件改动；验收驱动只按预先登记的规则调用公开 CLI，不生成候选代码，不替模型修答案。

```text
克隆 → npm ci → npm run check → 构建基础 / Excel 镜像
                                      │
                         显式运行时、地址池、DNS
                                      │
                                      ▼
         镜像真路径预检 → 公开输入 → 冻结合同和选择规则
                                      │
                                      ▼
               init → evolve → 原生优化器自主变异
                              │               │
                              │               └─ events --follow：只读观察
                              ▼
                  构建 / 原生 QA / 任务 / 独立评分
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
          无合格终态变异                完整均值最高变异
          保留负结果结束               同分选择最早登记
                                           │
                                           ▼
                           固定新任务 → 基线 / 候选完整复验
                                           │
                                           ▼
                                原包研究归档＋全部结果
                                           │
                                  源码与能力语义审查
                                           │
                                独立安装 → 新用户任务
```

## 运行完整公开流程

先按[启动指南](quick-start.md)安装依赖、通过检查并构建镜像。`npm run check` 自行生成类型检查所需的构建产物，首次检出不需要已有 `dist/`。模型凭证放在仓库外的私有环境文件中。

运行以下验收会实际消耗模型额度。默认示例包含三题、最多四个候选和 1,800 秒优化器预算；若有可复验变异，再执行四题 × 两组。它是工程体验，单次重复和公开任务不能证明稳定提分。

```bash
HE_IMAGE=$(docker image inspect harness-evolution-spreadsheet:local --format '{{.Id}}')
HE_CONTROLLER_IP=$(node scripts/controller-address.mjs "$HE_IMAGE")
node --env-file=/absolute/private/venus.env scripts/accept-walkthrough.mjs \
  --root "$PWD/.evolution/user-journey" \
  --image "$HE_IMAGE" --runtime runc \
  --pool "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" \
  --dns "${HE_TEST_DNS:?Set approved IPv4 DNS servers}" \
  --endpoint "http://${HE_CONTROLLER_IP}:18958"
```

`--root` 必须是尚不存在的目录。失败立即停止并保留原命令日志、退出状态和实验；此驱动不会重试，也不支持在原目录再跑一遍。需要恢复实验时，检查原失败后使用 [CLI 的恢复语义](events.md)，不能新建 attempt 掩盖失败。

| 产物 | 作用 |
|---|---|
| `commands/*.json`、stdout、stderr | 每条公开命令、时间、退出状态与输出哈希 |
| `registration.json` | 执行前固定源码版本、镜像、合同摘要、选择规则和数据用途 |
| `search/`、`search-report.json` | 原实验、全部候选、逐题成绩和模型用量 |
| `selection.json` | 依据完整均值选择终态变异，保留退步，不择优删题 |
| `validation-study/registration.json`、`comparison.json` | 两组同合同、同冻结构建产物、完整配对结果 |
| `research-export/` | 能力包与研究档案；归档不等于批准分发 |
| `outcome.json` 或 `failure.json` | 完成分支或首个失败，不补造成功终态 |

驱动从已构建镜像开始。完整冷启动验收还必须保留先前 `npm ci`、`npm run check` 和两次镜像构建的日志；不能仅凭 `outcome.json` 宣称依赖安装已验证。

## 观察真实进度和断点续读

另开终端观察已提交事件，无需模型凭证：

```bash
node dist/cli.js events --root .evolution/user-journey/search --follow | tee events.jsonl
```

每行 JSON 包含 `event` 和对应 `cursor`。未提交或回滚的事件不会显示；独立 CLI 连接在有界等待后重读，新提交最多延迟约 30 秒显示，不声称跨进程即时推送。等待到期不生成“健康”事件。Ctrl-C 仅停止观察者，原优化器和任务继续运行。一次性快照省略 `--follow`。

```bash
# 从非空日志中保存最后一条已经收到的游标，再接续；游标不能跨实验使用。
jq -s 'last.cursor' events.jsonl > cursor.json
node dist/cli.js events --root .evolution/user-journey/search \
  --cursor cursor.json --follow
```

观察者使用 Node [SQLite readOnly 连接](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)，不创建丢失的数据库、不修改实验 metadata、不取得执行租约。`status` 和 `report` 也使用相同只读方式。持久事件不等于进程存活证明；没有新事件时，还应检查实际进程/容器与任务产物。

## 安装使用

先检查候选实现、独立原生操作语义和复验结果。若有未接受的自动修复、错误算法或失败边界，保留研究档案，不强行安装。对已审核可信的 Bundle，按 [独立能力入口](use-capability.md) 安装并完成新任务，核对原生终态、工具调用、交付公式/缓存和非目标保留。

这个独立能力入口直接向可信容器传模型凭证；实验中的未审核候选继续使用受控出口。安装、工程验收、质量结论和公开发布分别记录。
