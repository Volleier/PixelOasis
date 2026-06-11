# PixelOasis DevList（中文）

本文档定义了 PixelOasis 从当前经典 UXP 壳到首个可接受的端到端 AI 生成工作流的完整开发路径：

1. 用户在 Photoshop 中选择一个区域
2. 插件正确抓取选中区域的图像和蒙版
3. 插件将请求发送到本地网关
4. 网关将请求适配到官方 ComfyUI
5. ComfyUI 生成图像
6. 插件将返回的图像作为顶层图层置入
7. 插件重建与原始选区对齐的蒙版

项目必须遵循 `docs/dev-guide.md`。

## 0. 已确认的项目决策

以下决策已确认，除非用户后续明确更改，否则应视为默认：

- ComfyUI 在本地运行。
- 使用官方推荐的 ComfyUI 本地部署方式。
- 首个可接受的工作流是 `composition.inpaint.basic`。
- 首个版本优先保证输出质量而非速度。
- 输出必须始终匹配原始 Photoshop 选区尺寸。
- 每次只生成一张图像。首个版本不要设计批量生成。
- 设置按工作流保存，而不仅仅是全局保存。
- 本地图像到图像 / 后期编辑的主要模型路线是 `FLUX.1 Kontext Dev`。
- 如果本地硬件、模型可用性或 ComfyUI 版本阻碍 `FLUX.1 Kontext Dev`，则回退模型路线为 `SDXL Inpaint`。

模型选择理由：

- `FLUX.1 Kontext Dev` 是本地高质量图像编辑的首选路线，因为它专为图像输入加文本引导编辑而设计，且在 ComfyUI 文档中作为原生本地工作流记录。
- `SDXL Inpaint` 作为回退方案，因为蒙版修复技术成熟、可预测，在需要严格的选区尺寸输出时更容易验证。
- 首个里程碑应以模型无关的方式实现网关和插件，使在 `FLUX.1 Kontext Dev` 和 `SDXL Inpaint` 之间切换时不需改动 Photoshop 端代码。

## 1. 核心方向

使用以下架构：

```text
Photoshop UXP 插件
  -> 本地 PixelOasis model-gateway
    -> 官方 ComfyUI HTTP/WebSocket API
      -> 生成的 PNG 结果
    -> 标准化的 PixelOasis 响应
  -> Photoshop 图层置入 + 蒙版重建
```

推荐的 ComfyUI 访问方式：

- 插件不应直接与 ComfyUI 通信。
- 插件应调用一个稳定的本地端点，例如 `POST http://127.0.0.1:8787/generate`。
- 本地网关负责 ComfyUI 工作流转换、模型选择、文件上传、队列轮询、进度追踪和结果获取。
- ComfyUI 应保持官方原版，不做修改。首个可接受的工作流不要求自定义 ComfyUI 节点。
- ComfyUI 端点取决于本地发行方式：当前机器上的 ComfyUI Desktop 为 `http://127.0.0.1:8000`，手动版 / portable 版 ComfyUI 常见为 `http://127.0.0.1:8188`。
- 默认 PixelOasis 网关端点为 `http://127.0.0.1:8787`。

理由：

- Photoshop UXP 应专注于 Photoshop 状态和 UI。
- ComfyUI 工作流 JSON 和节点 ID 是不稳定的实现细节，不应泄露到面板。
- 网关可以比 UXP 面板更可靠地验证模型、上传文件、轮询生成状态和标准化错误。

## 2. 不可妥协的工程规则

- 将 Photoshop 插件保持在 `pixeloasis-plugin` 目录。
- 保持经典 UXP 壳稳定，直到完整的 AI 返回图层流程正常工作。
- 在端到端 Photoshop 工作流已验证之前，不要重新引入 React、Vite、Bolt UXP 或 Spectrum Web Components。
- UI 样式要贴合 Photoshop 2024+ 原生面板：平面暗色中性表面、克制的边框、无光泽渐变、无装饰性布局。
- 不要以 `npm run build` 作为运行时验证。始终在 Photoshop 中通过 UXP Developer Tool 验证。
- 不要将 JPEG 用于正式工作流图像或正式工作流蒙版。
- JPEG 仅允许用于 UI 预览，且必须在透明像素已合成到不透明底色之后。
- 当选中区域包含透明度时，正式图像必须保留 alpha 通道。
- 正式蒙版必须与正式图像尺寸及原始 Photoshop 选区边界对齐。
- 工具切换必须使用录制的 `batchPlay` 描述符，不能使用可写的 `app.currentTool`。
- 避免在顶层初始化 `require("photoshop")`。将 Photoshop API 加载放在运行时函数内部。

## 3. 目标目录结构

推荐最终项目结构：

```text
PixelOasis/
  docs/
    dev-guide.md
    DevList.md
    DevList-CN.md
    workflows.md
  pixeloasis-plugin/
    manifest.json
    index.html
    index.js
    panel.css
    package.json
    scripts/
      state.js
      ui-template.js
      ui-status.js
      ui-preview.js
      ui-settings.js
      ui-workflows.js
      ui-parameters.js
      photoshop-selection.js
      photoshop-place-layer.js
      photoshop-tool.js
      gateway-client.js
      actions.js
      vendor/
        png-encoder.js
    dist/
  services/
    model-gateway/
      package.json
      src/
        server.js
        config.js
        routes/
          health.js
          generate.js
          workflows.js
        adapters/
          comfyui/
            client.js
            adapter.js
            workflow-loader.js
            workflow-bindings.js
            result-reader.js
        validation/
          generate-request.js
        utils/
          base64.js
          images.js
          errors.js
      workflows/
        comfyui/
          portrait/
          composition/
          lighting/
          effects/
          quality/
```

