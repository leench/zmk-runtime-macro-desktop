# ZMK Runtime Macro Desktop 开发设计

## 1. 项目定位与当前状态

这是 `zmk-module-runtime-macro` 的跨平台桌面配置客户端，通过固件专用的 runtime macro USB HID interface 管理 macro slots。桌面端只支持 Runtime Macro v2：v2 `AUTH_INFO` 成功后才安装连接 session；检测到旧 v1 固件时只显示升级提示，绝不回退到未认证的 v1 管理。

首版目标平台：Linux x86_64、macOS Intel/Apple Silicon、Windows x64。前端不直接访问 HID，所有枚举、认证、协议和传输都在 Rust/Tauri command 层完成。

当前状态：阶段 1–5（v2 protocol/auth core、Tauri session/bridge、MagicPatterns UI、密码管理、隐私预览、认证窗口恢复、重连、best-effort LOCK、文档和本机最终门禁）已实现并通过自动验证。macOS/Windows 原生安装器和 Ubuntu 22.04 AppImage 仍需在对应 runner/平台完成实际安装验证；不在文档或发布流程中伪造硬件结果。

## 2. 固件和协议约束

GUI 必须遵守现有 `docs/PROTOCOL.md`、`docs/CLI.md` 以及 sibling firmware 的 `docs/AUTHENTICATION_PROTOCOL.md`：

- 使用专用 runtime macro USB HID interface；默认 HID_1，但固件可以配置为其他未占用的 HID instance；键盘 HID_0 保持不变；
- 每个 request/response 是固定 32 bytes；v2 宏命令为 `LIST`、`GET`、`SET`、`CLEAR`；认证命令为 `AUTH_INFO`、`AUTH_CHALLENGE`、`AUTH_PROVE`、`PASSWORD_SET`、`LOCK`；
- `SET` 使用 22-byte payload 分块，完整 transaction 完成前不能替换 slot；slot 数量必须由 `LIST` 动态获取；
- 宏正文只允许 printable US ASCII（`0x20..0x7e`）、LF（`0x0a`）、Tab（`0x09`）和 Backspace（`0x08`）；Enter 在 UI 中转换为 LF，不能写入 CR；不提供 Esc；中文、Emoji 和其他 Unicode 不能进入宏正文；
- 协议允许的正文范围上限是 256 bytes，固件的 `CONFIG_ZMK_RUNTIME_MACRO_MAX_TEXT_LEN` 可能更小；桌面端无法预先知道该值，设备返回 `BAD_LENGTH` 时显示明确错误；
- `TAP_MS` 和 `WAIT_MS` 是编译期配置，当前协议没有 capability 或设置命令，桌面端不读取也不修改；
- v2 USB 配置通道不加密。`OPEN` 状态下可访问该 HID interface 的本机程序可能修改 slots；`PROTECTED` 状态下宏管理命令需要有效认证窗口；
- 固件是 RAM-first。`STORAGE_ERROR` 可能表示内存值已经生效但 Flash/NVS 持久化失败；UI 不得错误宣称完全失败；
- 认证密码在 Rust command 边界立即进入 zeroizing storage，原始密码不进入日志、序列化对象、持久化数据、错误 DTO 或返回值。

## 3. 技术栈

| 层 | 方案 |
|---|---|
| 桌面框架 | Tauri 2 |
| 前端 | React + TypeScript + Vite |
| 原生后端 | Rust |
| HID | `hidapi` 2.x，Linux 优先 hidraw |
| 样式 | 普通 CSS 与 React 组件，避免原型专用框架 |
| 图标 | `lucide-react` |
| 测试 | `cargo test`、Rust fake HID/golden tests、前端 `npm run build` |

## 4. 当前实现

### 4.1 连接、认证和路由

连接状态只由后端 `ConnectionState.authState` 驱动：

```text
discover -> explicit device selection -> connect -> AUTH_INFO
  OPEN          -> LIST -> Workbench + 可跳过的设置管理密码 modal
  PROTECTED     -> Unlock（正文隐藏，不发送 LIST/GET）
  AUTHENTICATED -> LIST -> Workbench
  credential-invalid -> Credential unavailable 页面
  BAD_VERSION  -> 旧固件不支持认证，请升级（不 fallback）
```

设备列表只展示安全摘要：产品名（如果 HID 提供）、VID/PID、interface number 和 Usage 元数据状态。列表不推测或展示 `requiresPassword`，是否受保护只有连接后的 `AUTH_INFO` 才能决定。没有设备、Usage 元数据缺失、多个候选、设备忙/权限拒绝、传输错误和协议不兼容都使用本地化的安全提示；不展示 HID path、serial、raw report 或后端原始错误字符串。

认证行为：

