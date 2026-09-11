# ZMK Runtime Macro Desktop 开发设计

## 1. 项目定位与当前状态

这是 `zmk-module-runtime-macro` 的跨平台桌面配置客户端，通过固件专用的 runtime macro USB HID interface 管理 macro slots。桌面端只支持 Runtime Macro v2：v2 `AUTH_INFO` 成功后才安装连接 session；检测到旧 v1 固件时只显示升级提示，绝不回退到未认证的 v1 管理。

首版目标平台：Linux x86_64、macOS Intel/Apple Silicon、Windows x64。前端不直接访问 HID，所有枚举、认证、协议和传输都在 Rust/Tauri command 层完成。

当前状态：阶段 1–5（v2 protocol/auth core、Tauri session/bridge、MagicPatterns UI、密码管理、隐私预览、认证窗口恢复、重连、best-effort LOCK、文档和本机最终门禁）已实现并通过自动验证；Dynamic Macro 后端已按 Dynamic Protocol v2 多槽位（slot-aware CAPABILITIES/DYNAMIC_BEGIN/DYNAMIC_DATA/DYNAMIC_CLEAR，最多 512 bytes/object）迁移完成，前端已按 `CAPABILITIES` 的 object count 提供多 object 选择（每个 object 独立内存 draft/状态，校验使用设备上报的长度和 TTL 范围）。页面级 Dynamic Workspace（§4.7）已完成 presentation-first UI-only 阶段：Scenario 列表/编辑器、capability-driven target 行、18 个 in-memory preview 状态和确认对话框全部来自内存 fixture，不接真实 workspace command，真实 dynamic 操作仍由旧 `DynamicMacroModal`/`DynamicMacroPanel` 提供。该工作区仍待人工视觉验收。macOS/Windows 原生安装器和 Ubuntu 22.04 AppImage 仍需在对应 runner/平台完成实际安装验证；不在文档或发布流程中伪造硬件结果。

## 2. 固件和协议约束

GUI 必须遵守现有 `docs/PROTOCOL.md`、`docs/CLI.md` 以及 sibling firmware 的 `docs/AUTHENTICATION_PROTOCOL.md`、`docs/DYNAMIC_PROTOCOL.md`（Dynamic Protocol v2 多槽位 wire contract）：

- 使用专用 runtime macro USB HID interface；默认 HID_1，但固件可以配置为其他未占用的 HID instance；键盘 HID_0 保持不变；
- 每个 request/response 是固定 32 bytes；static v2 宏命令为 `LIST`、`GET`、`SET`、`CLEAR`；dynamic v2 命令为 `CAPABILITIES`、`DYNAMIC_BEGIN`、`DYNAMIC_DATA`、`DYNAMIC_CLEAR`；认证命令为 `AUTH_INFO`、`AUTH_CHALLENGE`、`AUTH_PROVE`、`PASSWORD_SET`、`LOCK`；
- `SET` 使用 22-byte payload 分块，完整 transaction 完成前不能替换 slot；slot 数量必须由 `LIST` 动态获取；
- 宏正文只允许 printable US ASCII（`0x20..0x7e`）、LF（`0x0a`）、Tab（`0x09`）和 Backspace（`0x08`）；Enter 在 UI 中转换为 LF，不能写入 CR；不提供 Esc；中文、Emoji 和其他 Unicode 不能进入宏正文；
- static 协议允许的正文范围上限是 256 bytes，固件的 `CONFIG_ZMK_RUNTIME_MACRO_MAX_TEXT_LEN` 可能更小；桌面端无法预先知道该值，设备返回 `BAD_LENGTH` 时显示明确错误；dynamic object 的上限由 `CAPABILITIES` 返回（v2 固定 512 bytes）；
- `TAP_MS` 和 `WAIT_MS` 是编译期配置，当前协议没有 capability 或设置命令，桌面端不读取也不修改；
- v2 USB 配置通道不加密。`OPEN` 状态下可访问该 HID interface 的本机程序可能修改 slots；`PROTECTED` 状态下 static 宏管理命令需要有效认证窗口，但 dynamic 命令在 `OPEN`、`PROTECTED` 和 `ERROR_LOCKED` 都不经过 static auth gate；
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

