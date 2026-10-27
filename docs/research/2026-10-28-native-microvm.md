# Native macOS MicroVM isolation: source findings and installation evidence

研究日期：2026-10-28（Asia/Shanghai）。本记录服务于执行、构建、优化器的隔离后端；不修改核心思想、实验选择或生产 Docker 接口。

## 结论与真实状态

Apple `container` 提供本机可用的原生方向：每个 container 独立 Linux VM，使用 Virtualization.framework，并支持 OCI 镜像和固定容量 ext4 持久卷。此前 OrbStack 内 `losetup` 的 `Operation not permitted` 只否定那个共享内核环境中的 loop 挂载路径，不能推出本机没有 MicroVM 路线。

**目前未完成运行验收，也未接入生产执行后端。** 官方签名安装包已下载并校验成功；安装被管理员认证要求阻止，未启动服务、VM、容器、网络或卷。

| 实机项目                                    | 观测                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 操作系统                                    | macOS 26.6.2，build 25G83                                                                               |
| CPU / 架构                                  | Apple M4 Pro / arm64                                                                                    |
| `kern.hv_support`                           | `1`                                                                                                     |
| CLI                                         | PATH 和常见安装路径中未发现 `container`；`krunvm`、`vfkit`、`limactl` 未在 PATH 中发现                  |
| 官方安装包                                  | `container-1.6.1-installer-signed.pkg`，155,965,213 bytes                                               |
| SHA-256                                     | `cd47846819f06478d067060efe21e516b562ac0a9af8eecad6d5fea0b556b200`，与 GitHub release asset digest 一致 |
| `pkgutil --check-signature`                 | exit 0；Apple Inc. - Containerization (`UPBK2H6LZM`)，Apple notary service trusted                      |
| `spctl --assess --type install --verbose=2` | exit 0；`accepted`、`source=Notarized Developer ID`                                                     |
| 官方安装                                    | `sudo -n /usr/sbin/installer -pkg … -target /` 返回 exit 1：`sudo: a password is required`              |
| 内核隔离 / ENOSPC / 断点重连 / 日志硬界     | **unknown：尚未执行原生 VM 验收**                                                                       |

原始证据保留在忽略目录 `.evolution/apple-native-20261028-preflight/receipt.json`，UTC 时间 `2026-10-27T20:47:54.616Z` 至 `20:48:01.238Z`。安装包保留在同目录，不提交二进制。失败 receipt 完整保留；原始下载重定向包含 GitHub 的临时公开资产签名 URL，不作发布材料。探测脚本后续只记录重定向 origin/path，不保存查询参数。

新增脚本 [`scripts/probe-apple-isolation.mjs`](../../scripts/probe-apple-isolation.mjs) 是安装与能力前置探测，**不包含 VM 验收实现**。每次要求新证据目录，保存逐条命令、输出与退出状态；所有未执行能力维持 `unknown`，`acceptedAsExecutionBackend` 始终为 false。`--install` 仅使用固定官方签名发行包；不会解包到私有目录绕开系统认证，也不会启动后台服务。

```sh
# 必须使用新的目录，拒绝覆盖旧失败证据。
node scripts/probe-apple-isolation.mjs --install .evolution/apple-native-new-attempt
```

当前继续安装需要用户在官方安装器输入管理员密码。已经下载校验的包可直接使用；无需提供密码给 Agent。安装完成仅消除前置阻塞，不能据此宣布隔离验收完成。

