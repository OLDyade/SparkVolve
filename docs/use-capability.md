# 安装能力，直接完成任务

进化实验输出的 `bundle.tgz` 可通过 **DSH 原生插件安装器 → headless Profile → 原生 Agent Loop** 执行。使用者提供工作簿和任务即可，无需启动优化器、实验控制器或评分器。本页的容器提供 Python / openpyxl / LibreOffice 运行依赖，模型仍由 DSH 原生适配器调用。

```text
已审核 Bundle ── dsh plugin add ── headless Profile
                                      │
只读工作簿 + 用户任务 ────────────────▶ DSH Agent
                                      │
                            插件工具 / 原生工具
                                      │
                          result.xlsx + 原生会话记录
```

## 准备

此入口用于已经审核并信任的 Bundle，模型凭证直接进入能力容器。优化器生成的未审核候选继续使用实验系统的受控出口，不可据此入口声称候选与凭证已经隔离。

沿 README 构建表格运行镜像；选择已审核的能力归档。实验冠军只表示满足当时的评分规则，仍需检查是否包含违背能力语义的自动修复等逻辑。新开发集的变异 3 已因此排除分发。

以下命令从仓库根目录运行。`CAPABILITY_IMAGE` 使用本地镜像的不可变 ID；凭证文件仅包含 `VENUS_API_KEY=...`，放在仓库外并设为 `0600`，不复制进镜像。选择其他原生模型适配器时，替换两个模型 patch；不更改 Agent Loop。

```bash
export CAPABILITY_IMAGE=$(docker image inspect harness-evolution-spreadsheet:local --format '{{.Id}}')
export CAPABILITY_BUNDLE=/absolute/path/to/export/bundle.tgz
export CAPABILITY_CREDENTIALS=/absolute/private/path/venus.env
export TASK_DIR=$(mktemp -d)
export CAPABILITY_CONTAINER="harness-capability-$(basename "$TASK_DIR" | tr '[:upper:]' '[:lower:]')"
mkdir -p "$TASK_DIR/input" "$TASK_DIR/output" "$TASK_DIR/state"
cp /absolute/path/to/my-workbook.xlsx "$TASK_DIR/input/source.xlsx"
printf '%s\n' '请按我的业务要求处理 /input/source.xlsx，保留原输入，交付 /workspace/result.xlsx。这里替换为你的完整任务。' > "$TASK_DIR/task.txt"
```

## 原生安装与执行

```bash
docker run --name "$CAPABILITY_CONTAINER" --runtime runc \
  --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
  --read-only --memory 4g --cpus 2 --pids-limit 256 \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=536870912,mode=1777 \
  --env HOME=/state/home --env DSH_HOME=/state/dsh \
  --env DSH_MAX_TOKENS_AS_SUCCESS=false \
  --env-file "$CAPABILITY_CREDENTIALS" --workdir /workspace \
  --mount "type=bind,source=$CAPABILITY_BUNDLE,target=/capability/bundle.tgz,readonly" \
  --mount "type=bind,source=$(pwd)/examples/capability,target=/app/examples/capability,readonly" \
  --mount "type=bind,source=$(pwd)/examples/venus,target=/app/examples/venus,readonly" \
  --mount "type=bind,source=$TASK_DIR/input,target=/input,readonly" \
  --mount "type=bind,source=$TASK_DIR/output,target=/workspace" \
  --mount "type=bind,source=$TASK_DIR/state,target=/state" \
  --mount "type=bind,source=$TASK_DIR/task.txt,target=/task.txt,readonly" \
  "$CAPABILITY_IMAGE" bash -c '
    set -euo pipefail
    node /app/examples/capability/install.mjs /capability/bundle.tgz > /state/install.log 2>&1
    exec timeout --signal=TERM --kill-after=10s 600 \
      dsh --profile headless \
        --patch /app/examples/venus/cordis.patch.yml \
        --patch /app/examples/capability/headless.yml \
        --json - < /task.txt
  ' > "$TASK_DIR/events.jsonl" 2> "$TASK_DIR/stderr.log"
```

安装脚本只调用原生 `dsh plugin add`，并沿用镜像锁定的依赖构建授权；不会创建优化策略或改变候选代码。首次安装需要访问包仓库；执行阶段需要模型网络。原生动态库会从 `/tmp` 加载，因此该 tmpfs 显式允许 `exec`，与实验运行器的声明一致。仅挂载两个公开示例配置/安装脚本目录，不挂载完整项目工作树、私有评测材料或 Docker socket。

每个新任务使用独立 `TASK_DIR` 和容器名，容器结束后保留。记录 `docker inspect --format '{{.Id}} {{.State.ExitCode}}' "$CAPABILITY_CONTAINER"`；失败时检查原容器与日志，不重新执行同一命令制造新 attempt。

结果位于 `$TASK_DIR/output`。`events.jsonl` 是原生有界事件投影，完整会话保存在 `$TASK_DIR/state/dsh`。本项目锁定版本 `0.2.1-rc.4` 的终态在 `status` 事件中：`phase=turn_end` 且 `reason.kind=completed`；随后 `final` 事件提供文本。须同时核对容器退出码、该终态和实际文件。较新源码文档将 reason 放入 final，不能将其字段直接套到当前版本。退出成功不证明业务正确，失败保留日志与事件，不自动重复模型任务。

此入口是直接能力体验，安装后没有研究评分环节。需要研究结论时，回到固定合同与独立评测流程。

## 真实验收

[独立安装记录](evidence/2026-10-28-standalone-capability.json) 使用新建的非 root 容器和全新 DSH_HOME，原生安装开发实验变异 1 的冻结 tarball，直接调用真实 DeepSeek 模型。四步实际调用 `workbook_inspect → workbook_write → workbook_verify → workbook_inspect`，交付三条公式及缓存值 `87.5 / 84 / 171.5`；逐格检查非目标值与刻意空白保持，安装的四个运行文件与原构建产物哈希一致。

该验收证明原生安装和独立任务入口可用，不构成该候选的发布批准或新的正确率基准。原任务验收挂载了整个公开 examples 目录；文档评审后缩窄为两个所需目录，并单独验证原生配置装配，不重复模型任务。全部事件、交付和首次启动失败留在私有验收目录；机器记录明确区分原生已提交步骤用量与底层请求次数。

## 生态依据

- [DSH headless 官方实现与用法](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/headless/README.md)：原生一次性任务、持久会话、JSON 终态；最新源码与本项目安装版本的 CLI 帮助分别核对。
- 本项目运行版本固定 `0.2.1-rc.4`。本入口只使用该版本已核实的 `plugin add`、`--profile headless`、`--patch`、`--json` 与 stdin，未照搬较新文档中安装版本没有的参数。
- 镜像中 `node-addon-native-custom-loader` 会把原生二进制放入临时缓存再加载；首次验收漏配 tmpfs `exec` 的失败日志保留，修正命令后继续原生验收，不关闭加载校验。
