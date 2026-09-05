# ZMK Runtime Macro Desktop 开发设计

## 1. 项目定位

这是 `zmk-module-runtime-macro` 的跨平台桌面配置客户端，用于通过设备的专用 runtime macro USB HID interface 配置 runtime macro slots；该 interface 默认使用 HID_1，也可由固件配置为其他未占用的 HID instance。

首版目标平台：

- Linux x86_64；
- macOS Intel 和 Apple Silicon；
- Windows x64。

GUI 只负责配置已有固件功能，不修改 ZMK 主仓库，也不改变当前 v1 wire protocol。

当前状态：阶段 1–5 已完成协议、HID 通信、设备发现、连接状态、slot 元数据列表、宏编辑 UI、自动重连、连接设置和低调诊断；阶段 6 的跨平台打包配置已实现，待各平台 runner 验证。

## 2. 固件和协议约束

GUI 必须遵守现有 `docs/PROTOCOL.md` 和 `docs/CLI.md` 中的约定：

- 使用专用的 runtime macro USB HID interface；默认设备名为 `HID_1`，也可由固件配置为其他未占用的 HID instance；ZMK 键盘接口 `HID_0` 保持不变；
- 每个 request/response 固定为 32 bytes；
- `LIST`、`GET`、`SET`、`CLEAR` 是首版支持的全部命令；
- `SET` 使用每块 22 bytes 的 payload，完整事务完成前不会替换 slot；
- slot 数量通过 `LIST` 获取，不能在 GUI 中写死为 8；
- 宏内容只允许 printable US ASCII（`0x20..0x7e`）、LF、Tab、Backspace；
- 固件最大长度由 `CONFIG_ZMK_RUNTIME_MACRO_MAX_TEXT_LEN` 决定，协议范围上限为 256 bytes，但当前协议不会返回设备实际配置值；
- 固件执行宏的 `CONFIG_ZMK_RUNTIME_MACRO_TAP_MS` 和 `CONFIG_ZMK_RUNTIME_MACRO_WAIT_MS` 是编译时配置；当前 v1 没有 capability 或设置命令，桌面端不读取也不修改它们；
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
接口：Runtime Macro USB HID（默认 HID_1，可配置）  状态：已连接
```

行为：

- 启动时按 vendor Usage Page `0xff60`、Usage `0x61` 枚举 runtime macro HID 候选；不把 `HID_1`/`HID_2` 当作通用规则；
- 只有一个明确匹配候选时才自动选择；
- 多个候选（包括其他 vendor HID 使用同一 Usage 的情况）必须显示脱敏后的产品名、VID/PID 和 interface number 让用户选择，不能按 HID instance 或 interface number 猜测；
- Usage 元数据缺失时不得猜测，必须要求用户用精确 path 选择；完整 HID path 和 serial 不展示、不写入日志；
- 支持手动刷新、断开、重新连接；
- 通过定时枚举检测 USB 拔插，首版不依赖平台专用热插拔 API；
- 界面展示和诊断只保留脱敏产品名、VID/PID 和 interface number；serial/HID path 仅作为当前进程内部精确选择凭据，不展示、不记录；
- 阶段 2 只负责枚举和候选选择，不进行探测式广播 `LIST`；用户选定并建立连接后，由阶段 3 连接流程发送 `LIST`，确认所选接口确为 runtime macro 协议。

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
- 切换 slot 或关闭窗口时，对未保存内容进行确认；slot 切换使用本地化的浏览器确认提示。

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
- 界面语言：`跟随系统`、`中文`、`English`。

语言偏好使用独立的 `zmk-runtime-macro-language:v1` localStorage key，不经过后端 command，也不与宏正文共用存储。`跟随系统` 检查 `navigator.languages` 和 `navigator.language`：任一语言以 `zh` 开头时使用中文，其他语言（包括无法识别的语言）均使用 English fallback。切换后立即更新界面并同步 `<html lang>`；不要求运行时监听系统语言变化。所有应用自有文案（连接、设置、诊断、编辑器、状态、错误和确认）均提供中英文，macro 正文、控制字符 token、协议数据和安全错误 code 不翻译。

诊断信息可以包含协议版本、VID/PID、产品名和脱敏后的接口信息，但默认不记录宏文本、序列号和完整 HID path。

当前协议没有“直接执行宏”的命令，因此首版不提供“测试宏”按钮；宏仍需通过键盘上绑定的 `&runtime_macro <slot>` 触发。

## 4.6 阶段 4 已确认 Art Direction

本节记录用户已确认、阶段 4 实现必须遵守的视觉和交互规范。若本节与 Tauri、浏览器或 v1 协议的具体能力冲突，以实际平台行为为准，并在实现说明中记录偏差。

### 产品定位和总体方向

应用是一个精密、克制、安静的桌面硬件配置工具，而不是网页 Dashboard、SaaS 产品、游戏界面或 AI 控制台。用户打开后应在约 3 秒内知道设备是否连接，并能直接选择 slot、编辑 macro、保存或清空。

- 不做 Dashboard、统计卡片、图表、复杂侧边栏、多层导航、账户或云端功能。
- 不使用大面积渐变、霓虹发光、滥用玻璃拟态、巨大 Hero、过度圆角、厚阴影或堆叠卡片。
- 使用原生窗口行为和清晰的工具层级；硬件感来自精确排版、等宽数字、细边框和可预测反馈。
- Light 和 Dark 是同一个设计系统的两套表面和对比度，不是机械颜色反转。

### 实际协议边界

v1 wire protocol 没有 slot name 字段，只有 slot 编号、正文和 byte length。因此界面中的 `Password`、`VPN`、`Server` 等名称是本机 UI label：不写入键盘、不参与宏执行，并在输入框下明确标注 `Local label · not written to the keyboard`。如果持久化标签，只允许保存标签本身，并以 VID/PID/interface/Usage 等安全摘要作为 key；不得保存 macro 正文。清空 macro 只清空固件正文，保留本机 label。

宏正文默认隐藏。只有用户主动点击 Reveal 后才显示并可编辑；slot 列表、状态、错误、tooltip、日志和持久化数据都不得包含正文。当前实现使用单字符可视 token 编辑：LF 为 `↵`、Tab 为 `⇥`、Backspace 为 `⌫`；保存时转换回实际协议 byte。Enter 和 Tab 会插入对应 token，工具栏提供三类控制字符插入按钮，普通 Backspace 仍用于删除 token。这样避免不可见 byte 被静默丢失；不支持的 Unicode 会显示本地校验错误。

### 信息架构和布局

顶部固定为约 56px 的状态栏：左侧是 `ZMK Runtime Macro`，右侧是当前设备摘要、`● Connected`/`Device disconnected`、低调的 Refresh/Reconnect 和 `System / Light / Dark` 选择。连接状态不使用大面积绿色或红色横幅。

主体标题为 `Macro Slots`，旁边显示动态 slot 数量。主体采用连续的 `Slot List + Inspector` 两栏，而不是一堆独立卡片：

- 左侧 slot list 约 216px 宽，每行约 52px，显示低对比度编号（人类显示为 `01`，对应协议 slot 0）、本机 label、byte length/`Empty` 和未保存小圆点。行之间使用轻 divider；选中只使用轻微 surface 差异和 2px Accent 左线。
- 右侧只显示当前选中 slot 的 inspector：slot 编号/状态、本机 label、macro 编辑区、byte count、Reveal/Hide、轻量保存状态、`Clear macro…` 和 `Save`。
- 空 slot 显示 `No macro configured` 和 `Add macro`；点击 Add 后展开编辑区，不创建新的大卡片。
- 宽窗口下内容最大约 960px，inspector 可读宽度约 680px，多余空间留白，不增加 Dashboard 内容。
- 设备断开时保留内存中的未保存草稿，禁用 Save/Clear，并提供 Reconnect；不会显示假连接状态。
- LIST 刷新后，干净 slot 会重新标记为未加载，只有当前选中且非空的 slot 才会发送 GET；真正 dirty 的草稿会在同一安全设备摘要（VID/PID/interface/Usage）重连时保留，切换到不同摘要的设备会清理旧设备草稿。该摘要不使用也不暴露 HID path 或 serial。
- 未保存保护实际使用 Tauri 2 的 `onCloseRequested`；发现 dirty draft 后同步 `event.preventDefault()`，显示应用内的可访问确认 modal，取消保持窗口，确认调用 `WebviewWindow.destroy()` 绕过再次触发的 close event 并真正关闭窗口。该策略不依赖 Tauri WebView 中不可靠的同步 `window.confirm`，也不会对无 dirty draft 的正常关闭强制 destroy。在普通浏览器开发环境或 hook 注册失败时回退到 `beforeunload`；slot 切换使用不含正文的本地化确认提示。关闭保护只阻止/放行窗口关闭，不持久化 macro 正文。

### Light Theme tokens

| Token | HEX | 使用原则 |
|---|---|---|
| Background | `#F3F4F2` | 中性灰白窗口背景，不用刺眼纯白 |
| Surface | `#F9FAF8` | 连续 slot list 和主体区域 |
| Elevated Surface | `#FFFFFF` | 输入框、选中行和弹出确认区 |
| Border | `#D9DCD7` | 克制的 1px 分隔线和输入边界 |
| Primary Text | `#242724` | 标题、label 和正文，不用纯黑 |
| Secondary Text | `#5E645F` | 设备信息、辅助说明和 byte count |
| Muted Text | `#8A918B` | 编号、placeholder 和弱提示 |
| Accent | `#49658F` | 选中指示、Save、focus 辅助色 |
| Success | `#3F7655` | Connected、Saved |
| Warning | `#986B27` | Unsaved、持久化提示 |
| Error | `#B04E4E` | 写入失败和危险动作 |
| Focus Ring | `#6F8DBA` | 2px 键盘焦点环 |

