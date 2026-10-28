# 用 DSH 自己的开发能力改造 Harness

Evolution Preset 为优化器装配 DSH 原生的 Cordis 检查工具和官方插件开发 Skills。优化器可以先查当前运行版本的作者契约，再自主修改插件配置、实现和组合；框架不预写修复策略。

```text
锁定镜像与方法 Bundle
        │
        ▼
DSH 优化器 G
  ├─ cordis_inspect_list / query ──► 服务、事件、配置和工具契约
  ├─ skill ──► 安装包自带的插件开发 / 组合编辑资料
  └─ 原生编码工具 ──► 包 README、类型与实际实现
        │
        ▼
独立草稿：插件代码 / 配置 / 装配结构
        │
        ├── 可选原生 probe ──► 实际工具、服务与生命周期观察
        ▼
冻结构建 → 原生 QA → 任务执行 → 独立评分 → 同一原包交付
```

## 装配方式

Host 只注册一份原生 `dsh-cordis-host-runner` 和 `dsh-tool-cordis/host`。作者工具和官方 Skill Provider 随 Evolution Preset 进入选定 Agent 的作用域。执行器仍按冻结候选装配，评分端权限不变。

SDK 装配显式选择 Profile：`sdk` 复用已有的原生 Skill 服务，`sdk-minimal` 补入原生 Skill 服务；Agent 的 `skill` 工具和资料 Provider 随 Preset 生命周期注册与释放。

官方资料由实际安装的 `@deepseek-ai/dsh-agent-preset` 解析定位。新增 Skill Provider 关闭默认目录扫描和文件监视，原文按需加载；其他原生 Skill Provider 保持自己的配置。包版本、入口与资料摘要随作者来源记录呈现，实际运行镜像绑定这些文件，不在已登记实验中动态替换为网上最新内容。

这个接入不添加 `plugin_manager`。研究中的变异通过 `evolution_branch` 创建草稿，使用 `evolution_probe` 检验获准的机制，再由 `evolution_submit` 冻结并交给独立实验服务。

## 每种观察究竟说明什么

| 原生入口 | 能得到的事实 | 使用边界 |
|---|---|---|
| `Service` / `Event` | 发行包中的接口声明目录 | 查到声明不代表当前服务已激活 |
| `Config` | Host Loader 的插件配置 Schema、包位置与投影限制 | 不代表 detached Preset 的完整树，也不读取实际配置值 |
| `Tool` | 请求 Agent 当前可见的工具 Schema | 不返回工具执行函数 |
| 官方 Skill / 包源码 | 当前安装版本的作者说明、类型和实现 | 原文中的操作示例不能改变实验合同权限 |
| 候选原生 QA / probe | 冻结 H 实际装配与运行观察 | G 的目录查询不能代替候选 H 的验证 |

这些能力帮助优化器核实 API，不保证其选择的机制或生成的算法正确。真实模型是否使用资料、改了什么、候选是否通过 QA、质量是否改善，分别从轨迹、源码和独立评分记录判断。

实现入口：[`preset.ts`](../src/preset.ts)、[`native-authoring.ts`](../src/native-authoring.ts)、[默认方法 Bundle](../optimizers/evidence-driven)。完整验收状态见 [completion.md](completion.md)。

真实模型已实际查询契约、加载官方 Skill 并提交两个实现变异；该轮 20 次执行中 1 次触发原 300 秒上限，总体验收保留失败，详见[原始结果](experiments/2026-10-28-native-authoring-results.md)。新运行默认任务预算为 600 秒，模型出口、流空闲和优化器等待预算同步声明，见[执行预算](execution-budgets.md)。
