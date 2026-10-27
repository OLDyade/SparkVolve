# Contributing

`11.md` 保留项目核心思想。代码改动必须能回答：改了哪个插件机制、证据是什么、独立验证如何进行。

```bash
npm ci
npm run check
npm run test:install
docker build -t harness-evolution:test .
HE_TEST_RUNTIME=runc HE_TEST_IMAGE=$(docker image inspect harness-evolution:test --format '{{.Id}}') npm run test:container
```

- 使用 Node 24.16.0、npm 12.2.0；原生 Bundle 安装使用 pnpm 12.15.0。
- DSH API 先核对实际安装的版本与源码。新增插件能力通过原生 Cordis 注册、执行、释放验收。
- 改动实验状态机需要覆盖中断、重复投递、评分恢复、失败分母与冠军更新。
- 新领域通过输入目录、任务契约、独立评分镜像和能力 Bundle 接入。禁止在框架里添加题目 ID 分支或答案。
- 失败报告保留；服务异常与业务失败分开；不得靠重抽、降级模型、修改裁判使检查通过。
- 单元测试、协议夹具、真实模型闭环、独立质量实验分别标明。提交实验结论必须附完整分母、版本、重复次数、负结果与成本。
- `test:install` 在临时 DSH Home 中打包、原生安装并实际调用十二项能力中的状态工具；它使用确定性 Provider，检验分发和运行接线，不计作模型质量结果。
- 表格镜像在任何付费模型任务前按 README 运行 `verify-image.mjs`：实际生成 XLSX、调用独立评分脚本和 LibreOffice 重算；只验证基础运行依赖，不访问研究题目或提供质量成绩。
- 运行产物、数据集、密钥不提交。公开前检查授权、许可证、敏感信息和研究证据。

依赖或运行协议升级直接迁移至明确的新契约，并更新验证证据。仓库不维护未经测试的历史接口兼容层。
