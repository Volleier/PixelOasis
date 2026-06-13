# PixelOasis 部署指南

本文档描述 PixelOasis 插件的构建、打包和安装部署流程。

---

## 1. 项目结构

```
pixeloasis-plugin/                  ← 插件源码目录
├── manifest.json                   ← 插件清单（构建时拷贝到 dist）
├── index.html                      ← 面板入口 HTML
├── index.js                        ← 启动装配脚本
├── panel.css                       ← 面板样式
├── icons/                          ← 图标资源
│   ├── icon.png
│   ├── icon@1x.png                  (32×32)
│   └── icon@2x.png                  (64×64)
├── scripts/                        ← 业务逻辑模块
│   ├── ui-text.js                  ← 界面文案
│   ├── state.js                    ← 全局状态
│   ├── ui-template.js              ← HTML 模板构建
│   ├── ui-workflows.js             ← 工作流注册表
│   ├── gateway-client.js           ← HTTP 网关客户端
│   ├── photoshop.js                ← Photoshop API 封装
│   ├── photoshop-place-layer.js    ← 生成结果置入图层
│   ├── ui-status.js                ← 状态栏更新
│   ├── ui-preview.js               ← 预览区更新
│   ├── ui-settings.js              ← 设置面板
│   ├── ui-parameters.js            ← 参数页（构造 / 打开 / 保存 / 请求组装）
│   ├── actions.js                  ← 事件绑定
│   ├── prepare-udt-dist.mjs        ← 构建脚本（见 §2）
│   └── vendor/
│       └── png-encoder.js          ← 纯 JS PNG 编码器
├── dist/                           ← 构建输出（经典 UXP 多文件结构）
└── package.json
```

根目录还包含部署构建入口：

```
prepare-deploy-plugin.mjs           ← 直接部署版生成脚本
build-deploy-plugin.bat             ← Windows 一键生成脚本
com.pixeloasis.plugin/              ← 直接部署版输出目录
```

### 1.1 关键依赖关系（加载顺序）

`index.html` 中 `<script>` 标签的顺序定义了运行时加载顺序：

```
1. ui-text.js           → window.PO.TEXT
2. state.js             → window.PO.state, clearTransientTimer, 日志配置
3. logger.js            → window.PO.Logger (debug/info/warn/error, clearLogs, getLogPath)
4. ui-template.js       → window.PO.buildTemplate / buildSections
5. ui-workflows.js      → window.PO.WORKFLOWS, SAMPLER_OPTIONS, SCHEDULER_OPTIONS
6. vendor/png-encoder.js → window.PO.PngEncoder
7. gateway-client.js    → window.PO.GatewayClient
8. photoshop.js         → normalizeNumber, getSelectionBounds, captureSelectionData, 编码函数
9. photoshop-place-layer.js → placeGeneratedLayer
10. ui-status.js         → setStatus, showTransientStatus, refreshSelectionStatus
11. ui-preview.js       → updatePreview
12. ui-settings.js      → toggleSettings, initSettings (含日志设置)
13. ui-parameters.js    → buildParameterPage, open/close/save, assembleGenerateRequest
14. actions.js          → captureAndPreview, handleWorkflowButton, bindEvents
15. index.js            → 装配 DOM、绑定事件、启动
```

每个模块以 `window.PO = window.PO || {};` 开头，通过 `window.PO` 命名空间通信。

---

## 2. 构建控制

### 2.1 经典多文件构建 (UDT 开发模式)

```bash
cd pixeloasis-plugin
npm run build
```

执行 `scripts/prepare-udt-dist.mjs`，流程：

1. 清空 `dist/` 目录
2. 从根目录拷贝 `index.html`、`index.js`、`panel.css`、`manifest.json` 到 `dist/`
3. 拷贝 `icons/` 到 `dist/icons/`
4. 分别拷贝 `scripts/*.js` → `dist/scripts/`
5. 拷贝 `scripts/vendor/*.js` → `dist/scripts/vendor/`
6. 修正 `dist/manifest.json` 中的 `main` 字段为 `"index.html"`

输出结构：

