/**
 * AI图片收集器 - Background Service Worker
 * 
 * 职责：
 * 1. 创建和管理右键菜单
 * 2. 监听快捷键命令
 * 3. 中转图片数据到 GAS Web App（处理跨域）
 * 4. 将图片URL转为base64（利用background的跨域能力）
 */

// ============================================================
// 右键菜单管理
// ============================================================

// 安装时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'collect-ai-image',
    title: '📸 收集此AI图片',
    contexts: ['image']
  });

  chrome.contextMenus.create({
    id: 'collect-ai-image-page',
    title: '📸 打开图片收集面板',
    contexts: ['page', 'selection']
  });

  // 初始化默认设置
  chrome.storage.local.get(['settings'], (result) => {
    if (!result.settings) {
      const defaultTagCloud = `地方: 室内, 室外, 花园, 门廊, 露台, 阳台, 湖边, 海边, 草地, 山顶, 山坡, 田园, 牧场, 街头, 巷子, 咖啡馆, 森林, 小溪
时间: 夜晚, 日景, 日出, 清晨, 上午, 午后, 下午, 傍晚, 黄昏, 蓝天, 白云, 晴天, 黄金时光, 星空, 初雪
风格: 欧美, 美式, 欧式, 法式, 英伦, 东南亚, 日系, 韩系, 极简风, 波普艺术, 复古风, 童话风, 插画风, 古典主义
色调: 唯美, 梦幻, 暖色, 暖金, 柔和, 浅绿, 浅蓝, 莫兰迪, 马卡龙, 高饱和, 长调, 低对比度, 阳光明媚, 清新
主题: 人像, 静物, 动物, 盲盒, 潮玩, 建筑设计, 花卉, 风景, 美食, 精灵, 天使
镜头: 特写, 全景, 俯拍, 等距视角, 85mm, 微距, 逆光, 丁达尔光, 体积光, 棚拍光, 轮廓光, 自然光
材质: 极致细节, 8K, 毛毡, 粘土, 折纸, 磨砂玻璃, 光线追踪, 油画质感, 水彩, 丙烯`;

      chrome.storage.local.set({
        settings: {
          gasUrl: '',
          websiteUrl: '',
          sheetId: '',
          driveFolderId: '',
          userName: '',
          softwareList: [
            'Whisk - labs.google/fx',
            'Midjourney',
            'DALL-E 3',
            'Stable Diffusion',
            'Flux',
            'Leonardo AI',
            'Ideogram',
            'Adobe Firefly',
            'Kling AI',
            'Jimeng (即梦)'
          ],
          categoryList: [
            'AI词库',
            'MV素材',
            '海报',
            '壁纸',
            '头像',
            '写真',
            '插画',
            '产品图',
            'Logo',
            '概念设计'
          ],
          lastUsed: {
            software: '',
            category: '',
          }
        }
      });
    }
  });
});

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'collect-ai-image') {
    handleImageRightClick(info, tab);
  } else if (info.menuItemId === 'collect-ai-image-page') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'openCollectPanel',
      mode: 'paste'
    });
  }
});

// 处理图片右键点击：获取图片并转base64
async function handleImageRightClick(info, tab) {
  const imageUrl = info.srcUrl;
  
  try {
    const base64Data = await fetchImageAsBase64(imageUrl);
    chrome.tabs.sendMessage(tab.id, {
      action: 'openCollectPanel',
      mode: 'image',
      imageData: base64Data.data,
      imageMimeType: base64Data.mimeType,
      sourceUrl: imageUrl,
      pageUrl: info.pageUrl
    });
  } catch (err) {
    console.error('获取图片失败:', err);
    chrome.tabs.sendMessage(tab.id, {
      action: 'openCollectPanel',
      mode: 'paste',
      sourceUrl: imageUrl,
      pageUrl: info.pageUrl,
      error: '无法自动获取图片，请手动粘贴'
    });
  }
}

// 跨域获取图片并转为base64
async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  const mimeType = blob.type || 'image/png';
  
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  const base64 = btoa(binary);
  
  return { data: base64, mimeType };
}

