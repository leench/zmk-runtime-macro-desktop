# ZMK Runtime Macro Desktop

跨平台桌面 GUI 客户端，用于配置 `zmk-module-runtime-macro` 的 runtime macro slots。

目标平台：

- Linux x86_64
- macOS Intel / Apple Silicon
- Windows x64

## 当前状态

当前版本已完成 Tauri 2 + React + TypeScript 桌面 GUI、v2 认证与 HID session、MagicPatterns 视觉迁移、宏编辑、密码设置/修改、认证窗口恢复和插槽隐私预览。GUI 只支持 Runtime Macro v2，不提供 Legacy v1 管理入口；密码不会被记住或持久化。完整约束、验证边界和发布流程见：

- [`docs/GUI-DEVELOPMENT.md`](docs/GUI-DEVELOPMENT.md)
- [`docs/RELEASING.md`](docs/RELEASING.md)

## 开发环境

需要 Node.js、Rust 和对应平台的 Tauri/WebView 依赖。

```sh
npm install
npm run dev
```

运行 Tauri 桌面开发模式：

```sh
npm run tauri dev
```

构建前端：

```sh
npm run build
```

构建桌面安装包：

```sh
npm run tauri build
```

## 相关项目

固件模块和协议文档位于同一工作区的 `zmk-module-runtime-macro` 项目中。GUI 只管理 Runtime Macro v2，不提供 Legacy v1 管理入口；GUI 不依赖 Python CLI 运行，但复用共享的 v2 协议约定。