注意事项：

- `services/server.js` 应替换为 `services/model-gateway`。
- 旧的根目录 `dist/` 应删除或明确标记为不使用。UDT 加载目标必须是 `pixeloasis-plugin/dist/manifest.json`。
- 工作流文件属于网关，不属于插件。

## 4. 协议方向

当前协议在此定义。插件到网关：

```json
{
  "correlationId": "po-...",
  "presetId": "composition.inpaint.basic",
  "workflowId": "flux-kontext-dev-inpaint-basic",
  "selection": {
    "documentId": "123",
    "bounds": {
      "left": 100,
      "top": 120,
      "width": 512,
      "height": 512
    },
    "imagePngBase64": "BASE64_PNG_WITH_ALPHA",
    "maskPngBase64": "BASE64_GRAYSCALE_OR_ALPHA_MASK",
    "previewJpegBase64": "BASE64_JPEG_PREVIEW_OPTIONAL",
    "colorMode": "RGB",
    "resolution": 72
  },
  "parameters": {
    "prompt": "",
    "negativePrompt": "",
    "seed": -1,
    "steps": 28,
    "cfg": 7,
    "denoise": 0.75,
    "sampler": "dpmpp_2m",
    "scheduler": "karras"
  }
}
```

网关到插件：

```json
{
  "correlationId": "po-...",
  "status": "succeeded",
  "result": {
    "imagePngBase64": "BASE64_RESULT_PNG",
    "mimeType": "image/png",
    "width": 512,
    "height": 512,
    "seed": 123456,
    "metadata": {
      "provider": "comfyui",
      "promptId": "..."
    }
  }
}
```

规则：

- 将旧的 `imageBase64` 重命名为 `imagePngBase64`。
- 将旧的 `maskBase64` 重命名为 `maskPngBase64`。
- 返回图像必须与请求的选区图像尺寸匹配，除非工作流显式声明了缩放策略。
- 所有错误必须包含 `correlationId`、`code` 和 `message`。

## 5. ComfyUI 集成计划

使用官方 ComfyUI API 行为：

- `POST /upload/image` 上传输入 PNG 文件到 ComfyUI。
- `POST /prompt` 提交 API 格式的工作流。
- `GET /history/{prompt_id}` 读取已完成输出。
- `GET /view?filename=...&subfolder=...&type=output` 下载输出图像。
- `WS /ws?clientId=...` 监听进度和完成状态。
- `GET /object_info` 可用于验证可用节点类和模型选项值。

推荐的首个实现：

1. 通过 `/upload/image` 上传源图像 PNG。
2. 通过 `/upload/image` 将蒙版 PNG 作为普通图像文件上传。
3. 使用一个工作流，通过官方图像加载节点加载这两个文件。
4. 在工作流中通过官方节点将上传的蒙版图像转换为蒙版。
5. 将填充后的工作流提交到 `/prompt`。
6. 当 WebSocket 可用时，通过 WebSocket 追踪进度。
7. 如果 WebSocket 失败，回退到轮询 `/history/{prompt_id}`。
8. 通过 `/view` 下载输出 PNG。
9. 将输出 PNG 以 base64 形式返回给插件。

不要为首个可接受路线使用自定义 ComfyUI 扩展。自定义节点可在之后按工作流添加。

## 6. 工作流文件策略

使用 ComfyUI API 格式的工作流 JSON 进行执行，而非 UI 工作流格式。

推荐存储方式：

```text
services/model-gateway/workflows/comfyui/composition/flux-kontext-dev-inpaint-basic.api.json
services/model-gateway/workflows/comfyui/composition/flux-kontext-dev-inpaint-basic.meta.json
```

`.api.json` 文件是提交给 ComfyUI 的工作流。

`.meta.json` 文件描述 PixelOasis 如何填充它：

```json
{
  "workflowId": "flux-kontext-dev-inpaint-basic",
  "title": "FLUX.1 Kontext Dev Inpaint Basic",
  "category": "composition",
  "requiredModels": [
    {
      "type": "diffusion_model",
      "name": "flux1-dev-kontext_fp8_scaled.safetensors"
    },
    {
      "type": "vae",
      "name": "ae.safetensors"
    },
    {
      "type": "text_encoder",
      "name": "clip_l.safetensors"
    },
    {
      "type": "text_encoder",
      "name": "t5xxl_fp16.safetensors"
    }
  ],
  "bindings": {
    "sourceImage": {
      "nodeId": "12",
      "input": "image"
    },
    "maskImage": {
      "nodeId": "13",
      "input": "image"
    },
    "positivePrompt": {
      "nodeId": "6",
      "input": "text"
    },
    "negativePrompt": {
      "nodeId": "7",
      "input": "text"
    },
    "seed": {
      "nodeId": "3",
      "input": "seed"
    },
    "steps": {
      "nodeId": "3",
      "input": "steps"
    },
    "cfg": {
      "nodeId": "3",
      "input": "cfg"
    },
    "denoise": {
      "nodeId": "3",
      "input": "denoise"
    },
    "output": {
      "nodeId": "99"
    }
  },
  "defaults": {
    "steps": 28,
    "cfg": 7,
    "denoise": 0.75,
    "sampler": "dpmpp_2m",
    "scheduler": "karras"
  }
}
```

为什么采用这种格式：

- API 工作流节点 ID 保留在网关内部。
- 插件只需知道 `workflowId` 和面向用户的参数。
- 可以轻松为每个分区添加多个工作流，而无需更改插件 Photoshop 逻辑。

初始推荐工作流：

