# 将授权证据直接交给原生工具

真实用户旅程中，优化器把工具返回的工作簿 base64 转抄进文件：6,643 字节变成 6,288 字节，随后耗费多步排查 ZIP 错误。原始交付完整，损坏发生在转抄环节。框架现在把原字节发布到只读挂载，模型可用 DSH 文件、Shell 和领域工具直接检查。

```text
授权引用：kind + id + area + file
                 │
       实验内身份与区域权限检查
                 │
   可信根目录句柄 → 逐层打开 → 原字节
                 │
   私有 staging：文件 + 来源 + SHA256
                 │ 完整目录一次发布
                 ▼
   /evidence/<identity>/files/<basename>  只读
                 │
       DSH 原生文件 / Shell / 领域工具
                 │
       需要改动时自行复制到 /workspace
```

## 原生调用

先从状态及相应证据库存取得实际 ID 与文件名，再调用：

```json
{
  "kind": "run",
  "id": "<actual-run-digest>",
  "area": "delivery",
  "file": "result.xlsx"
}
```

`evolution_materialize` 返回可读路径、字节数、SHA256、原始引用和 provenance 文件路径。它不返回文件全文，不解释或修复文件；也不把工具自行报告的业务预期当正确证明。

| kind | 可选 area |
|---|---|
| `run` | `input`、`delivery`、`trace` |
| `candidate` | `source`、`build`、`artifact`、`qa` |
| `probe` | `source`、`suite`、`build`、`artifact`、`logs`、`observations` |
| `asset` | `source`：合同授权的研究资产源码文件 |

文件必须明确指定，目录清单仍通过原有证据工具读取。引用只在当前实验内解析，不接受宿主绝对路径、任意下载 URL 或调用者指定的写入目标；私有评分区域没有读取入口。相同来源和内容返回同一快照，内容变化产生新的身份，不覆盖已有证据。

## 读取与发布边界

独立评审实证发现，原有 `realpath → 前缀检查 → readFile` 存在竞态：候选可以在检查后替换文件或父目录。现在通过 Python 标准文件描述符接口，在可信授权根内逐层 `os.open(..., dir_fd=...)`，每层拒绝符号链接；目录清单与哈希也沿同一描述符树读取。终端仅接受普通文件，FIFO 等特殊文件不作为证据读取。候选冻结复制和研究资产读取复用这套实现。

实现依据 Python 官方 [`os.open(dir_fd=...)`](https://docs.python.org/3/library/os.html#os.open)、[`os.listdir(fd)`](https://docs.python.org/3/library/os.html#os.listdir) 及实际安装版本的能力检查。`Controller.start()` 在启动任务前调用 `fileReaderCapabilities()`；宿主 Python 3 必须提供相应 POSIX 能力，没有路径读取降级。Python 以 `-I -S` 启动，使用产品内固定程序，不加载候选目录、`PYTHONPATH` 或用户初始化代码。可信根目录及其宿主管理路径属于控制面的权限边界，不能由候选替换；容器内可写的后代目录不被当成可信路径。

发布前的临时目录不挂给优化器。文件和来源写齐、计算内容身份后，将完整目录移入只读 `/evidence`；并发发布者只有在已有文件与来源完全相等时才复用。进程在发布前崩溃不会暴露半份文件，私有残留保留供调查，不清扫别人的执行目录。这里验证进程中断语义，不宣称断电持久性。

活跃轨迹的快照记录本次实际读到的字节，不认证写入者已完成一个业务事务。证据内容仍可能不可信，原始调用日志和独立评分继续分别保存。

## 运行方式

`evolve` 自动建立实验 `materialized/` 到优化器 `/evidence` 的只读挂载。独立安装 Preset 时，部署方须建立相同目录映射；仅连接控制 HTTP 服务不会自动传输挂载。详见 [Preset 运行合同](presets.md)。

真实模型接口验收入口：

```bash
node --env-file=/absolute/private/venus.env scripts/verify-materialized-evidence.mjs \
  --root /absolute/new-evidence-directory \
  --image sha256:<immutable-image-id> \
  --isolation /absolute/isolation.json \
  --model examples/venus/model.json \
  --controller-ip <container-reachable-IPv4>
```

驱动让真实模型物化随机二进制、通过原生 Shell 复制和计算摘要、观察操作系统只读错误；主机独立核对原字节、原生调用、挂载与出口回执。它不执行评分任务、不提交候选、不重试，也不证明搜索收益。

## 实际验收 · 2026-10-28

| 验收层 | 结果 |
|---|---|
| 确定性与原生回归 | 75 项单元、11 项原生、16 项容器测试通过 |
| 独立竞态复核 | 真实生产接口的 8 组末端文件/父目录置换；未读取或发布授权范围外字节 |
| 真实模型 | 原生调用 `evolution_materialize` → Shell 读取并复制随机文件；8,192 字节与主机独立 SHA-256 完全相等 |
| 只读与回收 | 实际写入返回 `EROFS`，Docker 挂载 `RW=false`；worker、出口代理及两张网络均完成回收 |
| 分发包 | 同一 tarball 经原生 DSH 安装，Preset 加载、工具注册与实际调用通过 |

首次真实模型验收保留失败：Shell 实际报告只读文件系统，模型却将退出状态 `1` 写入要求符号 errno 的字段。修订驱动后明确要求从实际异常读取 errno，在新目录重新验证；产品代码与镜像未改变，原失败报告未覆盖。首次及修订后的会话各有 3 次 DSH stream 调用，分别报告输入/输出 8,852/823 与 2,053/677 tokens；调用统计不等同供应商内部 HTTP 重试次数。

原生轨迹、失败与通过回执、独立复核结果、代码及产物摘要见 [机器可读证据](evidence/2026-10-28-materialized-evidence.json)。这项结果证明文件交付及接口边界，不证明模型推理、候选业务正确性或进化收益。