```
dist/
├── manifest.json
├── index.html
├── index.js
├── panel.css
├── icons/
│   ├── icon.png
│   ├── icon@1x.png
│   └── icon@2x.png
└── scripts/
    ├── actions.js
    ├── gateway-client.js
    ├── photoshop.js
    ├── photoshop-place-layer.js
    ├── state.js
    ├── ui-parameters.js
    ├── ui-preview.js
    ├── ui-settings.js
    ├── ui-status.js
    ├── ui-template.js
    ├── ui-text.js
    ├── ui-workflows.js
    └── vendor/
        └── png-encoder.js
```

此结构用于 **UXP Developer Tool** 加载（Add Plugin → 选择 `dist/`）。

### 2.2 单文件捆绑构建（直接部署模式）

适用于 `PluginsStorage\External` 或 Photoshop `Plug-ins` 目录直接部署。

Windows 一键生成：

```bat
build-deploy-plugin.bat
```

或在项目根目录手动执行：

```bash
node prepare-deploy-plugin.mjs
```

该脚本会：

1. 清空并重建根目录 `com.pixeloasis.plugin/`
2. 按 §1.1 的加载顺序捆绑所有 JS 到 `main.js`
3. 生成只引用 `main.js` 的部署版 `index.html`
4. 生成 v6 格式 `manifest.json`
5. 拷贝 `panel.css` 和 `icons/`

输出结构：

```
com.pixeloasis.plugin/
├── manifest.json        ← v6 格式
├── index.html           ← 只加载 main.js
├── main.js              ← 捆绑后的单文件
├── panel.css
└── icons/
    ├── icon.png
    ├── icon@1x.png
    └── icon@2x.png
```

两种构建模式的核心差异：

| 项目                | 多文件 (UDT)                          | 单文件 (直接部署)                                         |
| ------------------- | ------------------------------------- | --------------------------------------------------------- |
| manifestVersion     | 5                                     | **6**                                                     |
| host 格式           | `[{...}]` 数组                        | **`{...}` 对象**                                          |
| requiredPermissions | 无                                    | **network / localFileSystem / clipboard / webview / ipc** |
| JS 文件数           | 14 个独立文件                         | **单个 main.js**                                          |
| 加载 URL            | `<script src="./scripts/xxx.js">` × N | `<script src="./main.js">` × 1                            |
| 适用场景            | UXP Developer Tool 开发               | 目录直接部署 / CCX 打包                                   |

### 2.3 CCX 成品打包

```bash
# 将单文件构建输出打包为 .ccx（实质是 ZIP）
cd com.pixeloasis.plugin
powershell -Command "Compress-Archive -Path '*' -DestinationPath '../PixelOasis-v0.1.0.zip' -Force"
ren ..\PixelOasis-v0.1.0.zip PixelOasis-v0.1.0.ccx
```

---

## 3. 部署目标目录

### 3.1 Photoshop UXP 目录结构

```
%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<version>\
├── External\                       ← 用户外部插件（可直接放置）
│   └── com.pixeloasis.plugin\      ← 插件目录（以 plugin id 命名）
│       ├── manifest.json
│       ├── index.html
│       ├── main.js
│       ├── panel.css
│       └── icons/
├── Internal\                       ← Adobe 内置插件
└── Shared\                         ← 共享数据
```

其中 `<version>` 对应 Photoshop 内部版本号：

| Photoshop 版本 | PHSP 版本号 |
| -------------- | ----------- |
| 2022 (v23.x)   | 22          |
| 2023 (v24.x)   | 26          |
| 2024 (v25.x)   | 27          |
| 2025 (v26.x)   | 28          |

**目标路径示例：**

```
D:\Adobe\Adobe Photoshop 2026\Plug-ins
```

### 3.2 手动安装步骤

1. **停止 Photoshop**
2. 将根目录下的 `com.pixeloasis.plugin` 复制到 `\Adobe\Adobe Photoshop 2026\Plug-ins`
3. **重启 Photoshop**
4. 检查 `插件` 菜单 → **PixelOasis** 面板

> ⚠️ Photoshop 仅在启动时扫描 `External` 目录，热重载需使用 UXP Developer Tool。

### 3.3 UDT 安装（开发模式）

