# 启动一次真实进化

[返回首页](../README.md#quick-start) · [完整用户旅程](user-journey.md) · [接入自己的任务](domain-adapters.md)

以下命令从仓库根目录执行。Excel 是这份可运行指南选用的示例，任务、运行环境、种子插件与评分器均可通过领域适配器替换。准备一次环境后，使用页面末尾的 evolve 命令启动。

首次使用先获取源码：

```bash
git clone https://github.com/OLDyade/spark-harness-evolution.git
cd spark-harness-evolution
```

官方 DeepSeek 配置见[提供方指南](../examples/deepseek/README.md)；选择它时，prepare 的模型与提供方目录均改为 examples/deepseek，私有环境文件使用 DEEPSEEK_API_KEY。不要混用两套提供方参数。


[完整用户旅程](user-journey.md)提供公开命令串联、逐步日志、真实事件观察和负结果分支。下面先准备运行环境，再启动真实模型闭环。

运行前显式生成[隔离合同](isolation.md)：五类角色使用声明的运行时、非 root 身份和资源预算。原容器恢复时重新核验权限，运行时缺失直接报错。

支持显式选择 runc 或 gVisor；gVisor 已完成插件构建、原生 DSH 执行、独立评分、恢复及真实模型接续验收。[固定版本安装与测试矩阵](isolation.md)提供可复现入口。

需要 Node **24.16.0**、npm **12.2.0**、pnpm **12.15.0**、Python 3 和运行中的 Docker。宿主 Python 必须支持 Unix `dir_fd`、`O_NOFOLLOW` 和 `O_DIRECTORY`，用于按授权目录读取不可信文件；缺失时明确报错，不退回存在竞态的路径读取。示例采用用户指定的 Venus 模型快照；其他模型通过原生 DSH Provider 配置接入。没有自动模型降级。

将 `HE_EGRESS_POOL` 设为部署方已预留、与宿主/LAN/VPN 不冲突的私有 IPv4 CIDR。每个受控执行占两个 `/29` 网段，30 执行器加 1 优化器需要至少 62 个；一个 `/23` 提供 64 个。地址池进入合同，容量不足直接拒绝，终态归档后释放。

将 `HE_TEST_DNS` 设为部署方确认可达的 IPv4 DNS 列表，以逗号分隔。可按[部署发现说明](isolation.md#出口-dns)从同一镜像和运行时的 default bridge 获取候选地址；框架不内置公共 DNS，发现记录不代表最终受控网络已通过解析验收。

```bash
npm ci
npm run check
docker build -t harness-evolution:local .
docker build --build-arg HARNESS_IMAGE=harness-evolution:local \
  -f examples/spreadsheet/Dockerfile -t harness-evolution-spreadsheet:local .

mkdir -p .evolution/business
node examples/isolation.mjs runc "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" \
  "${HE_TEST_DNS:?Set approved comma-separated IPv4 DNS servers}" > .evolution/business/isolation.json
node examples/spreadsheet/verify-image.mjs \
  "$(docker image inspect harness-evolution-spreadsheet:local --format '{{.Id}}')" \
  .evolution/business/isolation.json .evolution/business/image-check
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$PWD/examples/spreadsheet",dst=/example,readonly \
  --mount type=bind,src="$PWD/.evolution/business",dst=/workspace \
  harness-evolution-spreadsheet:local python3 /example/generate.py /workspace/dataset

node examples/spreadsheet/prepare.mjs .evolution/business/dataset \
  "$(docker image inspect harness-evolution-spreadsheet:local --format '{{.Id}}')" \
  examples/venus/model.json .evolution/business/spec.json .evolution/business/isolation.json examples/venus

node dist/cli.js init --root .evolution/business/search \
  --spec .evolution/business/spec.json --dataset .evolution/business/dataset \
  --seed examples/spreadsheet/seed
```

将密钥写入仓库外权限为 `0600` 的环境文件，变量名为 `VENUS_API_KEY`。真实凭证仅交给可信出口代理；优化器和执行器使用本地占位值。一条命令管理控制服务、执行、评分和优化器会话。控制地址使用容器可达的明确 IP，下面的辅助命令读取 Docker 的 `host-gateway` 映射；Linux 主机也可明确指定已配置的可达接口。端口需空闲，防火墙需允许代理访问。

```bash
HE_CONTROLLER_IP=$(node scripts/controller-address.mjs \
  "$(docker image inspect harness-evolution-spreadsheet:local --format '{{.Id}}')")
node --env-file=/absolute/private/venus.env dist/cli.js evolve \
  --root .evolution/business/search --host 0.0.0.0 --port 18948 \
  --endpoint "http://${HE_CONTROLLER_IP}:18948"

# 查看真实产物与裁决
node dist/cli.js status --root .evolution/business/search
# 在另一个终端跟随已提交事件；Ctrl-C 只停止观察
node dist/cli.js events --root .evolution/business/search --follow
```

示例生成公开合成 XLSX 业务任务，使用真实模型和独立 LibreOffice 重算。生成合同同时冻结[独立领域 QA](domain-verification.md)，通过原生工具检查显式写入和源文件保留，再运行正式任务。它验证产品闭环，不能代表 SpreadsheetBench 分数、迁移收益或统计显著性。历史私有题库、答案和运行产物没有进入仓库。

需要研究实验时，使用 `research.py` 生成四类业务机制任务，在 `init` 前登记任务角色、重复次数、候选与失败预算。全部候选使用同一合同；[已登记的联合插件实验](experiments/2026-10-27-joint-plugin-development.json)提供一份具体示例。工程演示与研究实验分别记账。

