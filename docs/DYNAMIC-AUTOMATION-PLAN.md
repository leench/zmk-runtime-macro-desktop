# Runtime Macro Dynamic 场景应用与本地服务开发计划

## 1. 文档目的与当前决策

本文规划 `zmk-runtime-macro-desktop` 在现有 Runtime Macro v2 slot 配置客户端基础上，逐步增加 Dynamic Macro 场景管理、系统托盘和本地自动化服务。

本文与固件模块及配套客户端项目中的以下文档一起使用：

- `docs/DYNAMIC_PROTOCOL.md`：Dynamic Macro wire contract（当前已实现的 v2 多槽位版本，取代早期单槽 v1）；
- `tools/runtime_macro_cli.py`：Python reference client（已按 v2 contract 同步）；
- companion 项目 `zmk-runtime-macro-mqtt-bridge` 的 `docs/LOCAL_DYNAMIC_HTTP_API.md`：本地 HTTP API 的调用方 contract（同机自动化客户端 / MQTT bridge 开发者使用，已实现的部分与后续增强分列）。调用方 contract 只维护在该 companion 项目，本仓库不复制一份；
- 本文：desktop 产品形态、UI 交付顺序、服务边界、场景模型和多 Dynamic Object 处理计划。

本文不修改固件协议，也不把复杂的自动化规则写死在 React UI 中。

当前已经确认的实施方向和实际进度是：

1. **Dynamic Protocol v2 backend、bridge/multislot model 和 presentation-first Dynamic Workspace 均已完成。** Rust protocol/client/commands 已按 v2 多槽位实现（slot-aware capability/upload/clear、每 object 最大 512 bytes、逐槽 clear、retry 从 BEGIN 重启）；`src/bridge.ts` 与 `src/types/dynamic.ts` 已提供 slot-aware dynamic command 和 per-object 状态模型；`src/features/dynamic/` 的页面级 Dynamic Workspace 已完成（Scenario 列表/编辑器、capability-driven target 行、状态矩阵和确认对话框），其中 DeviceSelect 入口仍用 in-memory fixture，connected Workbench 入口已接入真实 command，但**仍待人工视觉验收**。
2. Dynamic Workspace 保留 presentation-first 的 Preview 路径：DeviceSelect 入口用 in-memory fixture 完成高保真视觉和交互评审，不接真实 HID、不做场景持久化、不接 HTTP API；connected Workbench 入口则已接入真实 capability/service/store（见 §12 阶段 5），旧 `DynamicMacroModal`/`DynamicMacroPanel` 作为 fallback 保留到视觉验收通过。
3. **托盘基础已实现并已接入真实状态/操作**（`src-tauri/src/tray.rs`、`src-tauri/src/lib.rs`、`src/App.tsx`、`src/features/dynamic/DynamicWorkspace.tsx`）：Tauri 2 tray icon 和原生菜单、打开/隐藏/明确退出、close-to-tray、单实例窗口恢复；菜单的设备/Dynamic/Scenario 状态行显示连接与本地观察状态（状态行始终 disabled，仅信息展示），`Choose scenario` / `Upload current scenario` / `Clear Dynamic Object` 由受限 runtime context 控制 enabled，并通过稳定全局 event `tray-action` 交给已连接窗口执行；菜单文本有 `en` / `zh-CN` 两套 labels，由受限 `set_tray_locale` 与 `set_tray_runtime_state` command 更新（Rust 只接受这两个精确 locale tag 与精确 status tag，不自行推断语言、不接受任意文本）。平台专属托盘行为仍需在对应平台人工验收。
4. UI 人工视觉验收通过后，才依次实现 contract/DTO 冻结、场景持久化、设备 alias、自启、本地 HTTP API 和自动场景；DynamicService、UI 接入真实 HID、Scenario store、设备 alias、托盘状态/操作和登录自启已完成（托盘操作仍通过 frontend bridge，不绕过 DynamicService；alias 只是本机展示名，不写入设备；自启用官方 autostart plugin，启动开关不携带任何凭据/正文/设备信息）。本地 HTTP API 已按**固定 loopback 端口 + 无认证 + 仅按设备 alias 选择**冻结，并实现了 discovery（`/health`、`/devices`）与按 alias 的 Dynamic Macro 写入（`POST /dynamic-macros`，见 §10）；API 认证（可选 token）、clear/status、operation 和自动场景仍未实现。
5. 当前主机可以执行适用的 frontend、Rust、Tauri build/test；跨平台专属行为仍必须在对应平台或 runner 上验证。
6. 上面已完成的 v2 多槽位 backend 和 bridge 是后续接入基线，不从零重写，也不降级回单槽 v1。

产品核心定位为：

```text
用户命名的场景模板 + 系统托盘入口 + Dynamic Macro HID bridge + 可选本地自动化服务
```

应用不是宏内容的安全存储系统，也不是公网服务。Dynamic 文本只适合非 secret 内容。

## 2. 术语和边界

### 2.1 Scenario

**Scenario（场景）**是用户在 desktop 应用中创建、自己命名和编辑的宏模板。例如用户可以自行创建一个名字为“工作终端”的场景；名称不是固件协议字段，也不是固件预置值。

Scenario 可以包含：

- 用户自定义名称；
- Dynamic 宏正文；
- TTL 和执行后保留策略；
- 目标设备 alias；
- 目标 Dynamic Object；
- 后续自动场景所需的 source、priority 或匹配规则。

Scenario 是 desktop 的逻辑对象。它不是固件里的 Dynamic Object，也不表示设备当前保存了同样的文本。

### 2.2 Dynamic Object

**Dynamic Object**是 firmware 中的 RAM-only 容器，接收一次 Dynamic Macro upload。它没有 static slot 的 LIST/GET readback 能力，可能因执行、TTL、USB disconnect、重启或 lifecycle policy 被清除。

- Scenario 可以有多个；
- 一个设备当前或未来可以有一个或多个 Dynamic Object；
- 一个 Scenario 在某次操作中选择一个目标 Dynamic Object；
- UI 以 Scenario 为主要管理对象，Dynamic Object 是目标资源；
- 不把 Scenario 列表误画成 firmware object 列表，也不把 Dynamic Object 当作可读回的文本槽位。

### 2.3 当前 Dynamic Object 模型

当前 firmware 的 Dynamic Protocol v2 capability 报告 `dynamic_object_count`（默认 8，范围 1–8）和 512-byte `max_dynamic_length`；wire slot 必须是 `0..dynamic_object_count-1`，`0xff` 是 static `LIST_SLOT` 而不是合法 dynamic object。desktop 的 object 模型因此直接以 capability 为准：

- desktop/API 可以在 object 编号之外提供一个稳定的展示 alias，但 alias 不是对未来编号的猜测；
- UI 必须能读取 capability 的 object count 并在其上选择目标 object；
- 不硬编码 object 数量、编号范围、容量、TTL 边界或 wire contract，一律以 `CAPABILITIES` 返回值为准；
- 单 object 设备（count = 1）和多 object 设备必须能用同一套 UI 模型表达。

### 2.4 观察状态

Desktop 只能表达本地观察到的 transaction 结果，不能声称知道 firmware 当前 Dynamic 文本。`CommittedLocally` 和 `ClearedLocally` 只表示本次连接收到对应 final ACK；disconnect、reconnect、应用重启、firmware 重启或结果不确定后都必须回到 `Unknown`。

TTL 倒计时如果展示，必须标记为估计值，不能表示可靠的设备 readback。

## 3. 当前基线

### 3.1 已完成的协议和 backend 基线

当前仓库已经具备：

- Tauri 2 + React + TypeScript + Rust；
- Rust 负责 HID 枚举、连接、协议、重试和错误映射；
- 前端不直接访问 HID；
- Runtime Macro v2 固定 32-byte frame；
- Dynamic v2 `CAPABILITIES`、`DYNAMIC_BEGIN`、`DYNAMIC_DATA`、`DYNAMIC_CLEAR`（slot-aware，object count 默认 8，每 object 512 bytes）；
- capability 严格解析；
- upload 的 22-byte DATA 分块和原子 transaction（512 bytes 最多 24 chunks）；
- clear 和 upload retry；upload retry 使用新 request ID 并从 BEGIN 重启；clear 逐 object 幂等，无 wire clear-all；
- fake HID、protocol/client/command 相关测试；
- Dynamic 绕过 static password gate，但不应触发 static login；
- dynamic 文本仅允许 printable ASCII、LF、Tab 和 Backspace；
- Dynamic 默认执行后消费，可选 `keep-after-execute`；
- Dynamic 没有 readback，只能报告本地观察状态；
- Dynamic 状态层 `DynamicService`（capability、upload、clear 的本地观察状态、generation、唯一 DTO 和 `get_dynamic_state` command）已落地并在本阶段迁移完成；连接后的 Workbench Dynamic Workspace 和 Scenario store 已接入，DeviceSelect 入口仍保持纯 Preview；托盘状态行和三个真实操作已接入（经受限 context 与 `tray-action` event，见 §4.2）；本地 HTTP API（固定 loopback 端口、无认证、alias-only 的 discovery 与 Dynamic 写入）已接入（见 §10），API 认证、clear/status 和 operation 仍未实现。

相关现有实现主要位于：

```text
src-tauri/src/protocol.rs
src-tauri/src/client.rs
src-tauri/src/dynamic_service.rs
src-tauri/src/commands.rs
src/bridge.ts
src/components/DynamicMacroPanel.tsx
src/components/DynamicMacroModal.tsx
src/pages/MacroWorkbench.tsx
src/App.tsx
```

后续功能必须审核、复用并接入这些基线，不能为了新 UI 另开一套绕过既有 validation/retry/auth boundary 的 Dynamic client。

### 3.2 已认可的视觉基线

当前 `src` 中除 Dynamic 部分以外的 UI 视觉质量已认可，以下内容是后续所有 UI 的唯一视觉基准：

- MagicPatterns 设计来源；
- `TitleBar`、`AppHeader`、Static Slots 的列表/编辑器布局；
- 颜色 token、字体、字号、字重、间距、圆角、边框、阴影和按钮风格；
- 当前的空状态、错误提示、确认操作、主题和窗口行为。

本计划只重做 Dynamic 相关体验，不整体重写 `App.tsx`，不重做已认可的 Static Slots、认证和设置 UI。新增 Dynamic 页面必须看起来像原设计的一部分，而不是后加的独立工具。

### 3.3 当前 Dynamic UI 的产品方向

