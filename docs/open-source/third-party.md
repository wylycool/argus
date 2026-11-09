# 第三方组件说明

Argus 自有代码按根目录 [MIT 许可证](../../LICENSE) 发布。第三方组件的版权及许可证由各自权利人保留；Argus 的 MIT 许可不替代这些许可。

直接依赖清单与精确版本分别记录在 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock`。已按锁文件汇总运行依赖和当前 macOS Rust 依赖包所携带的许可证文本，见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。完整许可证也随相应依赖源码提供，重新分发时应保留适用的版权与许可声明。

主要组件包括 Tauri、React、Vite、CodeMirror、markdown-it、highlight.js、DOMPurify、Mermaid、Lezer、parse5、Phosphor Icons，以及 Rust 的 serde、url、sha2、tempfile、xattr、regex 和 objc2 系列。

新增或升级依赖时应核对该版本实际携带的许可证；不要仅依据本说明推断所有传递依赖使用同一许可证。
