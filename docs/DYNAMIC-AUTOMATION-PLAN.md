# Dynamic Macro 场景应用与本地服务开发计划

## 1. 文档目的

本文规划 `zmk-runtime-macro-desktop` 从当前 Runtime Macro v2 slot 配置客户端，扩展为跨平台的 Dynamic Macro 场景应用和本地自动化服务。

本文与固件模块中的以下文档配套使用：

- `docs/DYNAMIC_PROTOCOL.md`：dynamic macro 的 wire contract；
- `docs/DYNAMIC_DESKTOP_APP_SPEC.md`：当前 dynamic desktop integration 的行为和验收规范；
- `tools/runtime_macro_cli.py`：Python reference client；
- 本文：desktop 产品形态、外部服务 API、场景模型和后续多 dynamic object 兼容计划。

本文不改变固件协议，也不把 dynamic macro 的复杂自动化逻辑写死在 UI 代码中。

## 2. 产品目标

应用最终应同时满足以下目标：

1. 在 Windows、Linux 和 macOS 上运行；
2. 常驻系统托盘，并提供完整配置窗口；
3. 管理一个或多个 Runtime Macro 设备；
4. 根据手动选择或自动场景向键盘上传 dynamic macro；
5. 为其他本机服务提供稳定、版本化的调用接口；
6. 让外部服务可以自行实现复杂的自动化逻辑，而不要求每增加一种场景就修改 desktop 应用；
7. 兼容当前只有一个 dynamic object 的固件，并为未来多个 dynamic object 做好 API 和内部模型准备。

产品的核心定位是：

```text
场景管理器 + 本地自动化代理 + Runtime Macro HID bridge
```

应用不是宏内容的安全存储系统，也不是公网服务。

## 3. 当前基线

当前 dynamic macro 功能已经完成测试开发，desktop 应用的已有能力和约束如下：

- 使用 Tauri 2 + React + TypeScript + Rust；
- Rust 后端负责 HID 枚举、连接、协议、重试和错误映射；
- 前端不直接访问 HID；
- dynamic object 只存在于固件 RAM；
- 当前固件支持一个 dynamic object，最大长度、TTL 和 lifecycle flags 由 `CAPABILITIES` 返回；
- dynamic macro 没有 readback；
- 默认执行后消费，可选 `keep-after-execute`；
- 当前协议只允许 printable ASCII、LF、Tab 和 Backspace；
- dynamic 通道不经过 static slot password gate，也不加密；
- dynamic 只允许承载非 secret 文本。

当前 desktop 应用已经存在的 static slot、认证、隐私预览和 HID 安全边界继续有效，不因增加 dynamic 场景功能而放宽。

## 4. 应用形态

### 4.1 托盘应用

应用启动后默认常驻托盘，可以在没有打开主窗口时继续提供本地 API 和自动化能力。

托盘菜单至少包含：

- 打开主窗口；
- 当前设备和连接状态；
- 当前 active scenario；
- 手动选择场景；
- 上传当前场景；
- 清除 dynamic macro；
- 设置；
- 退出应用。

关闭主窗口默认隐藏到托盘。只有明确选择“退出”才终止后台服务和 HID worker。

### 4.2 配置窗口

第一阶段窗口提供：

- 设备选择和设备别名；
- dynamic capability 状态；
- 场景列表；
- 场景编辑器；
- TTL 和执行后保留选项；
- 手动激活/上传/清除；
- 本地 API 状态和 token 管理；
- 最近一次操作状态。

dynamic 状态只能表达本地观察结果，例如 `Ready`、`Uploading`、`CommittedLocally`、`ClearedLocally`、`Unknown` 和 `Error`，不能显示成“设备当前文本”，因为固件没有 dynamic readback。

## 5. 总体架构

```text
┌──────────────────────────────────────────┐
│ Tauri 2 application                      │
│                                          │
│  React/TypeScript UI                     │
│       │ Tauri invoke/events              │
│       ▼                                  │
│  Rust application core                   │
│   ├─ tray/window lifecycle               │
│   ├─ scenario store and rule runner      │
│   ├─ local HTTP API                      │
│   ├─ per-device serialized write queue   │
│   └─ Runtime Macro protocol client       │
│       │                                  │
│       ▼                                  │
│  hidapi / Runtime Macro management HID   │
└──────────────────────────────────────────┘
                    ▲
                    │ HTTP/JSON on loopback
       external scripts and automation services
```