当前 `DynamicMacroModal.tsx` 和 `DynamicMacroPanel.tsx` 是不满意的临时实现：它们把正文、TTL、keep、capability、lifecycle、警告和 clear/upload 操作堆在一个弹窗中，因此不作为新的产品形态；同时它们仍是当前真实的 dynamic handler 和 fallback 入口。

产品方向是新的**页面级 Dynamic Workspace**，并已按 presentation-first 实现（见 §12 阶段 1）：

- 不再把 Dynamic 主体验设计成弹窗；
- presentation 阶段保留旧入口，直到新页面通过人工视觉验收；
- 新 UI 验收后再移除或下线旧 `DynamicMacroModal`/`DynamicMacroPanel` 入口；
- 不在新 UI 验收前把旧弹窗继续扩展成场景管理器。

## 4. 托盘优先的产品形态

### 4.1 第一阶段托盘基础

第一阶段先实现托盘基础和窗口生命周期，但此时不要求 DynamicService、场景持久化或 HTTP API 已完成。托盘可以使用静态/mock 状态进行视觉和菜单验收，但不得把 mock 结果标成真实设备操作结果（阶段 7 已把状态行和三个操作接入真实来源，见 §4.2）。

基础能力包括：

- Tauri tray icon；
- 打开/显示主窗口；
- 隐藏主窗口到托盘；
- 关闭窗口默认隐藏到托盘，而不是退出进程；
- 明确的“退出”菜单项终止应用；
- 单实例再次启动时恢复已有窗口；
- 托盘菜单的视觉层级、禁用状态和错误状态。

这些基础能力已实现（§4.2 列出真实行为与托盘状态/操作的边界）；托盘图标和菜单在 GNOME/KDE、Wayland/X11、Windows 和 macOS 上的实际表现仍需要对应平台人工验收。

登录自启不属于第一阶段托盘基础，放在真实 DynamicService 和手动闭环稳定之后实现；现已落地（见 §12 阶段 8：官方 plugin、固定 `--autostart` 开关、主窗口 `visible: false`、默认关闭）。

### 4.2 托盘菜单的真实状态与操作

托盘的菜单结构如下（原生菜单提供 `en` / `zh-CN` 两套标签，`init` 时默认英文；状态行嵌入真实状态文本）：

```text
打开 ZMK Runtime Macro
──────────────────────
设备                 本地 alias / 已连接 / 未连接
Dynamic 状态         本地观察状态（unknown/ready/error/…）
当前场景             当前场景显示名 / 无
──────────────────────
选择场景             >
上传当前场景
清除 Dynamic Object
──────────────────────
设置
退出
```

托盘是**视图，不是 worker**：它不打开 HID、不发送 protocol frame、不调用 DynamicService、不读取 Scenario store，也不显示 HID path、serial 或正文。

- **真实行为**：`Open ZMK Runtime Macro`（以及 tray icon 左键点击）显示、取消最小化并 focus 主窗口；`Settings` 同样只显示并聚焦主窗口（设置界面在主窗口内）；`Quit ZMK Runtime Macro` 调用 `app.exit(0)` 终止应用（绕过 close-to-tray；退出路径在 `RunEvent::Exit` 先停掉本地 API acceptor，再经同一 HID worker 显式释放 session 并做 best-effort LOCK，因为平台事件循环以 `std::process::exit` 结束、managed state 的 `AppState` drop 不会执行）；普通窗口关闭隐藏到托盘；第二次启动由 single-instance plugin 恢复已有窗口。
- **状态行（始终 disabled，仅信息展示）**：设备行显示连接设备的本地 alias；设备没有 alias 时只显示“已连接”，断连时显示“未连接”，菜单不会自己编造名称；Dynamic 行显示序列化的本地观察状态（`unknown` / `discovering` / `ready` / `unsupported` / `uploading` / `committedLocally` / `clearing` / `clearedLocally` / `error`）；场景行显示当前场景的**显示名称**或“无”。`committedLocally` / `clearedLocally` 在菜单里明确写作本地确认（`Sent/Cleared · local confirmation`、`已发送/已清除 · 本地确认`），不当作设备 readback。
- **操作行**：`Choose scenario` / `Upload current scenario` / `Clear Dynamic Object` 的 enabled 由受限 runtime context 决定：必须已连接，且必须由窗口报告 upload/clear 无 blocker（目标缺失、超长、TTL、keep 不支持、store 不可用、场景未绑定当前设备或操作进行中都保持 disabled）。菜单项被点击时，托盘先恢复并聚焦主窗口，再 emit 稳定全局 event `tray-action`；真正的保存—上传顺序、dirty 确认和 clear 确认全部由窗口的现有路径完成。
- **输入边界**：`set_tray_runtime_state` 是唯一的运行状态输入，它的单个参数 `runtime` 只接受 `deviceConnected`、`dynamicStatus`、`currentScenarioName`（可空、≤ 64 bytes、不含控制字符的显示文本）、`deviceAlias`（可空、≤ 64 bytes、不含控制字符的本地 alias）、`canChooseScenario`、`canUploadScenario`、`canClearDynamic`；非法 status tag 返回 `unsupported_tray_status`，非法名称返回 `invalid_tray_scenario_name`，非法 alias 返回 `invalid_tray_alias`，错误信息不回显被拒值。Rust 端再把三个 action flag 与 `deviceConnected` 取交集，并在断连时丢弃 alias，因此断连时永远不会 offer 设备操作、也不会残留上一台设备的名称。
- **event payload**：`tray-action` 只携带三个稳定 action 之一（`chooseScenario` / `uploadScenario` / `clearDynamic`），不含正文、path、serial 或设备标识；未连接或未监听的窗口不会自行执行任何操作。
- **菜单文本跟随 UI locale**：菜单标签集中为 `en` 与 `zh-CN` 两套（不进入前端 UI locale 文件，菜单本身归 Rust 持有）；`set_tray_locale` 命令只接受精确的 `"en"` / `"zh-CN"`，其他值返回 `unsupported_locale`；语言始终来自前端 `resolveLocale` 的结果，Rust 不读环境变量、存储偏好或设备信息来猜语言；`App.tsx` 在启动和 locale 变化时同步，无需重启，失败静默处理；locale 切换不重置 runtime context。
- 仍未实现：托盘直接读写设备（不在计划中）和 API 认证；本地 HTTP API 的 discovery（`/health`、`/devices`）与 Dynamic 写入（`POST /dynamic-macros`，§10）已实现；登录自启已实现（§12 阶段 8：官方 plugin + 固定 `--autostart` 开关 + 主窗口 `visible: false`，默认关闭）；真实硬件与跨平台托盘/自启人工验收仍待完成。

## 5. Presentation-first UI 阶段

### 5.1 UI-only 的明确边界

UI 阶段只完成高保真页面、状态展示和评审用交互。允许：

- 使用 in-memory fixture；
- 在开发预览中切换状态；
- 点击场景、对象 selector、下拉框、确认对话框和按钮；
- 在内存中切换 dirty、selected、mock operation 状态；
- 使用单 object（count = 1）和多 object（count = 8）两种合法 fixture 做布局验收；
- 使用截图、运行中的窗口和人工操作完成视觉评审。

UI 阶段禁止：

- 调用 HID 或 Tauri Dynamic command；
- 访问或修改真实设备；
- 实现场景持久化；
- 写 `localStorage`；
- 接入 HTTP API；
- 生成或保存 API token；
- 声称完成真实上传、清除、readback 或设备状态；
- 把 mock fixture 当成 firmware 多 object contract。

UI-only 场景正文只存在 React 内存中，应用刷新后可以消失。正式保存必须等 scenario store 阶段。

### 5.2 不整体重写现有应用

新增 UI 应以最小入口接入现有 `MacroWorkbench`，保留既有 static UI：

```text
src/features/dynamic/
├── DynamicWorkspace.tsx
├── DynamicWorkspaceHeader.tsx
├── DynamicStatusCard.tsx
├── DynamicTargetSelector.tsx
└── DynamicCapabilityDetails.tsx

src/features/scenarios/
├── ScenarioList.tsx
├── ScenarioListItem.tsx
├── ScenarioEditor.tsx
├── ScenarioActions.tsx
├── ScenarioEmptyState.tsx
└── ScenarioDialog.tsx

src/types/dynamic.ts
src/types/scenario.ts
```

文件名可以根据现有实现调整，但职责必须保持窄而清晰。不要为了 Dynamic UI 重写整个 `App.tsx` 或 Static Slots 组件。

### 5.3 页面级 Dynamic Workspace

Dynamic Workspace 与 Static Slots 并列，但保留现有 `TitleBar`、`AppHeader` 和整体页面边界：

```text
┌──────────────────────────────────────────────────────────┐
│ TitleBar / AppHeader                                     │
│ Static Slots                         Dynamic Scenarios   │
├──────────────────┬───────────────────────────────────────┤
│ SCENARIOS        │ Scenario editor                       │
│                  │                                       │
│ 用户命名场景     │ 场景名称                              │
│ 用户命名场景     │ Dynamic 宏正文                        │
│ 用户命名场景     │                                       │
│                  │ 目标设备 / Dynamic Object             │
│ + New scenario   │ TTL / 执行后保留                       │
│                  │ 本地观察状态                          │
│                  │                                       │
│                  │ Clear device  Save  Save & Upload      │
└──────────────────┴───────────────────────────────────────┘
```

左侧列表的主要对象是 Scenario，而不是 Dynamic Object。右侧编辑器展示当前用户选中的 Scenario，并在目标区域选择一个 Dynamic Object。

### 5.4 视觉和信息层级

页面应遵循当前 MagicPatterns 风格：

- 使用已有 canvas/surface、line、ink、accent、warning、danger、success token；
- 保持当前静态页面的字号、圆角、间距、按钮高度和边框层级；
- 页面级布局优先于大面积 modal；
- 正文编辑器保持 monospace 和 byte count；
- 状态使用简洁标签和明确辅助说明，不展示 raw opcode、request ID 或 generation 数字；
- capability lifecycle 详情默认折叠，避免协议字段压过主要任务；
- 非 secret 警告持续可见，但不占据比编辑器和主要操作更高的视觉层级。

建议用户可见的核心摘要为：

```text
Dynamic Macro
RAM-only · no readback
Device ready · target: default
```

完整的 lifecycle、TTL 范围和 keep 支持情况放入 `Device behavior`/`Capability details` 展开区域。

### 5.5 明确的操作语义

UI 必须区分以下操作，不能使用一个模糊的“保存/上传”按钮代替：