1. 打开 UXP Developer Tool
2. **Add Plugin** → 选择 `pixeloasis-plugin/dist/`（多文件结构或单文件结构均可）
3. **Load**
4. 插件即时出现在 Photoshop 中，无需重启

---

## 4. 版本兼容性

| manifestVersion | host 格式         | 最低 PS 版本 | 说明                              |
| --------------- | ----------------- | ------------ | --------------------------------- |
| 5 (旧)          | `"host": [{...}]` | 25.0.0       | 仅 UDT 加载                       |
| 6 (新)          | `"host": {...}`   | 23.0.0       | 支持 External 目录部署 + UDT 加载 |

### 4.1 权限说明

manifest v6 中的 `requiredPermissions` 块：

```json
"requiredPermissions": {
  "localFileSystem": "fullAccess",   // 临时 PNG 文件读写（placeGeneratedLayer）
  "launchProcess": {                 // 外部进程调用
    "schemes": ["https", "http", "file", "ws"],
    "extensions": [".png", ".jpg", ".jpeg"]
  },
  "network": {                       // 网关 HTTP 请求
    "domains": "all"
  },
  "clipboard": "readAndWrite",       // 剪贴板访问
  "webview": {                       // WebView 支持
    "allow": "yes",
    "domains": "all",
    "enableMessageBridge": "localAndRemote"
  },
  "ipc": {                           // 插件间通信
    "enablePluginCommunication": true
  },
  "allowCodeGenerationFromStrings": true
}
```

如果后续功能不需要某类权限，可从 manifest 中移除对应的块以收紧安全策略。

---

## 5. 故障排查

| 现象                | 可能原因                      | 解决                                                                        |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| 插件不出现在菜单中  | PS 未重启                     | 完全退出并重启 Photoshop                                                    |
| 插件出现但面板空白  | JS 捆绑顺序错误               | 检查 main.js 是否按 §1.1 顺序拼接                                           |
| 网关不可达          | network 权限缺失 / 网关未启动 | 检查 manifest 含 `"network": {"domains": "all"}`，确认 model-gateway 已运行 |
| 生成失败 / 置入失败 | localFileSystem 权限缺失      | 检查 manifest 含 `"localFileSystem": "fullAccess"`                          |
| PS 版本不兼容       | minVersion 过高               | manifest v6 格式中 `host.minVersion` 设为 `"23.0.0"` 可兼容 PS 2022+        |
| 日志未生成          | 日志级别过高或配置关闭        | 检查设置面板中日志开关和级别                                                |

---

## 6. 分层日志架构

### 6.1 设计原则

- **插件端日志**记录 Photoshop/UXP 行为（选区抓取、请求组装、网关调用、结果置入、UI 状态）
- **网关端日志**记录模型调用和 ComfyUI 交互（HTTP 请求、验证、工作流解析、上传、生成、下载）
- **两端通过同一个 `correlationId` 串联**，形成完整请求链路
- **绝不写入日志的数据**：imagePngBase64 / maskPngBase64 / previewJpegBase64 / 完整 PNG bytes / 完整 ComfyUI workflow JSON
- **Prompt 隐私保护**：默认只记录 prompt 长度，不记录文本内容（可通过配置开启）

### 6.2 日志文件位置

| 端   | 路径                                                 | 文件名                          |
| ---- | ---------------------------------------------------- | ------------------------------- |
| 插件 | `<UXP data folder>/logs/`                            | `pixeloasis-plugin.jsonl`       |
| 网关 | `services/model-gateway/logs/`                       | `gateway-YYYY-MM-DD.jsonl`      |

### 6.3 日志格式（JSON Lines）

每行一条 JSON，便于搜索、归档、自动分析：

```json
{
  "ts": "2026-06-11T12:30:00.000Z",
  "level": "info",
  "source": "plugin",
  "component": "capture",
  "event": "capture.completed",
  "correlationId": "po-lx9abc123-k5",
  "workflowId": "composition.inpaint.basic",
  "durationMs": 120,
  "message": "Selection captured",
  "data": {
    "width": 512,
    "height": 512,
    "hasMask": true
  }
}
```

### 6.4 correlationId 流转

每次点击"生成"时，插件生成一个 `correlationId`（格式：`po-<timestamp>-<random>`），该 ID 贯穿：