设备列表只展示安全摘要：产品名（如果 HID 提供）、VID/PID、interface number 和 Usage 元数据状态。列表不推测或展示 `requiresPassword`，是否受保护只有连接后的 `AUTH_INFO` 才能决定。没有设备、多个候选、设备忙/权限拒绝、传输错误和协议不兼容都使用本地化的安全提示；不展示 HID path、serial、raw report 或后端原始错误字符串。

#### 复合 HID 设备发现边界

桌面端自动候选同时验证 Runtime Macro 的完整 HID report descriptor：顶层 Usage
Page `0xff60`、Usage `0x61`，输入 Usage `0x62`、输出 Usage `0x63`，固定
32-byte report 且不使用 Report ID。仅检查顶层 Usage 不够，因为同一复合键盘可以
同时暴露 `raw_hid_adapter`；它可能复用 `0xff60/0x61`，但输入/输出 Usage 是
`0x01/0x02`，不是 Runtime Macro 通道。因此应用不硬编码 interface number，也不
根据 `BusType`/Bluetooth 元数据猜测兼容性，而是过滤掉 report descriptor 不匹配的
接口。

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
- MagicPatterns 使用的 Inter 与 JetBrains Mono 字体作为视觉基准，并保留 system fallback；slot 编号、byte count、VID/PID 和协议值使用等宽数字；页面缩放默认 `100%`，设置页支持 `80–150%`、`5%` 步进的实时调整，并保存为本机偏好；窗口默认 `1344 × 896`、最小 `1024 × 640`，允许 resize 和最大化。无装饰窗口使用透明背景和 CSS 裁剪实现 `18px` 外层圆角；macOS 依赖 Tauri 的 `macOSPrivateApi`，因此不适用于 Mac App Store 分发。除真实功能、v2 协议、安全约束或 Tauri 平台行为冲突外，不调整设计源的视觉细节。

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

### 4.5 Dynamic Macro surface

Dynamic Macro 是独立于 static slot 的 RAM-only object collection，每个 object 最大 512 bytes、无 LIST/GET/readback，不写 Settings/NVS。v2 capability 报告 `dynamic_object_count`（默认 8，范围 1–8）和 512-byte `max_dynamic_length`；wire slot 必须是 `0..dynamic_object_count-1`，static `LIST_SLOT` 的 `0xff` 不是合法 dynamic object。Unlock 页面和 authenticated/open Workbench 都显示独立 surface；locked 用户看不到 static slot 内容，但仍可操作 dynamic。界面明确提示 management HID 未加密，只允许非-secret 文本。

连接后先对第一个 object 发送 `CAPABILITIES`，并严格校验 capability version（必须为 2，不接受 v1 或未知版本）、object count（1–8，且 response slot 必须落在该 count 内）、固定长度（512）/TTL/timeout、required lifecycle flags 和 reserved bits 7..15。`BAD_OPCODE`/`BAD_VERSION` 映射为 Dynamic unsupported，不阻塞 static 功能；malformed success 是 protocol error，不降级为 static `SET`，也不自动 login。Dynamic request 不刷新或修改 static auth session。

Dynamic 文本在任何 HID write 前完成本地校验：非空、不超过 `CAPABILITIES` 上报的 `max_dynamic_length`（capability 未加载时 UI 使用 512 bytes fallback）、仅 printable US ASCII/LF/Tab/Backspace；显式 TTL 必须落在 `CAPABILITIES` 上报的 min/max 内（fallback 1–86400 秒），缺省使用设备默认值（fallback 300 秒）。目标 object 先按协议上限（0–7）预检，再按 `CAPABILITIES` 返回的 object count 校验，非法 index 不会产生任何 HID 写入。BEGIN payload 只允许 0/1/4/5，keep-after-execute 只有 capability lifecycle bit 6 支持时才显示/发送，Tauri 参数使用 `slot`、`keepAfterExecute`。上传失败或 timeout 从新 request ID 的 BEGIN 重新开始；clear 逐个 object 幂等重试，没有 wire clear-all。Dynamic 文本只存在当前内存编辑区，不写 localStorage、日志、诊断、错误、报告或诊断摘要。

