# PixelOasis 在线生图网关 (Online Model Gateway)

本服务完全保持 PixelOasis 的 `/v2` 插件契约（能力发现、任务轮询、工件回填），将本地 ComfyUI 执行平滑代理至兼容的在线异步生图与图像编辑接口。

## 特性

- **完整兼容 /v2 契约**：兼容能力发现 (`/v2/capabilities`)、任务排队与状态查询 (`/v2/jobs`)、工件下载 (`/v2/artifacts`) 及运行审计 (`/v2/audit`)。
- **异步生图任务工作流**：
  - 向上游发起异步绘图请求 (`POST /draw/v1/images/generations`，支持尺寸规格、Base64 参考图、提示词等)。
  - 获取异步任务标识后自动轮询 (`GET /v1/tasks/{task_id}`)。
  - 任务完成提取输出图片并自适应缩放至 Photoshop 选区或目标尺寸，保存为本地工件回填。
- **多模型动态选择**：
  - 支持 5 款主流在线模型：`gpt-image-2`、`gpt-image-2-vip`、`nano-banana-2`、`nano-banana-2-lite`、`nano-banana-pro`。
  - 支持网关级默认配置与任务级独立指定 (`payload.model` / `payload.options.model`)。
  - 动态模型切换接口：`GET /v2/models`、`POST /v2/models`。
- **安全隔离**：API Key 与上游凭据仅保留在网关服务进程中，永不暴露给 Photoshop 前端插件。
- **轻量与可靠性**：支持并发控制、任务超时熔断与取消、SQLite 状态恢复。

## 启动

### 环境变量

| 变量名 | 描述 | 默认值 |
|---|---|---|
| `PO_ONLINE_API_KEY` | 在线服务 API Key（必填） | - |
| `PO_ONLINE_BASE_URL` | 在线服务基地址（必填，如 `https://<upstream-host>`） | - |
| `PO_ONLINE_MODEL` | 默认生图模型 | `nano-banana-2` |
| `PO_ONLINE_IMAGE_SIZE` | 默认分辨率规格 | `1K` |
| `PO_ONLINE_DRAW_URL` | 生图接口地址（可选，默认 `${PO_ONLINE_BASE_URL}/draw`） | - |
| `PO_ONLINE_TASKS_URL` | 任务轮询地址（可选，默认 `${PO_ONLINE_BASE_URL}`） | - |
| `PO_ONLINE_PORT` | 网关监听端口 | `8790` |
| `PO_ONLINE_HOST` | 网关监听主机 | `127.0.0.1` |
| `PO_ONLINE_CONCURRENCY` | 最大上游并发任务数 | `2` |

### 快速启动

```powershell
# 设置在线服务基地址与 API Key
$env:PO_ONLINE_BASE_URL = "https://<upstream-host>"
$env:PO_ONLINE_API_KEY = "sk-..."

# 启动服务
cd services/model-gateway-online
npm install
npm start
```

或使用项目根目录运维脚本：

```powershell
$env:PO_ONLINE_API_KEY = "sk-..."
node tools/start-online-gateway.mjs
```

服务启动后默认监听 `http://127.0.0.1:8790`。在 PixelOasis 插件设置面板中将运算后端切换为“在线生图”即可。
