# Runtime Macro Dynamic 场景应用与本地服务开发计划

## 1. 文档目的与当前决策

本文规划 `zmk-runtime-macro-desktop` 在现有 Runtime Macro v2 slot 配置客户端基础上，逐步增加 Dynamic Macro 场景管理、系统托盘和本地自动化服务。

本文与固件模块中的以下文档配套使用：

- `docs/DYNAMIC_PROTOCOL.md`：Dynamic Macro wire contract（当前已实现的 v2 多槽位版本，取代早期单槽 v1）；
- `tools/runtime_macro_cli.py`：Python reference client（已按 v2 contract 同步）；
- 本文：desktop 产品形态、UI 交付顺序、服务边界、场景模型和多 Dynamic Object 处理计划。

本文不修改固件协议，也不把复杂的自动化规则写死在 React UI 中。

当前已经确认的实施方向是：

1. **先做托盘基础、窗口入口/生命周期和完整 Dynamic UI。**
2. UI 阶段采用 presentation-first：使用 mock/in-memory fixture 完成高保真视觉和交互评审，不接真实 HID、不做场景持久化、不接 HTTP API。
3. UI 视觉验收通过后，才依次实现 contract/DTO、DynamicService、场景持久化、真实 HID 接入、设备 alias、托盘真实状态、自启、本地 HTTP API 和自动场景。
4. 当前主机可以执行适用的 frontend、Rust、Tauri build/test；跨平台专属行为仍必须在对应平台或 runner 上验证。
5. desktop backend 已完成 Dynamic Protocol v2 多槽位迁移（slot-aware capability/upload/clear、每 object 最大 512 bytes、逐槽 clear、retry 从 BEGIN 重启）；该实现是后续接入基线，不从零重写，也不降级回单槽 v1。

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
- Dynamic 没有 readback，只能报告本地观察状态。

相关现有实现主要位于：

```text
src-tauri/src/protocol.rs
src-tauri/src/client.rs
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

当前 `DynamicMacroModal.tsx` 和 `DynamicMacroPanel.tsx` 是不满意的临时实现：它们把正文、TTL、keep、capability、lifecycle、警告和 clear/upload 操作堆在一个弹窗中。

后续产品方向改为新的**页面级 Dynamic Workspace**：

- 不再把 Dynamic 主体验设计成弹窗；
- 保留旧入口作为过渡实现，直到新页面通过视觉验收；
- 新 UI 验收后再移除或下线旧 `DynamicMacroModal`/`DynamicMacroPanel` 入口；
- 不在新 UI 验收前把旧弹窗继续扩展成场景管理器。

## 4. 托盘优先的产品形态

### 4.1 第一阶段托盘基础

第一阶段先实现托盘基础和窗口生命周期，但此时不要求 DynamicService、场景持久化或 HTTP API 已完成。托盘可以使用静态/mock 状态进行视觉和菜单验收，但不得把 mock 结果标成真实设备操作结果。

基础能力包括：

- Tauri tray icon；
- 打开/显示主窗口；
- 隐藏主窗口到托盘；
- 关闭窗口默认隐藏到托盘，而不是退出进程；
- 明确的“退出”菜单项终止应用；
- 单实例再次启动时恢复已有窗口；
- 托盘菜单的视觉层级、禁用状态和错误状态。

登录自启不属于第一阶段托盘基础，放在真实 DynamicService 和手动闭环稳定之后实现。

### 4.2 托盘菜单的 UI-first 版本

UI-only 阶段可以展示以下菜单结构和 mock 状态：

```text
打开 ZMK Runtime Macro
──────────────────────
设备                 当前设备
Dynamic 状态         Ready / Unknown / Error
当前场景             用户选中的场景
──────────────────────
选择场景             >
上传当前场景
清除 Dynamic Object
──────────────────────
设置
退出
```

在 UI-only 阶段：

- “上传当前场景”和“清除 Dynamic Object”只能触发 mock/presentation interaction；
- 不打开 HID、不发送 protocol frame、不修改 firmware；
- 不把菜单中的 `Ready`、`CommittedLocally` 或 `ClearedLocally` 当成真实 ACK；
- 托盘真实设备状态和真实操作菜单在后续接入 DynamicService 后再启用。

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

selector 的选项来自 `objects` collection，不来自硬编码数字列表。缺少目标 object 时显示明确错误并禁止上传，但保留 Scenario 正文和 dirty draft。

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
├── dynamic_service.rs   # 后续统一队列、generation、observed state
├── scenario.rs          # 后续 Scenario 模型和原子持久化
├── tray.rs              # tray/window lifecycle 和真实状态菜单
├── autostart.rs         # 后续 login autostart
├── api.rs               # 后续 loopback HTTP API
├── credentials.rs       # 后续 API token OS credential storage
├── commands.rs          # Tauri bridge
└── lib.rs
```

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
- 场景正文明确属于用户选择保存的非 secret 明文；
- 写入使用临时文件加原子替换；
- 配置损坏时保留原文件并报告可恢复错误；
- 正文不进入日志、诊断、窗口标题、错误消息、CI artifacts 或无关持久化数据；
- 不使用 `localStorage` 作为正式 Scenario store。