- **Save**：只保存当前 Scenario 模板；UI-only 阶段只更新内存 fixture，正式阶段才写 scenario store；
- **Save & Upload**（也可在文案中称 Send）：保存 Scenario 后向选定的 Dynamic Object 上传；UI-only 阶段只展示 mock operation；
- **Clear device**：清除 firmware Dynamic Object，不删除 Scenario；UI-only 阶段只展示确认和 mock result；
- **Delete scenario**：删除 desktop 中的 Scenario 模板，不清除 firmware Dynamic Object，必须单独确认。

应区分当前选中的 Scenario、未保存 dirty Scenario 和最近一次本地观察操作，不能用一个高亮状态混合表达三者。

### 5.6 持续安全提示

Dynamic channel 未加密，Scenario 正文和 firmware RAM 内容都不适合保存密码、OTP、token、API key、私钥或其他 secret。UI 需要持续提示：

```text
Dynamic macros are unencrypted and intended only for non-secret text.
```

该提示不应暗示应用已经识别或过滤所有 secret。

## 6. Dynamic Object 的 UI 模型

### 6.1 Presentation model

UI 从第一天就使用 collection 形态，但这只是 desktop presentation model，不提前冻结 firmware wire contract：

```ts
type DynamicObjectPresentation = {
  objectId: string;              // opaque id from capability/fixture
  displayLabel: string;          // UI label, not a numeric assumption
  maxLength?: number;
  ttl?: {
    defaultSeconds?: number;
    minSeconds?: number;
    maxSeconds?: number;
  };
  supportsKeepAfterExecute?: boolean;
};

type DynamicCapabilitiesPresentation = {
  capabilityVersion?: number;
  objects: DynamicObjectPresentation[];
};
```

UI 不得根据 objectId 的格式猜测数字 slot，也不得预设 object 数量、各 object 的容量、TTL 或 lifecycle policy；backend 已按 v2 把真实 `dynamic_object_count`、512-byte 上限、TTL 边界和 keep 支持位透传到 capability DTO。mock fixture 中的对象数量和属性只用于布局和状态评审，必须明确标记为 preview data。

### 6.2 单 object 设备（`dynamic_object_count = 1`）

当 v2 capability 报告只有一个 Dynamic Object 时：

- `objects` collection 只有一个展示项；
- desktop/API 可以给该唯一 object 一个稳定展示 alias；
- 目标 object 行仍然保留，不因只有一个 object 而删除；
- 该行以只读展示为主；
- 不显示“当前设备文本”，因为没有 readback。

### 6.3 多 object 设备

UI preview 必须至少提供：

1. 一个 object 的 fixture；
2. 多个 object 的 fixture；
3. 当前 target object 缺失的 fixture。

单 object 时目标行是只读信息；多 object 时同一位置变为 capability-driven selector。v2 已允许最多 8 个 object，因此 selector 不是“未来形态”：

```text
Dynamic Object
[ capability-provided label ▾ ]
```

selector 的选项来自 `objects` collection，不来自硬编码数字列表。缺少目标 object 时显示明确错误并禁止上传，但保留 Scenario 正文和 dirty draft；单 object 设备同样不自动采用唯一 object：saved target 未解析时该行显示 target unavailable，并要求用户显式重新绑定后才解除 upload/clear 限制。

v2 capability 已正式发布多 object contract，`dynamic_object_count`、512-byte 上限和 slot 语义均为 wire contract 的一部分；reference client 与 desktop backend 已同步。UI 阶段直接按 capability 驱动选择，不再把 object 编号/数量当作猜测；desktop/API 可保留 collection、opaque object id/display label 和 `target_object` 的兼容形态。

## 7. UI mock 状态矩阵

UI preview 应可切换以下 fixture。状态名称是 presentation contract，不代表 UI-only 阶段已经具备对应 backend 功能。

| 状态 | 页面表现和交互要求 |
|---|---|
| `empty` | 没有 Scenario；显示高质量空状态和 New scenario 入口；不显示虚假的设备内容。 |
| `new` | 新建但尚未保存的 Scenario；显示默认编辑器结构和明确的 dirty/未保存提示。 |
| `dirty` | 正文、名称或目标设置已改变；切换 Scenario、关闭窗口或执行危险操作前显示未保存确认。 |
| `disconnected` | 设备栏显示断开；保留 Scenario draft；禁用真实设备操作；不把上次 ACK 当作当前设备状态。 |
| `unknown` | 设备、应用重启或 reconnect 后的本地观察未知；明确显示“设备当前状态未知”，不显示 Dynamic 文本。 |
| `discovering` | capability 区域 loading；目标 object、TTL 和 keep 控件等待能力信息；上传/clear 禁用。 |
| `unsupported` | 设备不支持 Dynamic 或 capability 不兼容；保留正文和 Scenario；显示原因和可恢复提示。 |
| `ready` | capability 已知且目标有效；允许 mock Save、Save & Upload、Clear device。 |
| `uploading` | 显示正在上传和当前操作来源；禁止重复 upload/clear；不显示不可信的伪精确进度。 |
| `committed locally` | 显示“本次连接已收到 final ACK”或等价文案；不写“设备当前内容”，不提供 readback。 |
| `clearing` | 显示正在清除；禁止重复操作；Scenario 不被删除。 |
| `cleared locally` | 显示“本次连接已收到 clear ACK”；不声称设备永远为空。 |
| `error` | 保留正文、目标和 dirty draft；显示可重试/返回 Unknown 的路径；错误信息不包含 raw frame、path 或 serial。 |
| static locked / dynamic available | static slot 正文继续隐藏或不可管理，但 Dynamic Workspace 仍可用；清楚说明 Dynamic 与 static auth gate 分离。 |
| keep unsupported | keep-after-execute 控件禁用并解释 firmware capability 不支持；不得静默改写用户选择。 |
| target object missing | 目标 object 不在最新 collection 中；保留 Scenario，要求用户重新选择，不自动映射到另一个 object。 |
| capability changed | capability 变化后重新检查正文长度、TTL、keep 和目标 object；显示可恢复提示，保留 draft。 |
| oversize | 正文超过当前目标 object 的 max length；显示 byte count 和明确错误；在 HID write 前禁止上传。 |

TTL 倒计时只在拥有本次 commit 的本地观察记录时展示，并必须标记为“估计”。disconnect、重启、TTL lifecycle 或状态不确定时停止倒计时并转为 `Unknown`。

## 8. 后续架构和统一服务

UI 视觉验收之后，所有真实来源必须共用一个 Rust `DynamicService`：

```text
┌──────────────────────────────────────────┐
│ Tauri application                        │
│                                          │
│ React Dynamic Workspace                  │
│ tray menu / future rules / local API     │
│              │                           │
│              ▼                           │
│ Rust DynamicService                      │
│   ├─ capability collection               │
│   ├─ observed state                      │
│   ├─ generation / last-write-wins        │
│   ├─ per-device serialized writer        │
│   └─ Dynamic v2 slot-aware client        │
│              │                           │
│              ▼                           │
│ Runtime Macro management HID             │
└──────────────────────────────────────────┘
```

边界要求：

- frontend 只通过 Tauri command/event 使用 backend，不直接访问 HID；
- UI、tray、自动规则和 HTTP API 不得各自创建 HID session；
- 一个设备只有一个 HID writer；capability、upload、clear 共用同一串行 queue；
- Dynamic retry 必须遵循已有 v2 client 规则：新 request ID，并从 BEGIN 重启，slot/request ID/total 全程保持一致；
- generation 用于淘汰尚未开始的旧请求并阻止过期 operation 覆盖当前 state；
- disconnect、reconnect 和应用重启后 observed state 为 `Unknown`；
- Dynamic 操作绕过 static auth gate，但不调用、刷新或自动登录 static auth；
- Dynamic 与 static slot/auth 状态机保持隔离。

建议职责拆分如下，实际命名可按仓库现有结构调整：

```text
src-tauri/src/
├── protocol.rs          # 已有 wire protocol
├── client.rs            # 已有 capability/upload/clear/retry client
├── dynamic_service.rs   # 已落地：状态层、generation、observed state、唯一 DTO
├── scenario.rs          # 后续 Scenario 模型和原子持久化
├── tray.rs              # tray/window lifecycle 和真实状态菜单
├── autostart.rs         # 已落地：官方 autostart plugin 注册 + --autostart 启动语义
├── api.rs               # 已落地（第一版）：固定 loopback HTTP API、alias registry、health/devices
├── credentials.rs       # 后续 API token OS credential storage（首版无认证）
├── commands.rs          # Tauri bridge
└── lib.rs
```

### 8.1 当前实现状态（状态层已落地）

`src-tauri/src/dynamic_service.rs` 已实现窄职责的 `DynamicService` 状态层和唯一 DTO，`src-tauri/src/commands.rs` 只做桥接：

- capability metadata 只定义一份：`DynamicCapabilitiesMetadata` 位于 `dynamic_service.rs`，`commands.rs` 通过 `pub use` 保持旧路径可用，Tauri JSON 字段仍为 camelCase，现有 `bridge.ts` 兼容；
- service status 序列化值固定为 `unknown` / `discovering` / `ready` / `unsupported` / `uploading` / `committedLocally` / `clearing` / `clearedLocally` / `error`；
- per-object 观察只记录 wire slot、状态、byte length（upload 后为本次长度，clear 后为 0）和可选 TTL/keep，状态和 DTO 都不保存也不返回正文；
- `generation` 是本地 last-write-wins 计数器，不是 firmware 值、不是 protocol request id：每次 capability/upload/clear 分配新 generation，过期完成不覆盖当前状态，新操作开始时清除被取代操作遗留的 in-flight object 状态；
- 不新增第二个 HID writer、线程或队列：所有 command 仍通过 `Arc<Mutex<AppState>>` + 单一 HID worker 串行访问同一个 `MacroSession`，因此没有也不假装实现并行 writer；
- connect/disconnect/设备替换/应用退出（退出路径显式释放 session，或 `AppState` drop）后状态回到 `Unknown`；transport/protocol 失败会丢弃 session，因此同样回到 `Unknown`，Remote status 保留 session 并进入 `unsupported` 或 `error`；
- `get_dynamic_capabilities` / `upload_dynamic` / `clear_dynamic` 与新的只读 command `get_dynamic_state` 共用这一状态层；Dynamic 仍绕过 static auth gate，不调用、不刷新也不自动登录 static auth，static slot/auth 状态机不变；
- 新增 `get_dynamic_state` command 和 `bridge.ts` 类型 wrapper；连接后的 Workbench Dynamic Workspace 通过 App bridge 使用真实 capability、无正文 service state、upload/clear 和 Scenario store，DeviceSelect 入口继续使用 in-memory Preview；
- Scenario store（阶段 4）已完成并由 connected Workbench 调用：见 §9；
- 本地 HTTP API（固定 loopback 端口、无认证、仅按 alias 解析设备：discovery + Dynamic 写入 + 按需连接/复用/`409` 冲突）已接入，见 §10 与 §8.3；API 认证、clear/status、按需连接的更细粒度租约和 operation 仍未实现；托盘状态/操作已接入（§4.2），但仍需真实硬件与跨平台人工验收。连接后的自动 capability discovery 仍未实现。

