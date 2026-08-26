# 在线模型网关架构方案

## 1. 目标

`services/model-gateway-online/` 在不改变 Photoshop 插件任务协议的前提下，将本地 ComfyUI 运算替换为 feifeimiao 的 OpenAI-compatible `gpt-image-2` 图片编辑调用。

文档确认的上游接口为：

- Base URL：`https://api.feifeimiao.top/v1`
- 鉴权：`Authorization: Bearer <API Key>`
- 图片生成：`POST /images/generations`
- 图片编辑：`POST /images/edits`
- 余额查询：`GET /usage`
- 图片模型：`gpt-image-2`

PixelOasis 的所有任务都包含 Photoshop 捕获源图，因此在线网关统一使用图片编辑接口；选择蒙版存在时一并上传，以保留局部编辑语义。

## 2. 信任边界

```text
Photoshop UXP plugin
  │ PixelOasis /v2 contract (no provider key)
  ▼
localhost:8790 model-gateway-online
  │ Bearer API Key + source/mask image
  ▼
api.feifeimiao.top/v1/images/edits
```

API Key 只存在于在线网关进程的 `FEIFEIMIAO_API_KEY` 环境变量中。插件、浏览器存储、任务负载、日志和 Photoshop 图层元数据均不保存 API Key。

## 3. 兼容层

在线网关实现插件已经使用的接口：

| 接口 | 兼容行为 |
|---|---|
| `GET /v2/health` | 网关模式、模型、上游配置和余额状态 |
| `GET /v2/capabilities` | 复用本地网关的 27 个 capability 定义 |
| `POST /v2/assets` | 源图、编辑蒙版、主体蒙版上传 |
| `HEAD /v2/assets/{id}` | 素材有效性检查 |
| `POST /v2/jobs` | 幂等创建异步在线生图任务 |
| `GET /v2/jobs[/{id}]` | 列表、恢复和轮询 |
| `GET /v2/jobs/{id}/events` | SSE 状态与完成事件 |
| `DELETE /v2/jobs/{id}` | 取消结果落盘与回填 |
| `GET /v2/artifacts/{id}` | PNG 下载、长度与 SHA-256 校验 |
| `POST /v2/jobs/{id}/client-events` | 下载和回填确认事件 |
| `GET /v2/usage` | 上游余额和额度查询代理 |

插件端仍执行原有的捕获、预检、参数表单、任务面板、下载校验、智能对象创建、图层命名和放置流程。

## 4. Capability 到在线提示词

在线网关读取 `services/model-gateway/capabilities/**/*.capability.json`，保留输入要求、参数 schema、敏感操作确认、分组和 UI 顺序。执行时将以下信息组合成受控编辑提示：

1. capability 中文标题和描述；
2. 用户在参数表单中选择的合法参数；
3. 保身份、构图、透视、文字、Logo 和非编辑区域的通用约束；
4. 自然融合边缘、光照、色彩、颗粒和景深的质量约束。

输出统一为一张完成图，并按 Photoshop 捕获边界精确缩放。多层效果的 UI 和回填协议仍兼容，但单次 GPT Image 调用只返回一个合成结果层；这是上游图片接口与 ComfyUI 多节点多输出之间的能力差异。

## 5. 尺寸策略

上游请求按宽高比选择：

- 横图：`1536x1024`
- 竖图：`1024x1536`
- 方图：`1024x1024`

返回图片通过 Lanczos 重采样到 `source.bounds` 的精确宽高，确保插件回填时像素网格与原捕获区域一致。

## 6. 状态和错误映射

任务状态保持 `queued → preparing → running → postprocessing → succeeded`。上游错误转换为稳定代码：

- `401` → `ONLINE_AUTH_INVALID`
- `429` → `ONLINE_QUOTA_EXCEEDED`
- 其他上游错误 → `ONLINE_PROVIDER_ERROR`
- 未配置 Key → `ONLINE_AUTH_MISSING`
- 无图片结果 → `ONLINE_RESULT_MISSING`

插件已为这些错误提供中文信息和建议动作。

## 7. 运行和演进

开发启动：

```powershell
$env:FEIFEIMIAO_API_KEY = "sk-..."
npm install --prefix services/model-gateway-online
npm run start:online
```

插件设置中选择“在线 GPT Image”，目标自动切换为 `http://127.0.0.1:8790`。

当前任务元数据保存在进程内，图片与 artifact 保存在 `.pixeloasis/online-data/`。生产化下一阶段应把任务元数据迁移到 SQLite、增加启动恢复、上游并发队列、请求成本审计和加密凭据存储；这些扩展不会改变插件 `/v2` 契约。