关键边界：

- Tauri command 是 UI 与 Rust backend 的内部 IPC，不是外部服务 API；
- 外部服务只调用 local HTTP API，不接触 HID path、report、request frame 或密码；
- 每个设备只有一个 HID writer；所有 upload、clear 和 capability request 必须经过同一个串行队列；
- UI、内置规则和外部 API 都通过同一个 backend service 写入，禁止各自打开 HID。

## 6. 外部服务 API

### 6.1 第一版协议选择

第一版使用：

> **版本化 REST/JSON API，通过 `127.0.0.1` 提供服务。**

选择原因：

- Python、Shell、Go、Node.js 和其他自动化工具都能直接调用；
- `curl` 即可调试；
- 不需要为每种语言维护 SDK；
- 适合当前主要操作：写入、清除、查看能力和查看本地状态；
- 与 Tauri 前端解耦，未来替换 UI 不影响自动化服务。

WebSocket 不是第一版必需项。若未来需要实时推送设备连接、上传进度和状态变化，再增加 SSE 或 WebSocket；它们不应替代写入 API。

Unix Domain Socket 和 Windows Named Pipe 可以作为后续可选 transport，用于更严格的本机 ACL 场景，但不作为第一版唯一接口。

### 6.2 API 路径

API 使用 `/api/v1` 前缀。设备使用用户配置的 alias，不直接把 serial 或 HID path 暴露给调用方。

建议接口：

```text
GET    /api/v1/health
GET    /api/v1/devices
GET    /api/v1/devices/{device}/capabilities
GET    /api/v1/devices/{device}/status
PUT    /api/v1/devices/{device}/dynamic-objects/{object}
DELETE /api/v1/devices/{device}/dynamic-objects/{object}
GET    /api/v1/operations/{operation_id}
```

当前单 object 固件使用 object alias `default`。即使当前只有一个 object，也使用复数路径和 object 标识，避免未来增加多个 dynamic object 时重新设计外部 API。

### 6.3 写入请求

示例：

```http
PUT http://127.0.0.1:<port>/api/v1/devices/totem/dynamic-objects/default
Content-Type: application/json
Authorization: Bearer <local-api-token>
Idempotency-Key: terminal-2026-01-01-0001
```

```json
{
  "text": "git status\n",
  "ttl_seconds": 300,
  "keep_after_execute": true,
  "source": "terminal-automation",
  "priority": 50
}
```

字段约束：

- `text`：必填，允许的字节集合和长度由 firmware capability 约束；
- `ttl_seconds`：可选，必须经过本地范围校验；
- `keep_after_execute`：可选，只有 firmware capability 支持时才允许；
- `source`：可选，用于冲突诊断和状态显示，不写入宏正文；
- `priority`：可选，用于多来源仲裁；
- `Idempotency-Key`：建议支持，避免调用方重试造成不必要的重复上传。

请求成功时，应用应等待 dynamic transaction 的最终 ACK 后返回成功，而不是只返回“已排队”。如果操作需要异步执行，则返回 `202 Accepted` 和 `operation_id`，调用方通过 operation endpoint 查询结果。

成功响应示例：

```json
{
  "operation_id": "op_7f2c",
  "status": "committed_locally",
  "device": "totem",
  "object": "default",
  "length": 11,
  "ttl_seconds": 300
}
```

`committed_locally` 只表示 desktop 在本次连接中收到 firmware final ACK，不表示应用可以 read back 或保证 object 没有随后因 TTL、重启、USB disconnect 或 lifecycle policy 被清除。

### 6.4 清除和状态

清除使用：

```text
DELETE /api/v1/devices/{device}/dynamic-objects/{object}
```

状态接口只返回本地观察信息，例如：

```json
{
  "device": "totem",
  "object": "default",
  "state": "committed_locally",
  "length": 11,
  "observed_at": "<timestamp>",
  "source": "terminal-automation"
}
```

状态接口不得返回 dynamic text，也不得通过猜测提供“设备当前内容”。设备断开、应用重启、固件重启或无法确定 transaction 结果时，状态必须变为 `unknown`。

### 6.5 API 安全

第一版必须遵守：