脚本语法和仓库 Prettier 检查通过；重复使用原证据目录实测返回 `EEXIST`，原记录未覆盖。独立 subagent 方向评审确认未混淆预检与运行验收，并指出已装 CLI 的版本核验缺口；现已按稳定版 [ReleaseVersion 格式](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/ContainerVersion/ReleaseVersion.swift#L18-L24) 检查 version、release build 和 commit，拒绝把其他版本套入本次能力表。该 CLI 分支尚未在本机执行。

## 固定资料版本

先通过 Context7 resolve 检索 `/apple/container`、`/libkrun/libkrun` 与 `/libkrun/krunvm`，再核对官方稳定 tag 源码，避免把 main 文档当已发布行为。

| 项目                   | 本次核实版本与来源                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple container        | [1.6.1 release](https://github.com/apple/container/releases/tag/1.6.1)，发布于 2026-10-23；tag 对应 commit `aa8d76b44a834eee3ebf6a0bc577e376f65f6361`                                                                      |
| Apple Containerization | 上述发行版 [Package.resolved](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Package.resolved) 锁定 0.53.0、commit `f79e412d7c31b00c65c8a6f80dd0b0bb55f6a4f7`；未取得独立 latest release |
| libkrun                | [v1.19.7](https://github.com/libkrun/libkrun/releases/tag/v1.19.7)，发布于 2026-10-22                                                                                                                                      |
| KrunVM                 | [v0.2.7](https://github.com/libkrun/krunvm/releases/tag/v0.2.7)，发布于 2026-08-25                                                                                                                                         |

## Apple 原生能力与边界

| 能力          | 稳定版已核事实                                                                                | 对本项目的含义                                                                  |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 独立内核      | 每容器轻量 VM，基于 Virtualization.framework；正式支持 Apple Silicon / macOS 26               | 本机符合公开平台要求；仍需实测不同 boot ID、资源与设备配置                      |
| 镜像          | 消费与产出 OCI 镜像                                                                           | 可复用镜像格式和 digest；CLI、inspect、网络、退出与恢复协议必须独立适配         |
| 持久卷        | named volume 使用 ext4，创建时指定 `size`；默认 512 GiB sparse image                          | 必须显式小容量；工作数据无需无界 host bind。容量参数不等于 ENOSPC 已通过        |
| 网络 none     | `NetworkClient.noNetworkName = "none"`；CLI 将单独 `--network none` 转为 `config.networks=[]` | 无网 grader 有原生接线；零网卡、IPv4/IPv6/DNS/host 可达性仍需实测               |
| internal 网络 | `--internal` 映射 host-only                                                                   | 保留主机网络通路，不能作为 broker-only egress 的完成证明                        |
| 资源          | CPU、memory、readonly root、cap-drop、tmpfs、ulimit 均有接口                                  | 当前合同的 pids、no-new-privileges、swap 必须逐项核对；不支持项应暴露，不忽略   |
| 日志          | VM runtime 将 stdout/stderr 写入宿主 bundle 的 `stdio.log`                                    | 工作卷大小不限制宿主日志；需要独立硬边界，不能以轮询删除日志冒充                |
| 恢复          | 原生服务保留 container/process 身份和退出等待接口；named volume 可跨运行保留                  | 重连原任务、恢复已保存数据、重新启动进程三者必须区分；本次未验证内存 checkpoint |

关键来源：

- [平台与官方安装](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/README.md)、[VM 架构](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/docs/technical-overview.md)。签名包需要管理员认证安装 `/usr/local`，与绕开 OrbStack 权限限制无关。
- [持久卷](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/docs/volumes.md)、[EXT4 格式化实现](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/ContainerAPIService/Server/Volumes/VolumesService.swift)。源码调用 `EXT4.Formatter(... minDiskSize: sizeInBytes ...)`，仍需核实实际块数、可写容量与 inode 耗尽行为。匿名卷不会因 `--rm` 自动删除，必须按本次创建清单回收。
- [none 常量](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/ContainerAPIService/Client/NetworkClient.swift#L39-L43)、[CLI 无网分支](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/ContainerAPIService/Client/Utility.swift#L185-L205)。该行为在命令参考中不突出，已以稳定源码补证；不得继续记为“CLI 无 none”。
- [命令与网络合同](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/docs/command-reference.md)、[运行配置](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/docs/runtime-configuration.md)。`--no-dns` 不阻止直接 IP 连接。
- [宿主 stdio 写入](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/RuntimeLinux/Server/RuntimeService.swift#L225-L240)、[stdio 路径](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/Runtime/RuntimeClient/Bundle%2BLog.swift)、[开发 FileLogHandler 无轮转](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/ContainerLog/FileLogHandler.swift#L19-L20)。这两类日志均不在工作 ext4 卷里；当前未找到 CLI 硬日志上限接口，不能声明全写入路径有界。
- [runtime wait](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/RuntimeLinux/Server/RuntimeService.swift#L623-L644)、[start 行为](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/ContainerCommands/Container/ContainerStart.swift)。恢复控制器时不能不分状态地 start 原任务；CLI 对已运行容器重新 attach 也有明确限制。

## 与当前执行协议的接合

保留 `execution.ts` 的创建意图、实际资源身份、终态证据、恢复和回收顺序，新增独立后端实现。不能将 Docker 命令直接换成 `container`：

```text
冻结执行合同、OCI digest、kernel/init 身份
                  │
    ┌─────────────┴─────────────┐
    │ Docker / gVisor 后端      │ Apple 原生 VM 后端
    │ Docker inspect / wait     │ 原生 API 配置 / process wait
    │ Linux 网络边界            │ 无网 VM / 独立 broker 通道
    │ 原生宿主存储约束          │ 显式 ext4 卷 + 宿主日志约束
    └─────────────┬─────────────┘
                  │
同一语义的身份核验、资源证据、终态归档、失败保留与定向回收
```

文件暂存、优化器可写区、构建上下文与缓存、镜像展开、执行卷、宿主 stdio、归档 staging 各自明确所有者与限额；只限制 `/workspace` 不能闭合磁盘边界。镜像缓存若在共享可信服务中，也须单独限额与归属记录。guest 侧 ext4 满盘和宿主服务日志限额应由真实文件系统或内核约束实现。日志字节轮询、下载大小检查与应用捕获长度只限制各自工具输出，不属于恶意 guest 的磁盘配额证明。

当前 Apple CLI 的宿主 stdio 硬上限没有闭合。可研究直接 Containerization API 的受限日志 sink 或受内核容量约束的独立服务数据目录；二者均尚未实施，不将路径重定位或虚拟磁盘文件大小直接标记为安全。

## 最小原生验收合同（待安装后执行）

1. 用固定 OCI digest、kernel/init 身份启动两个测试 VM；保存配置与不同 Linux boot ID，验证独立进程空间。仅使用自有无模型 fixture。
2. 无网络配置先验核对为零 attachments，再验证 guest 只有 loopback、没有非本地路由，外网、宿主、peer、DNS 均不可达。禁止改用 internal/NAT 让测试继续。
3. 创建显式小容量 ext4 卷；在非 root 工作进程中写到真实 ENOSPC，记录总块数、inode、实际写入量和宿主占用。终止后重挂同卷读取已 fsync 的随机标记，核对 hash；回收仅操作本次卷。
4. 对 rootfs、tmpfs、宿主日志、构建和归档目录执行独立边界检查。持续写日志的对抗测试须先具备宿主硬限额，避免用无界日志洪泛宿主。
5. 杀掉控制器而保持 VM 运行，重新连接同一 VM、同一进程、同一卷；写入计数证明没有重新启动工作负载。正常结束后独立恢复退出码；VM crash 必须保留失败，不能自动重跑。
6. 核对 CPU/memory/pids/权限和 no-new-privileges 的实际 enforcement；缺失字段保留 fail/unknown。完成后归档配置、终态、日志与数据 hash，再回收本次资源。

上述合同尚无通过结果。前置脚本 exit 1 表示已保存的安装或环境阻塞；exit 2 表示前置检查完成但运行验收仍缺失。不存在“预检通过便接受后端”的路径。

## libkrun / KrunVM 比较

[libkrun v1.19.7](https://github.com/libkrun/libkrun/blob/v1.19.7/README.md) 支持 macOS ARM64 的 Hypervisor.framework，与 Linux KVM 是不同宿主路径。它有 virtio-block/fs/net 等基础能力，但官方安全模型要求使用宿主机制隔离 VMM；virtiofs 自身不保护其他宿主目录，默认 TSI 网络使用 VMM 的网络上下文。

[KrunVM v0.2.7](https://github.com/libkrun/krunvm/blob/v0.2.7/README.md) 用 Buildah 展开 OCI、libkrun 启动 VM，默认的宿主目录和 virtiofs 根文件系统不能直接承担固定持久磁盘边界。它适合定制 VMM 路线，但需要更多宿主沙箱、网络和存储工作；本次未安装或启动。

本机优先验收 Apple 原生路径，外部原生 Linux 主机仍是另一种部署选择。该选择来自已核平台能力与接口，不代表 Apple 路线已经通过完整执行合同。
