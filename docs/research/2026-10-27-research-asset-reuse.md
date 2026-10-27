# 授权研究资产复用：设计依据与验收

## 一手资料与适用范围

- [OCI Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)：digest 标识确切内容，接收方重新计算校验。这里借鉴内容绑定原则，不把本地档案冒充 OCI registry。
- [SLSA 1.2 artifact verification](https://slsa.dev/spec/v1.2/verifying-artifacts)：签名信任根和 subject 摘要匹配是不同检查。当前库由研究者本地授权并冻结；校验摘要不等于完成签名认证，也不认证历史得分。
- [Node 24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html)：递归 cp 的 errorOnExist/force 控制文件覆盖，不提供数据库来源记录与目录发布的联合事务。采用持久导入意图、私有 staging、提交准入状态和同意图恢复。
- 原生工具复用实际 DSH `0.2.1-rc.4` 的 `defineTool` 和 Cordis 生命周期。没有新建 Agent Loop，也没有给优化器挂载研究库、数据库或评分私有目录。

## 具体改变

新合同字段 `researchLibrary` 明确授权目录及摘要，未授权用 null。检索包含失败记录；查看提供精确源码与记录摘要；导入复制源码并登记 origin。新候选始终重新评分，导入不会带入旧 mean、TaskRun 或 champion。授权库变动、错误 ID、越界路径及源码/产物失配直接失败。

只读子代理指出并已修复“先发布草稿再记录来源”的中断窗口。现在先写 pending 导入意图，复制校验后提交 ready；提交候选拒绝 pending，同意图恢复不会清除已完成草稿的后续修改。故障注入覆盖复制前、发布后记录提交前、记录提交后响应丢失，并重开 SQLite 验证。

24 项单元、8 项原生以及 3 项真实容器测试通过。[真实模型验收](../evidence/2026-10-27-library-acceptance.json)在两个合成负结果档案中选择相关资产，检查记录与实现后导入：3 次检索、3 次资产查看（包含原始 index.mjs）、1 次导入，10 次模型请求全部返回，容器 22.618 秒。草稿命名由模型选择，源摘要一致，未导入无关项；0 候选、0 测评运行、无冠军。此项证明自主工具使用与来源传递，仍未证明复用能提高任务得分。

原生调用轨迹还显示模型尝试从 `/workspace/library` 查找资产，实际库未挂载；随后通过授权工具完成读取。两个合成档案共享同一最小源码，模型在结束原因中主动指出该边界，依据研究记录区分相关性；这不是复杂代码检索基准。
