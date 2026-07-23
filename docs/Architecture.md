# PixelOasis 项目结构

本文档记录 PixelOasis 的完整项目结构、模块职责和数据流。

---

## 1. 完整目录树

```text
PixelOasis/
├── config.yaml                          ← 项目统一配置（ComfyUI、网关、模型、部署）
├── package.json                         ← 根 package（pixeloasis，依赖 yaml）
├── README.md
│
├── pixeloasis-plugin/                   ← Photoshop UXP 插件
│   ├── manifest.json                    ← 插件清单（v5 for UDT）
│   ├── index.html                       ← 面板入口 HTML（定义脚本加载顺序）
│   ├── index.js                         ← 启动装配（DOM、事件、初始化）
│   ├── panel.css                        ← 面板样式
│   ├── icons/                           ← 图标（icon.png, @1x, @2x）
│   ├── scripts/
│   │   ├── ui-text.js                   ← 界面文案
│   │   ├── state.js                     ← 全局状态 PO.state、定时器
│   │   ├── logger.js                    ← JSONL 日志（隐私过滤、轮转）
│   │   ├── ui-template.js               ← HTML 模板构建
│   │   ├── ui-workflows.js              ← 工作流按钮注册表、采样器选项
│   │   ├── vendor/
│   │   │   └── png-encoder.js           ← 纯 JS PNG 编码器
│   │   ├── gateway-client.js            ← HTTP 客户端（/health, /generate）
│   │   ├── photoshop.js                 ← 选区抓取、PNG/JPEG 编码
│   │   ├── photoshop-place-layer.js     ← 结果置入图层、蒙版重建
│   │   ├── placement-engine.js          ← 策略感知回填
│   │   ├── ui-status.js                 ← 状态栏更新
│   │   ├── ui-preview.js                ← 预览区更新
│   │   ├── ui-settings.js               ← 设置面板（网关地址、日志）
│   │   ├── ui-parameters.js             ← 参数页、请求组装
│   │   ├── actions.js                   ← 事件绑定
│   │   └── prepare-udt-dist.mjs         ← UDT 构建脚本
│   ├── dist/                            ← UDT 构建输出（多文件，manifest v5）
│   └── package.json
│
├── services/model-gateway/              ← 本地模型网关
│   ├── package.json                     ← 依赖 sharp、yaml
│   ├── src/
│   │   ├── server.js                    ← HTTP 服务入口、路由表
│   │   ├── config.js                    ← 配置合并（env > yaml > 默认值）
│   │   ├── config/
│   │   │   └── config-loader.js         ← config.yaml 加载器
│   │   ├── routes/
│   │   │   ├── config.js                ← GET /config
│   │   │   ├── health.js                ← GET /health（含 upstream 探测）
│   │   │   ├── workflows.js             ← GET /workflows
│   │   │   └── generate.js              ← POST /generate
│   │   ├── adapters/
│   │   │   ├── registry.js              ← 适配器注册（echo / comfyui）
│   │   │   ├── registry-instance.js     ← 工作流注册表单例
│   │   │   ├── echo/
│   │   │   │   └── adapter.js           ← Echo 适配器（返回原图，测试用）
│   │   │   └── comfyui/
│   │   │       ├── adapter.js           ← ComfyUI 适配器主逻辑（11 步管线）
│   │   │       ├── client.js            ← ComfyUI HTTP 客户端
│   │   │       ├── size-policy.js       ← 尺寸策略（缩放、扩边、裁切）
│   │   │       ├── mask-policy.js       ← 遮罩策略（扩张、模糊、反转）
│   │   │       ├── placement-policy.js  ← 回填策略
│   │   │       ├── workflow-loader.js   ← 工作流扫描与注册
│   │   │       ├── workflow-bindings.js ← 工作流参数注入
│   │   │       └── result-reader.js     ← 输出图下载与尺寸检测
│   │   ├── validation/
│   │   │   └── generate-request.js      ← /generate 请求体校验
│   │   └── utils/
│   │       ├── images.js                ← sharp 图片处理工具
│   │       ├── logger.js                ← JSONL 日志（隐私过滤、轮转）
│   │       ├── audit.js                 ← 请求级审计追踪
│   │       └── errors.js                ← 结构化错误响应
│   ├── models/
│   │   └── models.manifest.yaml         ← 模型清单（所有可用模型）
│   └── workflows/comfyui/               ← ComfyUI 工作流文件
│       ├── *.meta.json                  ← 工作流元数据（策略、模型清单）
│       └── *.api.json                   ← ComfyUI API workflow JSON
│
├── tools/                               ← 部署与运维脚本
│   ├── deploy-plugin.mjs                ← 插件单文件部署构建
│   ├── deploy.bat                       ← Windows 构建启动器
│   ├── start-gateway.mjs                ← 网关启动器
│   ├── start-gateway.bat                ← Windows 网关启动器
│   ├── download-models.mjs              ← 模型下载
│   ├── verify-models.mjs                ← 模型校验
│   ├── verify-env.mjs                   ← 环境验证
│   ├── migrate.bat                      ← 迁移脚本
│   └── lib/
│       ├── config.mjs                   ← config.yaml 读取
│       ├── download.mjs                 ← 下载工具
│       └── hash.mjs                     ← SHA-256 工具
│
├── PixelOasis/                          ← 单文件部署输出（由 deploy-plugin.mjs 生成）
│   ├── manifest.json                    ← v6 格式
│   ├── index.html                       ← 只加载 main.js
│   ├── main.js                          ← 捆绑后的单文件
│   ├── panel.css
│   └── icons/
│
├── logs/                                ← 网关运行时日志
└── docs/                                ← 项目文档
    ├── Overview.md                      ← 项目总览
    ├── Architecture.md                  ← 本文档
    ├── WorkflowSpec.md                  ← 工作流元数据规范
    └── Deployment.md                    ← 部署指南
```

