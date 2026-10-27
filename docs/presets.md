# Evolution Preset：把进化装进原生会话

```text
SDK Profile：Agent Loop / 模型 / 文件 / Shell / 原生压缩
                         │ 共享运行基础
                  Agent Preset Registry
                    ┌────┴────┐
             evolution       其他 Preset
             进化工具         各自能力
             冻结研究方法     无进化工具、无研究方法
                    │
         原生模型请求 → 工具执行 → 独立实验 API
```

`evolve` 自动装配 `evolution` Preset。合同中的 `optimizerHarness` 指定来源及 `composition` 原生条目清单；`optimizers/evidence-driven/plugins.yml` 是默认实现。方法先准备为验真的冻结构建包，清单由原生 Include 在 Preset 作用域加载。执行器继续使用其冻结候选，与优化器的方法和控制权限分开。

| 输入种类 | 必填身份 | 准备行为 |
|---|---|---|
| `kind: source` | `source: {directory, digest}`、`composition`、`build: {image, timeoutSeconds}` | 冻结源码、依赖锁定、实际构建、原生 QA |
| `kind: artifact` | `source: {directory, digest}`、`artifact: {directory, identity}`、`composition` | 验真并导入原构建包、原生 QA；不重新构建 |

`PreparedOptimizer` 固定源码摘要、完整 `BuildIdentity` 与装配入口，位于实验的 `optimizer-harness/prepared.json`。恢复沿用原准备意图及构建容器；已有产物缺失或被修改会直接失败。活动会话挂载构建包为只读目录，不加载可变输入源码。

## 在已有 DSH 中安装

打包本仓库，使用原生 `dsh plugin --profile <目标 Profile> add <tarball>` 安装。启动前设置 `EVOLUTION_ENDPOINT` 与 `EVOLUTION_TOKEN`，指向一个实际 `search` 实验控制服务。安装提供名为 **Harness Evolution**、ID 为 `evolution` 的原生 Preset；有 Preset 注册表和选择界面的部署可直接选择它。不会把进化工具注册到所有会话。

工具安装只完成原生注册。自行托管优化器时，还须建立其工作目录与控制服务之间的挂载合同：实验的 `drafts/` 可写映射到 `/workspace`，`materialized/` 只读映射到 `/evidence`，合同声明的方法和验证目录也须按对应只读路径挂载。API 返回的是优化器运行环境路径，不是下载 URL；仅连接 HTTP API 不会传输或创建这些挂载。推荐通过 `evolve` 使用已实现的隔离启动路径，它自动建立并核验这些映射，不向优化器暴露数据库、评分材料或 Docker socket。

研究方法也可独立打包安装：

```bash
npm pack ./optimizers/evidence-driven
dsh plugin --profile <目标 Profile> add ./harness-evolution-optimizer-evidence-driven-0.1.0.tgz
```

方法 Bundle 的 patch 完整替换 Evolution Preset 的子插件清单。安装顺序为进化设施 Bundle → 研究方法 Bundle；按原生语义，替换清单不会自动合并未来版本的默认子插件。

## SDK 的明确接入

锁定的 DSH `0.2.1-rc.4` 中，`sdk` / `sdk-minimal` 没有 Preset 注册表，高层 SDK 没有会话 Preset 参数。独立安装后的 SDK 使用以下原生 patch，并在 `DeepSeekHarness({ patches: [...] })` 中加载：

```yaml
- insert:
    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: evolution
    - id: evolution-sdk-preset
      name: '@harness-evolution/dsh-bundle/sdk-preset'
      config:
        preset: evolution
```

此 SDK 进程的新根会话明确选择该 Preset。已有原生装配的会话及子 Agent 保留原绑定；恢复读取会话投影中的 Preset 身份。缺失定义或恢复记录直接报错。桥接插件仅使用原生生命周期和注册表，不替换 Agent Loop，不修改 SDK。

Web 等已经提供注册表的 Profile **不加载这份 SDK patch**，沿用部署自身的原生会话选择。Preset 管理注册可见性，系统安全隔离仍由独立进程、容器和权限合同承担。

## 验收边界

- 实际 SDK 子进程：进化工具调用、同进程普通会话无泄漏、研究方法隔离、原生 spawn 子 Agent 继承并调用进化工具、进程重启后恢复、缺失 Preset 在首个模型请求前失败。
- 实际优化器容器：冻结方法 → Preset → 原生模型工具请求 → 真实控制服务 → 搜索结束记录。
- 干净 Profile：实际安装打包后的进化设施与方法 Bundle，并检查首个模型请求及真实工具回执。

以上采用确定性 Provider 验证协议，不能据此宣称准确率提升；真实模型搜索的研究结果另行记录。