UI 按 `CAPABILITIES` 的 object count 生成 capability-driven 目标 object 选择器（count = 1 时只显示只读对象行），upload/clear 使用当前选中 object 的 wire slot；每个 object 独立保存内存 draft、TTL、keep、状态、progress、error 和 clear 确认。本节描述旧 dynamic modal（真实 handler）；page-level Dynamic Workspace 的对应行为见 §4.7。

状态文案区分 `Unknown`、`Unsupported`、`Uploading`、`Committed locally`、`Cleared locally` 和 `Error`；提交/清除仅表示本地收到 ACK，不是 readback 证明。断开、重连、重启或生命周期不确定后回到 Unknown，不自动 re-upload。capability flags 摘要、byte count、TTL、keep 开关和进度均为本地 UI 信息，不能推断设备当前仍保存动态文本。

### 4.6 设置、主题和诊断

当前实现保留中文/English 与 System/Light/Dark，并包含 v2 密码管理和隐私预览设置：

- language 偏好单独存放在 `zmk-runtime-macro-language:v1`；跟随系统根据 `navigator.languages`/`navigator.language` 的 `zh-*` 选择中文，其余使用 English；
- theme、页面缩放（`80–150%`，默认 `100%`）、timeout、retries 和隐私预览的两个数值可以存入本机偏好；页面缩放在设置控件输入或步进后立即调用当前 Tauri WebView 的 `setZoom`，取消设置会恢复打开设置前的已保存值；密码、K、正文、raw report、HID path 和 serial 不得存储；
- timeout 默认 1000 ms（100–5000），retries 默认 2（0–5），后端标记为下一次连接生效；
- 诊断默认折叠，只显示 Runtime Macro v2、USB HID、脱敏设备摘要、动态 slot count、最近白名单操作和安全 error code；不显示正文、凭据、path、serial 或 raw report。

### 4.7 Dynamic Workspace（页面级场景工作区，UI-only 阶段）

除真实 dynamic 操作所在的 modal（§4.5）之外，仓库已按 presentation-first 实现页面级 **Dynamic Workspace**：Scenario 是主要管理对象，Dynamic Object 是上传目标。该工作区目前是 UI-only 阶段：

- 入口：workbench header 的 `Dynamic Macro`（Zap）按钮；设备选择页的 `Preview` 入口可在未连接设备时打开同一工作区；
- 内容：Scenario 列表 + 编辑器（名称、正文、TTL、keep、target 行）、capability details、本地观察状态和确认对话框；
- 数据来源：`src/features/dynamic/previewFixtures.ts` 的 18 个 in-memory preview 状态（`empty`、`new`、`dirty`、`disconnected`、`unknown`、`discovering`、`unsupported`、`ready`、`uploading`、`committed`、`clearing`、`cleared`、`error`、`staticLocked`、`keepUnsupported`、`targetMissing`、`capabilityChanged`、`oversize`）；Scenario 名称、正文和 TTL 只在 React 内存中，刷新即丢失，不写 `localStorage`；
- 本阶段不接真实 workspace command：不调用 HID、不持久化 Scenario、不接 HTTP API，也不显示设备 readback；
- 旧 `DynamicMacroModal`/`DynamicMacroPanel` 仍是真实 dynamic handler，从已连接 workbench 打开的 workspace header 保留 `Legacy dialog` fallback 按钮（无设备预览入口不提供该按钮），旧入口在新 UI 通过人工视觉验收后才移除；
- target 行按 capability 驱动：单 object（count = 1）为只读行，多 object 为 selector；saved target 不在最新 capability 时显示 saved target unavailable / target missing 并保留正文和 dirty draft，单 object 设备也不会自动采用唯一 object，必须由用户主动点击 `Use this object` 重新绑定，绑定前 upload/clear 保持禁用；
- 场景持久化、真实 DynamicService 接入、托盘入口和 v2 多 object 真实数据（§4.5）属于后续阶段。

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

前端只调用 `bridge.ts` 中的 Tauri commands。Rust 负责设备发现、显式候选选择、AUTH_INFO、认证 KDF/proof、static LIST/GET/SET/CLEAR、dynamic capability/upload/clear（含 object slot 校验）、重试、事务边界和错误映射。Dynamic commands 不经过 `ensure_management_access`，但仍复用同一 HID session/串行队列；Tauri IPC 使用 camelCase 参数（包括 `slot`、`ttlSeconds`、`keepAfterExecute`）。Tauri command 不返回 salt、iterations、K、nonce、proof、密码、dynamic readback 或 raw report。

