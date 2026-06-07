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
- 默认 ComfyUI 端点为 `http://127.0.0.1:8188`。
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

### 阶段 G0：服务骨架

任务：

- 将当前占位服务替换为 `services/model-gateway`。
- 添加 `package.json`。
- 添加服务器启动脚本。
- 添加 ComfyUI 基础 URL 配置。
- 添加路由：
  - `GET /health`
  - `GET /workflows`
  - `POST /generate`
- 添加结构化错误响应。

验收标准：

- `npm install` 在 `services/model-gateway` 内部正常工作。
- `npm run dev` 启动服务。
- `GET /health` 返回 JSON。

### 阶段 G1：请求验证

任务：

- 验证请求格式。
- 验证必需的 PNG 字段。
- 验证边界。
- 验证 workflowId。
- 验证参数范围。
- 拒绝将 JPEG 作为正式图像或正式蒙版。
- 强制实施载荷大小限制。

验收标准：

- 无效请求在接触 ComfyUI 之前失败。
- 错误信息在插件状态区可读。

### 阶段 G2：ComfyUI 客户端

任务：

- 实现 ComfyUI HTTP 客户端。
- 实现图像上传。
- 实现 prompt 提交。
- 实现 WebSocket 进度监听器。
- 实现历史轮询回退。
- 实现输出下载。
- 实现超时和取消策略。

验收标准：

- 网关可以提交一个硬编码的 API 格式工作流。
- 网关可以获取生成的输出 PNG。
- 网关返回标准化的 PixelOasis 响应。

### 阶段 G3：工作流注册表

任务：

- 在启动时加载工作流元数据。
- 通过 `workflowId` 加载 API 工作流 JSON。
- 从请求中填充工作流节点输入。
- 尽可能通过 ComfyUI 对象信息验证所需模型名称。
- 向插件返回工作流列表。

验收标准：

- `GET /workflows` 返回分类和工作流元数据。
- `POST /generate` 可以通过 `workflowId` 运行。
- 缺少工作流或缺少模型时产出明确的错误。

### 阶段 G4：首个真实 ComfyUI 工作流

任务：

- 构建 `composition.inpaint.basic`。
- 从 ComfyUI 导出 API 格式工作流 JSON。
- 添加工作流元数据和节点绑定。
- 使用源 PNG 和蒙版 PNG 进行测试。
- 确保输出 PNG 尺寸与输入选区尺寸匹配。
- 当本地硬件和 ComfyUI 版本支持时，首先实现 `FLUX.1 Kontext Dev`。
- 如果 `FLUX.1 Kontext Dev` 无法快速达到首个里程碑，添加 `SDXL Inpaint` 作为回退工作流。

验收标准：

- 网关可以在没有 Photoshop 的情况下运行修复工作流。
- 使用本地 PNG 和蒙版的测试请求返回有效的 PNG。
- 该工作流返回恰好一张输出图像。
- 输出图像尺寸与输入选区尺寸匹配。

## 10. 端到端验收路径

首个可接受的完整路线：

1. 本地启动官方 ComfyUI。
2. 启动 PixelOasis model-gateway。
3. 打开 Photoshop。
4. 在 UXP Developer Tool 中加载 `pixeloasis-plugin/dist/manifest.json`。
5. 打开一个文档。
6. 创建一个矩形选区。
7. 点击 `composition.inpaint.basic`。
8. 打开参数页。
9. 确认或编辑参数。
10. 运行生成。
11. 插件抓取正式 PNG 图像和 PNG 蒙版。
12. 插件向网关发送请求。
13. 网关将图像上传到 ComfyUI。
14. 网关提交工作流。
15. 网关获取输出 PNG。
16. 插件将返回的 PNG 作为顶层图层置入。
17. 插件应用与原始选区对齐的蒙版。

验收标准：

- 正式图像或蒙版不使用 JPEG。
- 预览 JPEG 正确显示。
- ComfyUI 接收到有效的输入图像和蒙版。
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

插件在 Photoshop 内的测试：

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

网关测试：

- 健康检查。
- 无效 JSON。
- 缺少 workflowId。
- 缺少正式 PNG 图像。
- 缺少正式 PNG 蒙版。
- 无效 base64。
- ComfyUI 离线。
- ComfyUI 缺少模型。
- ComfyUI 超时。
- 成功的模拟工作流。
- 成功的真实工作流。

端到端测试：

