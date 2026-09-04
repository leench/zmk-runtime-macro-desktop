# ZMK Runtime Macro Desktop 开发设计

## 1. 项目定位

这是 `zmk-module-runtime-macro` 的跨平台桌面配置客户端，用于通过设备的 USB HID_1 配置 runtime macro slots。

首版目标平台：

- Linux x86_64；
- macOS Intel 和 Apple Silicon；
- Windows x64。

GUI 只负责配置已有固件功能，不修改 ZMK 主仓库，也不改变当前 v1 wire protocol。

当前状态：已初始化 Tauri 2 + React + TypeScript 基础工程；HID 通信和编辑功能尚未实现。

## 2. 固件和协议约束

GUI 必须遵守现有 `docs/PROTOCOL.md` 和 `docs/CLI.md` 中的约定：

- 使用第二个 HID interface，即 `HID_1`；ZMK 键盘接口 `HID_0` 保持不变；
- 每个 request/response 固定为 32 bytes；
- `LIST`、`GET`、`SET`、`CLEAR` 是首版支持的全部命令；
- `SET` 使用每块 22 bytes 的 payload，完整事务完成前不会替换 slot；
- slot 数量通过 `LIST` 获取，不能在 GUI 中写死为 8；
- 宏内容只允许 printable US ASCII（`0x20..0x7e`）、LF、Tab、Backspace；
- 固件最大长度由 `CONFIG_ZMK_RUNTIME_MACRO_MAX_TEXT_LEN` 决定，协议范围上限为 256 bytes，但当前协议不会返回设备实际配置值；
- 宏通过键盘事件执行，主机键盘布局可能影响标点结果；
- USB 配置通道没有认证和加密，本机上能够访问 HID interface 的程序都可能修改 slots；
- 固件是 RAM-first。返回 `STORAGE_ERROR` 时，内存中的新值可能已经生效，但 Flash/NVS 持久化失败。

GUI 的界面语言可以使用中文或英文，但宏内容本身不支持中文、Emoji 或其他 Unicode。

## 3. 推荐技术栈

| 层 | 方案 | 原因 |
|---|---|---|
| 桌面框架 | Tauri 2 | 同时覆盖 Linux、macOS、Windows，使用 Rust 原生后端 |
| 前端 | React + TypeScript + Vite | 适合实现 slot 列表和可视化编辑器 |
| 原生后端 | Rust | 负责 HID、协议、重试和跨线程串行化 |
| HID | Rust `hidapi` crate 2.x | 复用 HIDAPI 的跨平台实现 |
| 序列化 | `serde` / `serde_json` | Tauri command 的结构化数据传输 |
| 样式 | CSS Modules 或普通 CSS | 首版减少 UI 依赖和构建复杂度 |
| 测试 | `cargo test`、Vitest | 分别覆盖协议/传输和编辑器逻辑 |
| 发布 | Tauri bundler、GitHub Actions | 使用各平台原生 runner 构建安装包 |

不把 Python CLI 作为 GUI 的运行时依赖。现有 Python 客户端继续作为协议参考实现、诊断工具和测试对照。

Linux 后端优先使用 `hidraw`。HIDAPI 文档说明 `hidraw` 可以提供 Usage Page/Usage，而 libusb 后端可能无法提供这些字段；无论后端如何选择，普通用户访问设备仍需要正确的 udev 权限规则。

## 4. 功能设计

### 4.1 设备连接

顶部连接区显示当前设备、连接状态和刷新按钮：

```text
Runtime Macro                         [刷新设备] [已连接 ▾]

设备：My Keyboard
接口：Runtime Macro HID_1       状态：已连接
```

行为：

- 启动时枚举兼容的 HID_1；
- 只有一个明确匹配设备时自动连接；
- 多个设备或无法识别 Usage 元数据时必须让用户选择，不能猜测；
- 支持手动刷新、断开、重新连接；
- 通过定时枚举检测 USB 拔插，首版不依赖平台专用热插拔 API；
- 记录设备身份时优先使用 VID/PID、序列号、产品名和 interface number，HID path 只作为回退信息；
- 当前目标设备观察到的 interface number 不能硬编码为所有设备的通用规则；
- 连接成功后通过 `LIST` 请求确认目标确实是 Runtime Macro HID_1。

连接失败时需要区分：没有设备、多个候选设备、权限拒绝、设备忙、协议不兼容和 USB 传输失败。

### 4.2 Slot 列表

```text
Slots
────────────────
● Slot 0       12 bytes
○ Slot 1        0 bytes
● Slot 2       32 bytes
○ Slot 3        0 bytes
```

列表从 `LIST` response 动态生成，显示：

- slot 编号；
- 当前 byte 长度；
- 空、已保存、正在编辑、保存失败和设备断开状态。

点击 slot 后再发送 `GET`，不必启动时一次性读取所有宏。

### 4.3 宏编辑器

建议使用可视化控制字符编辑器，而不是直接显示不可见控制字节：