- 只绑定 `127.0.0.1`，不绑定 `0.0.0.0`；
- 使用随机或可配置端口，避免固定端口冲突；
- 使用本机生成的 Bearer token，token 放入操作系统安全凭据存储，不放入普通配置文件；
- 不把 token、宏正文、密码、完整 HID frame 写入日志；
- 不依赖 CORS 作为安全措施；
- API 文档明确 dynamic 不适合密码、OTP、token、API key、私钥和其他 secret；
- 诊断信息只记录 source、长度、operation 类型、request id、结果类别和脱敏设备 alias。

本地 API token 与键盘 firmware 的 static management password 是两套完全独立的凭据，不能混用，也不应由 API 自动触发 firmware login。

## 7. 场景模型

场景是 desktop 或外部服务中的逻辑对象，不等同于 firmware dynamic object。

建议的最小模型：

```json
{
  "id": "terminal",
  "name": "Terminal",
  "text": "git status\n",
  "ttl_seconds": 300,
  "keep_after_execute": true,
  "target_device": "totem",
  "target_object": "default",
  "match": {
    "bundle_ids": [
      "com.apple.Terminal",
      "com.googlecode.iterm2"
    ],
    "priority": 100
  }
}
```

场景激活来源分为：

1. 用户在托盘或窗口中手动激活；
2. desktop 内置规则根据前台应用或窗口标题激活；
3. 外部服务通过 HTTP API 激活或直接写入；
4. 未来由插件或其他自动化系统激活。

第一版内置规则只建议支持前台应用 identifier/bundle id 和窗口标题。浏览器 URL、编辑器项目、Git 分支等复杂上下文交给外部服务实现，避免把场景系统做成不可维护的插件框架。

## 8. 多来源和并发规则

当前 firmware 只有一个 dynamic object，同一时刻不能让多个来源并行写入。

backend 必须：

1. 为每个设备维护一个串行 operation queue；
2. 让 capability、upload 和 clear 共享同一 queue；
3. 一次 upload 的 retry 必须从新的 `BEGIN` 开始；
4. 新场景到达时丢弃尚未发送的旧场景请求；
5. 已经开始的 upload 完成后，再按 generation 检查结果是否仍然有效；
6. 不允许 UI、内置规则和外部 API 分别创建 HID session。

第一版可以采用明确的 last-write-wins 规则，但 UI 和 API 必须显示 source。后续多来源场景建议增加：

- source priority；
- 临时 lease/claim；
- lease TTL；
- 用户手动 override；
- override 到期后的自动恢复。

建议优先级：

```text
用户手动 override > 外部服务 lease > 外部普通请求 > desktop 内置自动规则
```

该优先级必须在 API 文档中固定，不能只存在于 UI 行为中。

## 9. 多 dynamic object 兼容计划

固件后续会增加多个动态宏。desktop 不能把当前单 object 假设扩散到 UI、场景存储和 API。

### 9.1 内部模型

从第一版开始使用 collection 模型：

```text
Device
  └─ DynamicCapabilities
       └─ DynamicObject[]
            ├─ object_id
            ├─ max_length
            ├─ ttl policy
            └─ lifecycle policy
```

当前 v1 capability 只有一个 object 时，应用仍构造一个 `DynamicObject`，并映射为 object alias `default`。

### 9.2 能力探测

每次设备连接后必须重新执行 capability discovery。应用不能硬编码：

- object 数量；
- object id；
- 最大长度；
- TTL 边界；
- keep-after-execute 支持状态；
- lifecycle flags。

遇到未知 capability version、malformed response 或不兼容 object metadata 时，应用应报告 protocol mismatch，不能静默降级为 static slot，也不能把多个 object 合并成一个文本。

### 9.3 API 兼容

API 使用：

```text
/devices/{device}/dynamic-objects/{object}
```

而不是：

```text
/devices/{device}/dynamic-macro
```

当前单 object 固件的 `default` 只是兼容 alias。未来 object id 由 capability 返回，外部服务不应假定 object 一定是数字 slot，也不应把 dynamic object 映射到 static slot。

场景模型同时保存 `target_device` 和 `target_object`。如果调用方不提供 object，只有在设备明确只有一个 object 时才可以使用 `default`；多个 object 时必须返回明确的输入错误。

### 9.4 固件协议演进

未来多个 dynamic object 如果需要新的 wire contract，应通过 capability version 或新 protocol version 协商。desktop 应保留协议适配层，但不复制一套绕过现有 validation/retry 规则的快捷实现。

