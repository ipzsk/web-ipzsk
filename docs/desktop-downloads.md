# 官网桌面客户端下载

`/workstation#download` 从 `/api/desktop-release` 读取 GitHub 仓库
`JayceHuang/ipzsk-dsh-desktop` 的 Latest 正式版。接口 CDN 缓存 5 分钟，
安装包由浏览器直接从 GitHub 下载，不经过 API 服务器转发。

发布顺序：编译 → 创建 draft Release → 上传完整附件 → 发布并设为 Latest。
仅推送代码或完成 CI 编译不会改变官网；必须发布 GitHub Release。
草稿与 prerelease 不展示，当前正式版缺少的平台显示暂未发布。
GitHub API 暂时不可用时提供 GitHub Latest 发布页入口。

Mac 附件使用 `IPZSK.Desktop-版本-arm64.dmg`、`IPZSK.Desktop-版本-x64.dmg`。
Windows 附件使用 `DSH-Desktop-版本-x64-Setup.exe`（沿用当前客户端打包配置）。
更改打包附件命名时，需要同时调整 `api/desktop-release.js`。

生图插件在 `JayceHuang/dsh-imagegen` 单独发布，由 IPZSK 插件市场审核上架。
本次未修改客户端内部自动更新协议，也未改变旧工作台安装包的存储或地址。
