# 持久磁盘边界：路线与宿主实测

状态：研究与宿主能力探测。尚未接入生产控制器，磁盘配额缺口保持开放。

## 当前真实边界

`src/docker.ts` 的可写 bind mount、结束后复制出的 stdout/stderr 及冻结产物归档目前没有硬容量上限。已有只读 rootfs、有界 tmpfs、内存/PID 限制不能代替持久磁盘边界。

he-runsc-lab 使用 OrbStack 管理的 btrfs，Docker 29.9.2 使用 containerd overlayfs snapshotter，默认 json-file 日志。btrfs 已启用 squota；本次未修改 OrbStack 的全局配额或机器安全设置。没有 `/dev/kvm`，不能据此完成 Firecracker 独立 guest kernel 验收。

## 推荐设计

```text
部署侧受限存储池（真实总容量，保留控制状态空间）
 ├─ 执行卷：每次运行独立固定容量文件系统，代码只得到挂载目录
 ├─ 日志卷：可信接收器、明确溢出失败，底层仍执行硬容量限制
 └─ 归档池：冻结产物与证据有总预算，不把压力转移到无限宿主目录

卷身份 → 文件系统 UUID / backing identity / mount identity
       → 原卷恢复 → 原容器完成 → 归档 → 卸载与释放
```

固定容量 ext4 块设备是一条可实施路线：部署方预分配镜像，由可信宿主管理器挂载，候选无 loop/block device 权限；写满由内核返回 ENOSPC，原卷保留用于恢复。生产环境也可明确采用 XFS project quota，但需验证项目继承与绕过路径。两种后端均需显式声明和独立验收，不自动切回普通目录。

[losetup 官方手册](https://man7.org/linux/man-pages/man8/losetup.8.html)指出 find/关联不是原子操作，生产管理器需要互斥及 identity 核验。`--nooverlap` 避免同一 backing file 重复映射，不能独自替代并发租约。

[Docker local 日志规则](https://docs.docker.com/engine/logging/drivers/local/)会在超过 max-file 后删除旧记录；这是诊断窗口的保留策略，不能作为完整取证的证明。完整日志要求有界可靠接收、溢出明确终止及独立控制状态空间。仅轮询目录大小或事后清理不提供硬隔离。

## 本次能力探测结果

安装 Debian 签名仓库的 e2fsprogs 1.47.2-3+b12。首次 apt 索引更新因现有离线镜像缺少翻译索引失败；显式关闭翻译索引后，现有在线签名源正常安装，未修改软件源或依赖版本。

独立 64 MiB 文件已成功预分配并格式化为 ext4；实际 `sudo losetup --find --show --nooverlap` 返回 **Operation not permitted**，尚未进入挂载或容器写满测试。`losetup -f` 能看到空闲 `/dev/loop0`，不证明该机器允许关联设备。第二次只为补齐第一份探测未记录的命令 stderr，在新文件中复现；两份失败产物保留。事后 loop 列表为空，无挂载或设备关联残留。见[原始报告](../evidence/2026-10-28-persistent-volume-host-probe.json)。

后续需要核实受支持的 Linux 宿主能力，或对另一明确后端完成完整隔离证明。不能把格式化成功、设备节点存在或配置项存在写成磁盘验收通过。

补充核验：[OrbStack 官方资源接口](https://docs.orbstack.dev/machines/#resource-limits)和本地 `orb create --help` 都提供 `--disk`，可调查每任务独立受限 machine 的开发后端。当前共享机器总限额不能当作逐任务预算；该方式仍共享 Linux 内核，[官方安全模型](https://docs.orbstack.dev/machines/isolated)不将其视为对抗主动内核逃逸的独立 VM。没有查到受支持的 machine loop 开关；不会用 privileged/nsenter 进入共享宿主绕过 EPERM。具备 `/dev/kvm` 和受限存储池的专用 Linux 主机仍是完整生产验收的推荐环境。

## 完成依据

字节与 inode 耗尽、write/fsync/close、超大 stdout/stderr、任务间隔离、进程重启后原卷恢复、归档池耗尽、路径替换与 quota/subvolume ioctl 绕过都需要实际验收。MicroVM 与磁盘限制独立验证，gVisor Sentry 和 OrbStack 共享内核不作为独立虚拟机的替代证据。

其他官方调研入口：[XFS 配额](https://man7.org/linux/man-pages/man8/xfs_quota.8.html)、[Docker containerd 存储](https://docs.docker.com/engine/storage/containerd/)、[btrfs 子卷](https://btrfs.readthedocs.io/en/stable/btrfs-subvolume.html)、[qgroup](https://btrfs.readthedocs.io/en/latest/Qgroups.html)、[Firecracker 宿主要求](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)。gVisor 的 [FUSE/NFS 延迟配额错误报告 #16043](https://github.com/google/gvisor/issues/16043)仍需按实际版本检验，不能据一条 issue 断言所有环境受影响。
