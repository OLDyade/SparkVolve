# Compatibility

所有实验固定实际运行版本，升级依赖必须重新通过原生和容器验收。

| 层 | 当前实现 |
|---|---|
| Node | 验收 24.16.0；包要求 ≥24.11.0，覆盖原生 SQLite 与开发工具依赖 |
| npm / pnpm | 12.2.0 / 12.15.0；npm 管理本仓库，DSH 原生命令用 pnpm 管理 Profile |
| DSH | 精确锁定 `0.2.1-rc.4`；使用 `sdk` / `sdk-minimal` Profile |
| Cordis | `4.0.5`；插件注册、服务依赖、生命周期由原生实现处理 |
| 模型 | Quick start 使用 Venus `deepseek/deepseek-v4.1-flash-1017`；Provider 配置与模型合同分别冻结 |
| 容器 | runc（OrbStack daemon）及 gVisor 20261019.0/systrap（专用 Debian 13 daemon，ARM64）全链路实测；公开 Linux x86_64 CI 在 `48e835c` 对 runc/gVisor 各通过 23 项完整回归，逐版本结果见[公开验收记录](experiments/2026-10-28-public-ci-and-delivery.md) |
| Excel | 示例镜像提供 openpyxl / LibreOffice；独立重算并检验公式与数值 |

DSH 的 Profile 选择应用装配，Bundle 提供可分发 patch 与插件，Cordis 管理服务和生命周期。优化器和执行器分别运行原生 SDK；本项目不实现另一个 Agent Loop。

Evolution Preset 的 SDK 选择桥与安装配置见 [presets.md](presets.md)。当前实验合同的 `optimizerHarness.composition` 指向原生插件条目清单；旧的根 `patch` 方法合同不兼容，须通过当前 prepare 命令生成新实验。历史合同、日志和成绩保留原状，不改写后重跑。

通用镜像不含 Excel 依赖；表格任务和表格评分器必须使用 `examples/spreadsheet/Dockerfile` 构建的扩展镜像。README 的 `verify-image.mjs` 在付费模型运行前实际检查 openpyxl、LibreOffice 重算、独立 grader 和原始值保留，输出原始日志及隔离回执。测试夹具输入和交付目录在准备阶段可写；该验收不代替正式评分的只读挂载或业务正确率评测。

接入其他模型时提供原生 Provider patch，更新 `Model` 合同及其环境变量列表，并完成真实工具调用验收。没有隐式模型切换。安装 Bundle 后的依赖由目标 Profile 管理；本仓库 npm overrides 不会成为消费者的全局策略。

首次安装可能需要授权 pnpm 对精确版本的原生依赖执行构建脚本。只允许实际需要且核验过的包；错误直接保留并处理，不能把停用的插件当安装成功。

当前分发测试的目标 Profile 在 `pnpm-workspace.yaml` 中明确允许以下构建；用在不同版本时须重新核实安装输出：

```yaml
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local@0.2.1-rc.4': true
  '@google/genai@2.21.0': true
  'koffi@3.1.1': true
  'node-pty@1.2.0-beta.15': true
  'protobufjs@7.6.6': true
```

`npm pack --json` 在 npm 12 返回按包名键控的对象；本仓库安装测试按锁定版本解析，没有引入旧格式兼容层。

核验入口：[当前原生实现调研](research/2026-10-27-native-implementation.md)、[DSH 固定源码](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60)。