如果未来设备有多个 object，而 Scenario 的目标 object 不再存在，必须报告明确输入/绑定错误，不自动改到其他 object。

## 10. 本地 HTTP API（UI 和手动闭环之后）

### 10.1 版本和路径

第一版 API 采用版本化 REST/JSON，通过 loopback 提供：

```text
GET    /api/v1/health
GET    /api/v1/devices
GET    /api/v1/devices/{device}/capabilities
GET    /api/v1/devices/{device}/status
PUT    /api/v1/devices/{device}/dynamic-objects/{object}
DELETE /api/v1/devices/{device}/dynamic-objects/{object}
GET    /api/v1/operations/{operation_id}
```

设备使用用户配置的 alias，不暴露 serial 或 HID path。object 数量以 `CAPABILITIES` 为准（1–8），路径和 object 标识保留复数形式。

### 10.2 API 行为

写入请求可以包含：

- `text`：必填，非空，字符集和长度由 capability 约束；
- `ttl_seconds`：可选，经过本地范围校验；
- `keep_after_execute`：可选，仅 capability 支持时允许；
- `source`、`priority`：用于冲突诊断和仲裁，不写入正文；
- `Idempotency-Key`：避免调用方重试造成不必要的重复 upload。

默认等待 Dynamic transaction final ACK 后返回成功；调用方明确使用 `Prefer: respond-async` 时才返回 `202` 和 `operation_id`。响应可以返回长度、TTL 和本地观察状态，但不得返回 Dynamic text。

`committed_locally` 只表示本次连接收到 final ACK，不保证 object 仍存在，也不是 readback。

### 10.3 API 安全

- API 默认关闭，由用户主动启用；
- 只绑定 `127.0.0.1`，不绑定 `0.0.0.0`；
- 使用随机端口，runtime metadata 只暴露 API version、host、port 和 PID，不含 token；
- Bearer token 第一次启用时生成，存入 OS 安全凭据存储，不写普通配置；
- API token 与 firmware static management password 完全独立；
- API 不自动触发 static login；
- 不把 token、Authorization header、密码、正文、完整 HID frame、serial 或 HID path 写入日志；
- 不依赖 CORS 作为安全措施；
- operation/idempotency cache 不保存正文，具备 TTL 和容量上限；
- API 文档明确 Dynamic 不适合密码、OTP、token、API key、私钥或其他 secret。

## 11. 多来源和并发规则

当前 firmware 只有一个 Dynamic Object，同一时刻不能并行写入。后续服务必须：

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

## 12. 实施阶段和验收闸门

### 阶段 1：托盘基础 + 高保真 Dynamic UI（先做）

这一阶段是 presentation-first，先让用户看到并验收完整产品形态：

1. 托盘 icon、打开/隐藏/退出、close-to-tray、单实例窗口入口；
2. 保持现有 TitleBar、AppHeader、Static Slots 和全局 MagicPatterns 视觉风格；
3. 用页面级 Dynamic Workspace 替代旧 Dynamic modal 的产品方向；
4. Scenario 列表、空状态、新建、编辑器、dirty 状态和操作栏；
5. 可选的单 object（count = 1）与多 object（count = 8）capability-driven selector 的 mock；
6. capability details、非 secret 警告、无 readback 文案；
7. 全部状态矩阵和确认对话框的 mock/in-memory interaction；
8. 不接 HID、不写 localStorage、不持久化 Scenario、不接 HTTP API；
9. 新 UI 通过人工视觉和交互验收后，才移除旧 Dynamic modal 入口。

**UI 视觉验收点 A：**

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

### 阶段 3：DynamicService、队列和 generation

