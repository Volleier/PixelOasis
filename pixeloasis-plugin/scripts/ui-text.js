window.PO = window.PO || {};

window.PO.TEXT = {
  /* ── v1 legacy (keep for backward compat) ── */
  ready: "就绪",
  shellReady: "uxp shell ready",
  noDocument: "无活动文档",
  noSelection: "无活动选区",
  settings: "设置",
  settingsOpened: "settings opened",
  settingsClosed: "settings closed",
  themeMode: "亮暗模式",
  themeHint: "仅显示界面，逻辑暂未接入",
  themeClicked: "theme toggle clicked",
  gatewayUrlLabel: "网关地址",
  gatewayUrlPlaceholder: "http://127.0.0.1:8787",
  previewTitle: "预览区",
  previewAction: "抓取当前选区",
  previewEmpty: "暂无预览内容",
  selectRectTool: "选择矩形选框工具",
  captureSelection: "抓取当前选区",

  /* v1 sections (kept for backward compat) */
  sections: [
    { id: "retouch", title: "人像精修", hint: "功能按钮待接入" },
    { id: "composition", title: "构图工具", hint: "当前分区已接入基础操作" },
    { id: "lighting", title: "光影风格", hint: "功能按钮待接入" },
    { id: "fx", title: "视觉特效", hint: "功能按钮待接入" },
    { id: "quality", title: "画质提升", hint: "功能按钮待接入" },
  ],

  /* ── v2 section titles ── */
  sectionTitles: {
    sceneEffects:    "场景氛围",
    combatEffects:   "战斗特效",
    studioComposite: "场照与合成",
    portrait:        "人像塑形",
    hair:            "头发创作",
    lightingCleanup: "光影与清理",
  },

  /* ── v2 UI text ── */
  searchPlaceholder: "搜索功能…",
  favoritesLabel: "★ 收藏",
  favoritesEmpty: "从下方功能卡点击 ☆ 收藏常用功能",
  favoritesMax: "收藏已达上限（12 个）",
  favoritesMaxHint: "请先取消部分收藏后再添加",
  p0Placeholder: "能力配置将在下一阶段接入",

  /* ── Readiness badges ── */
  badgeDegraded: "兼容模式",
  badgeMissingModels: "模型缺失",
  badgeMissingNodes: "节点缺失",
  badgeUnsupportedHardware: "硬件不足",
  badgePolicyDisabled: "已禁用",

  /* ── Gateway status ── */
  gatewayOnline: "网关就绪",
  gatewayOffline: "网关离线",
  gatewayChecking: "检查网关…",
  gatewayCachedMode: "离线模式 — 使用缓存数据",

  /* ── Task bar ── */
  tasksNone: "任务：0 个运行中",
  tasksActive: "任务：{count} 个运行中",
  viewTasks: "查看任务",

  /* ── Card states ── */
  cardDisabledModels: "模型缺失，无法使用",
  cardDisabledNodes: "节点缺失，无法使用",
  cardDisabledHardware: "当前设备不支持",

  /* ── Section states ── */
  sectionEmpty: "该分区暂无可用能力",
  sectionNoMatch: "无匹配结果",

  /* ── Settings ── */
  envStatusLabel: "环境状态",
  dataManagementLabel: "数据管理",
  clearFavoritesBtn: "清除收藏",
  clearCacheBtn: "清除能力缓存",
  clearFavoritesConfirm: "确定要清除所有收藏吗？此操作不可撤销。",
  clearCacheConfirm: "确定要清除能力缓存吗？下次将重新从网关获取。",

  /* ── Errors ── */
  errorCorruptStorage: "本地存储数据损坏，已重置",
};