状态背景只使用对应颜色约 8–12% 的浅 tint；不要让状态色成为大面积装饰。输入框用 Elevated Surface 与 Surface 的轻微差异和细边框建立层次，主要不依赖阴影。

### Dark Theme tokens

| Token | HEX | 使用原则 |
|---|---|---|
| Background | `#171918` | 深灰窗口背景，不用纯黑 |
| Surface | `#1D201E` | slot list 和主体区域 |
| Elevated Surface | `#252825` | 输入框、选中行和确认区 |
| Border | `#363A37` | 低对比但可辨识的边界 |
| Primary Text | `#ECEEEA` | 标题、label 和正文 |
| Secondary Text | `#B6BBB5` | 设备信息和辅助说明 |
| Muted Text | `#838A84` | 编号、placeholder 和弱提示 |
| Accent | `#89A4CC` | 选中指示、Save、链接 |
| Success | `#74AA85` | Connected、Saved |
| Warning | `#D0A257` | Unsaved、持久化提示 |
| Error | `#DA7B78` | 写入失败和危险动作 |
| Focus Ring | `#9CB5DA` | 2px 键盘焦点环 |

Dark Theme 的层级来自三层石墨色表面，不使用发光边框；Accent 只在必要的动作和焦点处出现。使用浅色 Accent 或 Error 填充的按钮改用深色对比文字，避免固定白字在 Dark/System-dark 下失去可读性。