- 在 `composition` 下从一个 `FLUX.1 Kontext Dev` 图像编辑工作流开始。
- 仅使用官方 ComfyUI 节点。
- 当工作流支持蒙版条件时，使用源图像 + 蒙版图像输入。
- 如果选定的本地工作流不直接使用蒙版，则在置入后在 Photoshop 中应用蒙版，并将生成的图像限制在选区尺寸的输出范围内。
- 返回一张与选中区域尺寸相同的 PNG。
- 在需要时围绕选区使用上下文填充，然后将最终结果裁剪回精确的选区尺寸。

理由：

- 修复是 PixelOasis 的核心工作流。
- 它在一个路线中验证了图像抓取、蒙版导出、ComfyUI 执行、返回图像处理和 Photoshop 图层置入。
- 其他分类可以复用相同的基础设施。
- `FLUX.1 Kontext Dev` 是后期制作图像编辑的质量优先本地路线。
- 如果 `FLUX.1 Kontext Dev` 太重或不可用，`SDXL Inpaint` 仍然可用作回退方案。

## 7. 功能分类与工作流拓展

主内容区分区：

- `portrait`：人像精修
- `composition`：构图工具
- `lighting`：光影风格
- `effects`：视觉特效
- `quality`：画质提升

每个分类必须支持多个工作流。

推荐的首批工作流：

- `portrait.skin-retouch.basic`：使用选中区域和蒙版的皮肤清理
- `portrait.face-restore.basic`：面部细节修复
- `composition.inpaint.basic`：局部修复
- `composition.object-remove.basic`：物体移除
- `composition.outpaint.basic`：画布扩展或边缘延伸
- `lighting.relight.basic`：局部光线调整
- `lighting.color-grade.basic`：风格和色调变化
- `effects.style-transfer.basic`：视觉风格效果
- `effects.background-effect.basic`：选中 / 背景效果替换
- `quality.upscale.basic`：选中区域放大
- `quality.denoise.basic`：去噪和细节恢复

实现顺序：

1. `composition.inpaint.basic`
2. `composition.object-remove.basic`
3. `quality.upscale.basic`
4. `portrait.skin-retouch.basic`
5. `lighting.relight.basic`
6. 端到端路线稳定后再实现剩余工作流

## 8. 插件开发阶段

### 阶段 P0：清理基线

任务：

- 只保留经典 UXP 路径。
- 从文档中删除对已删除的 `src/` 文件的过时引用。
- 确认 `npm run build` 产出 `pixeloasis-plugin/dist`。
- 确认 UDT 加载 `pixeloasis-plugin/dist/manifest.json`。
- 确认五个主分区、固定预览区、底部状态栏和设置界面正确显示。

验收标准：

- 插件在 Photoshop 中打开。
- 所有五个分区可见。
- 设置界面打开和关闭时不会隐藏必须的控件。
- 状态栏更新。
- 不使用旧的根目录 `dist/` 进行 UDT 加载。

### 阶段 P1：正确的选区抓取

任务：

- 通过 `batchPlay` 读取活动文档和活动选区边界。
- 抓取选中像素。
- 抓取选区蒙版。
- 保留原始选区边界。
- 确保正式图像和正式蒙版尺寸匹配。
- 如果 `getPixels` 裁剪了透明区域，将像素缓冲区填补回原始选区矩形。
- 正式图像使用 PNG。
- 正式蒙版使用 PNG。
- JPEG 仅用于 alpha 合成后的 UI 预览。

重要纠正：

- 不要依赖 `imaging.encodeImageData` 作为正式 PNG 编码器。
- 添加一个 UXP 兼容的 PNG 编码器用于正式图像和蒙版，或实现另一个经过验证的 Photoshop 导出路线来产出真正的 PNG 字节。
- 将此编码器隔离在 `scripts/vendor/` 或专用的图像工具模块下。

验收标准：

- 选中不透明区域可产出预览 JPEG、正式 PNG 图像和正式 PNG 蒙版。
- 选中含透明像素的区域不会抛出 JPEG alpha 错误。
- 选中含透明像素的区域在正式 PNG 中保留透明度。
- 正式图像和蒙版尺寸匹配原始选区的宽度和高度。
- 预览区显示 JPEG 缩略图。

### 阶段 P2：参数页 UI

任务：

- 点击工作流按钮打开参数页。
- 参数页覆盖主分区，不破坏壳布局。
- 底部栏保持稳定。
- 页面支持：
  - prompt
  - negative prompt
  - seed
  - 随机 seed 开关
  - steps
  - cfg
  - denoise / strength
  - sampler
  - scheduler
  - 模型 / 工作流显示
  - 运行按钮
  - 取消 / 返回按钮
- 使用类似 Photoshop 的紧凑控件。
- 按工作流持久化参数编辑。
- 不要将一个工作流的设置应用到另一个工作流，除非该参数是显式全局的，例如网关 URL。

验收标准：

- 每个工作流按钮可以打开其自己的参数页。
- 参数默认值来自工作流元数据。
- 编辑后的参数传递到请求组装。
- 返回主分区不会丢失当前的预览抓取。
- 重新打开同一工作流恢复其已保存的设置。
- 打开另一个工作流使用该工作流自己的已保存设置或默认值。

### 阶段 P3：插件中的网关客户端

任务：

- 添加插件端网关客户端模块。
- 从设置中读取网关 URL。
- 默认为 `http://127.0.0.1:8787`。
- 发送 `POST /generate`。
- 在底部栏和参数页中显示进度状态。
- 处理网关健康检查失败。
- 处理生成超时。
- 保持请求组装独立于 UI 渲染。

验收标准：

- 插件可以调用 `GET /health`。
- 插件可以向模拟网关发送生成请求。
- 插件可以接收到 PNG 结果。
- UI 显示成功或结构化错误。

