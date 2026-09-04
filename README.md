# ZMK Runtime Macro Desktop

跨平台桌面 GUI 客户端，用于配置 `zmk-module-runtime-macro` 的 runtime macro slots。

目标平台：

- Linux x86_64
- macOS Intel / Apple Silicon
- Windows x64

## 当前状态

项目目前完成 Tauri 2 + React + TypeScript 工程、HID 通信、设备发现、slot 列表和 macro 编辑器。编辑器支持本机 label、隐藏/reveal、控制字符 token、保存和清空；完整阶段状态与限制见：

完整的功能设计、技术栈、平台发布和测试计划见：

- [`docs/GUI-DEVELOPMENT.md`](docs/GUI-DEVELOPMENT.md)

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

固件模块和 v1 HID 协议位于同一工作区的 `zmk-module-runtime-macro` 项目中。GUI 不依赖 Python CLI 运行，但会复用相同的协议约定。
