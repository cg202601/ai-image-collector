/**
 * AI图片收集器 - Popup 设置页面逻辑
 * 
 * 职责：
 * 1. 加载和保存配置到 chrome.storage.local
 * 2. 管理软件列表（添加/删除标签）
 * 3. 管理分类列表（添加/删除标签）
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM 引用
  const gasUrlInput = document.getElementById('gasUrl');
  const websiteUrlInput = document.getElementById('websiteUrl');
  const sheetIdInput = document.getElementById('sheetId');
  const driveFolderIdInput = document.getElementById('driveFolderId');
  const userNameInput = document.getElementById('userName');
  const softwareListEl = document.getElementById('softwareList');
  const categoryListEl = document.getElementById('categoryList');
  const saveBtn = document.getElementById('saveBtn');
  const openPanelBtn = document.getElementById('openPanelBtn');
  const statusMsg = document.getElementById('statusMsg');
  const collapseBtns = document.querySelectorAll('.collapse-btn');
  const SECTION_COLLAPSE_KEY = 'popupSectionCollapsed';

  // 软件管理
  const addSoftwareBtn = document.getElementById('addSoftwareBtn');
  const addSoftwareRow = document.getElementById('addSoftwareRow');
  const newSoftwareInput = document.getElementById('newSoftwareInput');
  const confirmSoftwareBtn = document.getElementById('confirmSoftwareBtn');
  const cancelSoftwareBtn = document.getElementById('cancelSoftwareBtn');

  // 分类管理
  const addCategoryBtn = document.getElementById('addCategoryBtn');
  const addCategoryRow = document.getElementById('addCategoryRow');
  const newCategoryInput = document.getElementById('newCategoryInput');
  const confirmCategoryBtn = document.getElementById('confirmCategoryBtn');
  const cancelCategoryBtn = document.getElementById('cancelCategoryBtn');

  // 当前设置
  let currentSettings = {};

  // ============================================================
  // 加载设置
  // ============================================================
  function loadSettings() {
    chrome.storage.local.get(['settings'], (result) => {
      currentSettings = result.settings || {};

      gasUrlInput.value = currentSettings.gasUrl || '';
      websiteUrlInput.value = currentSettings.websiteUrl || '';
      sheetIdInput.value = currentSettings.sheetId || '';
      driveFolderIdInput.value = currentSettings.driveFolderId || '';
      userNameInput.value = currentSettings.userName || '';

      renderTagList(softwareListEl, currentSettings.softwareList || [], 'software');
      renderTagList(categoryListEl, currentSettings.categoryList || [], 'category');
    });
  }

  // ============================================================
  // 渲染标签列表
  // ============================================================
  function renderTagList(container, items, type) {
    container.innerHTML = '';
    items.forEach((item, index) => {
      const tag = document.createElement('span');
      tag.className = 'tag-item';
      tag.innerHTML = `
        <span>${item}</span>
        <button class="tag-delete" data-type="${type}" data-index="${index}" title="删除">✕</button>
      `;
      container.appendChild(tag);
    });

    // 绑定删除事件
    container.querySelectorAll('.tag-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const t = e.currentTarget.dataset.type;
        const i = parseInt(e.currentTarget.dataset.index);
        if (t === 'software') {
          currentSettings.softwareList.splice(i, 1);
          renderTagList(softwareListEl, currentSettings.softwareList, 'software');
        } else {
          currentSettings.categoryList.splice(i, 1);
          renderTagList(categoryListEl, currentSettings.categoryList, 'category');
        }
      });
    });
  }

  // ============================================================
  // 添加软件
  // ============================================================
  addSoftwareBtn.addEventListener('click', () => {
    addSoftwareRow.classList.remove('hidden');
    newSoftwareInput.focus();
  });

  cancelSoftwareBtn.addEventListener('click', () => {
    addSoftwareRow.classList.add('hidden');
    newSoftwareInput.value = '';
  });

  confirmSoftwareBtn.addEventListener('click', () => addNewSoftware());
  newSoftwareInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNewSoftware();
    if (e.key === 'Escape') {
      addSoftwareRow.classList.add('hidden');
      newSoftwareInput.value = '';
    }
  });

  function addNewSoftware() {
    const val = newSoftwareInput.value.trim();
    if (!val) return;
    if (!currentSettings.softwareList) currentSettings.softwareList = [];
    if (currentSettings.softwareList.includes(val)) {
      showStatus('error', '该软件已存在');
      return;
    }
    currentSettings.softwareList.push(val);
    renderTagList(softwareListEl, currentSettings.softwareList, 'software');
    newSoftwareInput.value = '';
    addSoftwareRow.classList.add('hidden');
  }

  // ============================================================
  // 添加分类
  // ============================================================
  addCategoryBtn.addEventListener('click', () => {
    addCategoryRow.classList.remove('hidden');
    newCategoryInput.focus();
  });

  cancelCategoryBtn.addEventListener('click', () => {
    addCategoryRow.classList.add('hidden');
    newCategoryInput.value = '';
  });

  confirmCategoryBtn.addEventListener('click', () => addNewCategory());
  newCategoryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNewCategory();
    if (e.key === 'Escape') {
      addCategoryRow.classList.add('hidden');
      newCategoryInput.value = '';
    }
  });

  function addNewCategory() {
    const val = newCategoryInput.value.trim();
    if (!val) return;
    if (!currentSettings.categoryList) currentSettings.categoryList = [];
    if (currentSettings.categoryList.includes(val)) {
      showStatus('error', '该分类已存在');
      return;
    }
    currentSettings.categoryList.push(val);
    renderTagList(categoryListEl, currentSettings.categoryList, 'category');
    newCategoryInput.value = '';
    addCategoryRow.classList.add('hidden');
  }

  // ============================================================
  // 保存设置
  // ============================================================
  saveBtn.addEventListener('click', () => {
    currentSettings.gasUrl = gasUrlInput.value.trim();
    currentSettings.websiteUrl = websiteUrlInput.value.trim();
    currentSettings.sheetId = sheetIdInput.value.trim();
    currentSettings.driveFolderId = driveFolderIdInput.value.trim();
    currentSettings.userName = userNameInput.value.trim();

    // 验证必填项
    if (!currentSettings.gasUrl) {
      showStatus('error', '请填写 GAS Web App URL');
      gasUrlInput.focus();
      return;
    }

    chrome.storage.local.set({ settings: currentSettings }, () => {
      if (chrome.runtime.lastError) {
        showStatus('error', '保存失败: ' + chrome.runtime.lastError.message);
      } else {
        showStatus('success', '✅ 设置已保存');
      }
    });
  });

  // ============================================================
  // 状态提示
  // ============================================================
  function showStatus(type, message) {
    statusMsg.className = 'status-msg ' + type;
    statusMsg.textContent = message;
    setTimeout(() => {
      statusMsg.className = 'status-msg';
    }, 3000);
  }

  function setCollapseVisual(btn, collapsed) {
    btn.textContent = collapsed ? '展开' : '收起';
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function applySectionCollapsed(btn, collapsed) {
    const section = btn.closest('.section');
    if (!section) return;
    section.classList.toggle('collapsed', collapsed);
    setCollapseVisual(btn, collapsed);
  }

  function initCollapsibleSections() {
    chrome.storage.local.get([SECTION_COLLAPSE_KEY], (result) => {
      const sectionCollapsedMap = result[SECTION_COLLAPSE_KEY] || {};

      collapseBtns.forEach((btn) => {
        const section = btn.closest('.section');
        if (!section) return;
        const sectionKey = section.dataset.sectionKey || btn.dataset.target || '';
        const collapsed = !!sectionCollapsedMap[sectionKey];
        applySectionCollapsed(btn, collapsed);
      });
    });

    collapseBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = btn.closest('.section');
        if (!section) return;

        const sectionKey = section.dataset.sectionKey || btn.dataset.target || '';
        const nextCollapsed = !section.classList.contains('collapsed');
        applySectionCollapsed(btn, nextCollapsed);

        chrome.storage.local.get([SECTION_COLLAPSE_KEY], (result) => {
          const map = result[SECTION_COLLAPSE_KEY] || {};
          map[sectionKey] = nextCollapsed;
          chrome.storage.local.set({ [SECTION_COLLAPSE_KEY]: map });
        });
      });
    });
  }

  // ============================================================
  // 手动打开收集面板（替代 Alt+C）
  // ============================================================
  openPanelBtn.addEventListener('click', async () => {
    openPanelBtn.disabled = true;
    openPanelBtn.innerHTML = '<span>⏳</span><span>正在打开面板...</span>';

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];

      if (!activeTab || !activeTab.id) {
        throw new Error('未找到当前标签页');
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { action: 'openCollectPanel', mode: 'paste' },
        () => {
          if (chrome.runtime.lastError) {
            showStatus('error', '当前页面不支持打开面板（请在普通网页中使用）');
            openPanelBtn.disabled = false;
            openPanelBtn.innerHTML = '<span>🪄</span><span>打开收集面板（替代 Alt+C）</span>';
            return;
          }

          showStatus('success', '✅ 已尝试打开收集面板');
          openPanelBtn.disabled = false;
          openPanelBtn.innerHTML = '<span>🪄</span><span>打开收集面板（替代 Alt+C）</span>';
        }
      );
    } catch (err) {
      showStatus('error', '打开失败: ' + (err && err.message ? err.message : '未知错误'));
      openPanelBtn.disabled = false;
      openPanelBtn.innerHTML = '<span>🪄</span><span>打开收集面板（替代 Alt+C）</span>';
    }
  });

  // ============================================================
  // 测试 GAS 连接
  // ============================================================
  const testBtn = document.getElementById('testBtn');
  
  testBtn.addEventListener('click', async () => {
    const url = gasUrlInput.value.trim();
    if (!url) {
      showStatus('error', '请先填写 GAS Web App URL');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = '⏳ 测试中...';
    showStatus('', '');

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow'
      });

      const text = await response.text();
      console.log('[测试] 响应状态:', response.status);
      console.log('[测试] 响应内容:', text.substring(0, 500));

      try {
        const json = JSON.parse(text);
        if (json.success) {
          // 显示详细的诊断信息
          let msg = '✅ GAS 连接成功！';
          if (json.version) msg += `\n版本: ${json.version}`;
          if (json.sheetStatus) msg += `\n表格状态: ${json.sheetStatus}`;
          
          showStatus('success', msg);
          
          // 如果版本低于 1.2.0，明确提示用户重新部署
          if (!json.version || json.version < '1.2.0') {
            setTimeout(() => {
              showStatus('error', '⚠️ 警告: GAS 代码未更新！\n请在 Apps Script 中点击 [部署]->[管理部署]->编辑->[新版本]->[部署]！');
            }, 3000);
          }
        } else {
          showStatus('error', 'GAS 返回错误: ' + (json.error || JSON.stringify(json)));
        }
      } catch {
        if (text.includes('Authorization') || text.includes('authorize')) {
          showStatus('error', '❌ GAS 需要授权！请在 Apps Script 中运行 initDataSheet 函数来授权');
        } else if (text.includes('accounts.google.com')) {
          showStatus('error', '❌ 部署时请选择"任何人"可访问');
        } else {
          showStatus('error', 'GAS 返回了非 JSON 响应 (HTTP ' + response.status + ')。\n请检查 URL 是否以 /exec 结尾');
        }
      }
    } catch (err) {
      showStatus('error', '❌ 连接失败: ' + err.message + '\n请检查 URL 是否正确');
    }

    testBtn.disabled = false;
    testBtn.innerHTML = '<span>🔍</span><span>测试 GAS 连通</span>';
  });

  // ============================================================
  // 导入/导出配置
  // ============================================================
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');

  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['settings'], (result) => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.settings || {}, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "ai_collector_config.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      showStatus('success', '✅ 配置已导出');
    });
  });

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedSettings = JSON.parse(event.target.result);
        if (typeof importedSettings === 'object' && !Array.isArray(importedSettings)) {
          chrome.storage.local.set({ settings: importedSettings }, () => {
            currentSettings = importedSettings;
            loadSettings(); // 重新渲染界面内容
            showStatus('success', '✅ 配置导入成功');
          });
        } else {
          showStatus('error', '❌ 配置文件格式不正确');
        }
      } catch (err) {
        showStatus('error', '❌ 读取 json 失败');
      }
      importFile.value = ''; // 清空，便于重复选同名文件
    };
    reader.readAsText(file);
  });

  // ============================================================
  // 云端漫游 (Cloud Sync)
  // ============================================================
  const uploadCloudBtn = document.getElementById('uploadCloudBtn');
  const downloadCloudBtn = document.getElementById('downloadCloudBtn');
  const listCloudBackupsBtn = document.getElementById('listCloudBackupsBtn');
  const cloudBackupListWrap = document.getElementById('cloudBackupListWrap');
  const cloudBackupList = document.getElementById('cloudBackupList');

  function formatBackupTime(raw) {
    if (!raw || raw.length !== 15) return raw || '';
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}`;
  }

  function renderCloudBackups(backups) {
    cloudBackupList.innerHTML = '';
    if (!backups || backups.length === 0) {
      cloudBackupList.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.6);padding:6px 4px;">暂无备份版本</div>';
      cloudBackupListWrap.classList.remove('hidden');
      return;
    }

    backups.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cloud-backup-item';
      const displayTime = formatBackupTime(item.backupAt);
      row.innerHTML = `
        <div class="cloud-backup-meta">
          <div class="cloud-backup-key">${item.versionKey || ''}</div>
          <div class="cloud-backup-time">${displayTime || ''}</div>
        </div>
        <button class="cloud-backup-restore-btn" data-version-key="${item.versionKey || ''}">恢复</button>
      `;
      cloudBackupList.appendChild(row);
    });

    cloudBackupList.querySelectorAll('.cloud-backup-restore-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const versionKey = btn.dataset.versionKey;
        if (!versionKey) return;

        btn.disabled = true;
        btn.textContent = '恢复中...';
        chrome.runtime.sendMessage({
          action: 'syncConfigRestoreBackup',
          payload: { versionKey }
        }, (res) => {
          if (res && res.success && res.data) {
            chrome.storage.local.set({ settings: res.data }, () => {
              currentSettings = res.data;
              loadSettings();
              showStatus('success', `✅ 已恢复备份：${versionKey}`);
            });
          } else {
            showStatus('error', '❌ 恢复失败: ' + (res ? res.error : '响应异常'));
          }
          btn.disabled = false;
          btn.textContent = '恢复';
        });
      });
    });

    cloudBackupListWrap.classList.remove('hidden');
  }

  uploadCloudBtn.addEventListener('click', () => {
    chrome.storage.local.get(['settings'], (result) => {
      if (!result.settings || !result.settings.gasUrl) {
        return showStatus('error', '❌ 请先填好第一个格子里的 GAS URL 并保存');
      }
      uploadCloudBtn.disabled = true;
      uploadCloudBtn.innerHTML = '⏳ 上传中...';

      chrome.runtime.sendMessage({
        action: 'syncConfigUpload',
        payload: result.settings
      }, (res) => {
        uploadCloudBtn.disabled = false;
        uploadCloudBtn.innerHTML = '📤 本地上云';
        
        if (res && res.success) {
          if (res.versionKey) {
            showStatus('success', `✅ 云端配置漫游成功，备份版本：${res.versionKey}`);
            return;
          }
          showStatus('success', '✅ 云端配置漫游成功！');
        } else {
          showStatus('error', '❌ 上传失败: ' + (res ? res.error : '获取反馈异常'));
        }
      });
    });
  });

  downloadCloudBtn.addEventListener('click', () => {
    chrome.storage.local.get(['settings'], (result) => {
      if (!result.settings || !result.settings.gasUrl) {
        return showStatus('error', '❌ 请先填好 GAS URL 并确认连通');
      }
      downloadCloudBtn.disabled = true;
      downloadCloudBtn.innerHTML = '⏳ 下载中...';

      chrome.runtime.sendMessage({ action: 'syncConfigDownload' }, (res) => {
        downloadCloudBtn.disabled = false;
        downloadCloudBtn.innerHTML = '📥 云端下载';
        
        if (res && res.success && res.data) {
          chrome.storage.local.set({ settings: res.data }, () => {
            currentSettings = res.data;
            loadSettings(); // 重新渲染界面
            showStatus('success', '✅ 配置已覆盖为云端最新版！');
          });
        } else {
          showStatus('error', '❌ 下载失败: ' + (res ? res.error : '可能是首次使用，请先上传一次配置哦'));
        }
      });
    });
  });

  // 初始加载
  listCloudBackupsBtn.addEventListener('click', () => {
    listCloudBackupsBtn.disabled = true;
    listCloudBackupsBtn.textContent = '⏳ 加载中...';
    chrome.runtime.sendMessage({ action: 'syncConfigListBackups' }, (res) => {
      listCloudBackupsBtn.disabled = false;
      listCloudBackupsBtn.textContent = '🗂️ 查看备份版本';
      if (res && res.success) {
        renderCloudBackups(res.backups || []);
        const count = (res.backups || []).length;
        showStatus('success', `✅ 已加载 ${count} 个备份版本`);
      } else {
        showStatus('error', '❌ 获取备份失败: ' + (res ? res.error : '响应异常'));
      }
    });
  });

  loadSettings();
  initCollapsibleSections();
});