### 阶段 P4：Photoshop 结果置入

任务：

- 将返回的 PNG base64 转换为 UXP 临时文件。
- 将临时 PNG 作为新的顶层图层置入。
- 将图层定位在原始选区边界。
- 仅在响应尺寸不同且工作流声明缩放时才进行缩放。
- 从原始选区边界和蒙版重建图层蒙版。
- 以工作流标题和时间戳命名图层。
- 保持置入后原始文档选区状态可预测。

验收标准：

- 返回的图像作为顶层图层出现。
- 图层与原始选区矩形对齐。
- 蒙版与原始选区对齐。
- 透明和软边选区保持视觉上正确。

## 9. 网关开发阶段

现在可以继续网关开发。当前仓库已经具备服务骨架、请求验证、echo 适配器和插件侧网关调用。剩余核心工作是真实 ComfyUI 路线：发现本地 ComfyUI 端点、创建并导入可执行工作流、在网关注册该工作流，并先在没有 Photoshop 的情况下跑通。

ComfyUI Desktop 运行时注意事项：

- ComfyUI Desktop 会管理并启动本地 ComfyUI 实例。当前本机实例监听在 `http://127.0.0.1:8000`，不是 `http://127.0.0.1:8188`。
- 手动版 / portable 版 ComfyUI 常见端口仍然是 `http://127.0.0.1:8188`。
- 网关必须支持 `COMFYUI_URL`，之后应按以下顺序自动探测候选地址：显式环境变量、`http://127.0.0.1:8000`、`http://127.0.0.1:8188`。
- Photoshop 插件的网关地址仍然是 `http://127.0.0.1:8787`。不要让插件直接指向 ComfyUI。

### 阶段 G0：网关运行时加固

当前状态：大部分已实现。添加真实适配器前先加固。

实现细节：

- 保持 `services/model-gateway` 作为唯一网关服务。
- 保持路由：
  - `GET /health`
  - `GET /workflows`
  - `POST /generate`
- 添加明确的 ComfyUI 上游配置：
  - 当前机器上的 ComfyUI Desktop 使用 `COMFYUI_URL=http://127.0.0.1:8000`。
  - 为手动版 / portable 版保留候选回退地址。
- 扩展 `GET /health`，使其可选报告上游 ComfyUI 状态：
  - 网关进程状态
  - 当前配置的 ComfyUI base URL
  - `GET /system_stats` 的结果
  - 仅在深度检查时调用 `GET /object_info`
- 保持面向插件的结构化错误：
  - `correlationId`
  - `error.code`
  - `error.message`
  - 可选 `error.details` 用于开发诊断
- 保留 echo 适配器用于 Photoshop 侧测试，并通过配置显式选择 provider：
  - `PO_MODEL_PROVIDER=echo`
  - `PO_MODEL_PROVIDER=comfyui`

验收标准：

- `npm run dev` 在 `127.0.0.1:8787` 启动网关。
- ComfyUI 离线时 `GET /health` 仍然可用。
- `GET /health?upstream=1` 能清楚报告 ComfyUI 在线 / 离线。
- ComfyUI Desktop 运行时，网关能访问 `http://127.0.0.1:8000/system_stats`。
- 配置改动后，现有 echo 生成仍然可用。

### 阶段 G1：请求验证补完

当前状态：部分已实现。必须在转发任何请求到 ComfyUI 前补完。

实现细节：

- 验证插件公开请求结构：
  - `correlationId`
  - `workflowId`
  - `selection.bounds`
  - `selection.imagePngBase64`
  - `selection.maskPngBase64`
  - `parameters`
- 将 `workflowId` 视为 PixelOasis 公开工作流 ID，例如 `composition.inpaint.basic`。
- 不要将 ComfyUI API 工作流文件名或节点 ID 暴露给插件。
- 在元数据中支持内部工作流变体，例如：
  - 公开 `workflowId`：`composition.inpaint.basic`
  - 内部 `variantId`：`sdxl-inpaint-basic`
  - 内部 API 文件：`sdxl-inpaint-basic.api.json`
- 正式图像和蒙版只能是 PNG。
- 即使存在预览 JPEG，也要拒绝把 JPEG 作为正式图像 / 蒙版。
- 验证选区边界：
  - 宽高为正数
  - left/top 为有限数字
  - 最大像素数量
  - 最大请求体大小
- 验证参数范围：
  - `steps` 1-100
  - `cfg` 1-30
  - `denoise` 0-1
  - `seed` 为有限数字或 `-1`
  - `sampler` 和 `scheduler` 来自允许列表或工作流元数据
- 在适配器执行前归一化可选字段：
  - 缺少 prompt -> `""`
  - 缺少 negative prompt -> `""`
  - seed `-1` -> 网关生成一个具体整数 seed

验收标准：

- 无效请求在接触 ComfyUI 前失败。
- 验证错误在插件状态区可读。
- 同一验证路径同时适用于 echo 和 ComfyUI provider。
- 公开工作流 ID 和内部 ComfyUI 工作流变体不会混用。

### 阶段 G2：ComfyUI 客户端

先实现底层 ComfyUI 客户端，再做工作流注册表。该模块不应依赖 PixelOasis 请求细节。

目标文件：

```text
services/model-gateway/src/adapters/comfyui/client.js
```

客户端函数：