- 一个修复工作流返回一个图层。
- 重复生成不会破坏之前的图层。
- 重新加载插件不会丢失核心设置。
- Photoshop 重启和 UDT 重新加载后仍然加载正确的 dist。

## 12. 需要添加或更新的文档

协议见本文档 §4（插件 ↔ 网关请求 / 响应 schema）。

当工作流注册表超出内存列表时添加 `docs/workflows.md`：

- 解释工作流元数据格式。
- 解释 API 格式工作流导出。
- 解释节点绑定规则。
- 解释所需模型声明。

如果发现新的陷阱，更新 `docs/dev-guide.md`：

- PNG 编码器行为。
- ComfyUI 工作流绑定错误。
- Photoshop 置入和蒙版对齐陷阱。

如果发现新的陷阱，更新 `docs/dev-guide.md`：

- PNG 编码器行为。
- ComfyUI 工作流绑定错误。
- Photoshop 置入和蒙版对齐陷阱。

## 13. 推荐构建顺序

使用此精确顺序以避免重复之前的偏差：

1. 修复文档和协议名称。
2. 稳定插件壳和设置覆盖层行为。
3. 实现正确的 PNG 图像 / 蒙版抓取。
4. 在 ComfyUI 之前使用本地测试 PNG 实现结果置入。
5. 创建网关骨架。
6. 添加模拟网关响应。
7. 将插件连接到模拟网关。
8. 添加 ComfyUI 客户端。
9. 添加首个 API 格式的修复工作流。
10. 在没有 Photoshop 的情况下运行网关到 ComfyUI。
11. 运行完整的 Photoshop 到 ComfyUI 到 Photoshop 流程。
12. 添加参数页。
13. 为每个分类添加更多工作流。

## 14. 已确认假设及仍需的用户信息

已确认：

- ComfyUI 在本地运行。
- 使用官方推荐的 ComfyUI 本地部署方式。
- 主要模型路线是 `FLUX.1 Kontext Dev`。
- 回退模型路线是 `SDXL Inpaint`。
- 首个可接受的功能是 `composition.inpaint.basic`。
- 质量优先于速度。
- 输出必须始终等于 Photoshop 选区尺寸。
- 首个版本每次只生成一个结果。
- 工作流设置按工作流持久化。

在模型下载和工作流调优之前，仍需了解：

- GPU 型号和显存大小。
- 可用于模型的磁盘空间。
- 机器是否能流畅运行 `FLUX.1 Kontext Dev`。
- prompt 是否只需英文，还是插件后续需要添加 prompt 翻译功能。

默认运行时假设：

- ComfyUI 本地运行在 `http://127.0.0.1:8188`。
- 网关本地运行在 `http://127.0.0.1:8787`。
- 首个工作流是 `FLUX.1 Kontext Dev Inpaint Basic`。
- 回退工作流是 `SDXL Inpaint Basic`。

## 15. 首个里程碑完成标准

首个里程碑仅在以下条件全部满足时才算完成：

- Photoshop 插件通过 UDT 加载。
- 用户可以创建选区。
- 用户可以运行 `composition.inpaint.basic`。
- 插件正确抓取 PNG 图像和 PNG 蒙版。
- 网关将匹配的 `FLUX.1 Kontext Dev` 或回退 `SDXL Inpaint` 工作流提交到官方 ComfyUI。
- ComfyUI 返回一张 PNG。
- 插件将 PNG 作为新的顶层图层置入。
- 插件创建与原始选区对齐的蒙版。
- 透明像素选区不会破坏预览或正式上传。
- 完整路线在重新构建和重新加载 `pixeloasis-plugin/dist/manifest.json` 后仍然正常运行。

## 16. 参考资料

- 官方 ComfyUI 服务端路由：https://docs.comfy.org/development/comfyui-server/comms_routes
- 官方 ComfyUI Cloud API 概述，对路由命名和文件 / 工作流概念有参考价值：https://docs.comfy.org/api-reference/cloud/overview
- 官方 ComfyUI 本地系统要求：https://docs.comfy.org/installation/system_requirements/
- 官方 ComfyUI FLUX.1 Kontext Dev 原生工作流：https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev
- 官方 ComfyUI 修复工作流指南：https://docs.comfy.org/tutorials/basic/inpaint
- 官方 Adobe Photoshop UXP Imaging API 参考，对理解 `getPixels` 和 `encodeImageData` 的限制很重要：https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging/