### Typography

普通界面使用 `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif`；macro 编辑器、slot 编号和 byte count 使用 `ui-monospace, SFMono-Regular, "Cascadia Mono", "Segoe UI Mono", monospace`。数字启用 `font-variant-numeric: tabular-nums`。

| 元素 | 字号 | Weight | Line height |
|---|---:|---:|---:|
| 应用名称 | 15px | 600 | 20px |
| 主标题 | 18px | 600 | 24px |
| Section 标题 | 14–16px | 600 | 20–22px |
| Slot 名称 | 14px | 600 | 20px |
| Macro 输入 | 13.5px | 400 | 20px |
| 普通/辅助文字 | 13px / 12px | 400 | 18px / 16px |
| 按钮文字 | 13px | 500 | 18px |
| Slot 编号 | 12px | 500 | 16px |

不使用营销页式巨大标题或展示字体。

### Spacing 和窗口尺寸

基础 spacing system 固定为 `4 / 8 / 12 / 16 / 24 / 32`。窗口默认 `860 × 620`，最小 `720 × 520`，允许 resize 和最大化；不使用无边框自定义标题栏。window padding 为 20–24px（窄窗口 16px），顶部栏压缩为约 48px，section 间距 20–24px，slot row 48px，普通输入 34–36px，macro editor 最小 142px（约 144px 可视高度），按钮和 icon button 30–32px，Inspector 内部间距 14–18px，label 与输入间距 8px。