- `getSystemStats()`：调用 `GET /system_stats`。
- `getObjectInfo()`：调用 `GET /object_info`。
- `getQueue()`：调用 `GET /queue`。
- `uploadImage({ bytes, filename, overwrite })`：以 `multipart/form-data` 提交到 `/upload/image`。
- `submitPrompt({ workflow, clientId })`：向 `/prompt` 提交 `{ prompt, client_id }`。
- `getHistory(promptId)`：调用 `GET /history/{prompt_id}`。
- `downloadView({ filename, subfolder, type })`：调用 `GET /view?...` 并返回 PNG bytes。
- `waitForPrompt(promptId, options)`：轮询 history，直到输出可用、超时或出现错误。
- 后续可选：`connectWebSocket(clientId)` 用于 `/ws?clientId=...` 进度事件。

实现规则：

- 尽量使用 Node 18+ 内置的 `fetch`、`FormData`、`Blob` 和 `AbortController`。
- 超时必须显式：
  - health / object info：5-10 秒
  - upload：30 秒
  - generation：可配置，本地模型默认 10 分钟
- 当 `/prompt` 返回验证错误时，将 ComfyUI 的 `error` 和 `node_errors` 保存在 `error.details`。
- WebSocket 进度有用，但首个真实里程碑不强制要求；轮询 `/history/{prompt_id}` 是第一条可靠路径。
- 首条路线不要依赖自定义 ComfyUI 节点。

验收标准：

- 本地脚本或临时路由可以通过 ComfyUI Desktop 的 `8000` 调用 `getSystemStats()`。
- 客户端可以上传 PNG 并收到 ComfyUI 上传响应。
- 客户端可以提交一个小型已知 API 格式工作流并收到 `prompt_id`。
- 客户端可以轮询 history 并下载最终输出图像。
- 错误能区分 ComfyUI 离线、工作流验证失败、超时和缺少输出。

### 阶段 G3：工作流注册表与元数据

创建文件驱动的注册表。工作流文件属于网关，不属于插件。

目录结构：

```text
services/model-gateway/workflows/comfyui/
  composition/
    sdxl-inpaint-basic.api.json
    sdxl-inpaint-basic.meta.json
    flux-kontext-dev-inpaint-basic.api.json
    flux-kontext-dev-inpaint-basic.meta.json
```

元数据 schema：

```json
{
  "workflowId": "composition.inpaint.basic",
  "variantId": "sdxl-inpaint-basic",
  "title": "SDXL Inpaint Basic",
  "category": "composition",
  "provider": "comfyui",
  "apiWorkflowFile": "sdxl-inpaint-basic.api.json",
  "enabled": true,
  "priority": 20,
  "requiredModels": [
    {
      "folder": "checkpoints",
      "name": "sd_xl_base_1.0.safetensors"
    }
  ],
  "inputs": {
    "sourceImage": {
      "nodeId": "10",
      "input": "image"
    },
    "maskImage": {
      "nodeId": "11",
      "input": "image"
    },
    "positivePrompt": {
      "nodeId": "6",
      "input": "text"
    },
    "negativePrompt": {
      "nodeId": "7",
      "input": "text"
    },
    "seed": {
      "nodeId": "3",
      "input": "seed"
    },
    "steps": {
      "nodeId": "3",
      "input": "steps"
    },
    "cfg": {
      "nodeId": "3",
      "input": "cfg"
    },
    "denoise": {
      "nodeId": "3",
      "input": "denoise"
    }
  },
  "outputs": {
    "images": {
      "nodeId": "99"
    }
  },
  "defaults": {
    "prompt": "",
    "negativePrompt": "",
    "seed": -1,
    "steps": 28,
    "cfg": 7,
    "denoise": 0.75,
    "sampler": "dpmpp_2m",
    "scheduler": "karras"
  },
  "sizePolicy": {
    "mode": "matchSelection",
    "allowResize": false
  }
}
```

实现细节：

- 添加 `workflow-loader.js`：
  - 递归查找 `*.meta.json`
  - 验证元数据结构
  - 加载匹配的 `.api.json`
  - 按公开 `workflowId` 建立索引
  - 支持按 priority 选择最佳 enabled 变体
- 添加 `workflow-bindings.js`：
  - 深拷贝 API 工作流
  - 将上传后的图像文件名写入 `LoadImage` 一类节点
  - 写入 prompt、negative prompt、seed、steps、cfg、denoise、sampler、scheduler
  - 提交前验证每个配置的节点 ID 和 input 都存在
- 添加模型验证：
  - 可用时使用 `/models` 和 `/models/{folder}`
  - 将 `/object_info` 作为节点类可用性的回退验证
  - 缺少必需模型时提前返回 `MISSING_MODEL`
- 更新 `GET /workflows`：
  - 返回公开工作流和被选中的变体元数据
  - 除非 debug 模式开启，不向插件暴露内部节点 ID

验收标准：

- `GET /workflows` 返回文件驱动的工作流元数据。
- 缺少 `.api.json`、无效 `.meta.json`、绑定错误都能产生清晰错误。
- `POST /generate` 可以将 `composition.inpaint.basic` 解析到一个 ComfyUI API 工作流变体。
- 插件不需要知道当前变体是 FLUX 还是 SDXL。

### 阶段 G4：创建并导入首个 ComfyUI 工作流

由于当前 ComfyUI Desktop 没有配置 PixelOasis 工作流，必须先在 ComfyUI 中创建工作流，再导出并注册。

推荐实践顺序：

1. 先构建 `SDXL Inpaint Basic` 作为回退里程碑工作流。
2. SDXL 路线证明网关链路后，再构建 `FLUX.1 Kontext Dev Inpaint Basic`。
3. 两个变体都挂在同一个 PixelOasis 公开工作流下：`composition.inpaint.basic`。

为什么先做 SDXL：

- 修复路线成熟。
- 更容易验证蒙版对齐和精确输出尺寸。
- 开发网关时移动部件更少。
- 即使 FLUX 在本机太重，也能给 PixelOasis 留下一条端到端回退路线。