- 每次新连接在 `OPEN` 状态进入 Workbench 后显示可跳过的“设置管理密码” modal；Skip 后明显显示“未设置管理密码/宏未受保护”；
- 设置密码要求新密码与确认字段相同且 NFC 规范化后非空，不添加“至少 6 位”等前端硬门槛；确认字段只在前端比较，后端只收到一次新密码；成功后设备进入 locked，UI 转到 Unlock；
- `PROTECTED` locked 只显示 Unlock，密码输入不预填、不记住、不写 localStorage；文案说明密码本地派生、原始密码不发送；真实 `authenticate` 失败后清空输入；
- 已认证 protected session 可从 device menu 进入 Change management password；成功后再次 locked。没有移除密码入口；
- 已认证 protected session 可主动 Lock management。认证窗口按协议为 5 分钟；认证过期或任何 `AUTH_REQUIRED` 都立即隐藏正文、禁用管理操作并转到 Unlock，同时保留同设备 dirty draft；界面显示剩余认证时间，`AUTH_INFO` 只用于校验设备权威状态，不延长窗口；
- disconnect/switch/正常关闭都走 best-effort LOCK；传输断开后仅在唯一安全设备摘要重新出现时自动重连，恢复同设备内存 draft。`RATE_LIMITED` 使用明确错误提示，challenge 和密码仍只在 Rust backend 处理。

### 4.2 MagicPatterns Art Direction（当前 UI 规范）

当前产品是精密、克制、安静的桌面硬件配置工具，不是网页 Dashboard、SaaS 页面或卡片堆叠：

- 使用自绘 TitleBar；Tauri window `decorations: false`，标题栏支持拖动、最小化、最大化/还原和关闭。关闭请求使用 `onCloseRequested`；dirty 时同步阻止并显示应用内确认 modal，确认后调用 `destroy` 绕过重复的 close event。浏览器预览环境安全 no-op，监听失败回退到 `beforeunload`；
- 顶部为小型设备状态栏：当前设备摘要、连接/认证状态、由 LIST 的 SlotMetadata 汇总出的“已配置宏字节数”、刷新、System/Light/Dark、设置和更多操作；该摘要只统计设备已保存的 byte length，不把 dirty draft 算入，不显示未知固件上限、分母、百分比或 progressbar role；状态色只用于语义，不铺满区域；
- 主体是连续的 `Macro Slots + Inspector` 两栏。左侧显示动态 slot 编号、本机 label、`Empty`/byte length 和 dirty 点；正文列表预览由隐私设置控制，默认不显示真实字符；右侧只显示当前 slot 的 inspector；
- inspector 默认遮罩正文，只有用户主动 Reveal 才显示 token。列表预览仅使用已加载的内存内容，并按隐私设置显示；完整正文不进入标题、状态、tooltip、title、aria label、error、toast、诊断或 localStorage。切换 slot、设备、disconnect、Lock 或 auth 过期都会隐藏已显示内容；
- 本机 label 只保存在按 VID/PID/interface/Usage 组成的安全摘要 key 下，不写入固件，不与正文共用数据；完全不保存宏正文；
- light/dark/system 使用同一套 spacing 和组件层级：中性 canvas、连续 surface、1px divider、低调圆角、有限阴影；不使用渐变、霓虹、玻璃拟态、巨大 Hero、统计图表或过度圆角；主题切换使用设计中的 Sun/Moon 图标；
- MagicPatterns 使用的 Inter 与 JetBrains Mono 字体作为视觉基准，并保留 system fallback；slot 编号、byte count、VID/PID 和协议值使用等宽数字；Tauri WebView 初始页面缩放为 `110%`；窗口默认 `1344 × 896`、最小 `1024 × 640`，允许 resize 和最大化。除真实功能、v2 协议、安全约束或 Tauri 平台行为冲突外，不调整设计源的视觉细节。

### 4.3 Slot 列表与隐私预览

连接成功且状态为 OPEN 或 AUTHENTICATED 后才发送 `LIST`。slot 数量、byte length 和 Empty 状态来自真实 response，不在前端写死。非空 slot 的正文只在当前选中时按需发送 `GET`；预览不会为未加载 slot 额外发送 GET。GET 返回的字节先严格校验为协议允许的字符，再转换为可视 token。

设置页使用两个上下箭头 stepper，实际文案不显示内部代号：

- **列表预览字符数**：`0–5`，默认 `0`；`0` 时列表不显示真实字符；
- **悬停显示延迟**：`禁用`、`立即`、`1–5 秒`，默认 `禁用`；指针持续停留在预览区域达到设定值后显示已加载正文，离开区域立即重新遮罩；
- 设置只保存两个数值，不保存正文；预览以宏 token/字节为单位，不改变设备内容；
- 列表预览支持指针和键盘交互，Inspector 的主动 Reveal 独立于这两个设置；
- 正文不进入错误信息、诊断、日志或持久化数据。

切换设备或断开时不保存正文到文件、日志、诊断、toast 或 localStorage。当前设备意外断开后，同一安全设备摘要重新连接时可恢复内存中的 dirty draft；切换到不同摘要前必须先经过独立的设备级未保存确认，取消不会调用 bridge。确认后，如果另一设备连接成功，当前设备的内存草稿会被丢弃；如果连接失败，旧 drafts 仍保留。设备锁定或认证错误会隐藏正文但不丢 dirty draft。

### 4.4 Token 编辑器、保存和清空

编辑器使用单字节 token：