- 复用已有 Dynamic v2 slot-aware client/protocol/upload/clear/retry；
- 将 capability、upload、clear 接入统一 Rust DynamicService；
- 只维护一个 active device 和一个 HID writer；
- 每次新连接重新 discovery；
- 实现 `Unknown`、`Discovering`、`Unsupported`、`Ready`、`Uploading`、`CommittedLocally`、`Clearing`、`ClearedLocally`、`Error`；
- 实现 generation-based last-write-wins、pending 淘汰和 stale completion 保护；
- 不改变 static/auth command boundary。

### 阶段 4：Scenario 原子持久化

- 实现场景 schema version；
- 使用临时文件和原子替换；
- 保存 user-named Scenario、target device alias、target object、正文和策略；
- 配置损坏可恢复；
- 保持正文不进入日志、诊断、错误和无关持久化；
- 仍然提示仅适合非 secret 文本。

### 阶段 5：UI 接入真实 DynamicService/HID

- 将 UI mock adapter 替换为 Tauri/DynamicService bridge；
- 主窗口和未来托盘调用同一个 service；
- 接入真实 capability、upload、clear、retry、generation 和 observed state；
- 保留 static locked 但 Dynamic 可用的边界；
- 真实 ACK 只更新本地观察状态，不添加 readback；
- 完成硬件前的 fake-HID regression tests。

### 阶段 6：Device alias

- 为当前 active device 建立用户配置 alias；
- Scenario 和后续 API 使用 alias，不暴露 serial 或 HID path；
- alias 对应多个候选设备时不得自动选择；
- 设备摘要变化后要求用户重新确认绑定；
- 首期仍只保持一个并行 HID session。

### 阶段 7：托盘接入真实状态

- 将托盘菜单从 mock 状态接入 DynamicService 和 Scenario store；
- 显示当前设备 alias、active Scenario、observed state 和可用操作；
- 托盘上传、clear、选择 Scenario 与主窗口共用同一 service；
- 关闭窗口仍只隐藏到托盘；明确退出才停止 worker/service。

### 阶段 8：Login autostart

- 默认关闭，由用户主动启用；
- 使用官方 autostart plugin 或平台等价适配；
- 只授予 `enable`、`disable`、`isEnabled` 所需权限；
- 普通启动显示主窗口，login autostart 使用后台参数只显示托盘；
- 设置页显示实际 OS 注册状态；
- 启动后 dynamic observed state 先为 `Unknown`，不得假设上次 Dynamic 仍存在。

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
- HTTP API 安全 contract 已冻结：默认关闭、仅 loopback、token 与 firmware password 独立，且不得进入普通配置或日志；
- status 不提供 readback 假象；
- 三平台适用构建和平台生命周期检查已通过。

### 阶段 9：Local HTTP API

Gate C 通过后实现：

- HTTP lifecycle、随机 loopback port、runtime metadata；
- OS credential store 中的独立 token、复制和轮换；
- health、devices、capabilities、status、upload、clear；
- operation endpoint、Prefer async、idempotency、错误映射；
- curl、Python 和 Shell 示例；
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

### 阶段 11：正式多 Dynamic Object

只有 firmware 发布正式多 object capability/protocol contract 且 reference client 同步后才能实现：

- capability-driven object collection；
- 多 object fake-HID、并发、TTL、clear 和 lifecycle tests；
- object-specific validation；
- UI/API 的真实 object selector；
- 新 protocol version 或 capability negotiation。

在此之前不猜测 object 数量、数字编号、容量、TTL 或 wire contract，不使用 static slot fallback。

## 13. Pull Request 拆分

每个 PR 只承担一个主要目标，不在同一个 PR 中同时修改协议、托盘、UI、持久化和 HTTP API。

