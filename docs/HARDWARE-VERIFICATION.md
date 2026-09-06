# Hardware and platform verification

本文件记录阶段 5 的硬件与平台验证边界。硬件测试只允许执行安全的
`enumerate → 唯一候选选择 → connect → LIST` 流程；本阶段未连接真实硬件，
也没有执行 `GET`、`SET` 或 `CLEAR`，不修改设备内容。

## 已记录的 LIST-only 硬件冒烟结果

以下是此前授权的 LIST-only 冒烟结果；阶段 5 不重复连接设备。

| 项目 | 结果 |
|---|---|
| Linux HID discovery | passed；发现 1 个 Usage 精确匹配的 runtime-macro 候选 |
| 候选选择 | passed；仅在唯一候选时明确选择 |
| HID connection | passed |
| `LIST` | passed；动态 slot count 为 10 |
| 设备写入/正文读取 | not run；本阶段严格限制为 `LIST`-only |

冒烟程序只输出发现、连接、`LIST` 状态和 slot 数量；测试结束后一次性临时文件已清理。报告不保存或显示 HID path、serial、用户名、设备拓扑、raw report 或 slot 正文。

## 可由 CI 验证的项目

公开发布 workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml)
使用各平台原生 runner，配置了以下构建矩阵：

- Ubuntu 22.04：Linux x86_64 AppImage 和 `.deb`
- macOS 14：Apple Silicon `.dmg`
- Windows：x64 NSIS 安装包

Linux 使用 `hidapi` 的 `linux-static-hidraw` backend；macOS 和 Windows 使用
`hidapi` 默认 portable C backend。运行时根据 Usage metadata 选择候选，不硬编码
HID interface 编号。

workflow 只执行依赖安装、前端构建和 Tauri 打包，不枚举 HID、不打开设备，也不执行协议命令。因此平台安装包生成和启动检查必须在对应 runner 上完成；当前环境没有伪造这些 runner 的结果。

## 当前环境无法验证

- macOS Apple Silicon 的安装、启动、卸载和升级。
- Windows x64 的 NSIS 安装、WebView2 安装路径、启动、卸载和升级。
- Ubuntu 22.04 runner 上的最终 AppImage 产物；Linux 本机只验证 no-bundle，未伪造
  `linuxdeploy` AppImage 结果。
- 三个平台上的真实键盘交互、拔插和自动重连。
- `GET`、`SET`、`CLEAR`、Flash/NVS 持久化，以及宏执行效果；这些需要后续明确授权的设备测试，并且任何报告仍只能记录脱敏状态、slot 数量和必要的 byte length。
- 桌面窗口的人工视觉验收；本阶段只完成静态检查和 no-bundle 构建，没有把 GUI 自动化接入发布 workflow。

## 本阶段静态门禁

以下命令在当前 Linux 环境执行，具体结果见本次阶段交接：

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build
npm run tauri build -- --no-bundle
```

阶段 5 的结果由交接报告记录；文档中的门禁命令必须使用当前仓库的锁定依赖。
Linux 本机的 `--no-bundle` 构建不等同于 Ubuntu 22.04 AppImage 成功：AppImage
由 `linuxdeploy` 处理，可能受本机系统库和 binutils 版本影响，应以 CI 的
`ubuntu-22.04` runner 为准。阶段 5 不修改协议、Rust command 或 React UI。