- printable ASCII 正常显示，空格以可辨识的空白 token 显示；
- LF 显示 `↵`，Tab 显示 `⇥`，Backspace 显示 `⌫`；
- KeyPalette 只提供 printable ASCII、LF、Tab、Backspace，不提供 Esc；按 Enter 插入 LF；
- 前端限制 256 bytes 并拒绝 Unicode；设备较小的实际上限由 `BAD_LENGTH` 返回；
- Save 使用真实 `SET`，Clear 使用真实 `CLEAR`；保存中禁用重复操作；`Ctrl/Cmd+S` 可保存；
- SET/CLEAR 出错时保留 dirty draft 并给出 Retry；`STORAGE_ERROR` 显示“本次会话可能已生效，但未能永久保存”；
- Clear 使用原位二次确认；slot 切换和关闭使用不含正文的本地化 dirty 确认。

### 4.5 设置、主题和诊断

当前实现保留中文/English 与 System/Light/Dark，并包含 v2 密码管理和隐私预览设置：

- language 偏好单独存放在 `zmk-runtime-macro-language:v1`；跟随系统根据 `navigator.languages`/`navigator.language` 的 `zh-*` 选择中文，其余使用 English；
- theme、timeout、retries 和隐私预览的两个数值可以存入本机偏好；密码、K、正文、raw report、HID path 和 serial 不得存储；
- timeout 默认 1000 ms（100–5000），retries 默认 2（0–5），后端标记为下一次连接生效；
- 诊断默认折叠，只显示 Runtime Macro v2、USB HID、脱敏设备摘要、动态 slot count、最近白名单操作和安全 error code；不显示正文、凭据、path、serial 或 raw report。

## 5. 后端与前端边界

```text
React + MagicPatterns CSS
          │ Tauri invoke（camelCase IPC 参数）
          ▼
Rust command layer
          ▼
串行化 v2 HID session
          ▼
Runtime Macro protocol v2 / hidapi
```

前端只调用 `bridge.ts` 中的 Tauri commands。Rust 负责设备发现、显式候选选择、AUTH_INFO、认证 KDF/proof、LIST/GET/SET/CLEAR、重试、事务边界和错误映射。Tauri command 不返回 salt、iterations、K、nonce、proof、密码或 raw report。

## 6. Tauri window 权限

主窗口使用 `decorations: false` 以承载自绘 TitleBar。`src-tauri/capabilities/default.json` 仅授予当前实现需要的窗口能力：

- `core:event:allow-listen`、`core:event:allow-unlisten`（关闭请求监听）；
- `core:webview:allow-set-webview-zoom`（MagicPatterns 对齐所需的 110% 页面缩放）；
- `core:window:allow-close`、`allow-destroy`、`allow-minimize`、`allow-toggle-maximize`、`allow-start-dragging`。

不得为了方便恢复 `core:default` 全量权限。浏览器开发环境不能因为不存在 Tauri internals 而报错。

## 7. 实施阶段

1. Auth protocol core、KDF、fake HID 与 golden tests；
2. Tauri session/auth bridge、HID session 和安全 command boundary；
3. MagicPatterns UI 源代码迁移、真实 v2 auth/宏流程、密码设置/修改和视觉 gate；
4. 列表隐私预览、认证窗口倒计时、`AUTH_REQUIRED`/错误恢复、自动重连和正常关闭 best-effort LOCK；
5. 文档、跨平台行为/安装器配置检查和最终验证（含硬件边界检查）。

所有阶段均只支持 v2，不提供 Legacy v1 管理。MagicPatterns 是唯一视觉基准；仅在真实功能、v2 协议、安全约束或 Tauri 平台行为冲突时适配，并记录冲突原因。

## 8. 验证与硬件边界

自动验证至少包括：

- `npm run build`；
- `cargo fmt --check`、`cargo test`、`cargo clippy --all-targets -- -D warnings`；
- `npm run tauri build -- --no-bundle`；
- `git diff --check` 和隐私/secret scan。

真实硬件验证不得执行 GET、SET 或 CLEAR；硬件测试如有需要只发送 LIST，并且报告只写发现/连接状态、slot count 和 byte length，不写 HID path、serial、raw report、slot content、密码或用户名。

公开代码、测试、文档、构建日志和诊断不能包含真实 HID path、设备 serial、用户名、设备拓扑、宏正文或凭据。示例必须是抽象占位符，不能复制设计原型中的邮箱、SSH、IP 或其他静态示例。

## 9. 当前剩余工作与发布边界

阶段 5 已完成文档一致性、跨平台配置/构建检查、最终自动验证和硬件边界记录；本阶段未连接真实硬件，也未执行 `GET`、`SET` 或 `CLEAR`。macOS、Windows 原生安装器和 Linux 基线 AppImage 仍需由对应 runner 或平台分别验证，不能用 Linux 本机结果替代。最终应用在代码、文档和验证门禁完成后打开供人工查看。

后续维护必须继续遵守 v2-only 边界，不得恢复 Legacy v1 管理或把密码、K、正文、HID path、serial、raw report 写入持久化、日志和诊断。
