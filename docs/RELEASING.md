# Release runbook

本项目的桌面安装包由 [`.github/workflows/release.yml`](../.github/workflows/release.yml) 在各平台原生 runner 上构建。workflow 不执行真实 HID 设备测试，也不会把本机设备信息写入日志或 artifact。

## 发布前检查

1. 在 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中把版本更新到同一个 semver 值。
2. 运行本地静态检查和构建：

   ```sh
   npm ci
   npm run build
   cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
   cargo test --locked --manifest-path src-tauri/Cargo.toml
   cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
   npm run tauri build -- --no-bundle
   ```

3. 检查 diff 中没有本机路径、用户名、序列号、设备拓扑、raw report 或宏正文。
4. 提交版本变更后，创建并推送明确的版本 tag，例如：

   ```sh
   git tag app-v0.1.0
   git push origin app-v0.1.0
   ```

也可以从 GitHub Actions 手动运行 `Build desktop bundles`。手动运行同样会生成 draft Release，适合在不推送 tag 时验证 runner 构建。

## 构建矩阵

| Runner | Target | Bundles |
|---|---|---|
| `ubuntu-22.04` | Linux x86_64 | AppImage、`.deb` |
| `macos-13` | `x86_64-apple-darwin` | `.dmg` |
| `macos-14` | `aarch64-apple-darwin` | `.dmg` |
| `windows-latest` | Windows x64 | NSIS `.exe` |

矩阵通过 Tauri CLI 的 `--bundles` 参数显式限制产物，不应从工作流中删除这些参数，否则可能意外生成 RPM 或 MSI。版本 tag 使用 `app-v` 前缀，并且应与 `src-tauri/tauri.conf.json` 的版本一致。

## Draft Release 和签名

workflow 使用 GitHub 提供的 `GITHUB_TOKEN` 将构建结果上传到 draft Release；普通 push 不会创建 Release。发布者应检查每个平台的文件、版本和安装行为，再手动把 draft Release 发布。

当前没有配置签名 secrets，因此这些是 unsigned CI artifacts：

- macOS 正式发布仍需要 Apple Developer signing 和 notarization；
- Windows 正式发布仍建议使用 Authenticode；
- Linux 包不包含仓库无法验证的发行版签名密钥。

不要在公开 workflow 中添加个人证书、私钥或未经审核的 secrets。签名应在后续建立受控 secrets、权限和审计流程后单独加入。

Windows NSIS 使用 Tauri 官方的 `downloadBootstrapper` WebView2 安装模式。目标机器缺少 WebView2 时，安装程序需要联网下载 bootstrapper；本项目没有配置 offline installer，也不使用 updater。

## Linux 权限

当前仓库没有稳定、公开且适用于所有设备的 VID/PID 映射，因此发布包不静默安装 udev 规则。Linux 用户若遇到 HID 权限错误，应依据所用固件公开的 VID/PID，在本机安装最小权限规则。规则不能写入真实路径、序列号或本机设备拓扑；具体模板和限制见 [`GUI-DEVELOPMENT.md`](GUI-DEVELOPMENT.md) 的平台发布方案。

## Runner 验证边界

Linux、macOS 和 Windows 的 installer 构建不能在 Linux 本机可靠伪造。尤其是 AppImage 的 `linuxdeploy` 会受本机系统库和 binutils 版本影响；在较新的非 `ubuntu-22.04` 主机上出现 library strip 失败时，应以 workflow 的 `ubuntu-22.04` runner 结果为准，而不是把本机 workaround 写进发布配置。每个原生 runner 必须至少验证：

- workflow 依赖安装成功；
- Tauri bundle 生成了矩阵要求的目标；
- 安装包名称和版本正确；
- 应用可以启动到连接检查界面。

真实键盘的 LIST/GET/SET/CLEAR 验证属于独立硬件测试阶段，不在发布 workflow 中执行。测试报告只能记录脱敏的状态、slot 数量和 byte length；不得记录 slot 正文。