```
插件日志
  → POST /generate 请求体 (correlationId 字段)
    → 网关日志 (所有相关事件)
      → ComfyUI promptId metadata
        → 返回给插件的 result.metadata
          → Photoshop 图层名
```

排错时搜索同一个 `correlationId` 即可看到完整链路。

### 6.5 日志事件一览

**插件端：**

```
plugin.started              — 插件启动
plugin.initialization_failed — 初始化失败
workflow.clicked            — 点击工作流按钮
capture.started             — 开始抓取选区
capture.completed           — 选区抓取完成
capture.failed              — 选区抓取失败
selection.detected          — 检测到选区 bounds
request.assembled           — 请求体组装完成
gateway.health.completed    — 网关健康检查完成
gateway.health.failed       — 网关健康检查失败
gateway.generate.started    — 向网关发送请求
gateway.generate.completed  — 网关返回成功
gateway.generate.failed     — 网关请求失败
generation.started          — 用户点击生成按钮
generation.completed        — 生成+置入完成
generation.failed           — 生成失败
placement.started           — 开始置入图层
placement.completed         — 图层置入完成
placement.failed            — 图层置入失败
log.cleared                 — 日志已清空
```

**网关端：**

```
gateway.started               — 网关进程启动
request.received              — 收到生成请求
request.invalid               — 请求验证失败
response.succeeded            — 生成成功返回
response.failed               — 生成失败返回
workflow.resolved             — 工作流解析完成
workflow.loaded               — 工作流注册表加载
workflow.load_warnings        — 工作流加载警告
comfyui.health.up             — ComfyUI 可达
comfyui.health.down           — ComfyUI 不可达
comfyui.upload.source.completed — 源图上传完成
comfyui.upload.mask.completed   — 蒙版上传完成
comfyui.prompt.submitted      — Prompt 已提交
comfyui.generation.completed  — 生成完成
comfyui.output.downloaded     — 输出下载完成
request.completed             — HTTP 请求处理完成
request.not_found             — 路由未匹配
request.handler_error         — 请求处理器异常
```

### 6.6 插件端配置（设置面板）

设置面板提供以下日志控件：

| 控件         | 功能                         |
| ------------ | ---------------------------- |
| 日志开关     | 开启/关闭日志写入（默认开启）|
| 日志级别     | debug / info / warn / error  |
| 日志路径     | 显示当前日志文件所在目录     |
| 清空日志     | 删除所有日志文件并重新创建   |

配置存储在 `window.PO.state.logging` 中：

```js
logging: {
  enabled: true,           // 主开关
  level: "info",          // debug | info | warn | error
  maxFileBytes: 1048576,  // 单文件最大字节（超过自动轮转）
  retainFiles: 5,         // 保留的轮转文件数
  logPromptText: false,   // 设为 true 可记录完整 prompt 文本（调试用）
}
```

### 6.7 网关端配置（环境变量）

```bash
PO_LOG_ENABLED=1        # 默认开启，设为 0 关闭
PO_LOG_LEVEL=info       # debug | info | warn | error
PO_LOG_DIR=logs         # 日志目录（相对于网关进程 cwd）
PO_LOG_PROMPT_TEXT=0    # 设为 1 记录完整 prompt 文本
```

### 6.8 日志轮转

| 端   | 触发条件                     | 策略                                            |
| ---- | ---------------------------- | ----------------------------------------------- |
| 插件 | 单文件超过 `maxFileBytes`    | 重命名当前文件为 `.1.jsonl`，创建新文件，保留 5 个 |
| 网关 | 单文件超过 `maxFileBytes`    | 按时间戳重命名，保留 10 个，按日期分文件          |

### 6.9 数据隐私

以下字段**默认被滤除**，不写入日志：

- `imagePngBase64`、`maskPngBase64`、`previewJpegBase64`
- `imageBase64`、`base64`、`pngBytes`、`pixelData`、`rawData`
- `imageData`、`imageBuffer`
- 完整 ComfyUI workflow JSON

被滤除的字段替换为 `"[redacted, length=N]"`。

`prompt` / `negativePrompt` 默认替换为 `promptLength: N`，除非 `logPromptText: true`。
