# Hardware and platform verification

本文件记录最终阶段 7 的真实边界。硬件测试只执行安全的
`enumerate → 唯一候选选择 → connect → LIST` 流程；本阶段没有执行
`GET`、`SET` 或 `CLEAR`，也没有修改设备内容。

## 当前环境已验证

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
- macOS 13：Intel `.dmg`
- macOS 14：Apple Silicon `.dmg`
- Windows：x64 NSIS 安装包

workflow 只执行依赖安装、前端构建和 Tauri 打包，不枚举 HID、不打开设备，也不执行协议命令。因此平台安装包生成和启动检查必须在对应 runner 上完成；当前环境没有伪造这些 runner 的结果。

## 当前环境无法验证

- macOS Intel / Apple Silicon 的安装、启动、卸载和升级。
- Windows x64 的 NSIS 安装、WebView2 安装路径、启动、卸载和升级。
- Ubuntu 22.04 runner 上的最终 AppImage 产物；本机不是该基线，未重复运行已知的本机 AppImage 打包限制。
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

本阶段结果：

- `cargo fmt`: passed
- `cargo test --locked`: passed（46 tests）
- `cargo clippy --locked --all-targets -- -D warnings`: passed
- `npm run build`: passed
- `npm run tauri build -- --no-bundle`: passed
- `git diff --check`: passed
- workflow 不访问 HID：passed
- 前端不直接依赖 HID：passed
- 公开文件隐私扫描：passed

阶段 7 不修改协议、Rust command 或 React UI。