新增 object 后仍需保留：

- 原子 BEGIN/DATA commit；
- 单 object transaction timeout；
- 明确的 TTL 和 lifecycle 语义；
- 没有 readback 的限制；
- stale response、retry 和 disconnect 状态处理；
- dynamic 与 static/auth 状态机隔离。

## 10. 跨平台计划

### 10.1 Windows

- Tauri tray、window hide/show 和启动到托盘；
- hidapi Runtime Macro interface discovery；
- Windows x64 package；
- 本地 HTTP server 生命周期和 Windows 防火墙提示控制；
- 设备拔插、睡眠恢复和应用重启后的 `Unknown` 状态处理。

### 10.2 Linux

- x86_64 baseline；
- hidraw backend 和 udev rule 文档；
- AppImage/deb 的依赖说明；
- GNOME、KDE 和常见 Wayland/X11 环境的 tray 验证；
- WebKitGTK 运行时依赖说明；
- 设备拔插、权限变化和多 HID interface 选择。

### 10.3 macOS

- 继续保持现有 Tauri window 和 HID 行为；
- 托盘常驻和登录启动；
- 不把 HID path、serial 或正文写入偏好；
- 继续遵守当前 macOS private API 与分发限制。

所有平台都必须使用 HID report descriptor 和 Usage 进行 Runtime Macro interface 识别，不能只根据 VID/PID、interface number 或设备名称猜测。

## 11. 开发阶段

### 阶段 0：协议和模型冻结

- 确认 local HTTP API v1 路径、字段、错误模型和认证方式；
- 确认 `DynamicObject` collection 模型；
- 明确 current single-object 到 `default` alias 的映射；
- 明确 source、priority、generation 和 Unknown 状态语义；
- 增加 fake backend/API contract tests。

### 阶段 1：Rust dynamic service

- 把已有 dynamic protocol client 接入统一 Rust backend service；
- 第一阶段同时只维护一个 active device 和一个 serialized HID writer；
- 内部 collection、device alias 和 API path 从一开始兼容未来多设备；
- 实现 capability、upload、clear、retry、generation 和状态机；
- 不改变现有 static/auth command boundary；
- 完成 dynamic fake-HID regression tests。

### 阶段 2：Tauri 托盘、自启和场景窗口

- 优先增加 tray icon、tray menu、startup-to-tray 和 close-to-tray；
- 增加默认关闭、由用户主动启用的 login autostart；
- 普通启动显示窗口，login autostart 使用后台参数且只显示托盘；
- 托盘和自启稳定后，再增加场景列表、编辑器、手动激活和 clear；
- 增加 active scenario、source、TTL 和本地观察状态；
- 场景正文作为明确的非 secret 数据持久化到用户应用数据目录；
- 保持现有 MagicPatterns 和 privacy boundary；
- 不把 dynamic text 写入普通日志、诊断或无关的持久化数据。

### 阶段 3：本地 HTTP API

- 本地 HTTP API 作为手动 UI、托盘和自启完成后的独立里程碑；
- API 默认关闭，只能由用户主动启用；
- 启用后绑定 `127.0.0.1` 随机端口，并通过不含 token 的 runtime metadata 暴露实际端口；
- token 存入 OS 安全凭据存储，不写普通配置；
- 在 Rust backend 中实现 `/api/v1/health`、设备、capabilities、status、upload、clear 和 operation API；
- 实现请求校验、错误映射和 idempotency；
- 提供 curl、Python 和 Shell 示例；
- 增加 API server 关闭、端口冲突和应用重启测试。

### 阶段 4：自动场景

- 支持前台应用 identifier/bundle id 规则；
- 支持窗口标题规则；
- 支持 debounce、generation 和外部 override；
- 自动场景不能覆盖有效的用户手动 override；
- 复杂场景继续通过外部服务调用 HTTP API。

### 阶段 5：多 dynamic object

- 等 firmware 发布多 object capability/protocol 后再实现；
- 保持 object collection、target object 和 capability-driven UI；
- 增加多 object fake-HID、并发、TTL、clear 和 lifecycle 测试；
- 不为了兼容旧固件而改用 static slot 或未经验证的 fallback。

## 12. 测试和验收

### 12.1 自动测试

至少覆盖：

