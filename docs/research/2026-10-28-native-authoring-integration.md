# 原生 DSH 插件作者能力接入

核实日期：2026-10-28。官方源码提交 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`；实际安装 DSH `0.2.1-rc.4`、Cordis `4.0.5`。研究使用官方源码、包 README、运行版声明与实现交叉确认。Context7 用于资料定位；精确行为以固定源码和实际原生执行为准。

## 接入决策

```text
优化器 Host（普通进化与元优化器共用 sdkPreset 入口）
  ├─ cordis-host-runner + tool-cordis/host：进程级唯一 Providers
  ├─ sdk：复用原生 Skills registry
  └─ sdk-minimal：显式挂原生 Skills registry
                        │
Evolution Preset        ▼
  ├─ 原生 cordis_inspect_list / cordis_inspect_query
  ├─ 原生 skill tool + 独立 filesystem Provider
  │    └─ 安装版 agent-preset/skills（默认根关闭、watch 关闭）
  └─ G 作者来源身份与实验边界
                        │
按需查声明/原文 → 读实际 README/types → 自主改草稿 → 原生 probe/QA → 独立评分
```

复用原生 Creator 的发现和作者资料路径，不建立另一套 API 检索协议、插件 Runtime 或自动修复器。方法包仅说明如何发现接口；变异内容、插件实现与组合结构仍由优化器依据任务证据选择。MicroVM 不参与这项能力的装配前提。

`sdkPreset(preset, bridge, profile)` 要求明确 Profile，不通过猜测服务是否存在来选择路径。Host Providers 随 Host 装配一次；多会话和子会话沿用原生 Preset revision。安装版框架 Bundle 和方法 Bundle 的完整 Preset 声明均包含作者插件，程序生成的配置与分发配置采用同一结构。

## 官方机制与实际边界

| 能力 | 核实的行为 | 实验含义 |
|---|---|---|
| Service / Event | 固定发行包生成的作者声明目录 | 查到声明不证明某个自定义服务已激活 |
| Config | Host Loader 条目目录、配置 Schema、默认定义、投影限制和可解析的 packageDir | 不返回配置实例值；detached Preset 子树不在该目录 |
| Tool | 请求 Agent 的可见工具 Schema | 不返回执行函数；普通会话看不到新增作者工具 |
| Skill | 原生 filesystem Provider 按需读安装包完整正文 | 只限制新增 Provider 的根；完整 sdk 自有的全局 Skill 机制保持原样 |
| Scope / disposal | 工具、Skill Provider、提示词随注册作用域释放 | 临时作者作用域卸载后不残留，Host Providers 不因会话增加而重复 |
| G / H | inspection 描述当前优化器 G 的作者目录 | H 的构建、依赖和运行行为继续由冻结候选 QA 与原生 probe 核实 |

没有开放 `plugin_manager`。官方 Skill 正文保留原样，新增实验边界明确：活跃 Profile 安装示例不扩大实验权限；修改通过实际控制器工具的草稿、提交和获准 probe 进入候选。没有增加固定变异模板或评分规则。

`authoringSources()` 记录实际解析路径、包版本、manifest 与入口 SHA-256，以及完整 `lib` / 官方 Skills 文件清单与摘要。模型提示仅列来源路径、数量和摘要；完整清单供运行前登记与验收使用。引用的是 G 的实际安装版本，不借用网页最新版本冒充冻结镜像来源。

## 验收与发现

| 验收 | 结果与边界 |
|---|---|
| Typecheck | 通过 |
| 真实 SDK authoring 协议 | `sdk`、`sdk-minimal` 两条路径通过；实际调用四类 inspect、完整加载两份官方 Skill、通过原生 bash 读取真实类型文件 |
| Scope / 普通会话 / 卸载 | 原生调用后验证普通会话无作者工具和新增 Provider，临时作用域卸载移除注册；全局注册不被污染 |
| 配置实例保密 | 原生 Config 查询可见测试字段 Schema，回执与模型请求不出现配置的测试秘密值 |
| 完整原生套件 | 24/24；含子会话、恢复、服务替换、原生结束/拒绝/取消 |
| 分发安装 | 新包经 DSH 安装框架与方法后，SDK 请求实际包含两项 inspect 和 skill，以及与安装文件一致的来源版本/hash；1/1 通过 |
| 有界 subagent 评审 | 核实装配、scope、G/H 区分、来源与分发边界；安装补充发现单独复查 |

这些是框架与原生工具的确定性验收，使用协议 Provider，不宣称模型自主改造成功或业务正确率提升。真实模型搜索、独立验证及分发证据另行登记和报告。

实施中保留的真实失败与修正：

- 首次 `sdk-minimal` 激活等待 `skills`：该 Profile 没有完整 sdk 的 Skills registry。修正为显式 Profile 参数与最小 Profile 的原生 Host 注册。
- 完整 sdk 的 Config 目录超过单页 100 条：测试客户端按原生 `nextOffset` 翻页，不修改原生 Provider 或截断目录。
- 新增安装作者断言首次失败：方法 Bundle 的 patch 完整替换 `preset-evolution.config`，原方法列表覆盖掉框架 Bundle 新增的作者能力。程序生成的优化器配置此前已具备该能力；安装路径的旧测试只断言 `evolution_status`，未覆盖作者工具。方法 Bundle 声明补齐后，增强安装断言通过。失败输出摘录保留于本地 `.evolution/native-authoring-integration/installation-assertion-failure.txt`；没有把摘录表述为完整原始进程日志。

开发依赖新增固定 `@babel/parser@8.0.8` 用于独立作者验收驱动的标准 AST 分析。其 Node 要求使仓库最低版本调整为 `>=24.11.0`，实际验收仍使用 24.16.0。没有通过文本匹配替代语法分析。

## 原始资料

- [官方 Cordis 作者工具与 Host Providers](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/extensions/tool-cordis)：对应安装包 `lib/types/providers.js`、`config.js`、`api-catalog.js`。
- [官方 Creator Preset](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/web-app/presets/cordis.patch.yml)：官方 Skills 目录解析与插件装配参考。
- [原始 Agent Preset Skills](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset/skills)：插件开发、组合编辑、组合参考。
- [Babel parser 官方源码](https://github.com/babel/babel/tree/v8.0.8/packages/babel-parser)：版本及 Node 范围同时核对 npm 发行 manifest。

本次没有修改 DSH、Cordis、Evaluator 或历史冻结产物。