ComfyUI Desktop 工作流创建步骤：

1. 启动 ComfyUI Desktop 并确认 API base：
   - 打开 `http://127.0.0.1:8000/`
   - 检查 `http://127.0.0.1:8000/system_stats`
   - 检查 `http://127.0.0.1:8000/object_info`
2. 安装或确认所需模型位于 ComfyUI 模型目录。
3. 在 ComfyUI 中创建一个工作流，接收：
   - 从上传 PNG 加载的源图
   - 从上传 PNG 加载的蒙版图
   - positive prompt
   - negative prompt
   - seed
   - steps
   - cfg
   - denoise
4. 首个可接受工作流只使用官方节点。
5. 保存一份普通 UI 工作流供人编辑：
   - `services/model-gateway/workflows/comfyui/composition/sdxl-inpaint-basic.ui.json`
6. 导出 API 格式工作流并保存：
   - `services/model-gateway/workflows/comfyui/composition/sdxl-inpaint-basic.api.json`
7. 创建匹配的元数据文件：
   - `services/model-gateway/workflows/comfyui/composition/sdxl-inpaint-basic.meta.json`
8. 通过检查 API 工作流节点 ID 填写元数据 bindings。
9. 在 ComfyUI 内手动使用测试图像运行工作流。
10. 在接入 Photoshop 前，先通过网关使用本地 PNG 文件运行工作流。

工作流约束：

- 只输出一张图像。
- 输出 PNG 尺寸必须匹配 Photoshop 选区尺寸。
- 如果 ComfyUI 工作流内部做了 resize 或 padding，必须在 `SaveImage` 前裁剪或缩放回原尺寸。
- 元数据必须记录蒙版极性：
  - 白色表示可编辑 / 生成区域
  - 黑色表示保留区域
- 仅当元数据显式声明 `maskPolicy.invertBeforeUpload` 时，网关才反转蒙版。
- 输出节点必须是已知的图像输出节点，通常是 `SaveImage`。

验收标准：

- 工作流可在 ComfyUI Desktop 中手动运行。
- API 格式工作流可通过 `POST /prompt` 提交。
- 网关可以上传源图 PNG 和蒙版 PNG、修补工作流、提交、轮询完成并下载一张 PNG。
- 下载的 PNG 宽高与输入选区图像一致。
- 同一个公开请求可以通过元数据 / 配置切换 SDXL 和 FLUX 变体，而不需要改 Photoshop 端代码。

### 阶段 G5：ComfyUI 适配器集成

用完整网关执行路径替换当前 ComfyUI adapter stub。

目标文件：

```text
services/model-gateway/src/adapters/comfyui/adapter.js
```

执行流程：

1. 接收已验证的 PixelOasis 请求。
2. 将公开 `workflowId` 解析为选中的工作流元数据和 API JSON。
3. 解码 `selection.imagePngBase64` 和 `selection.maskPngBase64`。
4. 上传源图 PNG 到 ComfyUI。
5. 上传蒙版 PNG 到 ComfyUI。
6. 使用元数据 bindings 修补 API 工作流。
7. 提交工作流到 `/prompt`。
8. 轮询 `/history/{prompt_id}` 直到完成。
9. 从配置的输出节点读取输出图像引用。
10. 通过 `/view` 下载输出 PNG。
11. 根据 `selection.bounds` 验证 PNG 尺寸。
12. 返回标准化 PixelOasis 响应：

```json
{
  "correlationId": "po-...",
  "status": "succeeded",
  "result": {
    "imagePngBase64": "BASE64_RESULT_PNG",
    "mimeType": "image/png",
    "width": 512,
    "height": 512,
    "seed": 123456,
    "metadata": {
      "provider": "comfyui",
      "workflowId": "composition.inpaint.basic",
      "variantId": "sdxl-inpaint-basic",
      "promptId": "..."
    }
  }
}
```

失败行为：

- `COMFYUI_OFFLINE`：无法访问配置的 ComfyUI URL。
- `WORKFLOW_NOT_FOUND`：没有公开工作流 ID 对应的元数据。
- `WORKFLOW_BINDING_ERROR`：元数据指向缺失节点 / 输入。
- `MISSING_MODEL`：必需模型文件不可用。
- `COMFYUI_VALIDATION_ERROR`：`/prompt` 拒绝 API 工作流。
- `COMFYUI_TIMEOUT`：超时前没有结果。
- `NO_OUTPUT_IMAGE`：history 已完成但没有配置的输出图像。
- `OUTPUT_SIZE_MISMATCH`：结果尺寸不匹配选区，且没有允许缩放的策略。

验收标准：

- `PO_MODEL_PROVIDER=comfyui npm run dev` 运行真实适配器。
- 独立网关测试可以在没有 Photoshop 的情况下使用本地 PNG 和蒙版生成。
- 适配器返回现有插件可消费的标准响应结构。
- ComfyUI 错误保留足够信息用于调试节点和模型问题。

## 10. 端到端验收路径

首个可接受路线分三层验收：仅 ComfyUI、仅网关、最后 Photoshop 端到端。

### 第一层：ComfyUI Desktop 手动验证

1. 启动 ComfyUI Desktop。
2. 确认 `http://127.0.0.1:8000/system_stats` 有响应。
3. 在 ComfyUI 中打开 PixelOasis UI 工作流。
4. 加载本地源图 PNG 和蒙版 PNG。
5. 手动运行工作流。
6. 确认只输出一张 PNG。
7. 确认输出尺寸与源图尺寸一致。

### 第二层：网关到 ComfyUI，不经过 Photoshop

1. 启动网关：

