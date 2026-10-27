# 开源仓库建设依据

用户指定参考 [XHToken/dsh-intelligent-router](https://github.com/XHToken/dsh-intelligent-router)，本次核验固定到 [`d762b8e8ebd9f07dcea34fe2da56202f9f727fe4`](https://github.com/XHToken/dsh-intelligent-router/tree/d762b8e8ebd9f07dcea34fe2da56202f9f727fe4)。

| 借鉴方向 | 本仓库落实 |
|---|---|
| 一句话理解价值与机制 | 保留用户核心原句，README 给完整反馈流程和入口 |
| 原生插件安装与调用说明 | `npm pack → dsh plugin add`；独立分发测试实际调用已安装工具 |
| 版本和运行边界透明 | 固定 DSH、Node、npm、镜像；兼容性文档与失败记录 |
| 可参与、可引用、可验证 | Contribution、Issue / PR 模板、行为准则、CITATION、CI |
| 明确许可与归属 | 对方 LICENSE 与 package.json 为 Apache-2.0；本仓库同样采用标准 Apache-2.0，并保留本项目独立版权 |

未引入对方路由器实现、产品名或模型降级策略。README 的传播表达不替代真实实验；分发测试、真实模型验收和独立研究结论分别列出。

其他核验：

- npm 12 修改了 `pack --json` 结构，改为包名键控对象。本地 npm 12.2.0 实测与 [npm 12 变更记录](https://github.com/npm/cli/blob/latest/CHANGELOG.md)及[实现](https://github.com/npm/cli/blob/latest/lib/commands/pack.js)一致。安装测试据锁定版本处理，没有双格式兼容兜底。
- DSH 原生命令负责把 Bundle 纳入目标 Profile；目标 Profile 的 pnpm 构建授权仍需显式配置。依据安装版本 `@deepseek-ai/dsh@0.2.1-rc.4` 的 `runPlugin` / `runPluginCommand` 和实际安装输出。
- DSH 适配器可通过 finish 事件的 `reason.kind=error` 返回传输失败。遥测必须将其计为 failed，即使生成器没有 throw；真实 SDK 子进程测试覆盖这个路径。

GitHub Actions 受账号支付/消费额度限制，任务未启动。云端结果单独列为外部未完成项；本地测试结果不会写成云端矩阵通过。