## 6. Tauri window 权限

主窗口使用 `decorations: false` 以承载自绘 TitleBar。`src-tauri/capabilities/default.json` 仅授予当前实现需要的窗口能力：

- `core:event:allow-listen`、`core:event:allow-unlisten`（关闭请求监听）；
- `core:webview:allow-set-webview-zoom`（设置页实时调整 `80–150%` 页面缩放，默认 `100%`）；
- `core:window:allow-close`、`allow-destroy`、`allow-minimize`、`allow-toggle-maximize`、`allow-start-dragging`。

不得为了方便恢复 `core:default` 全量权限。浏览器开发环境不能因为不存在 Tauri internals 而报错。

## 7. 实施阶段

1. Auth protocol core、KDF、fake HID 与 golden tests；
2. Tauri session/auth bridge、HID session 和安全 command boundary；
3. MagicPatterns UI 源代码迁移、真实 v2 auth/宏流程、密码设置/修改和视觉 gate；
4. 列表隐私预览、认证窗口倒计时、`AUTH_REQUIRED`/错误恢复、自动重连和正常关闭 best-effort LOCK；
5. 文档、跨平台行为/安装器配置检查和最终验证（含硬件边界检查）；
6. Dynamic Macro v2 多槽位 capability（slot-aware capability/upload/clear、512-byte object、逐槽 clear）、keep-after-execute、unknown lifecycle 和 fake-HID/golden matrix；
7. Dynamic Workspace page-level UI-only 阶段（Scenario 列表/编辑器、capability-driven target 行、18 个 preview 状态、in-memory only）；真实 dynamic 操作仍走旧 modal。

所有阶段均只支持 v2，不提供 Legacy v1 管理。MagicPatterns 是唯一视觉基准；仅在真实功能、v2 协议、安全约束或 Tauri 平台行为冲突时适配，并记录冲突原因。

## 8. 验证与硬件边界

自动验证至少包括：

- `npm run build`；
- `npm test`（前端 dynamic object 状态模型和 page-level scenario model，含 `tests/scenario-model.test.ts` 的 target/scenario 解析、阻塞条件和 preview fixture 检查；Node 内置 test runner + 内置 TypeScript type stripping，需 Node 22.18+/24，无新增依赖）；
- `cargo fmt --check`、`cargo test`、`cargo clippy --all-targets -- -D warnings`；
- `npm run tauri build -- --no-bundle`；
- `git diff --check` 和隐私/secret scan。

真实硬件验证不得执行 GET、SET、CLEAR 或任何 dynamic upload/clear；硬件测试如有需要只发送 LIST，并且报告只写发现/连接状态、slot count 和 byte length，不写 HID path、serial、raw report、slot content、dynamic text、密码或用户名。Dynamic 功能只用 fake-HID 和软件构建/单元测试验证。

公开代码、测试、文档、构建日志和诊断不能包含真实 HID path、设备 serial、用户名、设备拓扑、宏正文或凭据。示例必须是抽象占位符，不能复制设计原型中的邮箱、SSH、IP 或其他静态示例。

## 9. 当前剩余工作与发布边界

阶段 5 已完成文档一致性、跨平台配置/构建检查、最终自动验证和硬件边界记录；本阶段未连接真实硬件，也未执行 `GET`、`SET` 或 `CLEAR`。Dynamic Workspace 的 presentation-first 阶段（§4.7）已完成代码和自动测试，但尚未通过人工视觉验收；该阶段不接真实 workspace command，dynamic upload/clear 仍由旧 modal 经既有 `bridge.ts` dynamic commands 执行。托盘基础是下一个待实现阶段。macOS、Windows 原生安装器和 Linux 基线 AppImage 仍需由对应 runner 或平台分别验证，不能用 Linux 本机结果替代。最终应用在代码、文档和验证门禁完成后打开供人工查看。

后续维护必须继续遵守 v2-only 边界，不得恢复 Legacy v1 管理或把密码、K、正文、HID path、serial、raw report 写入持久化、日志和诊断。