- 普通 printable ASCII 正常显示；
- LF 显示为 `↵`；
- Tab 显示为 `⇥`；
- Backspace 显示为 `⌫`；
- 通过工具栏按钮插入这三类控制字符；
- 显示 byte 数，不显示容易误导的 Unicode 字符数；
- 粘贴非法字符时指出位置和原因；
- 支持 `Ctrl/Cmd + S`；
- 切换 slot 或关闭窗口时，对未保存内容进行确认。

示例：

```text
Hello, world! ↵
⇥Username: ⌫

18 bytes       [插入换行] [插入 Tab] [插入 Backspace]
```

设备实际长度上限在当前协议中未知。GUI 可以先限制到协议允许的 256 bytes；如果固件使用了更小的 Kconfig 值，由设备返回 `BAD_LENGTH`，界面显示“超过固件配置上限”。

### 4.4 保存和清空

保存流程：

1. 前端校验字节范围和 256 bytes 协议上限；
2. Rust 后端按 22-byte payload 分块执行 `SET`；
3. 超时或可恢复传输错误时，从 offset 0 重新开始完整事务；
4. 成功后更新列表状态；
5. 设备在最后一个 chunk 前不会改变 slot。

清空使用 `CLEAR`，并要求用户确认。

如果保存期间 USB 断开：

- 保留当前未保存草稿在内存中；
- 重新连接后自动刷新 `LIST`；
- 如果最终 ACK 丢失，不假设操作结果，要求重新读取确认；
- 不重复发送旧的非零 offset chunk。

### 4.5 设置和诊断

首版设置：

- 请求超时，默认 `1000 ms`；
- 重试次数，默认 `2`；
- 自动重连开关；
- 中文/英文界面。

诊断信息可以包含协议版本、VID/PID、产品名和脱敏后的接口信息，但默认不记录宏文本、序列号和完整 HID path。

当前协议没有“直接执行宏”的命令，因此首版不提供“测试宏”按钮；宏仍需通过键盘上绑定的 `&runtime_macro <slot>` 触发。

## 5. 软件结构

```text
React UI
   │ Tauri invoke
   ▼
Rust command layer
   ▼
串行化 HID session
   ▼
Runtime Macro protocol v1
   ▼
hidapi
   ▼
Linux / macOS / Windows HID stack
   ▼
HID_1
```

Rust 后端负责：

- HID 设备枚举、选择和打开；
- 单个连接上的请求串行化；
- 32-byte frame 构造、校验和响应匹配；
- LIST/GET 分页；
- SET 分块、超时重试和事务重启；
- CLEAR；
- 结构化错误映射；
- 设备断开和重新连接。

前端不直接访问 HID，也不实现协议细节。Tauri command 应返回可区分的错误类型，例如 `NoDevice`、`PermissionDenied`、`AmbiguousDevices`、`Timeout`、`ProtocolError` 和固件 status error。

## 6. 平台发布方案

| 平台 | 首版交付 | 关键事项 |
|---|---|---|
| Linux | AppImage + `.deb` | 提供 udev 规则；AppImage 仍需验证目标系统的 WebKitGTK 运行依赖 |
| macOS | `.dmg` | 构建 Intel/Apple Silicon；正式发布需要代码签名和 notarization |
| Windows | NSIS 安装包 | 使用系统 HID 驱动；处理 WebView2 Runtime；正式发布建议 Authenticode 签名 |

三平台发布使用各自的原生 CI runner，不依赖交叉编译。首发验证范围建议为 Ubuntu 22.04/24.04、Debian 12 或当前 Fedora、macOS Intel/Apple Silicon、Windows 10/11 x64。

默认不要求管理员权限。Linux udev 规则的安装应由安装包或用户明确执行，不能让 GUI 静默修改系统权限。

## 7. 测试计划

### 自动测试

- Rust 协议帧字段、零填充和 little-endian 编码；
- response version/opcode/request ID/slot 校验；
- LIST/GET 分页和空 slot；
- SET 22/23/256 bytes 边界；
- 超时、陈旧 response、事务重启；
- STORAGE_ERROR 的状态映射；
- 前端控制字符编辑、非法字符校验和 dirty 状态；
- 使用 fake HID transport，不依赖真实设备。

### 手动测试

- 单设备和多设备选择；
- Linux Usage 元数据缺失场景；
- Linux udev 权限错误；
- USB 拔出、插回和重新连接；
- 保存过程中断开；
- Flash/NVS 持久化和重启后读取；
- 实际触发字母、数字、标点、LF、Tab、Backspace；
- 三个平台的安装、卸载和升级。

## 8. 实施阶段

1. 将现有 Python v1 客户端行为移植为 Rust 协议/传输模块；
2. 加入 fake HID 和协议 golden tests；
3. 实现设备发现、连接状态和 slot 列表；
4. 实现控制字符编辑器和保存/清空流程；
5. 加入错误提示、自动重连和诊断界面；
6. 配置 Linux/macOS/Windows 打包；
7. 在三平台和真实键盘上完成硬件验证。

## 9. 后续功能

可以在首版稳定后增加：

- 宏导入/导出和本地备份；
- 更详细的设备能力查询；
- 自动更新；
- 多设备配置切换；
- 协议 v2 的 capability/firmware information 命令。

这些功能不应改变当前 v1 协议的兼容性。
