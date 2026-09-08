# PixelOasis 在线生图网关架构设计 (Online Gateway Architecture)

本文档阐述 PixelOasis 在线生图网关（`model-gateway-online`）的系统架构、协议映射规范、异步任务流转与多模型调度机制。

---

## 1. 架构目标与定位

1. **保持 `/v2` 统一契约不变**：
   Photoshop UXP 插件基于标准 `/v2` 协议（`/v2/capabilities`、`/v2/jobs`、`/v2/artifacts`、`/v2/health`）与网关通信。无论是本地 ComfyUI 网关（8787）还是在线生图网关（8790），前端插件的代码路径与核心调度逻辑保持完全一致。
2. **异步生图任务编排**：
   上游在线生图接口采用标准的异步任务流程（提交生图任务返回 `task_id` -> 异步轮询任务状态 -> 任务完成后获取输出图片 URL）。网关负责维护异步轮询与工件落盘，对外呈现标准的 PixelOasis Job 状态机。
3. **多模型动态选择与可扩展性**：
   支持多种在线模型动态切换（如 `gpt-image-2`、`gpt-image-2-vip`、`nano-banana-2`、`nano-banana-2-lite`、`nano-banana-pro`），既支持全局默认配置切换，也支持单任务级别的模型指定。
4. **代码工程与厂商解耦 (Vendor-Agnostic)**：
   系统架构、环境变量、路由规范与 UI 组件不与特定厂商名称硬编码绑定，保持开放、通用与可替换性。
5. **凭据安全隔离**：
   在线生图 API Key 与鉴权信息仅由网关服务端进程在运行时持有，绝不透传给前端 Photoshop 插件或暴露在客户端存储中。

---

## 2. 系统拓扑与数据流

```text
┌────────────────────────────────────────────────────────┐
│               Photoshop UXP 插件面板                    │
│  - 模型选择下拉框 (gpt-image-2 / nano-banana-2 / ...)   │
│  - 选区与图层捕获 (RGB PNG + Alpha Mask)                │
│  - 提交任务: POST /v2/jobs                             │
│  - 状态轮询: GET /v2/jobs/{id}                         │
│  - 工件下载并回填: GET /v2/artifacts/{id}               │
└───────────────────────────▲────────────────────────────┘
                            │ (Local HTTP: 127.0.0.1:8790)
┌───────────────────────────▼────────────────────────────┐
│         PixelOasis 在线网关 (model-gateway-online)      │
│  - Capabilities 映射 (将 27 种能力统一映射为在线执行)   │
│  - Request 适配: 将图像编码为 Base64 Data URI           │
│  - 任务持久化与恢复: SQLite WAL (jobs & artifacts)     │
│  - 并发限流与超时熔断                                   │
└───────────────▲────────────────────────▲───────────────┘
                │                        │
  1. POST /draw/v1/images/generations    │ 2. 轮询 GET /v1/tasks/{task_id}
     (async: true, prompt, image: [...]) │    (SUCCESS -> 提取图片 URL)
                ▼                        ▼
┌────────────────────────────────────────────────────────┐
│                  上游在线异步生图服务                    │
│  - 任务调度队列                                         │
│  - GPU 图像生成 (支持多模型 gpt-image / nano-banana)    │
│  - 输出结果托管                                         │
└────────────────────────────────────────────────────────┘
```

---

## 3. 上游接口映射与工作流

### 3.1 任务创建：`POST /draw/v1/images/generations`

- **请求头**：
  - `Authorization: Bearer <PO_ONLINE_API_KEY>`
  - `Content-Type: application/json`
- **请求体设计**：
  ```json
  {
    "model": "nano-banana-2",
    "prompt": "提示词内容",
    "async": true,
    "size": "1:1",
    "imageSize": "1K",
    "image": [
      "data:image/png;base64,iVBORw0KGgo..."
    ]
  }
  ```
  - `model`: 任务指定或当前全局选定模型。
  - `prompt`: 插件传入的提示词，若图生图模式下提示词为空，网关自适应提供匹配动作的描述。
  - `async`: 设为 `true`，上游立即返回异步任务 ID。
  - `size`: 宽高比比例规格（`1:1`、`3:4`、`4:3`、`9:16`、`16:9`、`2:3`、`3:2`），由网关根据输入图像实际宽高比自动计算最接近的标准比例。
  - `imageSize`: 分辨率规格（`1K`、`2K` 等）。
  - `image`: 参考图 Base64 数组。当插件传入源图或蒙版合成图时编码为 Base64 传递。