```powershell
cd E:\PixelOasis\services\model-gateway
$env:COMFYUI_URL="http://127.0.0.1:8000"
$env:PO_MODEL_PROVIDER="comfyui"
npm run dev
```

2. 调用 `GET http://127.0.0.1:8787/health?upstream=1`。
3. 调用 `GET http://127.0.0.1:8787/workflows`。
4. 使用本地 fixture PNG 和蒙版数据提交测试 `POST /generate`。
5. 确认网关响应包含 `status: "succeeded"` 和 `result.imagePngBase64`。
6. 解码返回 PNG 并确认尺寸。

### 第三层：完整 Photoshop 路线

1. 构建插件：

```powershell
cd E:\PixelOasis\pixeloasis-plugin
npm run build
```

2. 打开 Photoshop。
3. 在 UXP Developer Tool 中加载 `pixeloasis-plugin/dist/manifest.json`。
4. 打开一个文档。
5. 创建一个矩形选区。
6. 点击 `composition.inpaint.basic`。
7. 打开参数页。
8. 确认或编辑 prompt 和生成参数。
9. 运行生成。
10. 插件抓取正式 PNG 图像和 PNG 蒙版。
11. 插件向网关发送请求。
12. 网关上传图像到 ComfyUI。
13. 网关提交选中的 API 工作流。
14. 网关获取输出 PNG。
15. 插件将返回 PNG 作为顶层图层置入。
16. 插件应用原始选区蒙版。

验收标准：

- 正式图像或正式蒙版不使用 JPEG。
- 预览 JPEG 正确显示。
- ComfyUI 接收到有效源图 PNG 和蒙版 PNG。
- 生成的图像返回到 Photoshop。
- 新图层出现在现有图层之上。
- 新图层定位在原始选区位置。
- 新图层蒙版与原始选区匹配。
- 状态栏显示每个主要阶段：
  - captured
  - uploading
  - queued
  - generating
  - downloading
  - placing layer
  - done

## 11. 测试计划

### 网关单元与集成测试

- 配置：
  - `COMFYUI_URL` 显式设置为 Desktop `8000`。
  - `COMFYUI_URL` 显式设置为不可用地址。
  - 未设置环境变量时进行候选地址探测。
- 健康检查：
  - ComfyUI 离线但网关在线。
  - ComfyUI 在线且网关在线。
  - 上游深度检查可以调用 `/object_info`。
- 请求验证：
  - 无效 JSON。
  - 缺少 `correlationId`。
  - 缺少 `workflowId`。
  - 未知公开工作流 ID。
  - 缺少正式 PNG 图像。
  - 缺少正式 PNG 蒙版。
  - JPEG 被提交为正式图像或蒙版。
  - 无效 base64。
  - bounds 宽高过小、过大或不是有限数字。
  - 参数范围超出限制。
- 工作流注册表：
  - 缺少元数据文件。
  - 缺少 API 工作流文件。
  - 公开工作流 ID 重复并存在 priority。
  - binding 指向缺失节点 ID。
  - binding 指向缺失节点输入。
  - 缺少必需模型。
- ComfyUI 客户端：
  - 图像上传成功。
  - `/prompt` 验证错误。
  - history 轮询成功。
  - history 轮询超时。
  - 输出下载成功。
  - 缺少输出图像。

### 工作流测试

- 使用不透明源图和矩形蒙版在 ComfyUI 中手动运行。
- 使用含透明像素的源 PNG 在 ComfyUI 中手动运行。
- 使用软边蒙版在 ComfyUI 中手动运行。
- 使用相同 fixture 通过网关运行。
- 输出尺寸匹配输入尺寸。
- 蒙版极性符合 PixelOasis 预期。
- 使用相同 seed 重复运行，结果足够稳定，便于调试。
- seed `-1` 会替换为具体 seed 并返回到 metadata。

### Photoshop 内插件测试

- 无文档打开。
- 文档打开但无选区。
- 小尺寸不透明选区。
- 大尺寸不透明选区。
- 包含透明像素的选区。
- 选区部分超出可见已绘制像素。
- 软边缘选区。
- 带透明度的图层。
- 多个文档打开。
- 如果 Photoshop 允许抓取，测试非 RGB 文档。
- 网关离线。
- 网关在线但 ComfyUI 离线。
- ComfyUI 工作流验证失败能显示到 UI。

### 端到端测试

- 一个修复工作流返回一个图层。
- 重复生成会创建额外图层，不破坏之前图层。
- 重新加载插件不会丢失核心设置。
- Photoshop 重启和 UDT 重新加载后仍然加载正确的 `pixeloasis-plugin/dist`。
- 从 SDXL 变体切换到 FLUX 变体时不需要改 Photoshop 端代码。

## 12. 需要添加或更新的文档

在添加第二个真实工作流变体前添加 `docs/workflows.md`。该文档必须解释：

- PixelOasis 公开 `workflowId` 与内部 ComfyUI `variantId` 的区别。
- 元数据文件格式。
- 从 ComfyUI Desktop 导出 API 工作流的步骤。
- 如何在 API 格式 JSON 中识别节点 ID 和输入名。
- source image、mask image、prompts、seed、steps、cfg、denoise、sampler、scheduler 和 output image 的绑定规则。
- 必需模型声明与验证。
- 蒙版极性，以及是否需要反转。
- 尺寸策略和精确匹配选区尺寸的输出要求。

发现新的运行时陷阱时更新 `docs/dev-guide.md`：

- ComfyUI Desktop 端口和实例行为。
- PNG 编码器行为。
- ComfyUI 工作流绑定错误。
- ComfyUI `/prompt` 验证错误解读。
- Photoshop 置入和蒙版对齐陷阱。
- Desktop、portable 和手动 ComfyUI 安装之间的模型文件位置差异。

