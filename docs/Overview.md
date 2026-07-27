# PixelOasis 项目总览

本文是 PixelOasis 项目的当前状态总览，涵盖项目定位、已有能力、关键链路、主要风险和后续方向。

---

## 1. 项目定位

PixelOasis 是一个 Photoshop UXP 插件，核心目标：

1. 从 Photoshop 读取用户选区。
2. 导出选区图像和遮罩。
3. 通过本地 model-gateway 调用 ComfyUI 执行 AI 生成。
4. 将生成结果作为新图层置回 Photoshop。

项目**仅通过 ComfyUI 进行 AI 生成**，不使用 Photoshop 原生 AI（Generative Fill / Adobe AI）。目前处于 Phase 1 可运行雏形阶段。

---

## 2. 目录结构

```text
pixeloasis-plugin/               ← Photoshop UXP 插件源码
  scripts/                       ← 业务逻辑模块（16 个 JS 文件）
  index.html / index.js          ← 面板入口与装配
  panel.css                      ← 面板样式
  manifest.json                  ← 插件清单

services/model-gateway/          ← 本地 Node.js 模型网关
  src/
    routes/                      ← HTTP 路由（config / health / workflows / generate）
    adapters/comfyui/            ← ComfyUI 适配器、策略引擎、工作流加载
    validation/                  ← 请求校验
    utils/                       ← 图片处理、日志、审计、错误处理
  models/                        ← 模型清单（models.manifest.yaml）
  workflows/comfyui/             ← ComfyUI API workflow 与 .meta.json 元数据

tools/                           ← 部署、下载、校验、启动脚本
PixelOasis/                      ← 单文件直接部署版输出（manifest v6）
docs/                            ← 项目文档
logs/                            ← 网关运行时日志
config.yaml                      ← 项目统一配置文件
```

---

## 3. 插件端现状

插件采用 UXP 多脚本结构，通过 `window.PO` 命名空间共享模块。`index.html` 中 `<script>` 标签顺序定义了运行时加载顺序。

| 模块 | 职责 |
|---|---|
| `ui-text.js` | 界面文案 |
| `state.js` | 全局状态、定时器、日志配置 |
| `logger.js` | JSONL 日志（自动过滤 base64 和 prompt 文本） |
| `ui-template.js` | HTML 模板构建 |
| `ui-workflows.js` | 工作流按钮注册表、采样器/调度器选项 |
| `gateway-client.js` | HTTP 客户端（/health、/generate、/workflows） |
| `photoshop.js` | 选区抓取、PNG/JPEG 编码 |
| `photoshop-place-layer.js` | 生成结果置入图层、蒙版重建 |
| `placement-engine.js` | 策略感知的图层回填 |
| `ui-parameters.js` | 参数页（构造/打开/保存/请求组装） |
| `actions.js` | 事件绑定 |
| `index.js` | DOM 装配、事件绑定、启动 |

前端注册的工作流按钮包括：局部修复、移除、扩图、超分放大、真实感增强、皮肤精修、光影调整、风格迁移。注意前端按钮数量多于后端实际可用的 ComfyUI 工作流——目前后端对同分类 workflow 做 fallback，长期需要严格对齐。

---

## 4. 网关端现状

网关是 Node.js ≥ 18 的 HTTP 服务，当前核心依赖为 `sharp`（图片处理）。

**HTTP API：**

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/config` | 返回非敏感配置摘要 |
| `GET` | `/health` | 健康检查；`?upstream=1` 探测 ComfyUI |
| `GET` | `/workflows` | 返回已注册工作流列表 |
| `POST` | `/generate` | 主生成端点 |

**适配器模式：** 通过 `PO_MODEL_PROVIDER` 切换后端。`echo` 返回原图（测试用），`comfyui` 执行真实生成（Phase 1 默认）。

**ComfyUI 适配器管线（11 步）：**
1. 解析 workflow variant（按优先级、启停状态、分类 fallback）
2. 校验模型（检查 ComfyUI `/object_info` 中的 loader 节点类型）
3. 应用 sizePolicy（计算内部尺寸、缩放、上下文扩边）
4. 应用 maskPolicy（扩张、模糊、反转遮罩）
5. 上传图片到 ComfyUI（`/upload/image`）
6. 注入参数到 API workflow JSON
7. 提交 prompt（`/prompt`）
8. 轮询等待完成（`/history/{prompt_id}`，每 1.5 秒，最长 10 分钟）
9. 下载输出图（`/view`），检测尺寸
10. 最终尺寸处理（裁切扩边、缩放到精确尺寸）
11. 返回标准化响应（含 placement 信息）

**工作流注册**是文件驱动的——扫描 `workflows/comfyui/` 下的 `*.meta.json`，加载对应 `*.api.json`。模型校验目前检查节点类型是否存在，尚未校验模型文件本身。

---

## 5. 当前 ComfyUI 工作流

### 已激活（Phase 1）

| workflowId | 说明 | 模型 |
|---|---|---|
| `composition.inpaint.pro` | 局部修复（VAEEncodeForInpaint，96px 上下文扩边） | SDXL base |
| `composition.remove.pro` | 物体移除（expandThenCrop） | SDXL base |
| `composition.remove.local` | 局部小缺陷移除 | SDXL base |
| `quality.realism.pro` | 真实感增强（img2img 低降噪） | SDXL base |

### 旧版（stage 0）

| workflowId | 说明 |
|---|---|
| `composition.inpaint.basic` | 基础局部修复 |
| `composition.remove.basic` | 基础物体移除 |
| `quality.upscale.basic` | img2img 细节增强（**非真正超分**——没有 UpscaleModelLoader / ImageUpscaleWithModel 节点，且网关会把输出缩回原选区尺寸） |

### 已知问题

- **`quality.upscale.basic` 不是真正的超分工作流。** 它是 `LoadImage → VAEEncode → KSampler(denoise=0.25) → VAEDecode → SaveImage`，没有放大节点。用户感知"和原图一样大"是符合当前实现的。
- **前端按钮多于后端工作流。** 扩图、皮肤精修、光影调整、风格迁移前端有按钮但后端无对应 workflow。

---

## 6. 完整生成链路

```text
用户点击工作流按钮
  → 插件 captureSelectionData()
    → imaging.getPixels() + imaging.getSelection()
    → 生成 imagePngBase64 / maskPngBase64
  → 打开参数页 → 用户点击"生成"
  → POST /generate { workflowId, selection, parameters, correlationId }
  → 网关校验请求
  → 解析 workflow variant
  → 应用 sizePolicy（缩放、扩边）
  → 应用 maskPolicy（扩张、模糊、反转）
  → 上传图片到 ComfyUI
  → 注入参数到 workflow JSON
  → POST /prompt → 轮询 /history → 下载输出
  → 裁切/缩放至最终尺寸
  → 返回 { imagePngBase64, width, height, placement }
  → 插件写临时 PNG → placeEvent 置入
  → 移动到选区位置 → 加载蒙版 → 创建图层蒙版