较宽窗口把内容限制在约 960px；slot list 保持约 216px，inspector 保持可读宽度，不能因为空间增加而加入卡片或统计。

### 组件样式

- **Text Input：** 36px 高、4px 圆角、1px Border、Elevated Surface；下方说明本机 label 不写入键盘。
- **Password/Macro Input：** 隐藏时显示 bullets 和 byte count，不能编辑正文；Reveal 后用等宽 token editor 编辑。不要把正文放入 placeholder、title、aria-label 或错误文本。
- **Primary Button：** 仅 Save 使用 Accent 实色，32px 高，不能做成营销 CTA；只有存在 dirty 修改时强调。
- **Secondary Button：** Refresh、Reconnect、Add 使用透明或 Surface 加低对比细边框；顶部工具按钮默认无边框，仅 hover/active 时显出 Surface。
- **Workspace：** slot list 与 inspector 共用连续 Surface；slot 行使用轻 separator、左侧 2px selected 指示和浅层 Elevated Surface，不使用独立卡片。
- **Connection Chip：** 顶部 Connected/Checking/Disconnected 使用小圆点、24px 高和低对比圆角 chip；状态色只用于语义，不铺满区域。
- **Destructive Action：** `Clear macro…` 为低调文字按钮，原位展开 `Clear this macro? Cancel Clear` 二次确认，不使用大红实心按钮。
- **Status Indicator：** 6px 圆点加文字，如 `● Connected`、`● Unsaved changes`、`✓ Saved`，不用大胶囊。
- **Divider：** 1px Border，slot 行连续排列，不加阴影。
- **Inline Message：** 靠近编辑器，使用小图标/文字/Retry 和 2px 左状态线；不用遮挡内容的大型 toast。
- **Empty State：** 不用插画，只显示 `No macro configured` 和 `Add macro`。
- **Tooltip：** 只解释 icon button，约 11–12px、最大 220px，绝不放正文。
- **Focus/Disabled：** 所有控件可键盘访问，使用 2px Focus Ring；disabled 降低对比而非模糊，仍保留原因可读性。

按钮必须显式 `type="button"`，icon button 需要 accessible label；窄窗口不能横向溢出。

### 交互状态