- **响应格式**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "task_id": "task_fea46299c377404e85ad8d45c1478275"
    }
  }
  ```

### 3.2 任务状态轮询：`GET /v1/tasks/{task_id}`

- **请求头**：`Authorization: Bearer <PO_ONLINE_API_KEY>`
- **状态流转**：
  - `PENDING` / `RUNNING`：任务处于排队或计算中，网关继续休眠间隔后轮询。
  - `SUCCESS`：任务成功完成，从响应体中解析 `data.data` 获取生成的图片结果 URL 数组。
  - `FAILED`：任务失败，提取错误信息并抛出结构化异常，将本地任务置为 `failed`。

### 3.3 结果落盘与尺寸自适应

网关在接收到上游返回的图片 URL 后：
1. 下载图片二进制流。
2. 使用 `sharp` 库读取图片尺寸元数据。
3. 若存在原始 Photoshop 选区或目标尺寸，执行平滑缩放以完全对齐原始画布边界。
4. 写入网关本地工件缓存，提供 `/v2/artifacts/{id}` 访问端点。

---

## 4. 多模型选择体系

### 4.1 支持的模型矩阵

| 模型标识 | 说明 | 适用场景 |
|---|---|---|
| `nano-banana-2` | 默认通用高速模型 | 日常快速草图生成、风格迁移 |
| `nano-banana-2-lite` | 轻量加速模型 | 快速预览、低延迟生成 |
| `nano-banana-pro` | 专业级高精模型 | 高质感细节强化、复杂概念生成 |
| `gpt-image-2` | 通用标准生成模型 | 精准指令遵循、细节修饰 |
| `gpt-image-2-vip` | 旗舰级高算力模型 | 商业级精细画质生成 |

### 4.2 模型选择交互流

1. **网关动态查询与切换**：
   - `GET /v2/models`：获取当前生效模型及全部可用模型列表。
   - `POST /v2/models`：动态切换网关全局默认模型。
2. **设置面板控制**：
   - 插件设置抽屉提供“生图模型”下拉框，用户可直接在 UI 中切换全局默认模型。
3. **参数面板即时控制**：
   - 用户在参数面板点击“开始生成”前，可通过面板顶部的“生图模型”选项单独为当前任务指定模型。
   - 选中的模型随请求提交在 `payload.model` 中，优先级高于网关全局默认配置。

---

## 5. 核心模块与文件拓扑

```text
services/model-gateway-online/
├── src/
│   ├── config.js         # 统一配置（环境变量读取与默认模型清单）
│   ├── server.js         # HTTP 路由服务（/v2/capabilities, /v2/jobs, /v2/models 等）
│   ├── provider.js       # 上游协议封装（POST 任务提交、GET 任务轮询、尺寸比例匹配）
│   ├── capabilities.js   # 27 项能力定义映射表
│   ├── queue.js          # 异步队列与并发限流器
│   ├── storage.js        # SQLite 任务状态持久化
│   └── audit.js          # 审计指标收集
└── test/
    └── contract.mjs      # 自动化契约与多模型测试套件
```

---

## 6. 环境配置与运维

### 环境变量说明

```powershell
# 必选：在线接口鉴权凭证
$env:PO_ONLINE_API_KEY = "sk-..."

# 可选：默认模型（默认 nano-banana-2）
$env:PO_ONLINE_MODEL = "nano-banana-2"

# 可选：分辨率规格（默认 1K）
$env:PO_ONLINE_IMAGE_SIZE = "1K"

# 可选：网络服务监听端口（默认 8790）
$env:PO_ONLINE_PORT = "8790"
```

### 启动方式

```powershell
# 启动在线网关
node tools/start-online-gateway.mjs
```