- API JSON schema 和版本前缀；
- 本地非法字符、空文本、长度和 TTL 在 HID write 前被拒绝；
- HTTP upload/clear 映射到正确的 dynamic protocol；
- 每个设备只有一个 writer；
- upload retry 使用新 request id 并从 BEGIN 重启；
- stale response 和 malformed response；
- idempotency key；
- 新场景丢弃旧 pending request；
- disconnect/reconnect 后状态为 `Unknown`；
- 应用重启不假设 dynamic object 仍存在；
- 单 object `default` alias；
- 多 object capability 和 object selection；
- HTTP token 不出现在日志；
- dynamic text、serial、HID path 和 raw report 不进入诊断输出。

### 12.2 手工平台测试

在 Windows、Linux 和 macOS 至少验证：

1. 应用启动到托盘；
2. 窗口显示、隐藏和退出；
3. Runtime Macro HID 设备发现；
4. 多 HID interface 和 Raw HID 共存时选择正确；
5. 外部 `curl`/Python 服务写入 dynamic macro；
6. 用户手动场景和外部 API 同时请求时仲裁正确；
7. 设备拔出、重新插入、睡眠恢复；
8. Linux udev 权限和托盘环境；
9. Windows 防火墙、端口冲突和安装后首次启动；
10. 当前 static slot/auth 功能没有回归。

### 12.3 完成标准

- UI、内置规则和外部服务都使用同一 Rust dynamic service；
- API 只提供 loopback 服务，不暴露公网监听；
- dynamic 上传成功只报告本地观察状态，不提供 readback 假象；
- 多来源请求不会并行写 HID；
- 未来 firmware 增加多个 dynamic object 时无需重做 API 路径和核心数据模型；
- Windows、Linux 和 macOS 的构建/打包验证分别在对应平台或 runner 完成；
- 文档、测试、日志和诊断不包含真实设备标识、用户正文或凭据。

## 13. 暂不实现

以下内容不属于第一阶段：

- 公网 HTTP API；
- 自动上传密码、OTP、token 或其他 secret；
- dynamic text readback；
- static slot 和 dynamic object 的隐式 fallback；
- 为每种自动化软件开发 desktop 内置插件；
- 浏览器 URL、IDE project、Git branch 等复杂上下文的内置识别；
- gRPC、消息队列或云端同步；
- 在 firmware 尚未发布多 object contract 前提前假设 object 编号和容量。

## 14. 已确认的实施计划

本节记录 2026-09-09 确认的交付范围和执行顺序。若本节与前文对阶段优先级的描述冲突，以本节为准。

### 14.1 已确认决策

| 决策项 | 结论 |
|---|---|
| 首期范围 | 完整的手动场景闭环 |
| 实施优先级 | dynamic 核心 → 托盘/自启 → 场景 UI → 本地 HTTP API |
| 设备模型 | 第一阶段同时只连接一个 active device |
| 多设备兼容 | collection、alias、场景 target 和 API path 预留多设备 |
| 登录自启 | 默认关闭，由用户主动启用；自启时后台启动，不弹主窗口 |
| HTTP API | 默认关闭，启用后只绑定 `127.0.0.1` 随机端口 |
| API token | 存入 OS 安全凭据存储 |
| 场景正文 | 作为非 secret 明文保存到用户应用数据目录 |
| 自动场景 | 手动闭环和本地 API 稳定后再实现 |
| 多 dynamic object | 等待 firmware 发布正式 contract |
| 编译环境 | 不在当前机器编译，使用 GitHub Actions 或对应平台 runner |

这里的“本地服务稍后实现”只指 loopback HTTP API。UI、托盘和未来 HTTP API 共用的 Rust `DynamicService` 仍需先完成，以确保所有来源共用同一个 HID writer、队列、generation 和状态机。

### 14.2 目标代码结构

Rust 后端按最小充分职责拆分：

```text
src-tauri/src/
├── protocol.rs
├── dynamic.rs          # dynamic wire contract 和严格解析
├── client.rs           # capability、upload、clear 和 retry
├── dynamic_service.rs  # 状态机、generation 和统一调用入口
├── scenario.rs         # 场景模型和持久化
├── tray.rs             # 托盘和窗口生命周期
├── autostart.rs        # login autostart 适配
├── api.rs              # 后续 loopback HTTP API
├── credentials.rs      # 后续 API token 凭据存储
├── commands.rs         # Tauri command 适配层
└── lib.rs
```

