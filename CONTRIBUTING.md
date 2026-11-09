# 参与 Argus 开发

欢迎修复缺陷、完善文档和改进使用体验。较大的功能请先通过 Issue 说明使用场景和方案。

## 开发环境

- macOS 12 及以上；目前发布和验证面向 Apple Silicon。
- Node.js 24、npm、Rust stable 和 Xcode Command Line Tools（`xcode-select --install`）。
- 首次执行 `npm ci` 安装前端依赖；Rust 依赖由 Cargo 根据 `src-tauri/Cargo.lock` 安装。

```sh
git clone https://github.com/wylycool/argus.git
cd argus
npm ci
npm run desktop
```

`npm run dev` 只运行浏览器界面。系统文件对话框、Finder 关联、本地图片授权和原生打印需要桌面模式验证。开发服务器固定在 `127.0.0.1:1420`。

## 检查与构建

```sh
npm run check
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
```

```sh
npm run bundle
```

DMG 位于 `src-tauri/target/release/bundle/dmg/`。默认配置采用临时签名，不包含 Apple Developer ID 签名或公证；本地构建不需要开发者证书。

## 代码结构

| 目录                        | 内容                                      |
| --------------------------- | ----------------------------------------- |
| `src/`                      | React 界面、文档状态、Markdown 渲染与测试 |
| `src/editor/`               | 编辑器、自动保存和实时预览                |
| `src/documents/`            | 文档操作、资源副本、搜索与打印            |
| `src/workspace/`            | 文件菜单、工具栏、大纲与图片查看          |
| `src/diagrams/`             | Mermaid 渲染和交互                        |
| `src/reader/`、`src/theme/` | 查找、历史、阅读排版与主题                |
| `src-tauri/src/`            | Rust 文件读写、权限、草稿、历史和系统集成 |
| `tests/`、`samples/`        | 回归测试与演示文档                        |
| `docs/open-source/`         | 公开用户文档与截图                        |

## Pull Request

- 描述触发条件、改动后的行为和验证结果。界面变化请附演示截图。
- 保留自动保存、磁盘版本检查、草稿恢复与冲突保护；文件操作需要覆盖失败路径。
- 不提交依赖目录、构建产物、安装包、个人文档、草稿、密钥或本机日志。安装包通过 Releases 分发。
- 只有涉及相应依赖时更新锁文件；发布版本需同步 package.json、package-lock.json、Cargo.toml、Cargo.lock 和 tauri.conf.json。
- 新增第三方依赖时核对其许可证，并按需更新第三方说明。

贡献代码将按本仓库的 MIT 许可证发布。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。
