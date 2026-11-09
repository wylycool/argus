# Argus 0.10.0

Argus 首次开源发布：轻量的 macOS Markdown 阅读与编辑软件，采用 MIT 许可证。

## 本版功能

- 默认阅读，主动进入编辑，自动保存到本地 Markdown 文件。
- 编辑实时预览、可拖动分栏、双向滚动和窄窗口标签切换。
- 新建文档、本机草稿、外部修改检测、保存冲突保护与历史差异。
- 图片插入、Mermaid 图表、大纲、八套主题和阅读排版。
- 搜索已打开文档、快速切换、携带本地图片另存副本、系统打印与 PDF。

## 下载安装

下载 `Argus_0.10.0_aarch64.dmg`，打开后把 Argus 拖入 Applications。需要 macOS 12 及以上，Apple Silicon（M 系列芯片）。更新前请正常退出旧版。

当前包使用临时签名，未进行 Apple Developer ID 签名和公证。macOS 可能提示无法验证开发者；请确认来自本仓库并校验 SHA-256，再按“系统设置 → 隐私与安全性”的提示允许打开。

```sh
shasum -a 256 -c SHA256SUMS.txt
```

SHA-256：`8b7d35c86deaf3a1f92307b73871427438c521203b29393e8deb0abc93dae449`。

当前未提供 Intel Mac、Windows 或 Linux 安装包。GitHub 自动生成的源码压缩包不能直接安装。

## 验证范围

本地通过 193 项前端测试、39 项 Rust 测试、TypeScript 检查和前端生产构建；安装包已核对版本、架构、临时签名、镜像完整性和 SHA-256。本轮没有重做系统文件对话框、Finder 交接与 WKWebView 原生打印的完整人工验收。

[使用指南](https://github.com/wylycool/argus/blob/main/docs/open-source/user-guide.md) · [问题反馈](https://github.com/wylycool/argus/issues) · [许可证](https://github.com/wylycool/argus/blob/main/LICENSE)
