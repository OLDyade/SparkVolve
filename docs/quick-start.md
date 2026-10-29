# 启动一次真实进化

[返回首页](../README.md#quick-start) · [接入自己的任务](domain-adapters.md) · [完整实验协议](optimizer-studies.md)

默认使用官方 DeepSeek，任务是三个公开合成的结构化数据例子：事件归并、请求日志聚合、依赖清单匹配。任务适配器可替换，进化控制器保持通用。

## 准备

需要 Node.js 24.16.0 或更高版本、npm、Python 3，以及运行中的 Docker。系统需要支持 Unix 目录文件描述符操作。默认使用 Docker 的 runc；已有 gVisor 部署可指定 `--runtime runsc`，见[隔离配置](isolation.md)。

1. 克隆 `https://github.com/OLDyade/spark-harness-evolution.git`，进入仓库目录。
2. 在仓库外的私有环境文件中设置 `DEEPSEEK_API_KEY`，文件权限设为 `0600`；也可直接在当前进程环境中配置同名变量。
3. 将 `HE_EGRESS_POOL` 设为部署方预留、与宿主/LAN/VPN 不冲突的私有 IPv4 CIDR。每个模型执行占两个 `/29` 子网；默认示例三个执行器加一个优化器至少需要一个 `/26` 地址池。初次配置见[网络说明](isolation.md)。

```bash
npm ci
npm start -- --env-file /absolute/private/deepseek.env --pool "$HE_EGRESS_POOL"
```

默认入口通过官方 Anthropic 兼容 API 使用 `deepseek-flash`；凭证仅交给可信出口代理。模型配置见[官方 DeepSeek](../examples/deepseek/README.md)。调用真实服务会消耗相应账户额度。

## 一个命令完成什么

```text
任务 recipe + 模型 Provider
       │
       ▼
构建运行镜像 → 发现 DNS / 宿主地址 → 冻结任务、模型与隔离合同
       │
       ▼
运行 H0 → DSH 优化器读取证据 → 自主修改插件 → 独立构建与评分
       │
       ▼
保存完整报告、轨迹、失败记录 → 导出选中候选的原始 Bundle
```

每题默认 600 秒，可用 `--task-seconds` 显式调整；优化器总预算按完整计划计算。地址与 DNS 从实际 Docker 部署读取，`--dns` 可以显式指定部署批准的解析器。运行端口自动分配并持久保存。

输出位于 `.evolution/<recipe>-<时间>/`：

| 产物 | 内容 |
|---|---|
| `startup.json` | 启动阶段、配置身份及失败原因 |
| `spec.json`、`search/` | 冻结合同、事件账本、候选、轨迹与逐题交付 |
| `report.json` | 实际评分、裁决与模型用量 |
| `capability/bundle.tgz` | 选中候选的原始构建包 |
| `command-logs/` | 逐阶段日志，保留原始失败 |

启动时会打印事件观察命令。运行失败直接报错，保留原目录；需要恢复时使用[原生 CLI](events.md)，入口不会重新抽样。选中候选可能仍是 H0，完成运行不等于质量提升。独立评分与另行留出的验证集也是不同证据层级；本入口完成开发任务闭环，方法比较使用专门的[预注册实验](experiments/2026-10-29-mutation-space-registration.md)。

## 换成你的任务

传入另一份 `--recipe path/to/recipe.json` 即可。自定义 recipe 的生成命令在镜像中运行，目录只读挂载为 `/recipe`，输出目录为 `/workspace`；它生成 `dataset`。准备脚本接收数据、镜像、模型、合同输出、隔离配置、Provider 目录与每题秒数，生成通用 Experiment 合同。

| Recipe 字段 | 用途 |
|---|---|
| `name` | 运行名称 |
| `dockerfile` | 领域依赖镜像；`null` 使用通用运行镜像 |
| `generate` | 数据生成命令的 argv，无 shell 拼接 |
| `prepare` | 领域合同准备脚本 |
| `seed` | 起始能力 Bundle |
| `preflight` | 可选领域运行环境验证脚本 |

所有文件路径均相对 recipe 所在目录。参考[结构化数据 recipe](../examples/structured-data/recipe.json)与[表格 recipe](../examples/spreadsheet/recipe.json)。Excel 示例只需添加 `--recipe examples/spreadsheet/recipe.json`，自动安装所需 LibreOffice 与 Python 依赖。可使用 `--image sha256:...` 指定已经构建的对应领域镜像，或以 `--provider` 选择另一份原生 Provider 配置，不会自动切换模型。

公开示例用于体验自主插件改造和产物交付。正式研究应使用自己的任务清单、独立验证集与重复搜索计划，详见[领域适配](domain-adapters.md)。