---

## 2. 脚本加载顺序

`index.html` 中 `<script>` 标签顺序决定运行时加载顺序，每个模块通过 `window.PO` 命名空间通信：

```
 1. ui-text.js              → window.PO.TEXT
 2. state.js                → window.PO.state
 3. logger.js               → window.PO.Logger
 4. ui-template.js          → window.PO.buildTemplate
 5. ui-workflows.js         → window.PO.WORKFLOWS
 6. vendor/png-encoder.js   → window.PO.PngEncoder
 7. gateway-client.js       → window.PO.GatewayClient
 8. photoshop.js            → 选区抓取函数
 9. photoshop-place-layer.js → placeGeneratedLayer
10. placement-engine.js     → 策略感知回填
11. ui-status.js            → setStatus
12. ui-preview.js           → updatePreview
13. ui-settings.js          → 设置面板
14. ui-parameters.js        → 参数页、请求组装
15. actions.js              → 事件绑定
16. index.js                → 装配、启动
```

---

## 3. 插件层架构

### 3.1 选区抓取

`photoshop.js` 负责从 Photoshop 获取选区数据：

1. `getSelectionBounds()` — 获取选区边界
2. `captureSelectionData()` — 通过 `imaging.getPixels()` + `imaging.getSelection()` 获取像素
3. `padImageDataToBounds()` — 将实际返回数据补齐到请求的边界（防止尺寸漂移）
4. 通过 `PngEncoder` 编码为 PNG base64
5. 生成 JPEG 预览图

### 3.2 参数页

`ui-parameters.js` 负责：
- 根据 workflowId 获取默认参数（prompt、seed、steps、CFG、denoise、sampler、scheduler）
- 生成 correlationId（格式：`po-<timestamp>-<random>`）
- 组装 `/generate` 请求体
- 调用网关、处理响应、触发回填

### 3.3 图层回填

`photoshop-place-layer.js` + `placement-engine.js` 负责：

1. 将返回的 PNG base64 写入临时文件
2. Photoshop `placeEvent` 置入新图层
3. 移动图层到选区左上角
4. 根据 placement 信息选择性加载蒙版、创建图层组、创建智能对象
5. 应用羽化、不透明度、混合模式

---

## 4. 网关层架构

### 4.1 路由表

`server.js` 定义路由：

| 方法 | 路径 | 处理文件 | 用途 |
|---|---|---|---|
| `GET` | `/config` | `routes/config.js` | 返回配置摘要（网关地址、ComfyUI URL、调试开关） |
| `GET` | `/health` | `routes/health.js` | 健康检查，支持 `?upstream=1`（探测 ComfyUI system_stats）和 `?upstream=deep`（探测 object_info） |
| `GET` | `/workflows` | `routes/workflows.js` | 返回工作流列表（文件注册 + 硬编码 fallback） |
| `POST` | `/generate` | `routes/generate.js` | 生成端点：校验→解析适配器→执行→返回 |

### 4.2 适配器系统