### 8.2 Scenario store（阶段 4，已实现）

`src-tauri/src/scenario_store.rs` 实现窄职责的 Scenario 原子持久化，`commands.rs` 不变，`lib.rs` 只注册两个 command：

- 文件为 app data dir 下的固定文件名 `scenarios.json`，磁盘 schema `{"schema_version":1,"scenarios":[...]}`，字段 `id`/`name`/`text`/`ttl_seconds`/`keep_after_execute`/`target_device`/`target_object`（严格 snake_case，类型 `ScenarioDocument`/`PersistedScenario`）；Tauri wire DTO 是独立类型 `ScenarioDocumentDto`/`PersistedScenarioDto`（`#[serde(rename_all = "camelCase")]`：`schemaVersion`/`ttlSeconds`/`keepAfterExecute`/`targetDevice`/`targetObject`），同一 serde struct 不同时承担两种格式，转换只经显式 `From`；
- 缺文件返回空 schema v1；JSON 损坏、schema 版本不支持、缺少必需 `scenarios` 字段、重复/空 id、空或过长 name、非法字符集或超长正文、TTL 越界、场景数过多一律返回 sanitized 错误（`scenario_store_corrupt` / `scenario_store_invalid` / `scenario_store_write_failed` / `scenario_store_unavailable`；读取时的权限等 I/O 失败映射 `scenario_store_unavailable`），错误、日志和 DTO 不含 path、OS 原文或正文，损坏原文件不被覆盖；
- 写入前验证完整 payload，不静默修正或截断；同目录临时文件 + flush/sync + 原子替换，失败时清理临时文件（Windows rename-over-existing 走显式 fallback）；`save_to_path` 覆盖验证/写临时文件/替换全流程持有进程内写锁，并发 save 串行完成、不会互相覆盖固定名临时文件；
- 文件 I/O 通过 `tauri::async_runtime::spawn_blocking` 执行，不占用 Tauri 主线程、不使用 HID worker、不使用 `localStorage` 或 store plugin；
- 正文是用户明确选择保存的非 secret 明文，只出现在该文件；store 不接真实 HID、托盘或 HTTP。

### 8.3 本地 HTTP API（discovery + Dynamic 写入，已实现）

`src-tauri/src/api.rs` 实现 loopback API，`lib.rs` 在 `setup` 中以同一个 `Arc<Mutex<AppState>>` 启动它（包括 autostart 的托盘-only 启动）：

- `API_BIND_ADDR = "127.0.0.1:17653"`，只绑定 loopback；`bind_loopback` 自身只接受精确 IPv4 `127.0.0.1`（拒绝 `0.0.0.0`、LAN 地址、IPv6 和主机名，端口仍由调用方给出，测试可用 ephemeral port），同步绑定，失败时静默跳过（不记 OS 文本、不影响桌面应用）；
- 路由：`GET /api/v1/health`（`{status:"ok",apiVersion:1}`）、`GET /api/v1/devices`（`{devices:[{vendorId,productId,productName,interfaceNumber,usagePage,usage,alias}]}`）和 `POST /api/v1/dynamic-macros`（按 alias 写入一个 Dynamic object）；未知路径 `404`，已知路径上的其他方法 `405` 并带匹配的 `Allow`（读路径 `GET`、写路径 `POST`），错误统一为 `{error:{code,message}}`；
- 带 `Origin` header 的请求一律 `403 browser_origin_rejected`，不发送 CORS header，也不回显被拒值；
- 设备枚举只经 `commands::api_device_records` 在既有单一 HID worker 上执行：不打开 session、不发 protocol 请求、不 invalidate candidate registry、不改连接状态，因此在 GUI 已连接时答案仍然可用且不干扰 GUI；state mutex 在 descriptor probing 前释放；
- 设备 DTO 没有 path/serial/deviceId/summary key 字段：条目只含安全摘要和 `alias`（未设置时为 `null`），安全摘要 key 只用于后端查找 alias；
- `DeviceAliasRegistry`（`BTreeMap<安全摘要 key, alias>`）由 `set_device_aliases` command 整体替换：key 必须是五段十进制安全摘要、alias trim 后 1–64 bytes 且不含控制字符、同一 alias 不能属于两台设备；任一条目非法则整体拒绝并保留旧 map，错误码为 `invalid_device_alias_key` / `invalid_device_alias` / `duplicate_device_alias`；
- 前端在启动和 alias 变化后将 `localStorage` 中同一份已验证映射镜像给该 command（`bridge.ts` 的 `setDeviceAliases`），backend 不落盘、不保存 path/serial；
- alias registry 区分“尚未初始化”和“已同步合法空 map”：第一次成功 `replace`（包括空 map）才把 registry 标记为 ready，被拒绝的替换不改变 readiness；未 ready 时 `GET /api/v1/devices` 在枚举 HID 之前直接返回 `503 service_not_ready`（固定脱敏 message，不含请求或设备信息），`GET /api/v1/health` 在这段时间仍是精确的 `200 {status:"ok",apiVersion:1}`，调用方据此区分“服务尚未就绪”与“服务未运行”；
- 模块没有任何日志，不把请求、响应、alias、path、serial 或 raw frame 写入任何输出；依赖为 hyper 1 + hyper-util（tokio adapter）+ http-body-util + bytes + tokio（均已在 Cargo.lock 中锁定，只新增 `httpdate`，没有升级现有依赖）；
- 本机测试：handler 级（health body、方法/路径边界与 `Allow`、Origin 拒绝、devices 字段集合与不得出现 path/serial/deviceId/summary key、alias null/已配置/重复、枚举失败 503、未 ready 时 devices 503 `service_not_ready` 且不调用 device source、health 在未 ready 时仍精确 200、被拒镜像不置 ready、空 map 同步后 ready）加真实 loopback socket 应答测试（health 200 + Origin 403 + 完整 POST 写入 200）；写路径还覆盖严格 JSON（未知字段/错类型/缺字段）、`Content-Type` 缺失与错误、`body` 超过 4 KiB、字段与协议边界（text 空/Unicode/控制字符/超 512 bytes、slot 越界、TTL 越界）在任何 HID 访问之前就被拒绝、alias 未同步 503、alias 未匹配 404、写入参数透传与设备默认 TTL 上报、device-layer 错误到公开 code 的映射且不回显正文或设备标识（映射表逐项覆盖，未知 code 回落到 `500 internal_error`，且每条拒绝与每条映射都被断言落在 companion contract 的公开 code/状态集合内；4 KiB 上限另在真实 socket 上断言 `413 payload_too_large`；`productName` 按 device descriptor 做有界、无控制字符的清洗，空名发布为 `null`）；`commands.rs` 覆盖按需连接/同设备复用/不同设备 `409 device_conflict`、capability 发现先于 upload、locked 设备绕过 static auth gate（无登录、无 LOCK、无 static 命令）和失败上传只发布无正文状态；前端有 `tests/device-alias-sync.test.ts`（command 名与单一 payload、空 map 也镜像、无 Tauri host 不伪造成功、只有安全摘要 key 能进入镜像）；另有 alias registry 校验/唯一性与整体拒绝、`bind_loopback` 只接受精确 IPv4 loopback 的测试；
- GUI 同步与会话生命周期（阶段 4）：写入成功或失败后 backend 发布无 payload 的全局 event `dynamic-state-changed`（该 event 同时表示“共享 session 或 Dynamic 服务状态在窗口之外变了”），窗口用既有只读 `get_connection` / `list_devices` / `get_dynamic_state` 重读无正文状态（事件不携带正文、path、serial 或 raw frame，浏览器 preview 不订阅也不伪造，也不发送任何 static 管理命令：不 login、不 LIST/GET/SET/CLEAR）；窗口只在安全时跟随后端 session（纯函数 `src/utils/session-sync.ts` 的 `backendSessionReport` / `backendSessionSync`）：同一设备的 session（API 复用）就地刷新、窗口本来没有 session 时采用（API 按 alias 新建的 session，避免窗口仍显示“未连接”让用户误触发 Connect 而丢掉 API 写入的 Dynamic object）、后端没有 session 而窗口仍显示时释放本地视图（设备消失/transport failure，draft 仍留在内存）；答案不可读、后端换了窗口正在管理之外的另一台设备、或采用会静默丢掉未保存 draft 时保持现状（hold），设备切换仍由用户显式操作；窗口自己不会打开管理窗口（不弹 setup modal，不自动 login），capability 仍只用既有 Dynamic command 发现；事件到达时若窗口正在执行操作则先记下，操作结束后重放，不抢设备的 operation sequence；`prepare_tray_close` 在 close-to-tray 时只对 API 用过的 session 做 best-effort LOCK 并保留共享 HID session（其它 session 按原行为释放；explicit disconnect、设备切换、transport failure 与 app Quit 都会释放 retained session），前端只在答案完整时按 `{sessionRetained, authState}` 更新本地状态，答案非法或 invoke 失败时重读 `get_connection`/`get_dynamic_state`；退出路径在 `RunEvent::Exit` 显式停止 API acceptor（释放 listener 与它对共享 state 的引用）并通过同一 HID worker 释放 session（有界等待；平台事件循环以 `std::process::exit` 结束，managed state 的 `Drop` 不会执行）；
- 本机测试还覆盖：acceptor 收到停止信号后释放 listener（同一地址可立即重新 bind）、server 停止后不再持有 shared state 引用、退出路径释放 retained session、`trayCloseOutcome` 只接受两个无正文答案形状（非法/残缺答案返回 unknown 而不当作 released/retained）；session 同步另见 `tests/session-sync.test.ts`（connection 答案校验/拒绝含 path/serial/正文/设备身份的答案、采用同一设备时保留 draft、采用窗口未显示的 session、另一台设备与 dirty draft 时 hold、后端无 session 时 release、无 Tauri host 不伪造 session）；
- **尚未实现**：API 的 clear/status/readback、可选认证与显式启用（token + OS credential store）、runtime metadata、operation/idempotency；端口占用只表现为 API 不可用（无声跳过），没有面向用户的提示。