// ============================================================
// 快捷键命令监听
// ============================================================

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'collect-image') {
    // tab 在 MV3 中可能为 null（例如焦点在 DevTools 或非标签页窗口时）
    let targetTabId = tab?.id;

    if (!targetTabId) {
      // 备选方案：查询当前活动标签页
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTabId = activeTab?.id;
      } catch (err) {
        console.error('[AI收集器] 无法获取活动标签页:', err);
        return;
      }
    }

    if (!targetTabId) {
      console.warn('[AI收集器] 没有可用的标签页来打开收集面板');
      return;
    }

    chrome.tabs.sendMessage(targetTabId, {
      action: 'openCollectPanel',
      mode: 'paste'
    });
  }
});

// ============================================================
// 消息处理（来自 content script）
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sendToGAS') {
    sendToGAS(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'fetchImageBase64') {
    fetchImageAsBase64(message.url)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'fetchPrompts') {
    fetchPromptsFromGAS(message.forceRefresh)
      .then(res => sendResponse({ success: true, data: res.data, tagCloud: res.tagCloud }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'addTemplate') {
    addTemplateToGAS(message.payload)
      .then(data => sendResponse({ success: true, data: data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'syncConfigUpload') {
    syncConfigGAS('syncConfigUpload', message.payload)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'syncConfigDownload') {
    syncConfigGAS('syncConfigDownload', null)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'syncConfigListBackups') {
    syncConfigGAS('syncConfigListBackups', null)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'syncConfigRestoreBackup') {
    syncConfigGAS('syncConfigRestoreBackup', message.payload)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ============================================================
// 发送数据到 GAS Web App
// ============================================================

async function sendToGAS(payload) {
  const { settings } = await chrome.storage.local.get(['settings']);
  
  if (!settings || !settings.gasUrl) {
    throw new Error('请先在扩展设置中配置 GAS Web App URL');
  }

  var bodyData = JSON.stringify({
    imageBase64: payload.imageBase64,
    mimeType: payload.mimeType,
    prompt: payload.prompt,
    userName: payload.userName,
    software: payload.software,
    category: payload.category,
    note: payload.note,
    sourceUrl: payload.sourceUrl,
    pageUrl: payload.pageUrl,
    timestamp: payload.timestamp,
    sheetId: settings.sheetId,
    driveFolderId: settings.driveFolderId
  });

  console.log('[AI收集器] 发送到GAS, URL:', settings.gasUrl);
  console.log('[AI收集器] 数据大小:', (bodyData.length / 1024).toFixed(1), 'KB');

  try {
    var response = await fetch(settings.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: bodyData,
      redirect: 'follow'
    });

    console.log('[AI收集器] 响应状态:', response.status, response.statusText);
    console.log('[AI收集器] 响应URL:', response.url);
    console.log('[AI收集器] 响应类型:', response.type);

    var text = await response.text();
    console.log('[AI收集器] 响应内容(前800字):', text.substring(0, 800));
    
    // 策略1: 直接解析为 JSON
    try {
      var json = JSON.parse(text);
      if (json.success === false) {
        throw new Error(json.error || 'GAS 返回了错误');
      }
      return json;
    } catch (e) {
      console.log('[AI收集器] 非纯JSON，尝试其他解析策略');
    }

    // 策略2: 从 HTML 中提取嵌入的 JSON
    var jsonMatch = text.match(/\{"success"\s*:\s*(true|false)[^}]*\}/);
    if (jsonMatch) {
      try {
        var extracted = JSON.parse(jsonMatch[0]);
        console.log('[AI收集器] 从HTML提取到JSON:', extracted);
        if (extracted.success === false) {
          throw new Error(extracted.error || 'GAS 执行出错');
        }
        return extracted;
      } catch (e2) { /* 继续 */ }
    }

    // 策略3: 检查授权/登录页面
    if (text.indexOf('Authorization') >= 0 || text.indexOf('authorize') >= 0) {
      throw new Error('GAS 需要授权！请在 Apps Script 中运行 initDataSheet');
    }
    if (text.indexOf('accounts.google.com') >= 0) {
      throw new Error('部署时请选择"任何人"可访问');
    }

    // 策略4: HTTP 200 但不是 JSON — GAS 很可能已执行成功
    if (response.ok) {
      console.warn('[AI收集器] HTTP 200 非JSON，视为成功。请检查表格确认');
      return { success: true, message: '已发送（请检查表格确认）' };
    }

    throw new Error('GAS 响应异常 (HTTP ' + response.status + ')');
  } catch (fetchErr) {
    if (fetchErr.message.indexOf('Failed to fetch') >= 0 || fetchErr.message.indexOf('NetworkError') >= 0) {
      throw new Error('网络请求失败：URL不正确或被广告拦截器阻止');
    }
    throw fetchErr;
  }
}

// ============================================================
// 获取词库（带缓存）
// ============================================================
async function fetchPromptsFromGAS(forceRefresh = false) {
  const { settings, promptCache } = await chrome.storage.local.get(['settings', 'promptCache']);
  
  if (!settings || !settings.gasUrl) {
    throw new Error('请先在扩展设置中配置 GAS Web App URL');
  }

  // 默认缓存 4 小时 (毫秒)
  const now = Date.now();
  if (!forceRefresh && promptCache && promptCache.timestamp && (now - promptCache.timestamp < 14400000)) {
    console.log('[AI收集器] 从本地缓存加载词库 (共', promptCache.data.length, '条)');
    return { data: promptCache.data, tagCloud: promptCache.tagCloud || null };
  }

  console.log('[AI收集器] 正在从 GAS 重新拉取词库...');
  const response = await fetch(settings.gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ 
       action: 'fetchPrompts',
       sheetId: settings.sheetId,
       driveFolderId: settings.driveFolderId
    }),
    redirect: 'follow'
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch(e) {
    // 提取可能内嵌在 HTML 中的 JSON
    const jsonMatch = text.match(/\{"success"\s*:\s*(true|false)[\s\S]*?\}/);
    if (jsonMatch) {
      try { json = JSON.parse(jsonMatch[0]); } catch(e2) {}
    }
  }

  if (!json || !json.success) {
    throw new Error((json && json.error) ? json.error : '获取词库失败');
  }

  // 保存到缓存
  await chrome.storage.local.set({
    promptCache: {
      timestamp: now,
      data: json.data || [],
      tagCloud: json.tagCloud || null
    }
  });

  console.log('[AI收集器] 词库拉取完成并缓存 (共', (json.data || []).length, '条)');
  return { data: json.data || [], tagCloud: json.tagCloud || null };
}

// ============================================================
// 添加模板到云端
// ============================================================
async function addTemplateToGAS(payload) {
  const { settings } = await chrome.storage.local.get(['settings']);
  
  if (!settings || !settings.gasUrl) {
    throw new Error('请先在扩展设置中配置 GAS Web App URL');
  }

  const response = await fetch(settings.gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ 
       action: 'addTemplate', 
       sheetId: settings.sheetId,
       driveFolderId: settings.driveFolderId,
       ...payload 
    }),
    redirect: 'follow'
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch(e) {
    const jsonMatch = text.match(/\{"success"\s*:\s*(true|false)[\s\S]*?\}/);
    if (jsonMatch) json = JSON.parse(jsonMatch[0]);
  }

  if (!json || !json.success) {
    throw new Error((json && json.error) ? json.error : '添加失败');
  }

  return json;
}

// ============================================================
// 通用配置同步 (云游互传)
// ============================================================
async function syncConfigGAS(action, payload) {
  const { settings } = await chrome.storage.local.get(['settings']);
  
  if (!settings || !settings.gasUrl) {
    throw new Error('请配置 GAS URL');
  }

  const fetchBody = { 
    action: action,
    sheetId: settings.sheetId,
    driveFolderId: settings.driveFolderId
  };
  if (payload) {
    fetchBody.payload = JSON.stringify(payload); // 序列化后存储更安全
  }

  const response = await fetch(settings.gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(fetchBody),
    redirect: 'follow'
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch(e) {
    const jsonMatch = text.match(/\{"success"\s*:\s*(true|false)[\s\S]*?\}/);
    if (jsonMatch) json = JSON.parse(jsonMatch[0]);
  }

  if (!json) {
    throw new Error('远程服务器响应了无效的格式');
  }
  if (!json.success) {
    throw new Error(json.error || '遇到错误，是否未部署新版本？');
  }

  if (json.data && typeof json.data === 'string') {
    try {
      json.data = JSON.parse(json.data);
    } catch(e) {}
  }
  return json;
}