React 前端只拆分新增功能，不提前整体重写现有 `App.tsx`：

```text
src/features/dynamic/
src/features/scenarios/
src/types/dynamic.ts
src/types/scenario.ts
src/bridge.ts
```

### 14.3 里程碑

#### M0：远程 CI 和 contract

- 新增普通分支及 pull request CI；
- Linux 执行 frontend build、format、unit tests 和 clippy；
- macOS、Windows 执行 Rust tests 和 Tauri no-bundle build；
- 保留现有 tag release workflow；
- 冻结 `DynamicCapabilities`、`DynamicObject`、`DynamicObservedState`、`DynamicUploadRequest`、`Scenario` 和 `OperationStatus`；
- 从 Python reference client 建立 golden frame fixtures；
- CI 日志和 artifacts 不得包含正文、token、HID path、serial 或 raw report。

#### M1：Dynamic wire protocol

- 实现 `CAPABILITIES`、`DYNAMIC_BEGIN`、`DYNAMIC_DATA` 和 `DYNAMIC_CLEAR`；
- 严格校验 capability version、object metadata、flags、长度和 TTL；
- DATA 按 22 bytes 分块；
- BEGIN 和 DATA 使用同一 request ID；
- upload retry 必须使用新 request ID 并从 BEGIN 重启；
- clear 按幂等操作整体重试；
- dynamic auth status 作为 protocol mismatch；
- dynamic 操作不得调用、修改或刷新 static auth session；
- 使用 fake HID 覆盖边界长度、非法字符、timeout、stale 和 malformed response。

#### M2：统一 DynamicService

- 复用当前长期 HID worker；
- UI、托盘、自动规则和 HTTP API 只能调用统一 service；
- 第一阶段只维护一个 active device；
- 每次新连接重新发现 capability；
- 维护 `Unknown`、`Discovering`、`Unsupported`、`Ready`、`Uploading`、`CommittedLocally`、`Clearing`、`ClearedLocally` 和 `Error`；
- 实现 generation-based last-write-wins；
- 新请求淘汰尚未开始的旧 upload；
- 已开始的过期 operation 可以完成，但不得覆盖当前 active state；
- disconnect、reconnect 和 app restart 后 observed state 必须为 `Unknown`。

#### M3：托盘、窗口生命周期和自启

- 使用 Tauri 2 tray API 创建托盘和菜单；
- 托盘提供打开窗口、状态、上传、clear、设置和明确退出；
- 关闭主窗口只隐藏到托盘；
- 有未保存草稿时关闭窗口必须先确认；
- 只有托盘“退出”才停止 worker 和应用；
- 单实例再次启动时恢复已有窗口；
- 使用官方 autostart plugin；
- 只授予 `enable`、`disable` 和 `isEnabled` 权限；
- 普通启动显示窗口，login autostart 通过后台参数只显示托盘；
- 自启默认关闭，设置页显示实际 OS 注册状态。

#### M4：Dynamic UI 和手动场景闭环

- 展示 capability、`default` object、byte count、TTL、keep 和 lifecycle flags；
- 提供 Upload 和独立 Clear 操作；
- dynamic 在 static locked 状态下仍可使用；
- `CommittedLocally` 明确表示本次连接的本地观察结果，不伪装成 readback；
- TTL 倒计时标为估计；
- 实现场景创建、编辑、删除、保存、选择和手动激活；
- 主窗口和托盘使用同一个场景及 operation service；
- 场景文件带 schema version，采用临时文件加原子替换；
- 配置损坏时保留原文件并报告可恢复错误；
- 场景正文不进入 localStorage、日志、诊断、窗口标题或错误信息；
- UI 持续提示 dynamic 和场景存储只适合非 secret 内容。

#### M5：设备 alias

- 为当前活动设备建立用户配置 alias；
- 场景和 API 使用 alias，不暴露 serial 或 HID path；
- 场景不得保存进程内 opaque candidate ID；
- alias 对应多个候选设备时不得自动选择；
- 设备摘要变化后必须由用户重新确认绑定；
- 内部保持 `ConfiguredDevice[]` 和 `ActiveDeviceId?`，但首期不保持多个并行 HID session。

完成 M0 至 M5 后，首期手动闭环完成，并在进入 HTTP API 前设置一次明确验收点。

#### M6：本地 HTTP API