## 9. Scenario 模型与持久化方向

UI-only 阶段不保存 Scenario。正式功能阶段采用带 schema version 的原子文件存储：

```json
{
  "schema_version": 1,
  "scenarios": [
    {
      "id": "opaque-desktop-id",
      "name": "用户自定义名称",
      "text": "git status\n",
      "ttl_seconds": 300,
      "keep_after_execute": true,
      "target_device": "configured-alias",
      "target_object": "default"
    }
  ]
}
```

要求：

- `name` 是用户自定义显示名称，不是 firmware object 名称；
- `target_object` 保存 opaque object id 或当前兼容 alias，不保存进程内 HID candidate ID；
- `target_device` 保存用户在本机设置的设备 alias（显示名）：它可以包含空格和本地化字符，但不能为空、超过 64 bytes 或包含控制字符；alias 与安全设备摘要 key、serial、HID path 都不同，store 也不保存后三者；
- 场景绑定要求用户显式选择：alias 变更或设备摘要变化后，旧绑定不再匹配，必须由用户重新确认；
- 场景正文明确属于用户选择保存的非 secret 明文；
- 写入使用临时文件加原子替换；
- 配置损坏时保留原文件并报告可恢复错误；
- 正文不进入日志、诊断、窗口标题、错误消息、CI artifacts 或无关持久化数据；
- 不使用 `localStorage` 作为正式 Scenario store。

如果未来设备有多个 object，而 Scenario 的目标 object 不再存在，必须报告明确输入/绑定错误，不自动改到其他 object。

## 10. 本地 HTTP API

### 10.1 冻结 contract（discovery + Dynamic 写入已实现）

首版 API 是**固定 loopback 端口、无认证、仅按设备 alias 选择**的接口，随应用启动后常驻（`src-tauri/src/api.rs`）。阶段 2 实现了 discovery，阶段 3 在同一份无认证 contract 上实现了 Dynamic 写入（按别名向一个 Dynamic object 上传）：

```text
GET /api/v1/health   -> {"status":"ok","apiVersion":1}
GET /api/v1/devices  -> {"devices":[{"vendorId":…,"productId":…,"productName":…,"interfaceNumber":…,"usagePage":…,"usage":…,"alias":…}]}
POST /api/v1/dynamic-macros <- {"deviceAlias":…,"text":…,"slot":…,"ttlSeconds":…,"keepAfterExecute":…}
                           -> {"status":"committedLocally","deviceAlias":…,"slot":…,"textLength":…,"ttlSeconds":…,"keepAfterExecute":…}
```

`GET /api/v1/health` 的成功响应只表示本地 HTTP 服务正在运行，不表示任何键盘已连接或 Dynamic 写入可用；调用方应另外检查 `/devices` 和写入响应。

冻结规则：

- 只绑定 `127.0.0.1:17653`（`api::API_BIND_ADDR`），不绑定 `0.0.0.0`、LAN 地址或 IPv6；`api::bind_loopback` 自身也只接受精确的 IPv4 loopback（拒绝 unspecified、LAN、IPv6 和主机名），被拒地址不回显；
- 使用固定端口而不是随机端口：本地自动化客户端不需要读取 runtime metadata 就能调用；端口被占用或绑定失败只让 API 不可用，桌面应用继续运行，且不记录 OS 错误文本；
- 首版没有认证（可选的 token + 显式启用属于后续增强）：API 只监听 loopback，也不是浏览器接口；无认证不是“只能只读”的理由，写入同样在这份无认证 contract 上工作；
- 设备只按用户在 Settings 设置的本机唯一 alias 解析，不使用 `productName`、VID/PID、HID path、serial 或临时 candidate id；alias 未配置或目标设备不在枚举结果中返回 `404 device_not_found`，同一 alias 匹配多个设备返回 `409 ambiguous_device`，已连接另一设备返回 `409 device_conflict`；API 从不猜测、也从不静默切换设备；
- 写入请求是严格 JSON：未知字段、错误类型、缺必填项、错误的 `Content-Type` 和超过 4 KiB 的 body 都在任何 HID 访问之前被拒；text 按协议边界（非空、可打印 ASCII/LF/Tab/Backspace、≤ 512 bytes）、slot（`0..7`）和 TTL（`1..86400` 或省略）在打开设备之前校验，设备自身更窄的 capability 边界由 protocol client 在 capability discovery 后复查；
- 写入成功只返回 `committedLocally`、alias、slot、byte length、实际 TTL 和 keep，不回显正文；`committedLocally` 只表示本次连接收到 final ACK，不是 readback；`ttlSeconds` 省略/`null` 时报设备默认 TTL；
- 无 active session 时按 alias 连接目标设备并保留该共享 session（不因写完就断开，避免固件 `CLEAR_ON_USB_DISCONNECT` 清掉刚写入的对象）；同一设备复用；不同设备 `409`，因此 API 调用不会破坏窗口正在使用的会话；
- 带 `Origin` header 的请求一律返回 `403 browser_origin_rejected`，并且不发送任何 CORS header，因此浏览器或内嵌 web view 读不到 API，被拒值不回显；
- 设备枚举与写入都走既有 `AppState`、`DynamicService` 和单一 HID worker（`commands::api_device_records` / `commands::api_dynamic_write`），不产生第二个 HID writer，也不 invalidate GUI candidate registry；
- alias mirror 首次到达前 API 还不是 ready：`GET /api/v1/devices` 与 `POST /api/v1/dynamic-macros` 都返回 `503 service_not_ready`（固定脱敏 message；`/devices` 还在枚举 HID 之前就拒绝），避免把“窗口尚未同步 alias”误报成“设备没有 alias”或“设备不存在”；`GET /api/v1/health` 仍返回精确的 `200 {"status":"ok","apiVersion":1}`。第一次成功镜像（包括空 map）才让 registry ready，被拒绝的镜像不会；
- 请求、响应、alias、HID path、serial、raw frame 和正文都不进入日志或错误；错误只返回稳定 code 加固定 message（公开 code 与内部 command code 分离映射）。

`GET /api/v1/devices` 的每个条目只有安全设备摘要（vendor/product/interface/usage）和 alias（未设置时为 `null`）。安全摘要 key（`vendorId:productId:interfaceNumber:usagePage:usage`）只用于后端内部查找 alias，不对外发布，也不是设备句柄。

### 10.2 alias 来源与同步

设备 alias 仍是桌面端的本地偏好：浏览器存储（`zmk-runtime-macro-device-alias:v1`）是唯一持久化来源。前端在启动和 alias 变化后通过受限 `set_device_aliases` command 把整个已校验映射镜像到 Rust 内存（`api::DeviceAliasRegistry`）；Rust 重新校验（key 必须是五段安全摘要、alias 为 1–64 bytes 且不含控制字符、同一 alias 不能属于两台设备），任何非法条目都整体拒绝而不是部分接受，也不回显被拒值。backend 不保存 HID path 或 serial，也不写入磁盘。

### 10.3 后续增强（尚未实现）

以下能力**不在首版**，按阶段 9 的增量实现：

- clear/status、readback 与 Dynamic object 列举（object 数量始终以 `CAPABILITIES` 为准（1–8），不猜测编号或容量）；
- 可选认证与显式启用（独立 token + OS credential store）；
- operation endpoint、`Prefer: respond-async`、`Idempotency-Key`、`source`/`priority` 仲裁；
- runtime metadata（host/port/PID）；固定端口下不提供运行时 metadata；curl/Python/Shell 调用示例已由 companion 项目 `zmk-runtime-macro-mqtt-bridge` 的 `docs/LOCAL_DYNAMIC_HTTP_API.md` 维护。

无论怎样扩展：API 只能通过 `DynamicService` 和单一 HID worker 工作，不返回 Dynamic text，不提供 readback 假象，也不自动登录 static auth。默认等待 final ACK 才返回成功，`committedLocally` 只表示本次连接收到 final ACK，不保证 object 仍存在。

## 11. 多来源和并发规则

当前 firmware 已按 v2 报告多个 Dynamic Object（默认 8），但同一设备的 HID session 只有一个 writer，upload/clear 不能并行发送。后续服务必须：

1. 每个设备只有一个 serialized HID writer；
2. capability、upload、clear 共享同一 queue；
3. 新场景到达时丢弃尚未发送的旧 pending upload；
4. 已开始的 upload 可以完成，但完成后按 generation 判断是否仍然有效；
5. stale response、malformed response、timeout 和 disconnect 不得污染新的 generation；
6. UI、tray、自动规则和 HTTP API 不能绕过 DynamicService。

首期功能阶段可使用明确的 last-write-wins；source 必须进入本地状态显示和后续 API contract。自动仲裁的建议顺序为：

```text
用户手动 override > 外部服务 lease > 外部普通请求 > desktop 内置自动规则
```

source priority、lease TTL、override 到期恢复属于自动场景阶段，不在 UI-only 阶段实现。

本阶段已落地的部分：第 1、2、4、5 条由 `DynamicService` 状态层配合既有的单一 HID worker 覆盖（每次操作新 generation、过期完成不覆盖状态、stale/timeout/disconnect 不污染新 generation）；第 6 条现在由窗口、托盘和本地 HTTP API 共同满足：窗口经 Tauri command、托盘操作经窗口的既有 bridge、HTTP API 写入经 `commands::api_dynamic_write`，三者共用同一个 `AppState`/`DynamicService`/单一 HID worker，没有第二个 writer，也不绕过状态层（写入后窗口通过无 payload 的 `dynamic-state-changed` event 重读同一份状态）；第 3 条的 pending 淘汰和 source priority/lease/override 仲裁仍未实现（仍是最朴素的 last-write-wins，没有按来源排队、没有 lease TTL），属于自动场景阶段。

## 12. 实施阶段和验收闸门

### 阶段 1：presentation-first Dynamic Workspace（已完成，待人工视觉验收）+ 托盘基础（已实现，待平台人工验收）

**本阶段已完成的 presentation-first Dynamic Workspace（UI-only）：**

