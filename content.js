/**
 * AI图片收集器 - Content Script
 * 
 * 职责：
 * 1. 注入浮动收集面板（Shadow DOM 隔离样式）
 * 2. 支持右键图片、剪贴板粘贴两种收集模式
 * 3. 表单填写：提示词、软件、分类等
 * 4. 发送数据到 background → GAS
 */

(function () {
  'use strict';

  // 防止重复注入
  if (window.__aiImageCollectorInjected) return;
  window.__aiImageCollectorInjected = true;

  // ============================================================
  // 工具函数
  // ============================================================
  function getLocalDateString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ============================================================
  // 状态管理
  // ============================================================
  let panelState = {
    isOpen: false,
    imageData: null,      // base64 图片数据
    imageMimeType: null,
    imageQueue: [],
    sourceUrl: '',
    pageUrl: '',
    settings: null
  };

  const PROMPT_USAGE_STATS_KEY = 'promptUsageStatsV1';
  const PROMPT_FAVORITES_KEY = 'promptFavoritesV1';
  const RETRY_QUEUE_KEY = 'failedSubmitQueueV1';
  const MAX_RETRY_QUEUE = 20;

  // ============================================================
  // Shadow DOM 面板构建
  // ============================================================
  const hostEl = document.createElement('div');
  hostEl.id = 'ai-image-collector-host';
  hostEl.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(hostEl);

  const shadow = hostEl.attachShadow({ mode: 'closed' });

  // 注入样式
  const style = document.createElement('style');
  style.textContent = `
    /* ===== 基础重置 ===== */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ===== 遮罩层 ===== */
    .overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
      z-index: 999998;
    }
    .overlay.active {
      opacity: 1;
      pointer-events: auto;
    }

    /* ===== 主面板 ===== */
    .collect-panel {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      width: 520px;
      max-height: 90vh;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      box-shadow: 
        0 25px 60px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.05) inset,
        0 0 80px rgba(79, 172, 254, 0.1);
      color: #e0e0e0;
      font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif;
      font-size: 14px;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      z-index: 999999;
    }
    .collect-panel.active {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, -50%) scale(1);
    }

    /* ===== 标题栏 ===== */
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background: rgba(255, 255, 255, 0.04);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      cursor: move;
      user-select: none;
    }
    .panel-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 600;
      color: #fff;
    }
    .panel-title-icon {
      font-size: 20px;
    }
    .quick-links a {
      font-size: 14px;
      opacity: 0.6;
      transition: all 0.2s;
    }
    .quick-links a:hover {
      opacity: 1;
      transform: scale(1.1);
    }
    .header-btn-group {
      display: flex;
      gap: 8px;
    }
    .header-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      color: #aaa;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .header-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .header-btn.is-close:hover {
      background: rgba(239, 68, 68, 0.3);
      border-color: rgba(239, 68, 68, 0.5);
      color: #ff6b6b;
    }

    /* ===== 面板主体 ===== */
    .panel-body {
      padding: 20px;
      overflow-y: auto;
      max-height: calc(90vh - 130px);
    }
    .panel-body::-webkit-scrollbar {
      width: 6px;
    }
    .panel-body::-webkit-scrollbar-track {
      background: transparent;
    }
    .panel-body::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
    }

    /* ===== 图片预览区 ===== */
    .image-preview-zone {
      width: 100%;
      min-height: 160px;
      border: 2px dashed rgba(79, 172, 254, 0.3);
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-bottom: 18px;
      background: rgba(79, 172, 254, 0.04);
      position: relative;
      overflow: hidden;
      transition: all 0.3s;
      cursor: pointer;
    }
    .image-preview-zone:hover {
      border-color: rgba(79, 172, 254, 0.6);
      background: rgba(79, 172, 254, 0.08);
    }
    .image-preview-zone.has-image {
      border-style: solid;
      border-color: rgba(79, 172, 254, 0.4);
      min-height: auto;
      cursor: default;
    }
    .image-preview-zone .placeholder-text {
      color: rgba(79, 172, 254, 0.7);
      font-size: 14px;
      text-align: center;
      line-height: 1.6;
    }
    .image-preview-zone .placeholder-icon {
      font-size: 40px;
      opacity: 0.6;
    }
    .preview-img {
      max-width: 100%;
      max-height: 300px;
      border-radius: 10px;
      object-fit: contain;
      display: none;
    }
    .image-preview-zone.has-image .preview-img {
      display: block;
      padding: 8px;
    }
    .image-preview-zone.has-image .placeholder-text,
    .image-preview-zone.has-image .placeholder-icon {
      display: none;
    }
    .batch-tools {
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .batch-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 12px;
      user-select: none;
    }
    .batch-toggle input[type="checkbox"] {
      width: 14px;
      height: 14px;
      accent-color: #4facfe;
      cursor: pointer;
    }
    .queue-tip {
      min-height: 20px;
      font-size: 12px;
      color: rgba(79, 172, 254, 0.9);
      background: rgba(79, 172, 254, 0.1);
      border: 1px solid rgba(79, 172, 254, 0.25);
      border-radius: 8px;
      padding: 4px 8px;
      display: none;
    }
    .queue-tip.visible {
      display: block;
    }
    .retry-box {
      display: none;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      padding: 8px 10px;
      border: 1px solid rgba(245, 158, 11, 0.55);
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.12);
      color: #fde68a;
      font-size: 12px;
    }
    .retry-box.visible {
      display: flex;
    }
    .retry-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .retry-mini-btn {
      border: 1px solid rgba(251, 191, 36, 0.65);
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.25);
      color: #fef3c7;
      padding: 4px 9px;
      font-size: 11px;
      cursor: pointer;
    }
    .retry-mini-btn:hover {
      border-color: #fbbf24;
      color: #fff7ed;
    }
    .clear-image-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      background: rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 50%;
      color: #fff;
      font-size: 14px;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .image-preview-zone.has-image .clear-image-btn {
      display: flex;
    }
    .clear-image-btn:hover {
      background: rgba(239, 68, 68, 0.7);
    }

    /* ===== 表单组 ===== */
    .form-group {
      margin-bottom: 14px;
    }
    .form-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 6px;
    }
    .form-label .label-icon {
      font-size: 14px;
    }

    /* ===== 输入框通用 ===== */
    .form-input,
    .form-select,
    .form-textarea {
      width: 100%;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      color: #e0e0e0;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: all 0.25s;
    }
    .form-input:focus,
    .form-select:focus,
    .form-textarea:focus {
      border-color: rgba(79, 172, 254, 0.6);
      background: rgba(79, 172, 254, 0.08);
      box-shadow: 0 0 0 3px rgba(79, 172, 254, 0.1);
    }
    .form-input::placeholder,
    .form-textarea::placeholder {
      color: rgba(255, 255, 255, 0.3);
    }
    .form-textarea {
      min-height: 80px;
      max-height: 200px;
      resize: vertical;
      line-height: 1.5;
    }
    .prompt-autocomplete {
      margin-top: 6px;
      max-height: 160px;
      overflow-y: auto;
      border: 1px solid rgba(79, 172, 254, 0.35);
      border-radius: 8px;
      background: rgba(12, 20, 40, 0.96);
      padding: 4px;
    }
    .prompt-autocomplete.hidden {
      display: none;
    }
    .prompt-suggest-item {
      width: 100%;
      display: block;
      text-align: left;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, 0.92);
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.16s ease;
    }
    .prompt-suggest-item:hover,
    .prompt-suggest-item.active {
      background: rgba(79, 172, 254, 0.2);
    }
    .prompt-suggest-empty {
      color: rgba(255, 255, 255, 0.55);
      font-size: 12px;
      padding: 6px 8px;
    }
    .form-select {
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23aaa' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 32px;
    }
    .form-select option {
      background: #1a1a2e;
      color: #e0e0e0;
    }

    /* ===== 双列布局 ===== */
    .form-row {
      display: flex;
      gap: 12px;
    }
    .form-row .form-group {
      flex: 1;
    }

    /* ===== 提交按钮 ===== */
    .submit-btn {
      width: 100%;
      padding: 12px 20px;
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
      border: none;
      border-radius: 12px;
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.3s;
      margin-top: 6px;
      position: relative;
      overflow: hidden;
    }
    .submit-btn::before {
      content: '';
      position: absolute;
      top: 0; left: -100%;
      width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
      transition: left 0.5s;
    }
    .submit-btn:hover::before {
      left: 100%;
    }
    .submit-btn:hover {
      box-shadow: 0 6px 25px rgba(79, 172, 254, 0.4);
      transform: translateY(-1px);
    }
    .submit-btn:active {
      transform: translateY(0);
    }
    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .submit-btn:disabled::before {
      display: none;
    }

    /* ===== 状态提示 ===== */
    .status-bar {
      padding: 10px 16px;
      margin-top: 12px;
      border-radius: 10px;
      font-size: 13px;
      display: none;
      align-items: center;
      gap: 8px;
      animation: slideIn 0.3s ease;
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .status-bar.success {
      display: flex;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: #4ade80;
    }
    .status-bar.error {
      display: flex;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }
    .status-bar.loading {
      display: flex;
      background: rgba(79, 172, 254, 0.12);
      border: 1px solid rgba(79, 172, 254, 0.3);
      color: #93c5fd;
    }

    /* ===== 加载旋转 ===== */
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid transparent;
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* ===== Drag Drop 高亮 ===== */
    .image-preview-zone.drag-over {
      border-color: rgba(79, 172, 254, 0.8);
      background: rgba(79, 172, 254, 0.15);
    }

    /* ===== 标签页 ===== */
    .tabs-header {
      display: flex;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 0 20px;
    }
    .tab-btn {
      padding: 12px 16px;
      color: rgba(255, 255, 255, 0.5);
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn:hover { color: #fff; }
    .tab-btn.active {
      color: #4facfe;
      border-bottom-color: #4facfe;
    }
    .tab-content {
      display: none;
      padding: 20px;
      overflow-y: auto;
      max-height: calc(90vh - 130px);
    }
    .tab-content.active { display: block; }
    .tab-content::-webkit-scrollbar { width: 6px; }
    .tab-content::-webkit-scrollbar-track { background: transparent; }
    .tab-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }

    /* ===== 词库中心 ===== */
    .library-toolbar {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }
    .library-filters {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .library-filter-btn {
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 999px;
      color: rgba(255, 255, 255, 0.78);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .library-filter-btn.active {
      color: #ffe7a3;
      border-color: rgba(251, 188, 4, 0.55);
      background: rgba(251, 188, 4, 0.2);
    }
    .library-search {
      flex: 1;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 13px;
      outline: none;
    }
    .library-search:focus { border-color: rgba(79, 172, 254, 0.6); }
    .refresh-btn {
      padding: 0 14px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      color: #fff;
      cursor: pointer;
    }
    .refresh-btn:hover { background: rgba(255, 255, 255, 0.1); }
    .prompt-list {
      columns: 240px;
      column-gap: 12px;
      padding-bottom: 20px;
    }
    .prompt-card {
      break-inside: avoid;
      margin-bottom: 12px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      position: relative;
      overflow: hidden;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
    }
    .prompt-card:hover {
      border-color: rgba(79, 172, 254, 0.4);
      background: rgba(79, 172, 254, 0.08);
      transform: translateY(-2px);
    }
    
    .card-hero-img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: cover;
      min-height: 80px;
      background: rgba(0,0,0,0.2);
    }
    
    .card-hero-fallback {
      width: 100%;
      min-height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.2);
      color: rgba(255,255,255,0.2);
      font-size: 24px;
    }

    .card-img-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
      opacity: 0;
      transition: opacity 0.2s;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 10px;
      pointer-events: none;
    }
    .prompt-card:hover .card-img-overlay {
      opacity: 1;
      pointer-events: auto;
    }

    .overlay-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    
    .overlay-btn {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(255,255,255,0.1);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    .overlay-btn:hover { background: #4facfe; border-color: #4facfe; transform: scale(1.1); }
    .overlay-btn.favorite-on {
      background: rgba(251, 188, 4, 0.24);
      border-color: rgba(251, 188, 4, 0.6);
      color: #fbbc04;
    }

    .card-inner-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .badge {
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 11px;
    }
    .badge.template { background: rgba(251, 188, 4, 0.15); color: #fbbc04; border: 1px solid rgba(251, 188, 4, 0.3); }
    .badge.history { background: rgba(52, 168, 83, 0.15); color: #4ade80; border: 1px solid rgba(52, 168, 83, 0.3); }
    .card-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: rgba(255, 255, 255, 0.5);
      font-size: 11px;
      margin-top: 6px;
    }
    .card-body {
      font-size: 12px;
      line-height: 1.5;
      color: #dadada;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-top: 4px;
    }

    /* ===== 手动添加模板区 ===== */
    .btn-create {
      padding: 6px 12px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      border-radius: 8px;
      color: #10b981;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    }
    .btn-create:hover { background: rgba(16, 185, 129, 0.3); }

    .add-template-box {
      background: rgba(0, 0, 0, 0.3);
      border: 1px dashed rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 16px;
      display: none;
      animation: slideIn 0.3s;
    }
    .add-template-box.active { display: block; }
    .add-template-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      font-size: 14px;
      color: #fff;
      font-weight: 600;
    }

    /* ===== 标签云与折叠抽屉 ===== */
    .tag-cloud-wrapper {
      position: relative;
      overflow: hidden;
      max-height: 70px;
      transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      margin-bottom: 5px;
    }
    .tag-cloud-wrapper.expanded {
      max-height: 1000px;
    }
    .tag-cloud-fade {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 35px;
      background: linear-gradient(transparent, #1e293b);
      pointer-events: none;
      transition: opacity 0.3s;
    }
    .tag-cloud-wrapper.expanded .tag-cloud-fade {
      opacity: 0;
    }
    .tag-cloud-toggle {
      display: flex;
      justify-content: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.1);
    }
    .toggle-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: #aaa;
      padding: 4px 16px;
      border-radius: 12px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .toggle-btn:hover {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }

    .tag-cloud-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-bottom: 5px;
    }
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .tag-row-label {
      font-size: 11px;
      color: rgba(255,255,255,0.4);
      width: 32px;
      margin-right: 4px;
      text-align: right;
    }
    .tag-pill {
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      color: #ccc;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
      user-select: none;
    }
    .tag-pill:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    .tag-pill.active {
      background: rgba(79, 172, 254, 0.2);
      border-color: rgba(79, 172, 254, 0.5);
      color: #4facfe;
      font-weight: bold;
    }
  `;

  // 面板 HTML
  const panelHTML = `
    <div class="overlay" id="overlay"></div>
    <div class="collect-panel" id="collectPanel">
      <div class="panel-header" id="panelHeader">
        <div class="panel-title">
          <span class="panel-title-icon">🎨</span>
          <span>AI 助理</span>
          <div class="quick-links" style="display:flex; gap:12px; margin-left:15px;" id="quickLinksBox">
            <a href="#" id="qn-gas" title="打开网站版图库" target="_blank" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px; color:#dbeafe; font-size:12px; font-weight:600;">🖼️ 画廊</a>
            <a href="#" id="qn-sheet" title="打开数据表格" target="_blank" style="text-decoration:none; display:none;">📊</a>
            <a href="#" id="qn-drive" title="打开Google云盘" target="_blank" style="text-decoration:none; display:none;">📁</a>
          </div>
        </div>
        <div class="header-btn-group">
          <button class="header-btn" id="maximizeBtn" title="全屏沉浸">🗖</button>
          <button class="header-btn is-close" id="closeBtn" title="关闭 (Esc)">✕</button>
        </div>
      </div>

      <div class="tabs-header" id="tabsHeader">
        <button class="tab-btn active" data-tab="tab-collect">📸 收集图片</button>
        <button class="tab-btn" data-tab="tab-library">📚 词库中心</button>
      </div>

      <!-- Tab1: 收集表单 -->
      <div class="tab-content active" id="tab-collect">
        <!-- 图片预览区 -->
        <div class="image-preview-zone" id="imageZone">
          <span class="placeholder-icon">📋</span>
          <span class="placeholder-text">
            点击粘贴图片 (Ctrl+V)<br>
            或 拖拽图片到这里
          </span>
          <img class="preview-img" id="previewImg" alt="预览">
          <button class="clear-image-btn" id="clearImgBtn" title="清除图片">✕</button>
        </div>
        <div class="batch-tools">
          <label class="batch-toggle">
            <input type="checkbox" id="batchModeCheckbox">
            <span>批量模式（可一次提交多张图，使用同一组信息）</span>
          </label>
          <div class="queue-tip" id="queueTip"></div>
        </div>

        <!-- 提示词 -->
        <div class="form-group">
          <label class="form-label">
            <span class="label-icon">📝</span> 提示词 (Prompt)
          </label>
          <textarea class="form-textarea" id="promptInput" 
            placeholder="粘贴生成此图片的提示词..."></textarea>
        </div>

        <!-- 人名 + 软件 -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">
              <span class="label-icon">👤</span> 人名
            </label>
            <input type="text" class="form-input" id="userNameInput" placeholder="操作人">
          </div>
          <div class="form-group">
            <label class="form-label">
              <span class="label-icon">💻</span> 软件
            </label>
            <select class="form-select" id="softwareSelect"></select>
          </div>
        </div>

        <!-- 分类 + 图库 -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">
              <span class="label-icon">📁</span> 图库分类
            </label>
            <select class="form-select" id="categorySelect"></select>
          </div>
          <div class="form-group">
            <label class="form-label">
              <span class="label-icon">📋</span> 备注
            </label>
            <input type="text" class="form-input" id="noteInput" placeholder="可选备注...">
          </div>
        </div>

        <!-- 提交 -->
        <button class="submit-btn" id="submitBtn">
          <span>🚀</span>
          <span>发送到表格</span>
        </button>

        <div class="retry-box" id="retryBox">
          <span id="retryText">有失败提交待重试</span>
          <div class="retry-actions">
            <button class="retry-mini-btn" id="retryBtn" type="button">重试</button>
            <button class="retry-mini-btn" id="clearRetryBtn" type="button">清空</button>
          </div>
        </div>

        <!-- 状态栏 -->
        <div class="status-bar" id="statusBar"></div>
      </div>

      <!-- Tab2: 词库中心 -->
      <div class="tab-content" id="tab-library">
         <div class="library-toolbar">
           <input type="text" class="library-search" id="librarySearch" placeholder="搜索关键词、标签...">
           <button class="btn-create" id="showAddTplBtn"><span>➕</span>新建模板</button>
           <button class="refresh-btn" id="refreshLibraryBtn" title="强制从云端更新词库">🔄</button>
         </div>

         <!-- 标签云 (折叠抽屉模式) -->
         <div class="library-filters">
           <button class="library-filter-btn active" id="filterAllBtn">全部</button>
           <button class="library-filter-btn" id="filterTemplateBtn">模板</button>
           <button class="library-filter-btn" id="filterHistoryBtn">历史</button>
           <button class="library-filter-btn" id="filterFavBtn">仅收藏</button>
           <button class="library-filter-btn" id="filterHotBtn">高频</button>
           <button class="library-filter-btn" id="filterPreviewBtn">有预览</button>
         </div>
         <div class="tag-cloud-wrapper" id="tagCloudWrapper">
           <div class="tag-cloud-container" id="tagCloudBox"></div>
           <div class="tag-cloud-fade" id="tagCloudFade"></div>
         </div>
         <div class="tag-cloud-toggle">
           <button class="toggle-btn" id="toggleTagCloudBtn">🔽 展开全部分类</button>
         </div>

         <!-- 新建模板面板 (折叠) -->
         <div class="add-template-box" id="addTplBox">
           <div class="add-template-header">
             <span>✨ 添加新提示词模板</span>
             <button style="background:transparent; border:none; color:#aaa; cursor:pointer;" id="hideAddTplBtn">✕</button>
           </div>
           
           <div class="form-row">
             <div class="form-group">
               <label class="form-label">模板分类</label>
               <select class="form-select" id="tplCategorySelect"></select>
             </div>
             <div class="form-group">
               <label class="form-label">推荐软件</label>
               <select class="form-select" id="tplSoftwareSelect"></select>
             </div>
           </div>
           
           <div class="form-group">
             <label class="form-label">提示词 (Prompt)</label>
             <textarea class="form-textarea" style="min-height:60px" id="tplPrompt" placeholder="粘贴高频优质提示词结构..."></textarea>
           </div>
           
           <div class="form-group">
             <label class="form-label">效果说明/备注</label>
             <input type="text" class="form-input" id="tplNote" placeholder="如：写实大光圈质感...">
           </div>

           <div class="form-group">
             <label class="form-label">模板预览图（可选）</label>
             <div class="image-preview-zone" id="tplImageZone" style="min-height: 160px;">
               <div class="placeholder-icon">🖼️</div>
               <div class="placeholder-text">点击选择图片，或拖拽 / Ctrl+V 粘贴预览图</div>
               <img class="preview-img" id="tplPreviewImg" alt="模板预览">
               <button class="clear-image-btn" id="tplClearImgBtn" title="清除图片">✕</button>
             </div>
             <input type="file" id="tplImageFile" accept="image/*" style="display:none;">
           </div>
           
           <button id="submitTplBtn" style="width:100%; margin-top:5px; background: rgba(16, 185, 129, 0.4); border: 1px solid #10b981; border-radius: 8px; color: #fff; padding: 10px; cursor: pointer; font-weight:bold; transition:all 0.2s;">
             💾 保存到云端词库
           </button>
         </div>

         <div class="prompt-list" id="promptList">
            <div style="text-align:center; padding: 20px; color:#aaa;">请使用此功能获取提示词...</div>
         </div>
      </div>

    </div>
    <div id="lightboxOverlay" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.9); z-index:99999999; justify-content:center; align-items:center; backdrop-filter:blur(8px); pointer-events:auto;">
      <button id="lightboxClose" style="position:absolute; top:20px; right:20px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:50%; width:40px; height:40px; color:#fff; font-size:20px; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'" title="关闭大屏 (Esc)">✕</button>
      <img id="lightboxImg" style="max-width:90vw; max-height:90vh; object-fit:contain; border-radius:8px; box-shadow:0 10px 50px rgba(0,0,0,0.8); transition: opacity 0.3s; opacity: 0;" src="">
    </div>
  `;

  // === URL 解析引擎 ===
  function extractDriveId(url) {
    if (!url) return null;
    const match = url.match(/(?:\/d\/|\?id=|&id=)([a-zA-Z0-9_-]{25,})/);
    return match ? match[1] : null;
  }

  // === Google Drive Cache Accel API ===
  function getThumbnailUrl(url) {
    const driveId = extractDriveId(url);
    if (driveId) {
      // 在一些严苛的网站（如 labs.google），drive.google.com 会被 csp img-src 屏蔽
      // 这里改用 lh3.googleusercontent.com，因为它是 Flow 生成图的原生 CDN 肯定在白名单中
      return `https://lh3.googleusercontent.com/d/${driveId}`;
    }
    return url;
  }

  const container = document.createElement('div');
  container.innerHTML = panelHTML;
  shadow.appendChild(style);
  shadow.appendChild(container);

  // ============================================================
  // DOM 引用
  // ============================================================
  const overlay = shadow.getElementById('overlay');
  const panel = shadow.getElementById('collectPanel');
  const closeBtn = shadow.getElementById('closeBtn');
  const maximizeBtn = shadow.getElementById('maximizeBtn');
  const panelHeader = shadow.getElementById('panelHeader');
  
  const lightboxOverlay = shadow.getElementById('lightboxOverlay');
  const lightboxImg = shadow.getElementById('lightboxImg');
  const lightboxClose = shadow.getElementById('lightboxClose');
  
  const qnGas = shadow.getElementById('qn-gas');
  const qnSheet = shadow.getElementById('qn-sheet');
  const qnDrive = shadow.getElementById('qn-drive');

  const imageZone = shadow.getElementById('imageZone');
  const previewImg = shadow.getElementById('previewImg');
  const clearImgBtn = shadow.getElementById('clearImgBtn');
  const batchModeCheckbox = shadow.getElementById('batchModeCheckbox');
  const queueTip = shadow.getElementById('queueTip');
  const promptInput = shadow.getElementById('promptInput');
  const userNameInput = shadow.getElementById('userNameInput');
  const softwareSelect = shadow.getElementById('softwareSelect');
  const categorySelect = shadow.getElementById('categorySelect');
  const noteInput = shadow.getElementById('noteInput');
  const submitBtn = shadow.getElementById('submitBtn');
  const retryBox = shadow.getElementById('retryBox');
  const retryText = shadow.getElementById('retryText');
  const retryBtn = shadow.getElementById('retryBtn');
  const clearRetryBtn = shadow.getElementById('clearRetryBtn');
  const statusBar = shadow.getElementById('statusBar');
  const promptSuggestBox = document.createElement('div');
  promptSuggestBox.id = 'promptSuggestBox';
  promptSuggestBox.className = 'prompt-autocomplete hidden';
  promptInput.insertAdjacentElement('afterend', promptSuggestBox);

  // 新增 Tab UI 和词库 DOM 引用
  const tabsBtns = shadow.querySelectorAll('.tab-btn');
  const tabContents = shadow.querySelectorAll('.tab-content');
  const librarySearch = shadow.getElementById('librarySearch');
  const refreshLibraryBtn = shadow.getElementById('refreshLibraryBtn');
  const filterAllBtn = shadow.getElementById('filterAllBtn');
  const filterTemplateBtn = shadow.getElementById('filterTemplateBtn');
  const filterHistoryBtn = shadow.getElementById('filterHistoryBtn');
  const filterFavBtn = shadow.getElementById('filterFavBtn');
  const filterHotBtn = shadow.getElementById('filterHotBtn');
  const filterPreviewBtn = shadow.getElementById('filterPreviewBtn');
  const promptList = shadow.getElementById('promptList');

  // 新增内部创建模板的 DOM
  const showAddTplBtn = shadow.getElementById('showAddTplBtn');
  const hideAddTplBtn = shadow.getElementById('hideAddTplBtn');
  const addTplBox = shadow.getElementById('addTplBox');
  const submitTplBtn = shadow.getElementById('submitTplBtn');
  const tplCategorySelect = shadow.getElementById('tplCategorySelect');
  const tplSoftwareSelect = shadow.getElementById('tplSoftwareSelect');
  const tplImageZone = shadow.getElementById('tplImageZone');
  const tplPreviewImg = shadow.getElementById('tplPreviewImg');
  const tplClearImgBtn = shadow.getElementById('tplClearImgBtn');
  const tplImageFile = shadow.getElementById('tplImageFile');

  const templateState = {
    imageData: null,
    imageMimeType: null
  };

  qnGas.addEventListener('click', (e) => {
    if (qnGas.dataset.ready === '1') return;
    e.preventDefault();
    showStatus('error', '请先在扩展设置里填写“网站版图库地址”并保存');
  });

  function getRetryQueue() {
    return new Promise((resolve) => {
      chrome.storage.local.get([RETRY_QUEUE_KEY], (res) => {
        resolve(Array.isArray(res[RETRY_QUEUE_KEY]) ? res[RETRY_QUEUE_KEY] : []);
      });
    });
  }

  function setRetryQueue(queue) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [RETRY_QUEUE_KEY]: queue }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  async function enqueueRetryPayload(payload, reason) {
    const queue = await getRetryQueue();
    const next = [{
      id: 'retry_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      payload,
      reason: String(reason || '发送失败'),
      createdAt: Date.now()
    }].concat(queue).slice(0, MAX_RETRY_QUEUE);
    await setRetryQueue(next);
    updateRetryQueueUI();
  }

  function updateRetryQueueUI() {
    getRetryQueue().then((queue) => {
      if (!queue.length) {
        retryBox.classList.remove('visible');
        retryText.textContent = '';
        return;
      }
      retryBox.classList.add('visible');
      retryText.textContent = `有 ${queue.length} 条失败提交待重试`;
    });
  }

  function sendPayloadToGAS(payload, timeoutMessage = '请求超时（30秒）') {
    return Promise.race([
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'sendToGAS', payload },
          (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (resp?.success) {
              resolve(resp.data);
            } else {
              reject(new Error(resp?.error || '发送失败'));
            }
          }
        );
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(timeoutMessage)), 30000)
      )
    ]);
  }

  async function retryFailedQueue() {
    const queue = await getRetryQueue();
    if (!queue.length) {
      showStatus('success', '没有待重试的提交');
      updateRetryQueueUI();
      return;
    }

    retryBtn.disabled = true;
    clearRetryBtn.disabled = true;
    showStatus('loading', `正在重试 ${queue.length} 条失败提交...`);

    const remaining = [];
    let successCount = 0;

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      try {
        showStatus('loading', `正在重试第 ${i + 1}/${queue.length} 条...`);
        await sendPayloadToGAS(item.payload, `第 ${i + 1} 条重试超时（30秒）`);
        successCount++;
      } catch (err) {
        remaining.push({
          ...item,
          reason: err && err.message ? err.message : '重试失败',
          lastTriedAt: Date.now()
        });
      }
    }

    await setRetryQueue(remaining);
    updateRetryQueueUI();
    retryBtn.disabled = false;
    clearRetryBtn.disabled = false;

    if (remaining.length) {
      showStatus('error', `已重试成功 ${successCount} 条，仍有 ${remaining.length} 条失败`);
    } else {
      showStatus('success', `失败队列已全部重试成功（${successCount} 条）`);
    }
  }

  async function clearRetryQueue() {
    await setRetryQueue([]);
    updateRetryQueueUI();
    showStatus('success', '已清空失败重试队列');
  }

  // ============================================================
  // 标签页切换逻辑
  // ============================================================
  tabsBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabsBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      shadow.getElementById(targetId).classList.add('active');

      // 切换到词库时加载数据
      if (targetId === 'tab-library') {
        loadPromptLibrary(false);
      }
    });
  });

  // ============================================================
  // 全屏最大化逻辑
  // ============================================================
  let isMaximized = false;
  maximizeBtn.addEventListener('click', () => {
    isMaximized = !isMaximized;
    if (isMaximized) {
      panel.style.width = '94vw';
      panel.style.height = '94vh';
      panel.style.maxHeight = '94vh';
      maximizeBtn.innerHTML = '🗗';
      maximizeBtn.title = '还原窗口';
    } else {
      panel.style.width = '';
      panel.style.height = '';
      panel.style.maxHeight = '';
      maximizeBtn.innerHTML = '🗖';
      maximizeBtn.title = '全屏沉浸';
    }
  });

  // ============================================================
  // Lightbox 关闭逻辑
  // ============================================================
  function closeLightbox() {
    lightboxImg.style.opacity = '0';
    lightboxImg.onerror = null; // 必须制空，否则后面 src='' 会导致循环触发错误阻断浏览器
    setTimeout(() => {
      lightboxOverlay.style.display = 'none';
      lightboxImg.src = '';
    }, 200);
  }
  lightboxClose.addEventListener('click', closeLightbox);
  lightboxOverlay.addEventListener('click', (e) => {
    if (e.target === lightboxOverlay) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxOverlay.style.display === 'flex') {
      closeLightbox();
      e.stopPropagation();
    }
  }, true);

  // ============================================================
  // 面板打开/关闭
  // ============================================================
  function openPanel(data = {}) {
    // 如果已经打开了，直接在已有面板上更新数据（不重置表单）
    const isReopening = panelState.isOpen || panelState.imageData || (panelState.imageQueue && panelState.imageQueue.length > 0) || promptInput.value;

    // 加载设置
    chrome.storage.local.get(['settings'], (result) => {
      panelState.settings = result.settings || {};
      populateSelects();

      // 仅在首次打开或无缓存数据时恢复默认值
      if (!isReopening) {
        const last = panelState.settings.lastUsed || {};
        userNameInput.value = panelState.settings.userName || '';
        if (last.software) softwareSelect.value = last.software;
        if (last.category) categorySelect.value = last.category;
      }

      // 如果带了新图片数据（比如右键图片），用新数据覆盖
      if (data.imageData) {
        replaceQueueWithSingle(data.imageData, data.imageMimeType || 'image/png', data.sourceUrl || '');
      }

      if (data.sourceUrl) panelState.sourceUrl = data.sourceUrl;
      panelState.pageUrl = data.pageUrl || panelState.pageUrl || location.href;

      // 实时计算快捷链接显示状态
      if (panelState.settings) {
        if (panelState.settings.websiteUrl) {
           qnGas.href = panelState.settings.websiteUrl;
           qnGas.title = '打开网站版图库';
           qnGas.dataset.ready = '1';
        } else {
           qnGas.href = '#';
           qnGas.title = '请先在扩展设置中填写网站版图库地址';
           qnGas.dataset.ready = '0';
        }
        
        if (panelState.settings.sheetId) {
           qnSheet.href = 'https://docs.google.com/spreadsheets/d/' + panelState.settings.sheetId + '/edit';
           qnSheet.style.display = 'block';
        } else {
           qnSheet.style.display = 'none';
        }

        if (panelState.settings.driveFolderId) {
           qnDrive.href = 'https://drive.google.com/drive/folders/' + panelState.settings.driveFolderId;
           qnDrive.style.display = 'block';
        } else {
           qnDrive.style.display = 'none';
        }
      }

      // 如果有错误提示
      if (data.error) {
        showStatus('error', data.error);
      }

      updateRetryQueueUI();

      // 显示面板
      overlay.classList.add('active');
      panel.classList.add('active');
      panelState.isOpen = true;

      // 聚焦到第一个空输入
      setTimeout(() => {
        if (!panelState.imageData) {
          // 没有图片，等待粘贴
        } else if (!promptInput.value) {
          promptInput.focus();
        }
      }, 350);
    });
  }

  function closePanel() {
    overlay.classList.remove('active');
    panel.classList.remove('active');
    panelState.isOpen = false;
    hidePromptSuggest();

    // 关闭时仅重置状态栏和按钮，保留表单数据
    setTimeout(() => {
      hideStatus();
      submitBtn.disabled = false;
    }, 300);
  }

  // 完全重置面板（仅在提交成功后调用）
  function resetPanel() {
    clearImagePreview();
    promptInput.value = '';
    hidePromptSuggest();
    noteInput.value = '';
    hideStatus();
    submitBtn.disabled = false;
  }

  // ============================================================
  // 下拉选项填充
  // ============================================================
  function populateSelects() {
    const s = panelState.settings;
    
    // 软件列表
    softwareSelect.innerHTML = '';
    (s.softwareList || []).forEach(item => {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      softwareSelect.appendChild(opt);
    });

    // 分类列表
    categorySelect.innerHTML = '';
    (s.categoryList || []).forEach(item => {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      categorySelect.appendChild(opt);
    });

    if (tplCategorySelect) {
      tplCategorySelect.innerHTML = '';

      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '请选择分类...';
      tplCategorySelect.appendChild(defaultOpt);

      (s.categoryList || []).forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        tplCategorySelect.appendChild(opt);
      });
    }

    if (tplSoftwareSelect) {
      tplSoftwareSelect.innerHTML = '';

      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '请选择软件...';
      tplSoftwareSelect.appendChild(defaultOpt);

      (s.softwareList || []).forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        tplSoftwareSelect.appendChild(opt);
      });
    }
  }

  // ============================================================
  // 图片预览
  // ============================================================
  function setImagePreview(base64, mimeType) {
    panelState.imageData = base64;
    panelState.imageMimeType = mimeType;
    previewImg.src = `data:${mimeType};base64,${base64}`;
    imageZone.classList.add('has-image');
    console.log('[AI收集器] 图片已加载, 大小:', (base64.length / 1024).toFixed(1), 'KB base64');
  }

  function clearImagePreview() {
    panelState.imageData = null;
    panelState.imageMimeType = null;
    panelState.imageQueue = [];
    panelState.sourceUrl = '';
    previewImg.src = '';
    imageZone.classList.remove('has-image');
    updateQueueTip();
  }

  function updateQueueTip() {
    const queueLen = panelState.imageQueue.length;
    if (queueLen <= 0) {
      queueTip.textContent = '';
      queueTip.classList.remove('visible');
      return;
    }

    if (batchModeCheckbox.checked && queueLen > 1) {
      queueTip.textContent = `已加入 ${queueLen} 张图片，提交时将批量写入表格`;
    } else {
      queueTip.textContent = `当前图片队列：${queueLen} 张`;
    }
    queueTip.classList.add('visible');
  }

  function replaceQueueWithSingle(base64, mimeType, sourceUrl = '') {
    panelState.imageQueue = [{ data: base64, mimeType: mimeType || 'image/png', sourceUrl: sourceUrl || '' }];
    panelState.sourceUrl = sourceUrl || '';
    setImagePreview(base64, mimeType || 'image/png');
    updateQueueTip();
  }

  function pushImageToQueue(base64, mimeType, sourceUrl = '') {
    const safeMime = mimeType || 'image/png';
    panelState.imageQueue.push({ data: base64, mimeType: safeMime, sourceUrl: sourceUrl || '' });
    panelState.sourceUrl = sourceUrl || panelState.sourceUrl || '';
    setImagePreview(base64, safeMime);
    updateQueueTip();
  }

  function addCollectedImage(base64, mimeType, sourceUrl = '') {
    if (batchModeCheckbox.checked) {
      pushImageToQueue(base64, mimeType, sourceUrl);
    } else {
      replaceQueueWithSingle(base64, mimeType, sourceUrl);
    }
  }

  function setTemplateImagePreview(base64, mimeType) {
    templateState.imageData = base64;
    templateState.imageMimeType = mimeType;
    tplPreviewImg.src = `data:${mimeType};base64,${base64}`;
    tplImageZone.classList.add('has-image');
  }

  function clearTemplateImagePreview() {
    templateState.imageData = null;
    templateState.imageMimeType = null;
    tplPreviewImg.src = '';
    tplImageZone.classList.remove('has-image');
    if (tplImageFile) tplImageFile.value = '';
  }

  function readImageFileAsBase64(file, onDone) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const [header, data] = dataUrl.split(',');
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      onDone(data, mimeType);
    };
    reader.readAsDataURL(file);
  }

  // ============================================================
  // 图片压缩（发送前将大图缩小，减少传输体积）
  // ============================================================
  function compressImage(base64, mimeType, maxWidth = 1200, quality = 0.85) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // 如果图片已经很小，直接返回
        if (img.width <= maxWidth && base64.length < 500 * 1024) {
          console.log('[AI收集器] 图片较小，无需压缩');
          resolve({ data: base64, mimeType });
          return;
        }

        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;

        // 等比缩放
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // 转为 JPEG 压缩
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        const compressedBase64 = compressedDataUrl.split(',')[1];

        console.log('[AI收集器] 图片压缩完成:',
          (base64.length / 1024).toFixed(1), 'KB ->',
          (compressedBase64.length / 1024).toFixed(1), 'KB',
          `(${w}x${h})`);

        resolve({ data: compressedBase64, mimeType: 'image/jpeg' });
      };
      img.onerror = () => {
        console.warn('[AI收集器] 图片压缩失败，使用原图');
        resolve({ data: base64, mimeType });
      };
      img.src = `data:${mimeType};base64,${base64}`;
    });
  }

  // ============================================================
  // 状态提示
  // ============================================================
  function showStatus(type, message) {
    statusBar.className = 'status-bar ' + type;
    if (type === 'loading') {
      statusBar.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
    } else {
      const icon = type === 'success' ? '✅' : '❌';
      statusBar.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    }
  }

  function hideStatus() {
    statusBar.className = 'status-bar';
    statusBar.innerHTML = '';
  }

  // ============================================================
  // 剪贴板粘贴处理
  // ============================================================
  function handlePaste(e) {
    if (!panelState.isOpen) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          const [header, data] = dataUrl.split(',');
          const mimeMatch = header.match(/data:([^;]+)/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
          addCollectedImage(data, mimeType);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  }

  function handleTemplatePaste(e) {
    if (!addTplBox.classList.contains('active')) return;

    const activeEl = shadow.activeElement || document.activeElement;
    if (activeEl && /^(INPUT|TEXTAREA)$/i.test(activeEl.tagName)) {
      return;
    }

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        readImageFileAsBase64(blob, setTemplateImagePreview);
        return;
      }
    }
  }

  // ============================================================
  // 拖拽处理
  // ============================================================
  function normalizePromptText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function safeDateValue(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;

    const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d2 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(d2.getTime())) return d2;
    }
    return null;
  }

  async function ensurePromptCacheForDedup() {
    return new Promise((resolve) => {
      // 去重必须尽量使用最新历史，避免被后台缓存影响
      chrome.runtime.sendMessage({ action: 'fetchPrompts', forceRefresh: true }, (response) => {
        if (response && response.success) {
          cachedPrompts = response.data || [];
          resolve(cachedPrompts);
        } else {
          resolve(cachedPrompts || []);
        }
      });
    });
  }

  async function confirmIfPotentialDuplicate(prompt, software) {
    const all = await ensurePromptCacheForDedup();
    if (!all || all.length === 0) return true;

    const promptNorm = normalizePromptText(prompt);
    const softwareNorm = String(software || '').trim().toLowerCase();
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;

    const candidates = all.filter((item) => {
      if (!item || item.type !== 'history') return false;
      if (normalizePromptText(item.prompt) !== promptNorm) return false;
      const itemSoftware = String(item.software || '').trim().toLowerCase();
      if (itemSoftware !== softwareNorm) return false;
      const dt = safeDateValue(item.timestamp);
      if (!dt) return true; // 时间无法解析时，宁可提醒，避免漏掉重复
      return (now - dt.getTime()) <= maxAge;
    });

    if (candidates.length === 0) return true;

    const preview = candidates.slice(0, 3).map((it) => {
      const d = safeDateValue(it.timestamp);
      const ds = d ? d.toISOString().slice(0, 10) : String(it.timestamp || '');
      return `- ${ds} / ${it.category || '未分类'} / ${it.userName || '未署名'}`;
    }).join('\n');

    return confirm(
      `检测到可能重复（近7天同提示词+同软件）: ${candidates.length} 条\n\n${preview}\n\n是否仍然继续提交？`
    );
  }

  imageZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    imageZone.classList.add('drag-over');
  });

  imageZone.addEventListener('dragleave', () => {
    imageZone.classList.remove('drag-over');
  });

  imageZone.addEventListener('drop', (e) => {
    e.preventDefault();
    imageZone.classList.remove('drag-over');

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
          for (let fi = 0; fi < files.length; fi++) {
            const file = files[fi];
            if (!file.type.startsWith('image/')) continue;
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result;
              const [header, data] = dataUrl.split(',');
              const mimeMatch = header.match(/data:([^;]+)/);
              const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
              addCollectedImage(data, mimeType);
            };
            reader.readAsDataURL(file);
          }
    }

    // 也支持拖拽网页中的图片（src URL）
    const imgUrl = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    if (imgUrl && imgUrl.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)) {
      chrome.runtime.sendMessage(
        { action: 'fetchImageBase64', url: imgUrl },
        (response) => {
          if (response?.success) {
            addCollectedImage(response.data, response.mimeType, imgUrl);
          }
        }
      );
    }
  });

  // ============================================================
  // 提交
  // ============================================================
  async function handleSubmit() {
    // 验证
    if (!panelState.imageData || panelState.imageQueue.length === 0) {
      showStatus('error', '请先粘贴或右键获取一张图片');
      return;
    }

    const prompt = promptInput.value.trim();
    const userName = userNameInput.value.trim();
    const software = softwareSelect.value;
    const category = categorySelect.value;
    const note = noteInput.value.trim();

    if (!prompt) {
      showStatus('error', '请填写提示词');
      promptInput.focus();
      return;
    }

    if (!userName) {
      showStatus('error', '请填写人名');
      userNameInput.focus();
      return;
    }

    // 检查 GAS URL 配置
    if (!panelState.settings?.gasUrl) {
      showStatus('error', '请先在扩展设置中配置 GAS Web App URL');
      return;
    }

    // 禁用按钮
    const allowSubmit = await confirmIfPotentialDuplicate(prompt, software);
    if (!allowSubmit) {
      showStatus('error', '已取消提交');
      return;
    }

    submitBtn.disabled = true;
    showStatus('loading', '正在压缩图片...');

    let lastSubmitPayload = null;

    try {
      if (panelState.imageQueue.length > 1) {
        const queue = panelState.imageQueue.slice();
        const total = queue.length;
        let successCount = 0;

        for (let idx = 0; idx < total; idx++) {
          const item = queue[idx];
          showStatus('loading', `正在处理第 ${idx + 1}/${total} 张图片...`);

          const compressed = await compressImage(item.data, item.mimeType || 'image/png');
          const payload = {
            imageBase64: compressed.data,
            mimeType: compressed.mimeType,
            prompt: prompt,
            userName: userName,
            software: software,
            category: category,
            note: note,
            sourceUrl: item.sourceUrl || panelState.sourceUrl,
            pageUrl: panelState.pageUrl,
            timestamp: getLocalDateString()
          };
          lastSubmitPayload = payload;

          try {
            await sendPayloadToGAS(payload, `第 ${idx + 1} 张请求超时（30秒）`);
            successCount++;
          } catch (itemErr) {
            await enqueueRetryPayload(payload, itemErr && itemErr.message ? itemErr.message : '发送失败');
          }
        }

        const updatedSettings = { ...panelState.settings };
        updatedSettings.lastUsed = { software: software, category: category };
        updatedSettings.userName = userName;
        chrome.storage.local.set({ settings: updatedSettings });
        trackPromptUsage({
          prompt: prompt,
          software: software,
          category: category,
          type: 'history'
        }, 'submit');

        const failedCount = total - successCount;
        if (failedCount > 0) {
          showStatus('error', `已发送 ${successCount}/${total} 张，失败 ${failedCount} 张已加入重试队列`);
          submitBtn.disabled = false;
          updateRetryQueueUI();
        } else {
          showStatus('success', `已成功发送到表格：${successCount}/${total} 张`);
          setTimeout(() => {
            closePanel();
            resetPanel();
          }, 2000);
        }
        return;
      }
      // 先压缩图片
      const compressed = await compressImage(
        panelState.imageData,
        panelState.imageMimeType || 'image/png'
      );

      showStatus('loading', '正在发送到表格...');
      console.log('[AI收集器] 开始发送, 图片大小:', (compressed.data.length / 1024).toFixed(1), 'KB');

      const payload = {
        imageBase64: compressed.data,
        mimeType: compressed.mimeType,
        prompt: prompt,
        userName: userName,
        software: software,
        category: category,
        note: note,
        sourceUrl: panelState.sourceUrl,
        pageUrl: panelState.pageUrl,
        timestamp: getLocalDateString()
      };
      lastSubmitPayload = payload;

      // 带超时的发送（30秒）
      await sendPayloadToGAS(payload, '请求超时（30秒）。请检查 GAS URL 是否正确，或查看 Service Worker 控制台日志');

      // 保存上次使用的选项
      const updatedSettings = { ...panelState.settings };
      updatedSettings.lastUsed = {
        software: software,
        category: category
      };
      updatedSettings.userName = userName;
      chrome.storage.local.set({ settings: updatedSettings });
      trackPromptUsage({
        prompt: prompt,
        software: software,
        category: category,
        type: 'history'
      }, 'submit');

      showStatus('success', '已成功发送到表格！');

      // 2秒后关闭面板并重置数据
      setTimeout(() => {
        closePanel();
        resetPanel();
      }, 2000);
    } catch (err) {
      console.error('[AI收集器] 提交失败:', err);
      try {
        if (lastSubmitPayload) {
          await enqueueRetryPayload(lastSubmitPayload, err && err.message ? err.message : '发送失败');
          showStatus('error', '发送失败，已加入重试队列：' + (err.message || '请稍后重试'));
        } else {
          showStatus('error', err.message || '发送失败，请重试');
        }
      } catch (queueErr) {
        showStatus('error', '发送失败，且保存重试队列失败：' + (queueErr.message || err.message || '未知错误'));
      }
      submitBtn.disabled = false;
    }
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  closeBtn.addEventListener('click', closePanel);
  // 不再点击遮罩关闭面板，防止误操作丢失已填数据
  // 用户可通过 X 按钮或 ESC 键关闭
  clearImgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearImagePreview();
  });
  submitBtn.addEventListener('click', handleSubmit);
  retryBtn.addEventListener('click', retryFailedQueue);
  clearRetryBtn.addEventListener('click', clearRetryQueue);
  batchModeCheckbox.addEventListener('change', updateQueueTip);

  // 点击图片区域触发粘贴
  imageZone.addEventListener('click', () => {
    if (!panelState.imageData) {
      // 尝试从剪贴板读取
      navigator.clipboard.read().then(items => {
        for (const item of items) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            item.getType(imageType).then(blob => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result;
                const [header, data] = dataUrl.split(',');
                const mimeMatch = header.match(/data:([^;]+)/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                addCollectedImage(data, mimeType);
              };
              reader.readAsDataURL(blob);
            });
          }
        }
      }).catch(() => {
        // 剪贴板 API 不可用，提示用户用 Ctrl+V
      });
    }
  });

  // 全局粘贴监听
  document.addEventListener('paste', handlePaste);
  document.addEventListener('paste', handleTemplatePaste);

  promptInput.addEventListener('input', () => {
    updatePromptSuggestFromInput();
  });

  promptInput.addEventListener('keydown', (e) => {
    const opened = !promptSuggestBox.classList.contains('hidden');
    if (!opened || suggestCandidates.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestActiveIndex = (suggestActiveIndex + 1) % suggestCandidates.length;
      renderPromptSuggest();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestActiveIndex = (suggestActiveIndex - 1 + suggestCandidates.length) % suggestCandidates.length;
      renderPromptSuggest();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const item = suggestCandidates[Math.max(0, suggestActiveIndex)];
      if (item) applyPromptSuggestion(item.term);
      return;
    }
    if (e.key === 'Escape') {
      hidePromptSuggest();
    }
  });

  promptInput.addEventListener('blur', () => {
    setTimeout(() => hidePromptSuggest(), 120);
  });

  tplImageZone.addEventListener('click', () => tplImageFile.click());
  tplClearImgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTemplateImagePreview();
  });
  tplImageFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    readImageFileAsBase64(file, setTemplateImagePreview);
  });
  tplImageZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    tplImageZone.classList.add('drag-over');
  });
  tplImageZone.addEventListener('dragleave', () => {
    tplImageZone.classList.remove('drag-over');
  });
  tplImageZone.addEventListener('drop', (e) => {
    e.preventDefault();
    tplImageZone.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      readImageFileAsBase64(files[0], setTemplateImagePreview);
    }
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelState.isOpen) {
      closePanel();
    }
  });

  // ============================================================
  // 拖拽移动面板
  // ============================================================
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  panelHeader.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn) return;
    isDragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    panel.style.transition = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      panel.style.transition = '';
    }
  });

  // ============================================================
  // 词库中心处理与搜索
  // ============================================================
  let cachedPrompts = [];
  let activeTags = new Set();
  let TAG_DICTIONARY = [];
  let promptUsageStats = {};
  let promptFavorites = {};
  let libraryViewMode = 'all';
  const PROMPT_RENDER_STEP = 50;
  let promptRenderLimit = PROMPT_RENDER_STEP;
  let promptSuggestPool = [];
  let suggestCandidates = [];
  let suggestActiveIndex = -1;

  const tagCloudBox = shadow.getElementById('tagCloudBox');
  const tagCloudWrapper = shadow.getElementById('tagCloudWrapper');
  const toggleTagCloudBtn = shadow.getElementById('toggleTagCloudBtn');
  let isTagCloudExpanded = false;

  // 展开折叠逻辑
  toggleTagCloudBtn.addEventListener('click', () => {
    isTagCloudExpanded = !isTagCloudExpanded;
    if (isTagCloudExpanded) {
      tagCloudWrapper.classList.add('expanded');
      toggleTagCloudBtn.textContent = '🔼 收起分类';
    } else {
      tagCloudWrapper.classList.remove('expanded');
      toggleTagCloudBtn.textContent = '🔽 展开全部分类';
    }
  });

  // 解析自定义文本形式的字典
  function parseTagCloudSettings(text) {
    const lines = text.split('\n');
    const dict = [];
    lines.forEach(line => {
      if (!line.trim()) return;
      const parts = line.split(/[:：]/);
      if (parts.length >= 2) {
        const label = parts[0].trim();
        const tags = parts[1].split(/[,，]/).map(t => t.trim()).filter(t => t);
        if (label && tags.length > 0) {
          dict.push({ label, tags });
        }
      }
    });
    return dict;
  }

  function normalizePromptKeyPart(v) {
    return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function buildPromptUsageKey(meta) {
    const p = normalizePromptKeyPart(meta.prompt);
    const s = normalizePromptKeyPart(meta.software);
    const c = normalizePromptKeyPart(meta.category);
    const t = normalizePromptKeyPart(meta.type || 'history');
    return [p, s, c, t].join('||');
  }

  function getPromptUsage(meta) {
    const key = buildPromptUsageKey(meta);
    return promptUsageStats[key] || null;
  }

  function isPromptFavorite(meta) {
    const key = buildPromptUsageKey(meta);
    return !!promptFavorites[key];
  }

  function savePromptFavorites() {
    chrome.storage.local.set({ [PROMPT_FAVORITES_KEY]: promptFavorites });
  }

  function loadPromptFavorites() {
    chrome.storage.local.get([PROMPT_FAVORITES_KEY], (res) => {
      promptFavorites = res[PROMPT_FAVORITES_KEY] || {};
      if (cachedPrompts.length > 0) {
        renderPromptList(cachedPrompts);
      }
    });
  }

  function togglePromptFavorite(meta) {
    const key = buildPromptUsageKey(meta);
    if (promptFavorites[key]) {
      delete promptFavorites[key];
    } else {
      promptFavorites[key] = {
        favoredAt: Date.now()
      };
    }
    savePromptFavorites();
  }

  function savePromptUsageStats() {
    chrome.storage.local.set({ [PROMPT_USAGE_STATS_KEY]: promptUsageStats });
  }

  function loadPromptUsageStats() {
    chrome.storage.local.get([PROMPT_USAGE_STATS_KEY], (res) => {
      promptUsageStats = res[PROMPT_USAGE_STATS_KEY] || {};
      if (cachedPrompts.length > 0) {
        renderPromptList(cachedPrompts);
      }
    });
  }

  function resetPromptRenderLimit() {
    promptRenderLimit = PROMPT_RENDER_STEP;
  }

  function trackPromptUsage(meta, action) {
    const key = buildPromptUsageKey(meta);
    const row = promptUsageStats[key] || {
      copyCount: 0,
      fillCount: 0,
      submitCount: 0,
      lastUsedAt: 0
    };

    if (action === 'copy') row.copyCount += 1;
    if (action === 'fill') row.fillCount += 1;
    if (action === 'submit') row.submitCount += 1;
    row.lastUsedAt = Date.now();

    promptUsageStats[key] = row;
    savePromptUsageStats();
  }

  function calcPromptScore(item) {
    const usage = getPromptUsage(item);
    let score = Number(item.copyCount || item.copies || 0) * 3;
    if (!usage) return score;

    score += usage.copyCount * 3 + usage.fillCount * 2 + usage.submitCount * 4;
    const now = Date.now();
    const oneDay = 86400000;
    const delta = usage.lastUsedAt ? (now - usage.lastUsedAt) : Number.MAX_SAFE_INTEGER;
    if (delta <= 7 * oneDay) score += 5;
    else if (delta <= 30 * oneDay) score += 2;

    return score;
  }

  function isPromptHot(item) {
    return calcPromptScore(item) >= 8 || Number(item.copyCount || item.copies || 0) >= 2;
  }

  function matchesLibraryViewMode(item) {
    if (libraryViewMode === 'template') return item.type === 'template';
    if (libraryViewMode === 'history') return item.type !== 'template';
    if (libraryViewMode === 'favorites') return isPromptFavorite(item);
    if (libraryViewMode === 'hot') return isPromptHot(item);
    if (libraryViewMode === 'preview') return !!String(item.previewUrl || '').trim();
    return true;
  }

  function tokenizePromptForSuggest(text) {
    if (!text) return [];
    return String(text)
      .split(/[\n,，;；|]+/)
      .map(t => t.trim())
      .filter(t => t.length >= 2 && t.length <= 40);
  }

  function rebuildPromptSuggestPool() {
    const freq = new Map();

    TAG_DICTIONARY.forEach(group => {
      (group.tags || []).forEach(tag => {
        const term = String(tag || '').trim();
        if (!term) return;
        freq.set(term, (freq.get(term) || 0) + 8);
      });
    });

    cachedPrompts.slice(0, 800).forEach(item => {
      tokenizePromptForSuggest(item.prompt).forEach(term => {
        freq.set(term, (freq.get(term) || 0) + 1);
      });
    });

    promptSuggestPool = Array.from(freq.entries())
      .map(([term, weight]) => ({ term, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 1200);
  }

  function getPromptCurrentFragment() {
    const value = promptInput.value || '';
    const caret = promptInput.selectionStart || 0;
    const left = value.slice(0, caret);
    const lastDelim = Math.max(
      left.lastIndexOf(','),
      left.lastIndexOf('，'),
      left.lastIndexOf('\n'),
      left.lastIndexOf(';'),
      left.lastIndexOf('；')
    );
    const start = Math.max(lastDelim, left.lastIndexOf('，'), left.lastIndexOf('；')) + 1;
    const fragment = left.slice(start).trim();
    return { start, end: caret, fragment };
  }

  function hidePromptSuggest() {
    suggestCandidates = [];
    suggestActiveIndex = -1;
    promptSuggestBox.classList.add('hidden');
    promptSuggestBox.innerHTML = '';
  }

  function renderPromptSuggest() {
    if (!suggestCandidates.length) {
      promptSuggestBox.innerHTML = `<div class="prompt-suggest-empty">没有可用建议</div>`;
      promptSuggestBox.classList.remove('hidden');
      return;
    }

    promptSuggestBox.innerHTML = suggestCandidates.map((item, idx) => {
      const cls = idx === suggestActiveIndex ? 'prompt-suggest-item active' : 'prompt-suggest-item';
      const safeTerm = item.term.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<button class="${cls}" data-suggest-index="${idx}" type="button">${safeTerm}</button>`;
    }).join('');

    promptSuggestBox.querySelectorAll('.prompt-suggest-item').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = Number(btn.dataset.suggestIndex || '-1');
        if (idx >= 0) {
          applyPromptSuggestion(suggestCandidates[idx].term);
        }
      });
    });

    promptSuggestBox.classList.remove('hidden');
  }

  function applyPromptSuggestion(term) {
    const value = promptInput.value || '';
    const caret = promptInput.selectionStart || 0;
    const info = getPromptCurrentFragment();
    const leftPrefix = value.slice(0, info.start);
    const rightPart = value.slice(caret);
    const insert = `${term}, `;
    const nextValue = `${leftPrefix}${insert}${rightPart}`;
    promptInput.value = nextValue;
    const nextCaret = leftPrefix.length + insert.length;
    promptInput.setSelectionRange(nextCaret, nextCaret);
    hidePromptSuggest();
    promptInput.focus();
  }

  function updatePromptSuggestFromInput() {
    if (promptSuggestPool.length === 0) {
      rebuildPromptSuggestPool();
    }
    const { fragment } = getPromptCurrentFragment();
    if (!fragment || fragment.length < 2) {
      hidePromptSuggest();
      return;
    }

    const q = fragment.toLowerCase();
    suggestCandidates = promptSuggestPool
      .filter(item => item.term.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.term.toLowerCase().startsWith(q) ? 1 : 0;
        const bStarts = b.term.toLowerCase().startsWith(q) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        if (a.weight !== b.weight) return b.weight - a.weight;
        return a.term.length - b.term.length;
      })
      .slice(0, 8);

    suggestActiveIndex = suggestCandidates.length ? 0 : -1;
    renderPromptSuggest();
  }

  function renderTagCloud() {
    tagCloudBox.innerHTML = '';
    TAG_DICTIONARY.forEach(group => {
      const row = document.createElement('div');
      row.className = 'tag-row';
      
      const label = document.createElement('div');
      label.className = 'tag-row-label';
      label.textContent = group.label;
      row.appendChild(label);

      group.tags.forEach(t => {
        const pill = document.createElement('div');
        pill.className = 'tag-pill';
        pill.textContent = t;
        if (activeTags.has(t)) {
          pill.classList.add('active');
        }
        pill.addEventListener('click', () => {
          if (activeTags.has(t)) {
            activeTags.delete(t);
            pill.classList.remove('active');
          } else {
            activeTags.add(t);
            pill.classList.add('active');
          }
          resetPromptRenderLimit();
          renderPromptList(cachedPrompts);
        });
        row.appendChild(pill);
      });
      tagCloudBox.appendChild(row);
    });
  }

  const DEFAULT_TAG_CLOUD = `地方: 室内, 室外, 花园, 门廊, 露台, 阳台, 湖边, 海边, 草地, 山顶, 山坡, 田园, 牧场, 街头, 巷子, 咖啡馆, 森林, 小溪
时间: 夜晚, 日景, 日出, 清晨, 上午, 午后, 下午, 傍晚, 黄昏, 蓝天, 白云, 晴天, 黄金时光, 星空, 初雪
风格: 欧美, 美式, 欧式, 法式, 英伦, 东南亚, 日系, 韩系, 极简风, 波普艺术, 复古风, 童话风, 插画风, 古典主义
色调: 唯美, 梦幻, 暖色, 暖金, 柔和, 浅绿, 浅蓝, 莫兰迪, 马卡龙, 高饱和, 长调, 低对比度, 阳光明媚, 清新
主题: 人像, 静物, 动物, 盲盒, 潮玩, 建筑设计, 花卉, 风景, 美食, 精灵, 天使
镜头: 特写, 全景, 俯拍, 等距视角, 85mm, 微距, 逆光, 丁达尔光, 体积光, 棚拍光, 轮廓光, 自然光
材质: 极致细节, 8K, 毛毡, 粘土, 折纸, 磨砂玻璃, 光线追踪, 油画质感, 水彩, 丙烯`;

  // 组件加载时异步从上一次的缓存中读取表结构，如果没网则兜底内置强壮字典
  chrome.storage.local.get(['promptCache', 'settings'], (res) => {
    let dict = null;
    if (res.promptCache && res.promptCache.tagCloud && res.promptCache.tagCloud.length > 0) {
       dict = res.promptCache.tagCloud;
    }
    
    if (dict) {
       TAG_DICTIONARY = dict;
    } else {
       TAG_DICTIONARY = parseTagCloudSettings(DEFAULT_TAG_CLOUD);
    }
    renderTagCloud();
    rebuildPromptSuggestPool();
  });

  loadPromptUsageStats();
  loadPromptFavorites();

  function loadPromptLibrary(forceRefresh = false) {
    if (!forceRefresh && cachedPrompts.length > 0) {
      resetPromptRenderLimit();
      renderPromptList(cachedPrompts);
      return;
    }

    promptList.innerHTML = `<div style="text-align:center; padding: 20px; color:#aaa;"><div class="spinner" style="margin: 0 auto 10px;"></div>正在拉取词库...</div>`;

    chrome.runtime.sendMessage({ action: 'fetchPrompts', forceRefresh: forceRefresh }, (response) => {
      if (chrome.runtime.lastError) {
        promptList.innerHTML = `<div style="text-align:center; padding: 20px; color:#ef4444;">连接后台失败：${chrome.runtime.lastError.message}</div>`;
        return;
      }
      if (response && response.success) {
        cachedPrompts = response.data || [];
        resetPromptRenderLimit();
        if (response.tagCloud && response.tagCloud.length > 0) {
          TAG_DICTIONARY = response.tagCloud;
          renderTagCloud();
        }
        rebuildPromptSuggestPool();
        renderPromptList(cachedPrompts);
      } else {
        const err = (response && response.error) ? response.error : '未知错误';
        promptList.innerHTML = `<div style="text-align:center; padding: 20px; color:#ef4444;">获取失败：${err}</div>`;
      }
    });
  }

  function renderPromptList(list) {
    promptList.innerHTML = '';
    const query = librarySearch.value.toLowerCase().trim();
    const activeTagsArr = Array.from(activeTags);
    const rankedList = (list || []).slice().sort((a, b) => {
      const fa = isPromptFavorite(a) ? 1 : 0;
      const fb = isPromptFavorite(b) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const sa = calcPromptScore(a);
      const sb = calcPromptScore(b);
      if (sa !== sb) return sb - sa;
      const ta = new Date(a.timestamp || 0).getTime() || 0;
      const tb = new Date(b.timestamp || 0).getTime() || 0;
      return tb - ta;
    });

    const filtered = [];
    for (let i = 0; i < rankedList.length; i++) {
      const item = rankedList[i];
      if (!matchesLibraryViewMode(item)) continue;
      const searchString = `${item.prompt || ''} ${item.category || ''} ${item.software || ''} ${item.note || ''}`.toLowerCase();
      
      // 检查搜索栏
      if (query && !searchString.includes(query)) continue;
      
      // 检查标签交集 (AND逻辑：所有选中的标签必须都存在)
      let tagsMatch = true;
      for (const t of activeTagsArr) {
        if (!searchString.includes(t.toLowerCase())) {
          tagsMatch = false;
          break;
        }
      }
      if (!tagsMatch) continue;

      filtered.push(item);
    }

    if (filtered.length === 0) {
      promptList.innerHTML = `<div style="text-align:center; padding: 20px; color:#aaa;">没有找到相关的提示词</div>`;
      return;
    }

    const visibleItems = filtered.slice(0, promptRenderLimit);

    visibleItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'prompt-card';
      const isTemplate = item.type === 'template';
      const badgeClass = isTemplate ? 'badge template' : 'badge history';
      const usageScore = calcPromptScore(item);
      const cloudCopyCount = Number(item.copyCount || item.copies || 0);
      const badgeText = isTemplate ? '模板' : '历史';
      
      // XSS 转义
      const safePrompt = (item.prompt || '').replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const safeNote = item.note ? ` - ${item.note}` : '';
      
      card.innerHTML = `
        <div style="position:relative;">
          ${item.previewUrl ? 
            `<img class="card-hero-img" src="${getThumbnailUrl(item.previewUrl)}" loading="lazy">` : 
            `<div class="card-hero-fallback">🖼️</div>`
          }
          <div class="card-img-overlay">
            <div class="overlay-actions">
              <button class="overlay-btn act-copy" data-prompt="${encodeURIComponent(item.prompt || '')}" title="复制提示词">📋</button>
              ${item.previewUrl ? `<button class="overlay-btn act-zoom" data-hq="${getThumbnailUrl(item.previewUrl)}" data-raw="${item.previewUrl}" title="大屏阅览">👁️</button>` : ''}
              ${item.previewUrl ? `<a href="${item.previewUrl}" target="_blank" class="overlay-btn" title="在新标签页原图访问" style="text-decoration:none;">🔗</a>` : ''}
            </div>
          </div>
        </div>
        <div class="card-inner-body">
          <div class="card-header">
            <div>
              <span class="${badgeClass}">${badgeText}</span>
              <span style="color:#aaa;font-size:10px;margin-left:6px;">${item.timestamp ? item.timestamp.substring(0,10) : ''}</span>
            </div>
          </div>
          <div class="card-body" title="${safePrompt}${safeNote}">${safePrompt}</div>
          <div class="card-tags">
            ${item.category ? `<span style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;">${item.category}</span>` : ''}
            ${item.software ? `<span style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;">${item.software}</span>` : ''}
          </div>
        </div>
      `;

      card.dataset.prompt = encodeURIComponent(item.prompt || '');
      card.dataset.software = encodeURIComponent(item.software || '');
      card.dataset.category = encodeURIComponent(item.category || '');
      card.dataset.type = encodeURIComponent(item.type || 'history');

      if (isPromptHot(item)) {
        const headerBox = card.querySelector('.card-header > div');
        if (headerBox) {
          const hotEl = document.createElement('span');
          hotEl.className = 'badge';
          hotEl.style.background = 'rgba(255,107,53,0.2)';
          hotEl.style.color = '#ffae8a';
          hotEl.style.border = '1px solid rgba(255,107,53,0.35)';
          hotEl.style.marginLeft = '6px';
          hotEl.textContent = cloudCopyCount > 0 ? `🔥 高频 ${cloudCopyCount}` : '🔥 高频';
          headerBox.insertBefore(hotEl, headerBox.children[1] || null);
        }
      }
      if (isPromptFavorite(item)) {
        const headerBox = card.querySelector('.card-header > div');
        if (headerBox) {
          const favEl = document.createElement('span');
          favEl.className = 'badge';
          favEl.style.background = 'rgba(251,188,4,0.2)';
          favEl.style.color = '#fbbc04';
          favEl.style.border = '1px solid rgba(251,188,4,0.45)';
          favEl.style.marginLeft = '6px';
          favEl.textContent = '⭐ 收藏';
          headerBox.insertBefore(favEl, headerBox.children[1] || null);
        }
      }

      const actionsBox = card.querySelector('.overlay-actions');
      const copyBtn = card.querySelector('.act-copy');
      if (actionsBox && copyBtn) {
        copyBtn.dataset.software = encodeURIComponent(item.software || '');
        copyBtn.dataset.category = encodeURIComponent(item.category || '');
        copyBtn.dataset.type = encodeURIComponent(item.type || 'history');

        const fillBtn = document.createElement('button');
        fillBtn.className = 'overlay-btn act-fill';
        fillBtn.setAttribute('data-prompt', encodeURIComponent(item.prompt || ''));
        fillBtn.setAttribute('data-software', encodeURIComponent(item.software || ''));
        fillBtn.setAttribute('data-category', encodeURIComponent(item.category || ''));
        fillBtn.setAttribute('data-type', encodeURIComponent(item.type || 'history'));
        fillBtn.setAttribute('title', '填入提示词');
        fillBtn.textContent = '✍️';
        actionsBox.insertBefore(fillBtn, copyBtn.nextSibling);

        const favBtn = document.createElement('button');
        favBtn.className = 'overlay-btn act-fav';
        favBtn.setAttribute('data-prompt', encodeURIComponent(item.prompt || ''));
        favBtn.setAttribute('data-software', encodeURIComponent(item.software || ''));
        favBtn.setAttribute('data-category', encodeURIComponent(item.category || ''));
        favBtn.setAttribute('data-type', encodeURIComponent(item.type || 'history'));
        favBtn.setAttribute('title', '收藏/取消收藏');
        favBtn.textContent = isPromptFavorite(item) ? '⭐' : '☆';
        if (isPromptFavorite(item)) favBtn.classList.add('favorite-on');
        actionsBox.insertBefore(favBtn, actionsBox.firstChild);
      }
      
      const imgEl = card.querySelector('.card-hero-img');
      if (imgEl && item.previewUrl) {
        imgEl.addEventListener('error', function() {
          const mountFallback = () => {
            const fallback = document.createElement('div');
            fallback.className = 'card-hero-fallback';
            fallback.innerHTML = '🔒';
            fallback.title = '安全限制跨域 / 无公网权限';
            this.replaceWith(fallback);
          };

          // 如果代理获取也失败了，才真正降级显示索图标
          if (this.dataset.triedBase64) return mountFallback();
          this.dataset.triedBase64 = "true";
          
          const driveId = extractDriveId(item.previewUrl);
          if (!driveId) return mountFallback(); // 阻断：非标准结构强退

          // 核心突破口：通知高权限 Background Service Worker 强行代理拉取图片并转化为无视防御的 Base64
          chrome.runtime.sendMessage({
            action: 'fetchImageBase64',
            url: `https://drive.google.com/thumbnail?id=${driveId}&sz=w400`
          }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success || (res.mimeType && res.mimeType.includes('text/html'))) {
               // 连后台请求都被挡了（比如私密文件重定向成了谷歌登录页抛出 html）
               mountFallback();
            } else {
               // Base64 Data URI 完全免疫当前网页的 CSP Content-Security-Policy 拦截！
               this.src = `data:${res.mimeType};base64,${res.data}`;
            }
          });
        });
      }
      
      promptList.appendChild(card);
    });

    if (filtered.length > visibleItems.length) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'refresh-btn';
      moreBtn.style.cssText = 'width:100%; margin: 8px 0 2px; padding: 10px; border-radius: 10px; border: 1px solid rgba(96,165,250,.55); color:#bfdbfe; background: rgba(37,99,235,.18); cursor:pointer;';
      moreBtn.textContent = `加载更多（${visibleItems.length} / ${filtered.length}）`;
      moreBtn.addEventListener('click', () => {
        promptRenderLimit += PROMPT_RENDER_STEP;
        renderPromptList(cachedPrompts);
      });
      promptList.appendChild(moreBtn);
    }

    // 绑定复制事件
    promptList.querySelectorAll('.act-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rawPrompt = decodeURIComponent(e.currentTarget.getAttribute('data-prompt'));
        const meta = {
          prompt: rawPrompt,
          software: decodeURIComponent(e.currentTarget.getAttribute('data-software') || ''),
          category: decodeURIComponent(e.currentTarget.getAttribute('data-category') || ''),
          type: decodeURIComponent(e.currentTarget.getAttribute('data-type') || 'history')
        };
        navigator.clipboard.writeText(rawPrompt).then(() => {
          trackPromptUsage(meta, 'copy');
          const originalHTML = e.currentTarget.innerHTML;
          e.currentTarget.innerHTML = `✨`;
          e.currentTarget.style.background = '#4ade80';
          e.currentTarget.style.borderColor = '#4ade80';
          
          setTimeout(() => {
            e.currentTarget.innerHTML = originalHTML;
            e.currentTarget.style.background = '';
            e.currentTarget.style.borderColor = '';
          }, 1500);
        });
      });
    });

    // 绑定画廊剧场大屏事件
    promptList.querySelectorAll('.act-fill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rawPrompt = decodeURIComponent(e.currentTarget.getAttribute('data-prompt'));
        const meta = {
          prompt: rawPrompt,
          software: decodeURIComponent(e.currentTarget.getAttribute('data-software') || ''),
          category: decodeURIComponent(e.currentTarget.getAttribute('data-category') || ''),
          type: decodeURIComponent(e.currentTarget.getAttribute('data-type') || 'history')
        };
        promptInput.value = rawPrompt;
        trackPromptUsage(meta, 'fill');
        tabsBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        const collectBtn = shadow.querySelector('.tab-btn[data-tab="tab-collect"]');
        if (collectBtn) collectBtn.classList.add('active');
        const collectTab = shadow.getElementById('tab-collect');
        if (collectTab) collectTab.classList.add('active');
        promptInput.focus();
        showStatus('success', '已填入提示词');
      });
    });

    promptList.querySelectorAll('.act-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const meta = {
          prompt: decodeURIComponent(e.currentTarget.getAttribute('data-prompt') || ''),
          software: decodeURIComponent(e.currentTarget.getAttribute('data-software') || ''),
          category: decodeURIComponent(e.currentTarget.getAttribute('data-category') || ''),
          type: decodeURIComponent(e.currentTarget.getAttribute('data-type') || 'history')
        };
        togglePromptFavorite(meta);
        renderPromptList(cachedPrompts);
      });
    });

    promptList.querySelectorAll('.act-zoom').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const hqUrl = e.currentTarget.getAttribute('data-hq');
        const rawUrl = e.currentTarget.getAttribute('data-raw');
        
        lightboxImg.dataset.triedBase64 = ""; // 重置标记
        lightboxImg.src = hqUrl;
        lightboxOverlay.style.display = 'flex';
        
        // 如果剧场模式加载也被强力拦截，尝试 Base64 代理突破
        lightboxImg.onerror = function() {
           if (!this.dataset.triedBase64) {
             this.dataset.triedBase64 = "true";
             const driveId = extractDriveId(rawUrl || hqUrl);
             if (driveId) {
                chrome.runtime.sendMessage({
                  action: 'fetchImageBase64',
                  url: `https://drive.google.com/uc?export=view&id=${driveId}`
                }, (res) => {
                  if (chrome.runtime.lastError || !res || !res.success || (res.mimeType && res.mimeType.includes('text/html'))) {
                    showErrorFallback();
                  } else {
                    this.src = `data:${res.mimeType};base64,${res.data}`;
                  }
                });
                return;
             }
           }
           showErrorFallback();
           
           function showErrorFallback() {
             lightboxImg.onerror = null; // 防止循环
             lightboxImg.src = ''; // 清空碎图
             // 动态插入错误提示
             const errorMsg = document.createElement('div');
             errorMsg.id = 'lightboxErrorMsg';
             errorMsg.style.position = 'absolute';
             errorMsg.style.color = '#fff';
             errorMsg.style.background = 'rgba(239,68,68,0.2)';
             errorMsg.style.padding = '20px';
             errorMsg.style.borderRadius = '12px';
             errorMsg.style.border = '1px solid #ef4444';
             errorMsg.style.textAlign = 'center';
             errorMsg.innerHTML = `
              <div style="font-size:40px;margin-bottom:10px">🔒</div>
              <div style="font-size:16px;margin-bottom:6px">顶级安全限制 (CSP防线) 无法突破</div>
              <div style="font-size:13px;color:#aaa;margin-bottom:15px">当前网站的安保级别过高，阻止了高清大图的加载传输。</div>
              <a href="${rawUrl || hqUrl}" target="_blank" style="display:inline-block;padding:8px 16px;background:#ef4444;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">在无限制新标签页中强势打开</a>
             `;
             
             const oldErr = shadow.getElementById('lightboxErrorMsg');
             if (oldErr) oldErr.remove();
             lightboxOverlay.appendChild(errorMsg);
           }
        };
        
        // 如果成功加载了，要确保移除错误提示
        lightboxImg.onload = function() {
           const oldErr = shadow.getElementById('lightboxErrorMsg');
           if (oldErr) oldErr.remove();
        }
        
        setTimeout(() => lightboxImg.style.opacity = '1', 10);
      });
    });
  }

  function setLibraryViewMode(mode) {
    const allowed = ['all', 'template', 'history', 'favorites', 'hot', 'preview'];
    libraryViewMode = allowed.includes(mode) ? mode : 'all';
    resetPromptRenderLimit();
    if (filterAllBtn) filterAllBtn.classList.toggle('active', libraryViewMode === 'all');
    if (filterTemplateBtn) filterTemplateBtn.classList.toggle('active', libraryViewMode === 'template');
    if (filterHistoryBtn) filterHistoryBtn.classList.toggle('active', libraryViewMode === 'history');
    if (filterFavBtn) filterFavBtn.classList.toggle('active', libraryViewMode === 'favorites');
    if (filterHotBtn) filterHotBtn.classList.toggle('active', libraryViewMode === 'hot');
    if (filterPreviewBtn) filterPreviewBtn.classList.toggle('active', libraryViewMode === 'preview');
    renderPromptList(cachedPrompts);
  }

  if (filterAllBtn) {
    filterAllBtn.addEventListener('click', () => setLibraryViewMode('all'));
  }
  if (filterTemplateBtn) {
    filterTemplateBtn.addEventListener('click', () => setLibraryViewMode('template'));
  }
  if (filterHistoryBtn) {
    filterHistoryBtn.addEventListener('click', () => setLibraryViewMode('history'));
  }
  if (filterFavBtn) {
    filterFavBtn.addEventListener('click', () => setLibraryViewMode('favorites'));
  }
  if (filterHotBtn) {
    filterHotBtn.addEventListener('click', () => setLibraryViewMode('hot'));
  }
  if (filterPreviewBtn) {
    filterPreviewBtn.addEventListener('click', () => setLibraryViewMode('preview'));
  }

  librarySearch.addEventListener('input', () => {
    resetPromptRenderLimit();
    renderPromptList(cachedPrompts);
  });
  refreshLibraryBtn.addEventListener('click', () => {
    resetPromptRenderLimit();
    loadPromptLibrary(true);
  });

  // 手动添加模板逻辑
  showAddTplBtn.addEventListener('click', () => {
    addTplBox.classList.add('active');
    shadow.getElementById('tplPrompt').focus();
  });
  
  hideAddTplBtn.addEventListener('click', () => addTplBox.classList.remove('active'));

  submitTplBtn.addEventListener('click', async () => {
    const category = tplCategorySelect.value.trim();
    const software = tplSoftwareSelect.value.trim();
    const prompt = shadow.getElementById('tplPrompt').value.trim();
    const note = shadow.getElementById('tplNote').value.trim();

    if (!prompt) {
      showStatus('error', '提示词不能为空！');
      shadow.getElementById('tplPrompt').focus();
      return;
    }

    submitTplBtn.disabled = true;
    submitTplBtn.innerHTML = '⏳ 保存中...';

    try {
      let templateImagePayload = {
        imageBase64: null,
        mimeType: 'image/png'
      };

      if (templateState.imageData) {
        const compressed = await compressImage(
          templateState.imageData,
          templateState.imageMimeType || 'image/png'
        );
        templateImagePayload = {
          imageBase64: compressed.data,
          mimeType: compressed.mimeType
        };
      }

      chrome.runtime.sendMessage({
        action: 'addTemplate',
        payload: {
          category,
          software,
          prompt,
          note,
          imageBase64: templateImagePayload.imageBase64,
          mimeType: templateImagePayload.mimeType
        }
      }, (res) => {
        submitTplBtn.disabled = false;
        submitTplBtn.innerHTML = '💾 保存到云端词库';

        if (res && res.success) {
          addTplBox.classList.remove('active');
          tplCategorySelect.value = '';
          tplSoftwareSelect.value = '';
          shadow.getElementById('tplPrompt').value = '';
          shadow.getElementById('tplNote').value = '';
          clearTemplateImagePreview();
          // 强制重新拉取云端，获得刚刚存进去的数据
          loadPromptLibrary(true); 
        } else {
          alert('保存失败: ' + (res ? res.error : '未知错误检查控制台'));
        }
      });
    } catch (err) {
      submitTplBtn.disabled = false;
      submitTplBtn.innerHTML = '💾 保存到云端词库';
      alert('模板预览图处理失败: ' + (err && err.message ? err.message : '未知错误'));
    }
  });

  // ============================================================
  // 消息监听（来自 background）
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openCollectPanel') {
      openPanel(message);
      sendResponse({ received: true });
    }
    return false;
  });

  updateRetryQueueUI();

})();