| PR | 主要目标 | 依赖 | 验收重点 |
|---|---|---|---|
| PR-01 | Tauri tray 基础、窗口入口、close-to-tray、明确退出、单实例恢复 | 无 | tray/window 生命周期；不接真实 Dynamic service |
| PR-02 | Dynamic Workspace 页面壳和 Static/Dynamic 入口 | PR-01 | 保持现有 MagicPatterns/static 视觉；不改旧 static UI |
| PR-03 | Scenario 列表、编辑器、目标 object 区域和操作栏 | PR-02 | Scenario 与 Dynamic Object 概念清楚；Save/Upload/Clear/Delete 语义清楚 |
| PR-04 | UI mock fixture、单/多 object preview、状态矩阵和对话框 | PR-03 | UI 视觉验收点 A；不接 HID、localStorage、HTTP |
| **Gate A** | **用户视觉/交互验收** | PR-04 | **验收通过后才移除旧 Dynamic modal 入口** |
| PR-05 | Dynamic contract/DTO、golden fixtures、CI/本机验证基线 | Gate A | DTO、frame fixture、privacy checks |
| PR-06 | DynamicService、serialized writer、queue、generation、observed state | PR-05 | 复用现有 client；fake-HID regression |
| PR-07 | Scenario schema、原子持久化和损坏恢复 | PR-06 | 正文只作为用户选择的非 secret 数据保存 |
| PR-08 | UI bridge 接入真实 DynamicService/HID | PR-07 | 真实 capability/upload/clear；无 readback |
| PR-09 | 当前 active device alias | PR-08 | alias 不暴露 serial/path；多候选不自动选择 |
| PR-10 | 托盘菜单接入真实 Scenario/service 状态 | PR-09 | 主窗口和 tray 共用 service；手动闭环准备 |
| PR-11 | Login autostart 和后台启动参数 | PR-10 | 默认关闭；普通启动和自启入口区分 |
| **Gate B** | **首期手动闭环验收** | PR-11 | **真实 tray、autostart、Scenario、HID 和 static/auth 无回归** |
| **Gate C** | **HTTP API 前验收** | Gate B | **确认 UI/tray/service/store/alias 已稳定，再决定是否开始 HTTP API** |
| PR-12 | HTTP lifecycle、loopback、token credential、health、metadata | Gate C | API 默认关闭；token 不进普通配置/日志 |
| PR-13 | HTTP devices/status/capabilities/upload/clear | PR-12 | API 只调用 DynamicService；不返回正文 |
| PR-14 | operations、idempotency、错误映射和调用示例 | PR-13 | final ACK、async operation、request digest |
| PR-15 | 自动场景基础规则和仲裁 | PR-14 | debounce、generation、manual override、external lease |
| PR-16 | 正式多 Dynamic Object 支持 | firmware contract | 只实现已发布 contract，不猜测、不 fallback |
| PR-17 | 跨平台人工验收、发布文档和 release hardening | 对应交付阶段 | Windows/Linux/macOS tray、autostart、打包和真实设备 |

## 14. 验证策略

### 14.1 当前主机可执行的检查

当前主机没有“禁止编译、测试或打包”的限制。适用时直接运行：

```text
npm ci
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build -- --no-bundle
git diff --check
```

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
- capability 驱动的 object 数量（含 count = 1）与目标选择；
- mock/正式 object collection 和目标选择；
- capability change、keep unsupported、oversize 和 target missing；
- dynamic auth status 不触发 static login；
- API token、密码、Dynamic 正文、serial、HID path 和 raw frame 不进入日志、诊断、CI artifacts 或错误返回；
- static slot/auth、隐私预览和既有 MagicPatterns UI 无回归。

## 15. 暂不实现

以下内容不属于当前 UI-first 和首期功能范围：

- 公网 HTTP API 或绑定 `0.0.0.0`；
- 自动上传密码、OTP、token、API key、私钥或其他 secret；
- Dynamic text readback 或把本地 ACK 包装成设备当前内容；
- static slot 与 Dynamic Object 的隐式 fallback；
- 为每种自动化软件开发 desktop 内置插件；
- 浏览器 URL、IDE project、Git branch 等复杂上下文的内置识别；
- gRPC、消息队列、云端同步；
- 不根据 desktop 假设猜测 object 编号、数量、容量、TTL 或 wire contract，一律以 `CAPABILITIES` 为准；
- 在 UI-only 阶段调用 HID、写 localStorage、Scenario 持久化或接 HTTP API。

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

- loopback HTTP API 默认关闭并通过独立 token 保护；
- API、tray、UI 和自动规则都通过同一 DynamicService；
- HTTP status/operation 不提供 readback 假象；
- 自动场景遵守 generation 和仲裁优先级；
- UI 完成基于 v2 `CAPABILITIES`（`dynamic_object_count` 1–8）的 capability-driven 多 object 选择支持；
- 三平台构建、打包、tray/autostart、真实 HID 和 static/auth 回归全部验收；
- 文档、测试、日志、诊断和 artifacts 持续符合公开仓库隐私边界。