1. 保持现有 TitleBar、AppHeader、Static Slots 和全局 MagicPatterns 视觉风格，以页面级 workspace 接入现有 workbench；
2. Scenario 列表、空状态、新建、编辑器、dirty 状态和操作栏；
3. capability-driven target object 行：单 object（count = 1）为只读行、多 object（count = 8）为 selector；saved target 不在最新 capability 时显示 target missing，单 object 设备也不会自动采用唯一 object，必须由用户显式重新绑定；
4. capability details、非 secret 警告和无 readback 文案；
5. 全部状态矩阵和确认对话框的 mock/in-memory interaction；
6. 不接 HID、不写 localStorage、不持久化 Scenario、不接 HTTP API；真实 dynamic 操作仍由旧 `DynamicMacroModal`/`DynamicMacroPanel` 提供；
7. 新 UI 通过人工视觉和交互验收后，才移除旧 Dynamic modal 入口。

**本阶段托盘基础（已实现，后续已接入真实状态/操作）。**

1. 托盘 icon、打开/隐藏/退出、close-to-tray、单实例窗口入口；
2. 菜单文本 `en` / `zh-CN` 两套，跟随 UI locale（`set_tray_locale`，只接受这两个精确 tag，不自行猜语言）；
3. 托盘状态行与三个操作已按阶段 7 接入（受限 runtime context + `tray-action` event，托盘本身不打开 HID）；仍不得把 mock 结果标成真实设备操作结果。

实现说明：`src-tauri/src/tray.rs` 提供 tray icon、原生菜单和 `show_main_window` helper（tray、菜单和 single-instance plugin 共用）；普通窗口关闭经 `onCloseRequested` 的 dirty 确认和 best-effort LOCK 后 `hide()` 到托盘，明确退出走 `app.exit(0)`；菜单状态行由 `set_tray_runtime_state` 跟随真实连接与本地观察状态（状态行始终 disabled，仅信息展示），`Choose scenario` / `Upload current scenario` / `Clear Dynamic Object` 按 context 启用并只 emit `tray-action`，真正操作由窗口经现有 bridge/确认流程完成（§4.2、阶段 7）；菜单标签提供 `en` / `zh-CN` 两套，由受限的 `set_tray_locale` command（只接受精确 `"en"` / `"zh-CN"`，非法值返回 `unsupported_locale`）通过 `MenuItem::set_text` / `set_enabled` 更新，菜单 ID、结构、disabled 边界和 tray actions 不变。本机自动验证（fmt/test/clippy/`npm test`/`npm run build`/`tauri build --no-bundle`）已通过；托盘图标、菜单交互、close-to-tray 和单实例恢复仍需要在 Windows/Linux（GNOME/KDE、Wayland/X11）和 macOS 上人工验收。

**UI 视觉验收点 A（尚未完成）：**

- 该验收目前尚未完成：workspace 仍是 preview/mock surface，旧 dynamic handler 和 fallback 入口保留；
- 页面与现有 Static Slots 的视觉质量一致；
- 单 object 和多 object mock 均不破坏布局；
- empty/new/dirty/disconnected/unknown/discovering/unsupported/ready/uploading/committed locally/clearing/cleared locally/error 等状态可检查；
- static locked 但 Dynamic 可用、keep unsupported、target missing、capability change/oversize 可检查；
- Save、Save & Upload、Clear device、Delete scenario 语义清楚；
- 没有 readback 假象，mock 不被描述成真实业务完成。

### 阶段 2：Contract/DTO 与 CI 基线

UI 视觉验收通过后：

- 冻结 `DynamicObject` collection、`DynamicCapabilities`、`DynamicObservedState`、`DynamicUploadRequest`、`Scenario` 和 `OperationStatus`；
- 定义 `DynamicObject` collection 到 capability `dynamic_object_count` 的映射（含可选展示 alias）；
- 定义状态、错误和 operation metadata，不在 DTO 中放正文、HID path、serial 或 token；
- 从已有 Python reference client 和 Dynamic Protocol v2 文档建立 golden frame fixtures；
- 增加适用于当前主机的 frontend build、Rust fmt/test/clippy、Tauri no-bundle 和 privacy checks；
- 保留现有 release workflow；
- Linux、macOS、Windows 的平台专属构建和行为验证继续由对应 runner/平台完成。

**已完成（Dynamic 部分）：** `src-tauri/src/dynamic_service.rs` 冻结了 Dynamic 侧的稳定 contract：`DynamicCapabilitiesMetadata`（唯一的 capability DTO，camelCase，兼容现有 `bridge.ts`）、状态值 `unknown` / `discovering` / `ready` / `unsupported` / `uploading` / `committedLocally` / `clearing` / `clearedLocally` / `error`、per-object 观察（slot、状态、byte length、可选 TTL/keep）、 sanitized `error` 和本地 `generation`；`get_dynamic_state` 是新的只读 command，`bridge.ts` 已有类型 wrapper。DTO 不含正文、HID path、serial 或 token，Rust 测试直接断言序列化字段集合而不是打印正文。`Scenario`、`DynamicUploadRequest` 和 source metadata 的正式 contract、golden frame fixtures、Tauri no-bundle 的 CI 基线仍未完成（属后续阶段）。

### 阶段 3：DynamicService、队列和 generation

- 复用已有 Dynamic v2 slot-aware client/protocol/upload/clear/retry；
- 将 capability、upload、clear 接入统一 Rust DynamicService；
- 只维护一个 active device 和一个 HID writer；
- 每次新连接重新 discovery；
- 实现 `Unknown`、`Discovering`、`Unsupported`、`Ready`、`Uploading`、`CommittedLocally`、`Clearing`、`ClearedLocally`、`Error`；
- 实现 generation-based last-write-wins、pending 淘汰和 stale completion 保护；
- 不改变 static/auth command boundary。

**已完成（状态层）：** `DynamicService` 已接入 `AppState`，capability/upload/clear 在开始时进入 `Discovering`/`Uploading`/`Clearing`，成功只记录本次本地观察（`CommittedLocally`/`ClearedLocally`，以及 slot、byte length、TTL/keep），失败按 Remote status 进入 `Unsupported`/`Error` 并保留 session，transport/protocol 失败丢弃 session 并回到 `Unknown`；connect/disconnect/设备替换/`AppState` drop 后 reset 为 `Unknown`；generation 为本地 last-write-wins，过期完成被丢弃，新操作清除被取代操作遗留的 in-flight 状态；仍然只使用既有单一 HID worker 和 `MacroSession`，没有第二个 writer/线程/queue；static/auth command boundary 未改变（Dynamic 仍绕过 static auth gate）。backend 不保存 draft，也不保存任何 dynamic 正文。

**仍未实现：** 连接后的自动 capability discovery（目前仍是显式 command）、pending 淘汰所需的待发送队列（目前只有 UI 的同步 command 调用方）和 source metadata。

### 阶段 4：Scenario 原子持久化

- 实现场景 schema version；
- 使用临时文件和原子替换；
- 保存 user-named Scenario、target device alias、target object、正文和策略；
- 配置损坏可恢复；
- 保持正文不进入日志、诊断、错误和无关持久化；
- 仍然提示仅适合非 secret 文本。

**已完成（阶段 4）：** `src-tauri/src/scenario_store.rs`（`SCENARIO_SCHEMA_VERSION = 1`、`scenarios.json`、`PersistedScenario`/`ScenarioDocument`）、`load_scenarios` / `save_scenarios` 两个 async command（`spawn_blocking`，不经过 HID worker）、`bridge.ts` 的 `PersistedScenario` / `ScenarioStore` / `SCENARIO_STORE_SCHEMA_VERSION` / `loadScenarios()` / `saveScenarios()`。持久化模型与 UI-only 的 `src/types/scenario.ts` 明确分离：`draft`/`saved`/`isNew` 和 React key 不落盘，`targetDevice`/`targetObject` 为 nullable opaque string，绝不写入 HID path、serial 或 in-process candidate id。校验/原子写/损坏错误行为见 §8.2。

**仍未实现：** 托盘选择/上传 Scenario 的跨平台人工验收（托盘操作本身已接入，见 §4.2）、API 的认证与 clear/status/operation（discovery 与按 alias 的 Dynamic 写入已实现，见 §10），仍不支持 secret；DeviceSelect 的 Preview 路径仍不持久化。

### 阶段 5：UI 接入真实 DynamicService/HID

- 将 UI mock adapter 替换为 Tauri/DynamicService bridge；
- 主窗口和未来托盘调用同一个 service；
- 接入真实 capability、upload、clear、retry、generation 和 observed state；
- 保留 static locked 但 Dynamic 可用的边界；
- 真实 ACK 只更新本地观察状态，不添加 readback；
- 完成硬件前的 fake-HID regression tests。

**已完成（阶段 5）：** connected Workbench 的 Dynamic Workspace 已通过 `DynamicWorkspaceBackend` 接入真实 capability、无正文 `get_dynamic_state`、upload/clear 和 Scenario store；保存、删除、Save & Upload 使用串行持久化，保存失败保留 dirty draft，`objectId` 与 `wireSlot` 通过显式 capability 映射校验。DeviceSelect 入口仍是纯 in-memory Preview，旧 Dynamic modal 保留为 fallback；本地 HTTP API 的 Dynamic 写入及共享 session/GUI 同步已接入，连接后的自动 capability discovery 仍未实现；托盘状态/操作已按阶段 7 接入，device alias 已按阶段 6 接入。

### 阶段 6：Device alias

- 为当前 active device 建立用户配置 alias；
- Scenario 和后续 API 使用 alias，不暴露 serial 或 HID path；
- alias 对应多个候选设备时不得自动选择；
- 设备摘要变化后要求用户重新确认绑定；
- 首期仍只保持一个并行 HID session。

**已完成（阶段 6）：** alias 保存在本机浏览器存储的独立 key（`zmk-runtime-macro-device-alias:v1`）下，按现有安全设备摘要 key（`vendorId:productId:interfaceNumber:usagePage:usage`）逐设备绑定；`src/utils/device-alias.ts` 只做纯校验/唯一性/读写（trim 后 1–64 bytes、不含控制字符、同一 alias 不能属于两个摘要 key、清空即解除），不存 serial、HID path、candidate id 或正文；前端通过受限 `set_device_aliases` 将已校验映射镜像到 Rust 内存，仅供本地 HTTP API alias 解析，不持久化设备隐私信息。Settings modal 在已连接时提供 alias 编辑（未连接则 disabled 并说明），错误用 `tooLong` / `controlCharacter` / `duplicate` 三种本地提示，保存走现有设置流程且与 `set_settings` 无关。Workbench header 与 Dynamic Workspace 的目标设备区优先显示 alias（无 alias 时回退 productName/unnamedDevice）；托盘设备行显示 alias（无 alias 时只说已连接），`deviceAlias` 作为受限字段进入 `TrayRuntimeStateInput`，Rust 以 `invalid_tray_alias` 拒绝非法值并在断连时丢弃 alias。Scenario 只在 `targetDeviceId` / 持久化 `target_device` 保存 alias，不保存摘要 key；connected Workspace 只有在 `targetDeviceId === 当前 alias` 时才允许 upload/clear，否则显示未绑定/不可用并提供显式 `Use this device`，点击后只改 draft（仍需 Save）；Preview 路径不参与绑定。仍只保持单一 HID session，未新增 manager/repository 层。