- 默认关闭，由用户主动启用；
- 只绑定 `127.0.0.1`，默认请求随机端口；
- runtime metadata 只记录 API version、host、port 和 PID，不记录 token；
- server 停止时删除 metadata，启动时清理属于已死亡进程的 stale metadata；
- token 第一次启用时生成，存入 OS 凭据库，并支持复制和轮换；
- 默认等待 final ACK 后返回成功；
- 调用方使用 `Prefer: respond-async` 时返回 `202` 和 `operation_id`；
- operation API 不返回 dynamic text；
- idempotency cache 保存 request digest，不保存正文，并设置 TTL 和容量上限；
- 限制 request body 大小，不记录 Authorization header 或正文；
- API 不得自动触发 static login。

#### M7：自动场景

第一版只实现前台应用 identifier/bundle ID、窗口标题、debounce、generation、manual override 和 external lease。仲裁顺序为：

```text
manual override > external lease > external request > built-in rule
```

浏览器 URL、Git branch、IDE project、插件系统、脚本执行引擎和云同步继续后置。

#### M8：多 dynamic object

只有 firmware 发布正式 capability/protocol 且 reference client 同步后才能实施。此前只保留 collection、`target_object`、复数 API path 和当前单 object 的 `default` alias，不猜测 object ID、数量或容量。

### 14.4 Pull request 拆分

| PR | 内容 | 依赖 |
|---|---|---|
| PR-01 | CI workflow、contract DTO、golden fixtures | 无 |
| PR-02 | Capability protocol/client | PR-01 |
| PR-03 | Dynamic upload、clear 和 retry | PR-02 |
| PR-04 | DynamicService、状态机和 generation | PR-03 |
| PR-05 | Tray 和 close-to-tray | PR-04 |
| PR-06 | Login autostart 和后台启动参数 | PR-05 |
| PR-07 | Dynamic UI | PR-04 |
| PR-08 | Scenario store 和编辑器 | PR-07 |
| PR-09 | Tray 场景菜单和手动完整闭环 | PR-06、PR-08 |
| PR-10 | Device alias 和单活动设备绑定 | PR-09 |
| PR-11 | HTTP lifecycle、token、health 和 runtime metadata | PR-10 |
| PR-12 | HTTP devices、status、upload 和 clear | PR-11 |
| PR-13 | Operations、idempotency 和调用示例 | PR-12 |
| PR-14 | 自动场景基础 | PR-13 |
| PR-15 | 跨平台人工验收和发布文档 | 对应交付阶段 |

每个 PR 只承担一个主要目标，不在同一 PR 中同时修改协议、托盘、UI 和 HTTP API。

### 14.5 CI-only 验证

当前机器不执行项目编译、测试或打包。所有代码 PR 通过 GitHub Actions 或对应平台 runner 执行：

```text
Frontend:
  npm ci
  npm run build

Rust:
  cargo fmt --check
  cargo test
  cargo clippy --all-targets -- -D warnings

Tauri:
  tauri build --no-bundle

Repository:
  git diff --check
  privacy/secret scan
```

平台相关要求：

- Linux、macOS 和 Windows 都执行 Rust tests 与 Tauri no-bundle build；
- tray、autostart、window lifecycle 变更必须等待三平台 runner；
- installer 和签名只在 release workflow 中执行；
- 真实 HID、tray、login autostart、拔插、睡眠恢复和安装后行为由对应平台人工验证；
- CI 通过不能替代真实硬件与桌面生命周期验收。

### 14.6 首期完成定义

M0 至 M5 同时满足以下条件时，首期“完整手动闭环”完成：

1. capability、upload、clear、strict retry 已实现；
2. UI 和托盘共用同一个 `DynamicService`；
3. 同时只维护一个 active device 和一个 HID writer；
4. 支持设备 alias；
5. 支持场景创建、编辑、删除、持久化和手动激活；
6. 支持从主窗口和托盘上传或 clear；
7. close-to-tray、明确退出和 login autostart 正常；
8. static slot/auth 无回归；
9. restart/reconnect 后状态为 `Unknown`；
10. Linux、macOS、Windows CI 通过；
11. 对应平台 tray/autostart 和真实 HID 人工验收完成；
12. 日志、诊断、DTO 和 artifacts 不包含真实设备标识、正文或凭据。

首期完成不要求 HTTP API、自动规则或多 dynamic object。