真实工作流跑通后更新 `README.md`：

- 如何启动 ComfyUI Desktop。
- 如何使用 `COMFYUI_URL` 启动网关。
- 如何构建和加载 UXP 插件。
- 最小故障排查清单。

## 13. 从当前状态开始的推荐构建顺序

从当前仓库状态开始，按以下顺序推进：

1. 确认 ComfyUI Desktop API base 为 `http://127.0.0.1:8000`。
2. 更新网关配置，支持 `COMFYUI_URL` 和 Desktop / 手动版候选回退。
3. 扩展 `GET /health`，添加可选上游 ComfyUI 状态。
4. 保持 echo 适配器可用，作为 Photoshop 侧安全测试。
5. 在 `client.js` 中实现 ComfyUI 客户端函数。
6. 在 ComfyUI Desktop 中手动构建 `SDXL Inpaint Basic`。
7. 将 UI 工作流 JSON 和 API 工作流 JSON 保存到 `services/model-gateway/workflows/comfyui/composition/`。
8. 创建带节点绑定的 `sdxl-inpaint-basic.meta.json`。
9. 实现文件驱动的工作流加载和元数据验证。
10. 实现从请求数据修补工作流。
11. 实现 ComfyUI adapter 执行路径。
12. 添加使用本地 PNG fixture 的网关单独测试请求。
13. 在没有 Photoshop 的情况下运行网关到 ComfyUI。
14. 运行 Photoshop 到网关到 ComfyUI 再回 Photoshop 的 `composition.inpaint.basic`。
15. SDXL 路线证明稳定后，添加 `FLUX.1 Kontext Dev` 作为第二个变体。
16. 通过元数据 priority / 配置提升首选变体。
17. 该路线稳定后再添加更多工作流分类。

## 14. 已确认假设及仍需的用户信息

已确认：

- ComfyUI Desktop 已在本地安装。
- 当前机器上 ComfyUI Desktop 响应地址为 `http://127.0.0.1:8000`。
- PixelOasis 网关本地运行在 `http://127.0.0.1:8787`。
- 插件必须调用网关，而不是直接调用 ComfyUI。
- 首个可接受功能是 `composition.inpaint.basic`。
- 质量优先于速度。
- 输出必须始终等于 Photoshop 选区尺寸。
- 首个版本每次只生成一个结果。
- 工作流设置按工作流持久化。
- 当前尚未配置 PixelOasis ComfyUI 工作流，必须创建、导出并注册。

模型下载和工作流调优前仍需了解：

- GPU 型号和显存大小。
- 可用于模型的磁盘空间。
- 机器是否能流畅运行 `FLUX.1 Kontext Dev`。
- 当前已经安装或偏好的 SDXL inpaint checkpoint。
- prompt 是否只需英文，还是插件后续需要添加 prompt 翻译功能。

默认运行时假设：

- 当前机器的 ComfyUI Desktop URL：`http://127.0.0.1:8000`。
- 手动版 / portable ComfyUI 回退 URL：`http://127.0.0.1:8188`。
- 网关 URL：`http://127.0.0.1:8787`。
- 首个公开工作流：`composition.inpaint.basic`。
- 首个实现变体：`SDXL Inpaint Basic`。
- 后续首选变体：`FLUX.1 Kontext Dev Inpaint Basic`。

## 15. 首个里程碑完成标准

首个里程碑仅在以下条件全部满足时才算完成：

- ComfyUI Desktop 正在运行，且网关可以访问它。
- 至少一个 PixelOasis 修复工作流已在 ComfyUI 中创建。
- 工作流的 UI JSON 和 API 格式 JSON 都已保存到网关工作流目录。
- 工作流有一个包含完整 bindings 的有效 `.meta.json`。
- 网关 `GET /workflows` 列出 `composition.inpaint.basic`。
- 网关 `POST /generate` 可以在没有 Photoshop 的情况下通过 ComfyUI 运行 `composition.inpaint.basic`。
- 网关将源图 PNG 和蒙版 PNG 上传到 ComfyUI。
- ComfyUI 返回恰好一张 PNG。
- 返回 PNG 尺寸匹配请求的选区尺寸。
- Photoshop 插件通过 UDT 加载。
- 用户可以创建选区。
- 用户可以运行 `composition.inpaint.basic`。
- 插件正确抓取 PNG 图像和 PNG 蒙版。
- 插件向网关发送请求。
- 网关将选中的 SDXL 或 FLUX 工作流提交到官方 ComfyUI。
- 插件将返回 PNG 作为新的顶层图层置入。
- 插件创建与原始选区对齐的蒙版。
- 透明像素选区不会破坏预览或正式上传。
- 完整路线在重新构建和重新加载 `pixeloasis-plugin/dist/manifest.json` 后仍然正常运行。

## 16. 参考资料

- 官方 ComfyUI 服务端路由：https://docs.comfy.org/development/comfyui-server/comms_routes
- 官方 ComfyUI Desktop 概览：https://docs.comfy.org/installation/desktop/overview
- 官方 ComfyUI Cloud API 概述，对路由命名和文件 / 工作流概念有参考价值：https://docs.comfy.org/api-reference/cloud/overview
- 官方 ComfyUI 本地系统要求：https://docs.comfy.org/installation/system_requirements/
- 官方 ComfyUI FLUX.1 Kontext Dev 原生工作流：https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev
- 官方 ComfyUI 修复工作流指南：https://docs.comfy.org/tutorials/basic/inpaint
- 官方 Adobe Photoshop UXP Imaging API 参考，对理解 `getPixels` 和 `encodeImageData` 的限制很重要：https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging/