- **Checking：** `○ Checking device…`，首次枚举、手动 Refresh 或 Reconnect 期间显示该状态；先显示结构再等待，检查结束后才显示 Connected/Disconnected。
- **Connected：** `● Connected` 和设备摘要，小面积 Success 色。
- **Disconnected：** `Device disconnected` + `Reconnect`，保留草稿并禁用写入。
- **Modified：** `● Unsaved changes`、左侧小点、Save 可用；切换 slot/关闭窗口时应提示未保存。
- **Saving：** Save 显示 `Saving…` 并禁用，防止重复提交；HID 操作保持串行。
- **Saved：** `✓ Saved` 在操作区轻量显示约 2 秒，成功前不清 dirty。
- **Error：** 保留草稿和 dirty，提供 Retry，不显示 raw backend/path/serial/report/正文。`STORAGE_ERROR` 应说明“本次会话可能已生效，但未能永久保存”，不能错误宣称完全失败。
- **Reveal：** 每次首次加载或切换 slot 默认隐藏；用户点击后才显示/编辑 token。切换 slot 后重新隐藏，Save/Saved/tooltip 不包含正文。

### ASCII wireframes

Light Theme：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ZMK Runtime Macro                   Example Keyboard  ● Connected  ↻ System│
├──────────────────────────────────────────────────────────────────────┤
│ Macro Slots                                               10 slots   │
│ ┌───────────────────┬──────────────────────────────────────────────┐ │
│ │ 01  Password    • │ SLOT 01                         Unsaved changes│ │
│ │     24 bytes      │ Name                                         │ │
│ ├───────────────────┤ ┌──────────────────────────────────────────┐ │ │
│ │ 02  Server        │ │ Password                                 │ │ │
│ │     18 bytes      │ └──────────────────────────────────────────┘ │ │
│ ├───────────────────┤ Local label · not written to the keyboard   │ │
│ │ 03  Empty         │ Macro                         24 bytes       │ │
│ │     0 bytes       │ ┌──────────────────────────────────────┐   │ │
│ ├───────────────────┤ │ •••••••••••••••••••••••••••••• Reveal│   │ │
│ │ 04  VPN           │ └──────────────────────────────────────┘   │ │
│ │     32 bytes      │ Last saved                Clear macro… Save │ │
│ └───────────────────┴──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Dark Theme：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ZMK Runtime Macro                   Example Keyboard  ● Connected  ↻ System│
├──────────────────────────────────────────────────────────────────────┤
│ Macro Slots                                               10 slots   │
│ ┌───────────────────┬──────────────────────────────────────────────┐ │
│ │ 01  Password       │ SLOT 02                              ✓ Saved │ │
│ │     24 bytes       │ Name                                         │ │
│ ├───────────────────┤ ┌──────────────────────────────────────────┐ │ │
│▌│ 02  Server         │ │ Server                                   │ │ │
│ │     18 bytes       │ └──────────────────────────────────────────┘ │ │
│ ├───────────────────┤ Local label · not written to the keyboard   │ │
│ │ 03  Empty          │ Macro                         18 bytes       │ │
│ │     0 bytes        │ ┌──────────────────────────────────────┐   │ │
│ ├───────────────────┤ │ •••••••••••••••••••••••••••••• Reveal│   │ │
│ │ 04  VPN            │ └──────────────────────────────────────┘   │ │
│ │     32 bytes       │ Last saved                Clear macro… Save │ │
│ └───────────────────┴──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 设计批评：需要避免的 5 种 AI UI 味道

1. **Card Soup：** 不要把每个 slot 做成带标题、阴影和按钮的独立卡片；使用连续列表和单一 Inspector。
2. **紫蓝渐变和霓虹：** 不要用 Gradient Hero、Neon Accent、Glassmorphism 或发光边框冒充科技感。
3. **Dashboard 化：** 不要加入 Welcome、活跃 slot 统计、环形图、趋势图或大 Hero；用户需要的是连接、选择、编辑、保存。
4. **所有动作抢注意力：** 不要让 Refresh、Reveal、Save、Clear、Reconnect 都是高饱和实心按钮；每个视图最多一个主要动作，Clear 必须是危险次级动作。
5. **过大字体、圆角和留白：** 不要使用 32px 标题、16px 圆角或宽松卡片导致一屏只剩两个 slot；保持精确而紧凑的信息密度。