**仍未实现：** alias 的跨平台人工验收（含托盘设备行渲染）。本地 HTTP API 已按 alias 使用该映射；tray 设备行也已使用 alias。

### 阶段 7：托盘接入真实状态

- 将托盘菜单从 mock 状态接入 DynamicService 和 Scenario store；
- 显示当前设备 alias、active Scenario、observed state 和可用操作；
- 托盘上传、clear、选择 Scenario 与主窗口共用同一 service；
- 关闭窗口仍只隐藏到托盘；明确退出才停止 worker/service。

**已完成（阶段 7，device alias 见阶段 6）：** `src-tauri/src/tray.rs` 保存受限的 `TrayRuntimeContext`（`deviceConnected`、精确 `DynamicServiceStatus` tag、有界的当前场景显示名、有界设备 alias、三个 action flag），并按 locale + context 重写已有 `MenuItem` 的文本与 enabled 状态（状态行始终 disabled）；`set_tray_runtime_state` 的单个参数 `runtime` 校验输入（非法 status → `unsupported_tray_status`，非法名称 → `invalid_tray_scenario_name`，非法 alias → `invalid_tray_alias`；断连时丢弃 alias），`set_tray_locale` 不重置 runtime context。三个操作菜单项点击时先恢复/聚焦主窗口，再 emit 全局 event `tray-action`（payload 只有 `chooseScenario` / `uploadScenario` / `clearDynamic`）；`src/App.tsx` 把连接状态、alias、`DynamicService` 状态和 workspace 回传的显示名/可用性同步给 Rust，`src/features/dynamic/DynamicWorkspace.tsx`（连接模式下 hidden 但仍 mounted）监听 event：choose 打开工作区，upload 复用 Save & Upload（先保存成功再上传，且需已绑定当前设备），clear 复用现有确认；blocker 存在时安全忽略。托盘仍不打开 HID、不调用 DynamicService/Scenario store，也不显示 HID path、serial 或正文。

**仍未实现：** 托盘上传/clear 的真实硬件与跨平台人工验收（含设备行 alias 渲染）仍待完成。

### 阶段 8：Login autostart

- 默认关闭，由用户主动启用；
- 使用官方 autostart plugin 或平台等价适配；
- 只授予 `enable`、`disable`、`isEnabled` 所需权限；
- 普通启动显示主窗口，login autostart 使用后台参数只显示托盘；
- 设置页显示实际 OS 注册状态；
- 启动后 dynamic observed state 先为 `Unknown`，不得假设上次 Dynamic 仍存在。

**已完成（阶段 8）：** 使用官方 `tauri-plugin-autostart`（Rust）+ `@tauri-apps/plugin-autostart`（前端），不自建 OS service/manager，也不写自有启动项文件或注册表。

- 启动参数：`src-tauri/src/autostart.rs` 的 `AUTOSTART_ARG = "--autostart"` 是登录项携带的唯一个参数（裸开关，无 `=`、无空白分割），不可能携带密码、K、正文、serial、HID path 或设备标识；`is_autostart_launch` 只接受精确匹配，`--autostart=1` / `--autostart-extra` / `--AUTOSTART` 一律当作普通启动；
- 窗口语义：`tauri.conf.json` 主窗口 `visible: false`（配置声明的可见窗口在 `setup` 前就已显示，必然闪窗），`lib.rs` 的 `setup` 先 `tray::init`，然后只在非 autostart 启动时 `tray::show_main_window`（show + unminimize + set_focus）；自启启动保持隐藏但托盘正常；
- 单实例：single-instance callback 同样检查 argv；普通二次启动恢复窗口，自启二次启动不抬前台；
- 无自动设备行为：自启不自动连接设备、不发 `AUTH_INFO`、不执行 capability discovery、不读写 Dynamic（`AppState` 的 `DynamicService` 初始即 `unknown`，启动路径只做一次设备枚举供隐形的设备列表使用），也不自动打开 Settings；自启不是新的工作线程或队列；
- 真实 OS 状态：`bridge.ts` 提供 `autostartAvailable()` / `getAutostartEnabled()` / `enableAutostart()` / `disableAutostart()`，Settings 在打开时读取 `is_enabled`；切开关时先写入再重新读取确认，只有确认成功才更新显示，失败保留旧状态并显示 sanitized 错误（`autostart_unavailable` / `autostart_failed`，不回显 OS 原文）；读写中或状态未知时 toggle 禁用，双击不会并发写；不使用 `localStorage` 另存一份开关；
- 权限：`capabilities/default.json` 只新增 `autostart:default`（等价 `allow-enable` / `allow-disable` / `allow-is-enabled`），窗口仍只有 `main`，不恢复 `core:default`；
- 本机验证：`tests/autostart.test.ts`（命令名 `plugin:autostart|is_enabled` / `|enable` / `|disable`、三者参数为空、无 Tauri host 时不伪造状态或成功、插件失败 sanitized、行状态只显示 OS 确认值、失败保留旧状态、toggle 禁用条件、中英文错误文案存在）与 `src-tauri/src/autostart.rs` 的配置/启动契约测试（精确参数、裸开关、主窗口 `visible: false`、权限范围、bundle 平台列表）；
- **仍待人工验收：** 真实登录项的写入/删除、自启启动不闪窗、普通启动仍显示并 focus、自启后托盘可用、单实例与自启组合，都必须在 Linux（GNOME/KDE、Wayland/X11）、Windows 和 macOS 上人工验收；本机只验证了配置、参数解析、命令契约和状态机，没有真的注册过登录项。

**手动闭环验收点 B：**

- 主窗口和托盘可打开、隐藏和明确退出；
- Scenario 创建、编辑、删除、持久化和手动 Save & Upload 正常；
- Dynamic upload/clear 经过同一 DynamicService 和 HID writer；
- static slot/auth 无回归，locked 状态仍符合 Dynamic 边界；
- restart/reconnect/disconnect 后状态为 Unknown；
- 对应平台完成 tray、autostart、窗口生命周期和真实 HID 人工验收。

**HTTP API 前验收点 C：**

Gate C 是 Gate B 通过后、正式投入 HTTP API 开发前的明确 go/no-go 检查：

- UI、托盘、自启和真实 service 已共用一个 writer/queue；
- Scenario store 和 device alias 行为稳定；
- HTTP API 安全 contract 已冻结并已实现首版：仅 loopback、固定端口 17653、无 API 认证（可选 token 与显式启用是后续增强）、设备只按用户 alias 解析，discovery（`/health`、`/devices`）与按 alias 的 Dynamic 写入（`POST /dynamic-macros`）同在这份无认证 contract 上工作；API token（若引入）与 firmware password 独立且不得进入普通配置或日志；
- status 不提供 readback 假象；
- 三平台适用构建和平台生命周期检查已通过。

### 阶段 9：Local HTTP API

首版已按固定 loopback 端口 + 无认证 + alias-only 冻结，阶段 2 的 discovery 与阶段 3 的 Dynamic 写入已实现（见 §10）；认证、clear/status、operation 等其余能力在 Gate C 通过后按增量实现：

- HTTP lifecycle、固定 loopback 端口与 runtime metadata（首版无 metadata）；
- clear/status、readback 与 Dynamic object 列举；
- 按需连接的更细粒度租约（当前已支持无 session 时连接并保留、同设备复用、不同设备 `409`）；
- 可选认证与显式启用：OS credential store 中的独立 token、复制和轮换；
- operation endpoint、Prefer async、idempotency、错误映射；
- curl、Python 和 Shell 示例（客户端调用 contract 由配套客户端项目维护）；
- API server 停止、端口冲突、应用重启和 stale metadata 测试；
- API 永远不自动 login static auth，不返回 Dynamic text。

### 阶段 10：自动场景

第一版只实现：

- 前台应用 identifier/bundle ID；
- 窗口标题；
- debounce；
- generation；
- manual override；
- external lease。

浏览器 URL、IDE project、Git branch、插件系统、脚本执行引擎和云同步继续后置。自动规则必须通过 DynamicService，不能直接打开 HID。

### 阶段 11：多 Dynamic Object 的真实接入

v2 多 object capability/protocol contract 已经发布并实现：Rust backend 的 slot-aware capability/upload/clear（默认 8 objects、512 bytes/object、逐 object clear、retry 从 BEGIN 重启）和 desktop bridge 的 per-object 状态模型都已完成，因此本阶段不再等待 firmware contract，只需把已发布的 contract 接入真实来源：

- capability-driven object collection 从真实 capability 进入 UI/API；
- 多 object fake-HID、TTL、逐 object clear 和 lifecycle tests（同一设备仍由单一 writer 串行化）；
- object-specific validation；
- UI/API 的真实 object selector 取代 preview fixture；
- 新 protocol version 或 capability negotiation。

不猜测 object 数量、数字编号、容量、TTL 或 wire contract，不使用 static slot fallback。

## 13. Pull Request 拆分

每个 PR 只承担一个主要目标，不在同一个 PR 中同时修改协议、托盘、UI、持久化和 HTTP API。

