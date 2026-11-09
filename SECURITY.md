# 安全说明

## 支持范围

当前维护最新公开发布版。报告问题时请先确认是否可在最新版本复现。

## 报告漏洞

请通过 GitHub 的 [Report a vulnerability](https://github.com/wylycool/argus/security/advisories/new) 私下报告安全问题，不要在公开 Issue 中放入可利用细节或私人文件。

请提供版本、macOS 版本、最小复现步骤、影响说明和已脱敏的示例。项目由个人维护，处理时间视问题情况而定。

## 安全边界

- Markdown 经 DOMPurify 清理；Mermaid 使用严格模式并清理生成的 SVG。应用设置 CSP，禁用脚本嵌入和 iframe。
- 本地文档与图片由原生层读取并执行路径、授权和大小检查；只读源码视图不写入文件。
- 编辑会写入用户打开或选择的文件；保存前校验版本并使用临时文件替换。冲突或失败会保留输入并提示处理。
- 草稿与历史保存在 `~/Library/Application Support/app.argus.reader/`，不上传。它们未单独加密，其他拥有相应本机权限的进程仍可能读取。
- 远程图片会访问其来源服务器，可能暴露 IP 等网络信息；外部链接交给系统浏览器。
- 历史有容量和数量上限，不能替代独立备份。突然断电或强制结束进程可能丢失最近尚未保存的输入。
- 当前 DMG 尚未进行 Apple Developer ID 签名和公证；请从本仓库 Releases 下载，并核对随版本发布的 SHA-256。