核心原则：**像一个精密、克制、可靠的桌面硬件配置工具，而不是一个网页 Dashboard。**

### 当前实现的视觉精修

当前 UI 在不改变设备连接、slot 编辑或状态交互的前提下，采用 48px 紧凑顶部栏、单一 `Macro Slots` 标题、连续 slot 列表和单一 inspector/form。顶部工具按钮保持 ghost 层级，Connected 使用低调 status chip；Save 保持唯一实色主动作，Clear 保持文字式危险次级动作。Light、Dark 和 System-dark 复用相同的 spacing、圆角与层级规则，仅调整表面和文字 token。

## 4.7 阶段 5：错误体验、自动重连、设置和诊断

### 自动重连

- 自动重连默认开启，只针对意外断线、LIST/GET/SET/CLEAR、连接或发现失败进入有限次数的退避尝试。
- 退避延迟为 1/2/4/8/15 秒，最多自动尝试 8 次；达到上限后显示可操作的 Retry/Reconnect，不进入 tight loop。
- 用户主动 Disconnect 会抑制自动重连；只有用户主动 Refresh/Reconnect 或选择设备连接后才恢复。
- 重连期间显示 `Reconnecting…` 或 `Checking device…`，在首次完整 LIST 成功前绝不显示 Connected。多个同 Usage 候选不会自动猜测，要求用户明确选择。
- 同一安全设备摘要（VID/PID/interface/Usage）重连时保留内存中的 dirty draft；切换到其他摘要时清理旧设备草稿。HID path、serial 和宏正文不参与摘要、不进入日志或持久化。
- 重连 timer、请求序列和组件卸载均有 cleanup；并发的旧请求不能覆盖新连接状态。自动重连只调用既有 Tauri commands，不在前端直接访问 HID。

### 连接设置

- 新增 `get_settings` 和 `set_settings` Tauri commands，IPC 使用 camelCase 的 `timeoutMs` 和 `retries`。
- request timeout 默认 `1000 ms`，允许 `100–5000 ms`；retries 默认 `2`，允许 `0–5`。后端 `ClientConfig` 校验边界，设置实际传入下一次创建的 HID protocol session。
- 当前 session 的配置不会被原地替换；设置面板明确显示 `Timeout and retries apply on next connection.`，保存后重新连接才生效。
- 仅将 theme、language preference、auto reconnect、timeout 和 retries 存入 localStorage；不存储 macro 正文、raw report、HID path 或 serial。

### 低调诊断

诊断区域默认折叠，不增加 Dashboard 或统计卡片，只显示白名单安全摘要：

- Runtime Macro protocol v1 和 USB HID transport；
- 当前连接状态、脱敏产品名、VID/PID、interface number 和 Usage Page/Usage；
- 动态 slot count；
- 最近一次白名单操作（`Discover`、`Connect`、`Disconnect`、`LIST`、`GET`、`SET`、`CLEAR`、`Settings`）；
- 最近一次结构化 sanitized error code。

诊断不显示 HID path、设备序列号、用户名、raw report 或宏正文；错误 UI 也只使用 `CommandError` 的安全 code/message。`STORAGE_ERROR` 继续提示本次会话可能已生效但未永久保存。

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
Runtime Macro USB HID（默认 HID_1，可配置）
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

首版发布配置位于 [`.github/workflows/release.yml`](../.github/workflows/release.yml)，使用各平台原生 GitHub Actions runner，不依赖交叉编译：

| 平台 | Runner / target | 交付物 | 关键事项 |
|---|---|---|---|
| Linux x86_64 | `ubuntu-22.04` | AppImage + `.deb` | 构建时安装 WebKitGTK、Tauri 和 `hidapi`/hidraw 所需依赖 |
| macOS Intel | `macos-13` / `x86_64-apple-darwin` | `.dmg` | 单独构建 Intel target |
| macOS Apple Silicon | `macos-14` / `aarch64-apple-darwin` | `.dmg` | 单独构建 Apple Silicon target |
| Windows x64 | `windows-latest` | NSIS `.exe` | 使用系统 HID 驱动和 WebView2 |

