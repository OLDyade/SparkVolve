# 冻结运行权限，核验真实容器

隔离合同进入实验身份。构建、QA、优化器、执行器、评分器都显式选择运行时、非 root UID/GID 和资源预算；各角色使用合同内的网络权限。运行时缺失、原容器配置漂移或身份不符会直接失败。

```text
研究者声明 isolation ──冻结──► 实验合同
                                  │
       ┌──────────┬──────────┬────┴─────┬──────────┐
       ▼          ▼          ▼          ▼          ▼
     Build        QA      Optimizer   Executor    Grader
       └──────────┴──────────┴──────────┴──────────┘
                                  │
             daemon 注册运行时 → create → inspect 核验
                                  │
                       isolation.json（启动前）
                                  │
                  原容器执行 / 中断后接回并重新核验
                                  │
                    isolation-final.json（结束后）
```

## 声明与操作

```bash
# 使用当前非 root 用户身份，显式选择已注册运行时；不改变 daemon 配置。
node examples/isolation.mjs runc "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" \
  "${HE_TEST_DNS:?Set approved comma-separated IPv4 DNS servers}" > isolation.json
# 在专用 Linux Docker 宿主安装固定版本，再显式选择。
bash scripts/install-runsc.sh
node examples/isolation.mjs he-runsc-20261019 "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" \
  "${HE_TEST_DNS:?Set approved comma-separated IPv4 DNS servers}" > isolation.json
```

安装脚本固定 gVisor `20261019.0` 与各架构 SHA256，将完整 runsc/sidecar 发行包安装到独立目录，注册 `he-runsc-20261019`，使用 systrap；不替换已有运行时或默认值。宿主需具备 Docker、systemd、sudo、tar、bzip2、sha256sum，在线安装还需 curl。仅支持 Linux x86_64/aarch64。已存在的安装目录或同名注册直接拒绝覆盖。

隔离主机可先传入官方发行包，再执行 `bash scripts/install-runsc.sh /absolute/path/gvisor-aarch64.tar.bz2`。离线模式仍核对同一固定摘要，不联网下载或切换运行时。安装涉及宿主配置，应在研究者管理的专用 Docker 主机执行。

同一套验收覆盖两个运行时，必须声明 `HE_TEST_RUNTIME` 和部署方确认的 `HE_TEST_DNS`，缺失直接失败：

```bash
HE_TEST_RUNTIME=he-runsc-20261019 \
  HE_TEST_DNS="${HE_TEST_DNS:?Set approved IPv4 DNS servers}" \
  HE_TEST_IMAGE=$(docker image inspect harness-evolution:local --format '{{.Id}}') \
  npm run test:container
```

GitHub Actions 分别运行 runc 和固定 gVisor，将测试日志与各角色隔离回执保留 14 天。远端任务当前被账户账单限制阻止启动，矩阵配置不代表云端验收通过。

生成器提供可编辑的工作站配置。框架不补缺失字段、不自动选择默认运行时、不在运行失败后回退。`prepare.mjs` 第五参数必须为此 JSON；冻结后修改合同需要新实验。UID/GID 必须能访问挂载目录，框架不会修改宿主目录权限。远端 Docker 的挂载路径必须真实存在于 daemon 宿主；本地路径不会自动上传。

| 字段 | 含义 |
|---|---|
| `runtime` | Docker 注册的精确名称；名称不证明实现或隔离强度 |
| `user.uid/gid` | 明确的非 root 用户，五类角色共用 |
| `memoryMiB` / `cpus` / `pids` | 每容器内存、CPU、进程上限；swap 总限额等于内存上限 |
| `tmpMiB` / `homeMiB` | 临时文件系统大小及用户所有权；`/tmp` 允许 DSH 动态库执行 |
| `network` | build 为 none 或 bridge；optimizer 为 controlled，executor 为 controlled 或 none；QA/grader 固定 none |
| `network.egressPool` | 部署方预留的私有 IPv4 CIDR；每个受控执行占用两个 `/29`，包括优化器；合同检查并发所需容量 |
| `network.egressDns` | 必填的 1–3 个 IPv4 resolver；拒绝重复、0.0.0.0、回环、组播、广播及与 egressPool 重叠的地址，无默认值 |

固定清空 capabilities、禁止提权、只读根文件系统、私有 IPC；镜像入口被显式命令替代。核验用户、资源、网络、挂载读写、运行时及命令，拒绝镜像隐式 volumes。恢复沿用原容器，权限变化不触发任务重跑。

## 出口 DNS