```

两端通过 `correlationId` 串联全部日志。

---

## 7. 日志体系

| 端 | 位置 | 格式 |
|---|---|---|
| 插件 | `<UXP data folder>/logs/` | `pixeloasis-plugin.jsonl` |
| 网关 | `services/model-gateway/logs/` | `gateway-YYYY-MM-DD.jsonl` |

特点：JSON Lines 格式、correlationId 串联、默认过滤 base64 图像数据、默认不记录完整 prompt 文本、支持轮转。

---

## 8. 策略引擎

每个工作流通过 `.meta.json` 声明三项策略（详见 [WorkflowSpec.md](WorkflowSpec.md)）：

| 策略 | 控制内容 |
|---|---|
| **sizePolicy** | 内部尺寸、最大边长限制、上下文扩边。模式：`selectionExact` / `expandThenCrop` / `upscaleMultiplier` |
| **maskPolicy** | 遮罩极性、扩张像素、模糊像素、边缘模式（soft/hard） |
| **placementPolicy** | 回填方式（智能对象/图层蒙版）、羽化、不透明度、混合模式 |

---

## 9. 主要风险与债务

### P0 — 超分 workflow 命名与实际能力不一致

`quality.upscale.basic` 没有真正 upscale 节点，应拆分为 `quality.enhance.basic`（原尺寸细节增强）和 `quality.upscale.2x/4x`（真正改变像素尺寸）。

### P0 — 尺寸策略缺少产品级定义

不同能力需要不同策略：局部修复需要选区扩边+裁回+边缘羽化，超分需要输出尺寸明确 2x/4x，扩图需要改变画布放置策略，真实感增强应保持原尺寸。

### P0 — 统一原始 mask 回填会破坏部分生成效果

当前所有有 mask 的结果都用原 mask 强制建立图层蒙版，会裁掉模型为自然过渡生成的边缘。应改为按 `placementPolicy` 声明处理。

### P1 — 后端协议过度绑定 selection + mask

请求校验当前要求每次都有 selection 和 mask。全图超分、全图降噪、参考图风格迁移不需要 mask。协议应支持多种输入类型。

### P1 — 模型校验不足

当前只检查 ComfyUI 节点类型，不验证模型文件确实存在。

### P1 — ComfyUI workflow 绑定可观测性不够

patch 后的 workflow 没有保存调试副本，排查"为什么没放大/尺寸变了/mask 不生效"困难。

### P1 — 前端按钮与后端 workflow 未严格同步

应建立统一 workflow registry API，由后端驱动前端按钮展示。

---

## 10. 部署能力覆盖

**已覆盖：** 插件单文件/多文件构建、manifest v5/v6 生成、CCX 打包、网关启动脚本。

**尚未覆盖：** Node.js 依赖自动安装、ComfyUI 自动检测/安装/启动、模型自动下载与校验、首次运行向导。

部署相关能力已覆盖插件构建和网关启动脚本，一键部署、模型自动下载等仍待后续设计。

---

## 11. 后续计划方向

1. 产品目标与用户画像
2. 功能分层：修图按钮、输入类型、输出策略
3. 模型与 ComfyUI workflow 调研
4. Workflow registry 规范升级
5. 尺寸/遮罩/placementPolicy 产品级设计
6. 日志与可观测性增强
7. 一键部署与模型下载方案
8. 插件 UI 改造路线
9. 测试矩阵
10. 里程碑拆分