workflow 只在手动触发或推送明确的 `app-vX.Y.Z` 版本 tag 时运行，不会因普通 push 创建 Release。Tauri action 将产物上传到 draft Release；发布者需要检查版本和产物后手动发布。矩阵通过 `--bundles` 显式限制目标，因此 Linux 不产出 RPM、Windows 不产出 MSI。

Tauri bundle 配置只启用 `appimage`、`deb`、`dmg` 和 `nsis`。Windows 使用官方 `downloadBootstrapper` WebView2 安装模式：安装缺少 WebView2 时需要网络；首版不嵌入约 127 MB 的 offline installer。

Linux workflow 安装 Tauri v2 官方 Debian/Ubuntu 依赖，并额外安装 `pkg-config`、`libudev-dev`（`hidapi` 的 `linux-static-hidraw` 构建依赖）、`patchelf`、`xdg-utils` 和 `libfuse2`（AppImage 构建依赖）。CI 只执行依赖安装、前端构建和 Tauri 打包，不访问真实 HID 设备。

当前公开仓库没有可用于所有用户的稳定 VID/PID 映射，因此不凭空提交 udev 规则或真实硬件标识。Linux 普通用户仍需根据所用固件公开的 VID/PID，在本机安装最小权限规则；可以从下面的模板开始，并替换占位符，不要把本机路径、序列号或设备拓扑提交到仓库：

```udev
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="<vendor-id>", ATTRS{idProduct}=="<product-id>", MODE="0660", GROUP="<existing-input-group>"
```

规则安装由用户或安装包明确执行，GUI 不会静默修改系统权限。待固件发布稳定、公开的 VID/PID 后，再单独评估是否把经过验证的规则加入各平台安装方案。

三平台正式发布仍需要各自的代码签名：macOS 需要 signing/notarization，Windows 需要 Authenticode。当前 workflow 不引用这些 secrets，产物明确视为 unsigned CI artifacts；签名发布应在后续配置好受控 secrets 后进行。

## 6.1 发布操作与文件

具体的版本、tag、draft Release、签名边界和平台检查步骤见 [`docs/RELEASING.md`](RELEASING.md)。版本发布前至少在本机运行 `npm ci`、前端构建、Rust 测试和 Tauri no-bundle 构建；完整的 macOS/Windows/Linux installer 验证必须在对应原生 runner 上完成。

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

## 开发流程门禁与协作约定

- 每个实施阶段完成后由主代理审核；审核通过后按当前授权自动 commit 并 push。
- 用户已确认阶段 4 Art Direction，并授权后续阶段默认由 worker 实现、主代理审核；审核通过后自动提交、推送并继续，不再逐阶段等待确认，直到项目完成。
- 开始阶段 4 前，必须先与用户讨论并确认 GUI 的 UI 视觉审美和 Art Direction。该门禁已于阶段 4 开始前完成；讨论范围包括视觉语言、配色、字体、布局密度、组件形态、状态反馈、平台一致性和参考产品。
- 主代理负责计划和审核，worker 负责实现、修改、测试和文档落盘。
- 本项目是公开项目。代码、测试、文档、日志和诊断不得包含真实 HID path、设备序列号、用户名、设备拓扑或其他本机隐私信息；示例仅使用明显虚构的值，例如 `Example Keyboard` 和 `<EXAMPLE-HID-PATH>`。

## 9. 后续功能

可以在首版稳定后增加：

- 宏导入/导出和本地备份；
- 更详细的设备能力查询；
- 自动更新；
- 多设备配置切换；
- 协议 v2 的 capability/firmware information 命令。

这些功能不应改变当前 v1 协议的兼容性。
