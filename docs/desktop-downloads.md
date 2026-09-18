# 官网桌面客户端下载

首页下载菜单和 `/workstation#download` 都从网关 `GET /api/public/desktop-release`
读取版本与下载地址。安装包存在私有 R2 桶 `ipzsk-user-images` 的
`desktop/<版本>/` 下，桶不开公共读；接口下发的是时间切片签名 URL（与案例图同一套，
几小时内稳定，浏览器可以缓存），安装包由浏览器直连 R2 下载，不经过网关转发。

发布顺序：编译 → CI 把安装包传到 `desktop/<版本>/` → 写 `desktop/<版本>/manifest.json`
→ 覆盖 `desktop/latest.json`。**`latest.json` 是官网唯一看的东西**：安装包传上去但
没更新 `latest.json`，官网不会变。历史版本留在桶里，可以用 `?version=x.y.z` 取到。

两份 JSON 形状相同：

```json
{
  "version": "2.0.8",
  "released_at": "2026-09-18T00:00:00Z",
  "files": [
    { "platform": "mac", "name": "IPZSK.Desktop-2.0.8-arm64.dmg", "bytes": 187000000, "sha256": "<64 位小写十六进制>" }
  ]
}
```

`platform` 只认 `mac`（Apple Silicon）、`mac-intel`、`windows`；`name` 是
`desktop/<版本>/` 下的文件名，不能带 `/`。形状不对、版本对不上、`latest.json` 缺失，
接口一律返回 503 `desktop_release_unavailable`，官网退到 GitHub 发布页
（**只是最后兜底**，那是私有仓库，终端用户打不开）。

当前正式版缺少某个平台时，该平台的按钮是明确的禁用态「暂未发布」，不再给一个点了打不开的链接。

Mac 附件使用 `IPZSK.Desktop-版本-arm64.dmg`、`IPZSK.Desktop-版本-x64.dmg`。
Windows 附件使用 `DSH-Desktop-版本-x64-Setup.exe`（沿用当前客户端打包配置）。
命名变了只需要 CI 写出的 `manifest.json` / `latest.json` 跟着变，官网按 `platform` 取，不认文件名。

迁移历史版本：在生产网关容器里跑
`node scripts/upload-desktop-release.mjs <版本> <目录>`（幂等，加 `--keep-latest` 只写
`manifest.json` 不动 `latest.json`）。CI 不走这个脚本，CI 直接传。

生图插件在 `JayceHuang/dsh-imagegen` 单独发布，由 IPZSK 插件市场审核上架。
本次未修改客户端内部自动更新协议（`/api/desktop/version`、`/api/desktop/download/*` 仍读 GitHub）。