```
resolveAdapter(provider)
  ├── "echo"    → adapters/echo/adapter.js       （返回原图）
  └── "comfyui" → adapters/comfyui/adapter.js    （完整 ComfyUI 管线）
```

### 4.3 策略引擎

三个策略模块处理每个工作流的输入/输出：

| 模块 | 输入 | 输出 |
|---|---|---|
| `size-policy.js` | 源图尺寸 + 选区 + sizePolicy 配置 | 内部处理尺寸、缩放后的图片 |
| `mask-policy.js` | 源遮罩 + maskPolicy 配置 | `maskForWorkflow` + `finalPlacementMask` |
| `placement-policy.js` | placementPolicy 配置 + 尺寸信息 | placement 摘要（供插件使用） |

### 4.4 配置加载

`config.js` 合并优先级：**环境变量 > config.yaml > 内置默认值**。

`config-loader.js` 从网关文件位置向上查找项目根目录的 `config.yaml`，解析 YAML，应用环境变量覆盖，规范化路径。

### 4.5 日志与审计

- **`utils/logger.js`**：JSON Lines 格式，自动过滤 base64 图像数据和 prompt 文本（可配置），支持文件大小轮转（保留 10 个）。
- **`utils/audit.js`**：每请求审计追踪，记录变体解析、图片 SHA-256、策略决策、上传验证、workflow patch、prompt 提交、历史状态、输出尺寸。可保存调试图片。

---

## 5. 数据流（端到端）

```text
[Photoshop 选区]
  │ imaging.getPixels() + imaging.getSelection()
  │ PngEncoder.encode()
  ▼
[imagePngBase64 + maskPngBase64 + correlationId]
  │ POST /generate
  ▼
[网关：validateGenerateRequest()]
  │ 校验 workflowId、selection、parameters
  ▼
[网关：resolveAdapter("comfyui")]
  │ resolveVariant(workflowId) → 最高优先级已启用变体
  │ validateModels() → ComfyUI /object_info
  ▼
[网关：applySizePolicy()]
  │ 计算内部尺寸、缩放源图、上下文扩边
  ▼
[网关：applyMaskPolicy()]
  │ grow(扩张) → blur(模糊) → invert(反转，若配置)
  ▼
[网关：上传图片]
  │ POST /upload/image (source)
  │ POST /upload/image (mask)
  ▼
[网关：patchWorkflow()]
  │ 深拷贝 API workflow JSON → 注入文件名和参数
  ▼
[ComfyUI：POST /prompt]
  │ 提交生成任务
  ▼
[ComfyUI：轮询 GET /history/{prompt_id}]
  │ 每 1500ms，最长 10 分钟
  ▼
[ComfyUI：GET /view]
  │ 下载输出图 + 检测尺寸（PNG IHDR）
  ▼
[网关：最终处理]
  │ cropToBounds() for expandThenCrop
  │ resizeToExact() 对齐目标尺寸
  │ 构建 placement 摘要
  ▼
[{ imagePngBase64, width, height, placement }]
  │ HTTP 响应
  ▼
[插件：写入临时 PNG]
  │ placeEvent 置入 Photoshop
  │ 移动到选区左上角
  │ maskSource === "finalSoftMask" → 加载最终柔化蒙版
  │ 创建图层蒙版 / 智能对象 / 图层组
  ▼
[Photoshop 新图层]
```

---

## 6. 构建系统

### 6.1 UDT 开发模式

```bash
cd pixeloasis-plugin
npm run build
```

输出 `dist/` 目录（多文件，manifest v5），通过 UXP Developer Tool 加载。

### 6.2 直接部署模式

```bash
node tools/deploy-plugin.mjs
```

输出 `PixelOasis/` 目录（单文件 main.js，manifest v6），可直接放入 Photoshop Plug-ins 目录。

### 6.3 CCX 打包

将 `PixelOasis/` 目录压缩为 ZIP，改扩展名为 `.ccx`。

---

## 7. 关键技术决策

1. **所有 AI 走 ComfyUI**，不依赖 Photoshop 原生 AI——保持独立性和模型可控。
2. **策略声明式**——每个 workflow 在 `.meta.json` 中声明 size/mask/placement policy，网关按声明执行，不硬编码。
3. **文件驱动注册**——新增 workflow 只需放入 `.meta.json` + `.api.json`，无需改代码。
4. **correlationId 跨层追踪**——一次生成的 ID 贯穿插件日志、网关日志、ComfyUI prompt 元数据。
5. **隐私优先日志**——base64 图像数据永不记录，prompt 文本默认脱敏。