| PR | 主要目标 | 依赖 | 验收重点 |
|---|---|---|---|
| PR-01 | Tauri tray 基础、窗口入口、close-to-tray、明确退出、单实例恢复、菜单文本跟随 UI locale | 无 | tray/window 生命周期；不接真实 Dynamic service |
| PR-02 | Dynamic Workspace 页面壳和 Static/Dynamic 入口 | PR-01 | 保持现有 MagicPatterns/static 视觉；不改旧 static UI |
| PR-03 | Scenario 列表、编辑器、目标 object 区域和操作栏 | PR-02 | Scenario 与 Dynamic Object 概念清楚；Save/Upload/Clear/Delete 语义清楚 |
| PR-04 | UI mock fixture、单/多 object preview、状态矩阵和对话框 | PR-03 | UI 视觉验收点 A；不接 HID、localStorage、HTTP |
| **Gate A** | **用户视觉/交互验收** | PR-04 | **验收通过后才移除旧 Dynamic modal 入口** |
| PR-05 | Dynamic contract/DTO、golden fixtures、CI/本机验证基线 | Gate A | DTO、frame fixture、privacy checks |
| PR-06 | DynamicService、serialized writer、queue、generation、observed state | PR-05 | 复用现有 client；fake-HID regression |
| PR-07 | Scenario schema、原子持久化和损坏恢复 | PR-06 | 正文只作为用户选择的非 secret 数据保存 |
| PR-08 | UI bridge 接入真实 DynamicService/HID | PR-07 | 真实 capability/upload/clear；无 readback |
| PR-09 | 当前 active device alias | PR-08 | alias 不暴露 serial/path；多候选不自动选择（已实现：安全摘要 key 绑定 + 本地唯一 + Scenario 显式绑定，见阶段 6） |
| PR-10 | 托盘菜单接入真实 Scenario/service 状态 | PR-09 | 主窗口和 tray 共用 service；手动闭环准备（已实现：状态行 + 三个 action 经 `tray-action` event 交给窗口，设备行显示 alias，见阶段 6/7） |
| PR-11 | Login autostart 和后台启动参数 | PR-10 | 默认关闭；普通启动和自启入口区分（已实现：官方 plugin + `--autostart` + `visible: false`，见阶段 8） |
| **Gate B** | **首期手动闭环验收** | PR-11 | **真实 tray、autostart、Scenario、HID 和 static/auth 无回归** |
| **Gate C** | **HTTP API 前验收** | Gate B | **确认 UI/tray/service/store/alias 已稳定，再决定 API 的写入/连接/认证扩展** |
| PR-12 | HTTP lifecycle、固定 loopback 端口、health、devices（已实现：固定 `127.0.0.1:17653`、无认证、alias-only discovery，见阶段 9/§10） | Gate C | 只读、无隐私字段、拒绝浏览器 Origin，无 token |
| PR-13 | HTTP Dynamic 写入（按 alias）+ 按需连接/复用/`409` 冲突（已实现：严格 JSON、协议边界先于 HID、设备默认 TTL 上报、无正文回显，见阶段 9/§10） | PR-12 | API 只调用 DynamicService；不返回正文；按需连接与 409 冲突语义 |
| PR-14 | clear/status、operations、idempotency、错误映射、可选 token 和调用示例 | PR-13 | final ACK、async operation、request digest 和调用方文档 |
| PR-15 | 自动场景基础规则和仲裁 | PR-14 | debounce、generation、manual override、external lease |
| PR-16 | 多 Dynamic Object 真实接入（v2 contract 已发布） | PR-08/PR-13 | 只接入已发布的 v2 contract；不猜测 object 数量/编号/容量，不 fallback |
| PR-17 | 跨平台人工验收、发布文档和 release hardening | 对应交付阶段 | Windows/Linux/macOS tray、autostart、打包和真实设备 |

## 14. 验证策略

### 14.1 当前主机可执行的检查

当前主机没有“禁止编译、测试或打包”的限制。适用时直接运行：

```text
npm ci
npm test
npx tsc --noEmit
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build -- --no-bundle
git diff --check
```

配置/启动契约（`src-tauri/src/autostart.rs` 的测试）在 `cargo test` 中一并执行，并直接读 `tauri.conf.json` / `capabilities/default.json` 断言：主窗口 `visible: false`、权限只多出 `autostart:default`、bundle 仍是桌面平台列表。

UI-only PR 至少执行 frontend build、`git diff --check`，并完成本地窗口/截图/人工交互验收。若本机环境缺少特定平台依赖，应记录原因并在对应 runner 补充验证，而不是把“当前主机不可验证”写成项目限制。

### 14.2 CI 和平台验证

普通分支/PR CI 应覆盖适用的 frontend build、Rust fmt/test/clippy、Tauri no-bundle 和 privacy scan；保留现有 tag release workflow。

平台专属行为必须在对应环境验证：

- Windows：tray、close-to-tray、autostart、窗口恢复、设备拔插和安装后首次启动；
- Linux：hidraw/udev、GNOME/KDE/Wayland/X11 tray、WebKitGTK 依赖、权限变化；
- macOS：tray、login autostart、现有 transparent/private API window 行为和 HID 发现限制。

三平台 CI 通过不能替代 tray、autostart、窗口生命周期和真实 HID 的人工验收。

### 14.3 Dynamic 和隐私回归

至少覆盖：

- Dynamic v2 capability、slot-aware upload、逐 object clear、22-byte DATA（512 bytes/24 chunks）、retry 和 stale/malformed response；
- 每个设备只有一个 writer；
- 新 generation 淘汰 pending 旧请求；
- disconnect/reconnect/restart 后 `Unknown`；
- Dynamic 状态层 DTO 的字段集合和隐私回归：service state 只含 status、capabilities、generation、objects、error，per-object 只含 slot、状态、byte length、TTL/keep，测试断言序列化字段集合而不打印正文；
- capability 驱动的 object 数量（含 count = 1）与目标选择；
- mock/正式 object collection 和目标选择；
- capability change、keep unsupported、oversize 和 target missing；
- dynamic auth status 不触发 static login；
- 本地 HTTP API：`/health` 的 body 与方法边界、`/devices` JSON 字段集合（不得出现 path/serial/deviceId/摘要 key）、alias mirror 首次 ready 前 `/devices` 与写入都返回 `503 service_not_ready`（`/devices` 不枚举 HID）而 `/health` 仍为精确 200、带 `Origin` 的请求被拒绝且不发送 CORS header、未知路径 `404` 与已知路径错误方法的 `405`/匹配 `Allow`、固定 loopback 常量（`127.0.0.1:17653`）与 `bind_loopback` 只接受精确 IPv4 loopback（拒绝 `0.0.0.0`/LAN/IPv6/主机名）、alias 校验/唯一性与整体拒绝、真实 loopback socket 应答（health + Origin 403 + 完整写入 200）；
- 本地 HTTP API 写入：严格 JSON（未知字段/错类型/缺必填）、缺失与错误 `Content-Type`、body 上限（含真实 socket 上的 `413`）、text/slot/TTL 协议边界在任何 HID 访问之前拒绝、alias 未匹配 `404`、写入参数透传与设备默认 TTL 上报、成功响应不含正文或设备标识、device-layer 错误映射到公开 code 且不回显内部 message（映射逐项覆盖，含未知 code 的 `500 internal_error` 回落），并断言只使用 companion contract 列出的 code 与状态；`commands.rs` 侧覆盖按需连接/同设备复用/不同设备 `409`、capability 先于 upload、locked 设备绕过 static auth gate；
- login autostart：启动开关只有精确 `--autostart`（近似值不得隐藏窗口）、主窗口保持 `visible: false` 而由 `setup` 按启动模式显示、自启不自动连接/不发 `AUTH_INFO`/不执行 capability discovery/不读写 Dynamic、toggle 只显示 OS 确认状态、无 Tauri host 时不伪造状态或成功、权限只多出 `autostart:default`；
- API token、密码、Dynamic 正文、serial、HID path 和 raw frame 不进入日志、诊断、CI artifacts 或错误返回；
- static slot/auth、隐私预览和既有 MagicPatterns UI 无回归。

## 15. 暂不实现

以下内容不属于当前 UI-first 和首期功能范围：

- 公网 HTTP API 或绑定 `0.0.0.0`；
- API 认证/token 与显式启用开关（首版无认证；阶段 2 的只读 discovery 与阶段 3 的 Dynamic write 均在同一 loopback contract 上实现，认证后置）；
- 自动上传密码、OTP、token、API key、私钥或其他 secret；
- Dynamic text readback 或把本地 ACK 包装成设备当前内容；
- static slot 与 Dynamic Object 的隐式 fallback；
- 为每种自动化软件开发 desktop 内置插件；
- 浏览器 URL、IDE project、Git branch 等复杂上下文的内置识别；
- gRPC、消息队列、云端同步；
- 不根据 desktop 假设猜测 object 编号、数量、容量、TTL 或 wire contract，一律以 `CAPABILITIES` 为准；
- 在 UI-only 阶段调用 HID、写 localStorage、Scenario 持久化或接 HTTP API；
- 自建 autostart OS service/manager、自写启动项文件或注册表，或用启动参数携带凭据、正文、设备标识（一律交给官方 autostart plugin 和单一裸开关）。

## 16. 完成定义

### 16.1 UI 视觉阶段完成

满足以下条件才算阶段 1 完成：

1. tray 基础、窗口入口、close-to-tray、明确退出和单实例恢复可用；
2. Dynamic Workspace 与现有 Static Slots、TitleBar、AppHeader 的视觉质量一致；
3. 新 UI 已替代旧 Dynamic modal 的产品方向，但旧入口在验收前仍可保留；
4. Scenario 是主要管理对象，Dynamic Object 明确为上传目标；
5. 单 object（count = 1）和多 object（count = 8）collection mock 均可展示；
6. 规定的状态矩阵、对话框和操作语义可人工检查；
7. UI-only 阶段没有 HID、localStorage、HTTP API 或真实业务完成假象；
8. 用户完成视觉/交互验收后，旧 Dynamic modal 入口才可移除。

### 16.2 首期手动闭环完成

阶段 1 之后，完成 PR-05 至 PR-11 并满足：

1. Dynamic v2 slot-aware client 已复用并接入统一 DynamicService；
2. UI、tray 和后续来源共用一个 serialized writer/queue；
3. Scenario 可创建、编辑、删除、原子持久化和手动 Save & Upload；
4. 支持当前 active device alias；
5. static locked/auth 边界无回归，Dynamic 不自动 login；
6. restart/reconnect/disconnect 后状态为 `Unknown`；
7. close-to-tray、明确退出和 login autostart 在对应平台正常；
8. 日志、诊断、DTO 和 artifacts 不包含正文、凭据或真实设备标识；
9. Windows、Linux、macOS 的适用构建和平台人工验收完成。

首期手动闭环完成不要求 HTTP API、自动规则或正式多 Dynamic Object。

### 16.3 最终产品完成

最终完成还需要：

- loopback HTTP API 的认证与显式启用（读写能力已实现：固定端口、无认证、仅按 alias 解析设备）；
- API、tray、UI 和自动规则都通过同一 DynamicService；
- HTTP status/operation 不提供 readback 假象；
- 自动场景遵守 generation 和仲裁优先级；
- UI 完成基于 v2 `CAPABILITIES`（`dynamic_object_count` 1–8）的 capability-driven 多 object 选择支持；
- 三平台构建、打包、tray/autostart、真实 HID 和 static/auth 回归全部验收；
- 文档、测试、日志、诊断和 artifacts 持续符合公开仓库隐私边界。