可信 broker 需要解析合同内上游；候选继续使用静态 hosts 与回环 DNS。Docker 自定义 bridge 的内置 DNS `127.0.0.11` 无法由 runsc 隔离 netstack 访问，单独设置 `--dns` 仍会经过这个地址。[gVisor 官方说明](https://gvisor.dev/docs/user_guide/faq/#docker-bridge)给出的适用方案是为容器只读挂载指向可达 resolver 的 `/etc/resolv.conf`。本框架将 broker 的 resolver 冻结在合同中，不切换 host network 或降低运行时隔离。

列表最多 3 项，与镜像中 glibc 的 `MAXNS` 一致；超出直接拒绝，不截断或让系统静默忽略。[Linux resolver 文档](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)

若部署方尚未提供 resolver，可从已构建镜像与已注册运行时的 default bridge 读取候选列表；辅助脚本不调用模型、不传凭证，退出后清理本次容器：

```bash
npm run build
mkdir -p .evolution/deployment
node scripts/egress-dns.mjs \
  "$(docker image inspect harness-evolution:local --format '{{.Id}}')" \
  "${HE_TEST_RUNTIME:?Select a registered Docker runtime}" > .evolution/deployment/dns-discovery.json
# 检查发现记录及部署网络后，显式采用已确认的列表；也可使用部署方直接提供的地址。
export HE_TEST_DNS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).servers.join(","))' \
  .evolution/deployment/dns-discovery.json)
```

脚本仅报告该镜像/运行时的原始 `resolv.conf` 与 IPv4 列表，不证明目标网络可达。最终验收必须在声明运行时、受控双网络和只读 resolver 文件下完成实际解析与请求，并验证原 broker 恢复。内网专用 resolver 可以显式声明；地址不能落入候选地址池，避免路由覆盖。CI 同样先发现并显式写入 `HE_TEST_DNS`，随后执行真实受控容器测试。

## 证据与边界

回执记录容器 ID、镜像 ID、合同、实际设置和 daemon 版本、内核、架构及运行时注册资料。仅序列化白名单字段，不保存 `Config.Env` 或完整 inspect。

| 环境 | 隔离边界 | 当前验收 |
|---|---|---|
| Linux Docker / OrbStack 的 runc | namespaces/cgroups，共享 Linux 内核 | 已实测非 root、禁网、只读、漂移拒绝及完整 DSH 链路 |
| gVisor/runsc 20261019.0 · systrap · Linux ARM64 | 用户态 Sentry 处理应用系统调用 | 专用 Debian 13 Docker daemon 实测构建、原生 DSH、评分、恢复、安装及真实模型事件接续；见 [验收证据](evidence/2026-10-27-gvisor-acceptance.json) |
| Firecracker | KVM 驱动独立 guest kernel；还需生产宿主和网络配置 | 调研完成；尚无 MicroVM 执行后端 |

回执依赖可信 daemon，无法对抗宿主管理员，不属于加密远程证明。本次 gVisor 实验机关闭 Mac 文件共享与宿主/其他机器网络访问，但 OrbStack 机器仍共享 Linux 内核，不能宣称每题独立微虚拟机。可信控制器持有专用 daemon socket，候选容器不挂载该 socket。受控执行的真实凭证留在独立出口代理，插件使用占位值；独立进程边界仍依赖所选容器运行时。工作目录和日志尚无磁盘配额；内存/PID 限制不解决磁盘耗尽。当前候选应在专用研究宿主运行。磁盘配额与 MicroVM 后端仍需继续实施。

来源及验收见 [运行隔离研究](research/2026-10-27-runtime-isolation.md)。

[受控出口架构实验](research/2026-10-28-controlled-egress.md)已在 runc/gVisor 验证 internal + isolated 网络、代理进程外凭证、显式 DNS/hosts 与代理停止失败。该实验使用独立 HTTP 夹具。

[受控出口组件](controlled-egress.md)已接入正式 Controller 与优化器；runc、gVisor 真实模型均完成中断恢复、独立评分、证据归档与资源释放。gVisor 最终镜像完成 4 次模型调用，实际只读 DNS 挂载及摘要核验通过，原容器与网络回收；见[本轮证据](evidence/2026-10-28-gvisor-controlled-dns.json)。显式有限地址池覆盖 62 个网络及跨进程竞争；失败回收也持久化，恢复只继续清理。部署方必须预留不与宿主/LAN/VPN 冲突的地址段，框架只核对 Docker IPAM 已占用网段，不能替代部署网络规划。
