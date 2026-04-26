/**
 * AI图片收集器 - Google Apps Script (GAS)
 * 
 * 部署方式：
 * 1. 打开 Google Sheets → 扩展程序 → Apps Script
 * 2. 将此代码粘贴到 Code.gs
 * 3. 部署 → 新建部署 → Web 应用
 *    - 执行身份：我自己
 *    - 谁可以访问：任何人
 * 4. 复制部署 URL，填入 Chrome 扩展设置
 * 
 * 表格结构（Data 表）：
 * A列: 时间 | B列: 人名 | C列: 软件 | D列: 项目链接 | E列: 图片链接 | F列: 生成图 | G列: 提示词 | H列: 备注 | I列: 图库分类
 */

// [可选] 默认兜底表格 ID。
// 现在主要由前端插件动态下发，此处可留空。仅在前端未发送时做保底使用。
var SPREADSHEET_ID = '';

// ============================================================
// Web App 入口
// ============================================================

function doPost(e) {
  var log = [];
  
  try {
    log.push('doPost 开始执行');
    var data = JSON.parse(e.postData.contents);
    
    // 核心改进：支持“一份代码多表混用”
    // 优先读取前端插件动态传递的目标表格 ID，如没有则退回到脚本硬编码的默认兼容 ID
    var targetSheetId = data.sheetId || SPREADSHEET_ID;
    if (!targetSheetId) {
      throw new Error('缺失目标表格 ID (sheetId)。请检查插件设置。');
    }
    
    var ss = SpreadsheetApp.openById(targetSheetId);

    // ===================================
    // 处理插件拉取词库的请求
    // ===================================
    if (data.action === 'fetchPrompts') {
      log.push('请求拉取词库数据');
      return fetchPromptsAction(ss, log);
    }

    // ===================================
    // 处理插件直接添加模板的请求
    // ===================================
    if (data.action === 'addTemplate') {
      log.push('请求添加模板');
      return addTemplateAction(ss, data, log);
    }

    // ===================================
    // 处理配置漫游 (云上传/云下载)
    // ===================================
    if (data.action === 'syncConfigUpload') {
      log.push('请求上传漫游配置');
      return syncConfigAction(ss, 'upload', data.payload, log);
    }
    
    if (data.action === 'syncConfigDownload') {
      log.push('请求下载漫游配置');
      return syncConfigAction(ss, 'download', null, log);
    }
    
    if (data.action === 'syncConfigListBackups') {
      log.push('list cloud config backups');
      return syncConfigAction(ss, 'listBackups', null, log);
    }

    if (data.action === 'syncConfigRestoreBackup') {
      log.push('restore cloud config backup');
      return syncConfigAction(ss, 'restoreBackup', data.payload, log);
    }

    var sheet = ss.getSheetByName('Data');
    
    if (!sheet) {
      sheet = ss.insertSheet('Data');
      var headers = ['时间', '人名', '软件', '项目链接', '图片链接', '生成图', '提示词', '备注', '图库分类'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#1a73e8')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    
    // 上传图片到 Google Drive
    var imageUrl = '';
    var driveFileId = '';
    
    if (data.imageBase64) {
      log.push('开始上传图片到 Drive...');
      var result = uploadImageToDrive(data);
      imageUrl = result.url;
      driveFileId = result.fileId;
      log.push('图片上传成功: ' + driveFileId);
    }
    
    // 追加数据到 Data 表
    var lastRow = sheet.getLastRow() + 1;
    
    // 优先使用前端传来的时间，避免 GAS 的 Session 时区获取失败
    var timestamp = data.timestamp || new Date().toISOString(); 
    try {
      if (!data.timestamp) {
         timestamp = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
      }
    } catch(e) {}
    
    var rowData = [
      timestamp,
      data.userName || '',
      data.software || '',
      data.sourceUrl || '',
      imageUrl,
      '',
      data.prompt || '',
      data.note || '',
      data.category || ''
    ];
    
    log.push('准备写入第 ' + lastRow + ' 行');
    sheet.getRange(lastRow, 1, 1, rowData.length).setValues([rowData]);
    log.push('数据写入成功');
    
    // 设置 IMAGE 公式，如果这里报错也不影响整行数据
    if (imageUrl) {
      try {
        sheet.getRange(lastRow, 6).setFormula('=IMAGE("' + imageUrl + '")');
        log.push('IMAGE 公式设置成功');
      } catch (err) {
        log.push('IMAGE 公式设置失败: ' + err.message);
      }
    }
    
    // 设置行高
    try {
      sheet.setRowHeight(lastRow, 150);
    } catch (err) {}
    
    return ContentService.createTextOutput(
      JSON.stringify({
        success: true,
        message: '图片已保存到第 ' + lastRow + ' 行',
        imageUrl: imageUrl,
        row: lastRow,
        log: log
      })
    ).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    log.push('FATAL ERROR: ' + error.message);
    
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: error.message || '未知错误',
        log: log
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var sheetStatus = '未检查';
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Data');
    sheetStatus = sheet ? ('Data 表存在，' + sheet.getLastRow() + ' 行') : 'Data 表不存在';
  } catch (err) {
    sheetStatus = '无法访问: ' + err.message;
  }
  
  return ContentService.createTextOutput(
    JSON.stringify({
      success: true,
      message: 'AI图片收集器 GAS 服务正常',
      sheetStatus: sheetStatus,
      spreadsheetId: SPREADSHEET_ID,
      version: '1.9.1'
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 图片上传
// ============================================================

function uploadImageToDrive(data) {
  var imageBlob = Utilities.newBlob(
    Utilities.base64Decode(data.imageBase64),
    data.mimeType || 'image/png',
    generateFileName(data)
  );
  
  var mainFolder;
  if (data.driveFolderId) {
    try {
      mainFolder = DriveApp.getFolderById(data.driveFolderId);
    } catch (e) {
      mainFolder = DriveApp.getRootFolder();
    }
  } else {
    var folders = DriveApp.getFoldersByName('AI图片收集');
    if (folders.hasNext()) {
      mainFolder = folders.next();
    } else {
      mainFolder = DriveApp.createFolder('AI图片收集');
    }
  }
  
  var targetFolder = mainFolder;
  // 分类自动创建路由：如果用户设定了分类，自动在该根目录下投递到对应分类名的子包内。
  if (data.category && String(data.category).trim() !== '') {
    var safeCategory = String(data.category).trim().replace(/[\\/]/g, '_'); // 防御性替换斜杠
    var subIter = mainFolder.getFoldersByName(safeCategory);
    if (subIter.hasNext()) {
      targetFolder = subIter.next();
    } else {
      targetFolder = mainFolder.createFolder(safeCategory);
    }
  }
  
  var file = targetFolder.createFile(imageBlob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {
    // 忽略企业盘权限限制导致的失败
  }
  var fileId = file.getId();
  
  // ============================================
  // 新版逻辑：将提示词作为“评论 (Comment)”发布到文件上
  // ============================================
  try {
    var descParts = [];
    if (data.prompt) descParts.push('📝 提示词:\n' + data.prompt);
    if (data.software) descParts.push('\n💻 软件: ' + data.software);
    if (data.category) descParts.push('📁 分类: ' + data.category);
    if (data.note) descParts.push('📋 备注: ' + data.note);
    if (data.sourceUrl) descParts.push('🔗 来源: ' + data.sourceUrl);
    
    if (descParts.length > 0) {
      var commentContent = descParts.join('\n');
      
      // 调用 Drive API v3 创建评论
      var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/comments?fields=id';
      var options = {
        method: 'post',
        headers: {
          'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify({
          'content': commentContent
        }),
        muteHttpExceptions: true
      };
      
      UrlFetchApp.fetch(url, options);
    }
  } catch (commentErr) {
    // 评论添加失败不影响主图上传流程
  }
  
  // 给 Drive 设置分享权限可能会因为组织策略报错，所以包装在 try-catch 中！！！
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    // 忽略分享失败错误（即使这里错误，图片还是建好了）
  }
  
  // Google 新版图片外链，这个比 /uc 更稳定
  var directUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;
  
  return { url: directUrl, fileId: fileId };
}

function generateFileName(data) {
  var now = new Date();
  var timestamp = Utilities.formatDate(now, 'GMT+8', 'yyyyMMdd_HHmmss');
  var software = (data.software || 'AI').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  var ext = getExtension(data.mimeType);
  return software + '_' + timestamp + '.' + ext;
}

function getExtension(mimeType) {
  var map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
  };
  return map[mimeType] || 'png';
}

// ============================================================
// 辅助函数
// ============================================================

function testConnection() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Data');
  if (sheet) {
    Logger.log('Data 表存在，当前行数: ' + sheet.getLastRow());
  } else {
    Logger.log('Data 表不存在');
  }
}

function initDataSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Data');
  
  if (!sheet) {
    sheet = ss.insertSheet('Data');
  }
  
  var headers = ['时间', '人名', '软件', '项目链接', '图片链接', '生成图', '提示词', '备注', '图库分类'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1a73e8')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 200);
  sheet.setColumnWidth(5, 200);
  sheet.setColumnWidth(6, 200);
  sheet.setColumnWidth(7, 400);
  sheet.setColumnWidth(8, 150);
  sheet.setColumnWidth(9, 100);
  
  sheet.setFrozenRows(1);
  Logger.log('Data 表已初始化');
}

function testWriteToSheet() {
  Logger.log('=== 开始测试写入 ===');
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log('表格: ' + ss.getName() + ' (ID: ' + SPREADSHEET_ID + ')');
  
  var sheet = ss.getSheetByName('Data');
  if (!sheet) {
    Logger.log('Data 表不存在，创建中...');
    sheet = ss.insertSheet('Data');
    var headers = ['时间', '人名', '软件', '项目链接', '图片链接', '生成图', '提示词', '备注', '图库分类'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  
  var lastRow = sheet.getLastRow() + 1;
  var timestamp = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
  
  var testRow = [timestamp, '测试', '测试软件', '', '', '', '测试提示词', '测试', '测试分类'];
  sheet.getRange(lastRow, 1, 1, testRow.length).setValues([testRow]);
  Logger.log('写入第 ' + lastRow + ' 行成功');
  Logger.log('=== 测试完成 ===');
}

function showSheetInfo() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log('表格: ' + ss.getName());
  Logger.log('ID: ' + ss.getId());
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    Logger.log('[' + i + '] ' + sheets[i].getName() + ' (' + sheets[i].getLastRow() + ' 行)');
  }
}

// ============================================================
// 读取词库（历史 Data + 自定义 Templates）
// ============================================================
function fetchPromptsAction(ss, log) {
  var results = [];
  
  // 1. 读取历史 Data
  var sheetData = ss.getSheetByName('Data');
  if (sheetData) {
    var lastRow = sheetData.getLastRow();
    if (lastRow > 1) {
      // A:时间, B:人名, C:软件, D:项目链接, E:图片链接, F:生成图, G:提示词, H:备注, I:图库分类
      // 我们最多只取最近的 500 条历史，以免数据量太大加载慢
      var startRow = Math.max(2, lastRow - 500); 
      var numRows = lastRow - startRow + 1;
      var values = sheetData.getRange(startRow, 1, numRows, 9).getValues();
      
      // 倒序：让最新的提示词排在前面
      for (var i = values.length - 1; i >= 0; i--) { 
        var row = values[i];
        if (row[6] && String(row[6]).trim() !== '') { 
          results.push({
            type: 'history',
            timestamp: row[0],
            userName: row[1],
            software: row[2],
            prompt: String(row[6]),
            note: row[7],
            category: row[8],
            previewUrl: (row[4] || row[5] || row[3] || '').toString().trim()
          });
        }
      }
    }
  }

  // 2. 读取 Templates 子表
  var sheetTpl = ss.getSheetByName('Templates');
  if (!sheetTpl) {
    log.push('Templates 表不存在，自动创建');
    sheetTpl = ss.insertSheet('Templates');
    var headers = ['模板分类', '软件推荐', '提示词', '效果说明', '预览图链接 (可选)'];
    sheetTpl.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground('#fbbc04').setFontWeight('bold');
    sheetTpl.setFrozenRows(1);
    sheetTpl.setColumnWidth(5, 200);
    // 写入一行示例提示词
    sheetTpl.getRange(2, 1, 1, 5).setValues([
      ['人像示例', 'Midjourney', 'A cinematic portrait of a beautiful woman, 85mm lens, rim lighting --ar 16:9', '通用高质量人像', '']
    ]);
  }
  
  var lastRowTpl = sheetTpl.getLastRow();
  if (lastRowTpl > 1) {
    var maxCols = sheetTpl.getLastColumn() >= 5 ? 5 : 4; 
    var tplValues = sheetTpl.getRange(2, 1, lastRowTpl - 1, 5).getValues();
    // 正序把模板加到前面（或者你可以后面由前端决定排序）
    for (var j = 0; j < tplValues.length; j++) {
      var tplRow = tplValues[j];
      if (tplRow[2] && String(tplRow[2]).trim() !== '') {
        // 模板的提示词优先放在最前面
        results.unshift({
          type: 'template',
          category: tplRow[0],
          software: tplRow[1],
          prompt: String(tplRow[2]),
          note: tplRow[3],
          previewUrl: tplRow[4] ? String(tplRow[4]).trim() : ''
        });
      }
    }
  }
    // ------------------------------------
    // 3. 读取并处理 TagCloud (云端标签字典表)
    // ------------------------------------
    var sheetTag = ss.getSheetByName('TagCloud');
    var tagCloudData = [];
    if (!sheetTag) {
      log.push('TagCloud 表不存在，隐式创建默认标签表');
      sheetTag = ss.insertSheet('TagCloud');
      var tagHeaders = ['分类名字', '标签集合 (只支持用逗号分隔，全半角均可)'];
      sheetTag.getRange(1, 1, 1, 2).setValues([tagHeaders])
        .setBackground('#4facfe').setFontWeight('bold').setFontColor('#ffffff');
      sheetTag.setFrozenRows(1);
      sheetTag.setColumnWidth(2, 600);
      
      // 写入默认的高质量防错大词典
      var defaultTags = [
        ['地方', '室内, 室外, 花园, 门廊, 露台, 阳台, 湖边, 海边, 草地, 山顶, 山坡, 田园, 牧场, 街头, 巷子, 咖啡馆, 森林, 小溪'],
        ['时间', '夜晚, 日景, 日出, 清晨, 上午, 午后, 下午, 傍晚, 黄昏, 蓝天, 白云, 晴天, 黄金时光, 星空, 初雪'],
        ['风格', '欧美, 美式, 欧式, 法式, 英伦, 东南亚, 日系, 韩系, 极简风, 波普艺术, 复古风, 童话风, 插画风, 古典主义'],
        ['色调', '唯美, 梦幻, 暖色, 暖金, 柔和, 浅绿, 浅蓝, 莫兰迪, 马卡龙, 高饱和, 长调, 低对比度, 阳光明媚, 清新'],
        ['主题', '人像, 静物, 动物, 盲盒, 潮玩, 建筑设计, 花卉, 风景, 美食, 精灵, 天使'],
        ['镜头', '特写, 全景, 俯拍, 等距视角, 85mm, 微距, 逆光, 丁达尔光, 体积光, 棚拍光, 轮廓光, 自然光'],
        ['材质', '极致细节, 8K, 毛毡, 粘土, 折纸, 磨砂玻璃, 光线追踪, 油画质感, 水彩, 丙烯']
      ];
      sheetTag.getRange(2, 1, defaultTags.length, 2).setValues(defaultTags);
      
      for (var k = 0; k < defaultTags.length; k++) {
        var tagsArray = String(defaultTags[k][1]).split(/[,，]/).map(function(t) { return t.trim(); }).filter(function(t) { return t !== ''; });
        tagCloudData.push({ label: defaultTags[k][0], tags: tagsArray });
      }
    } else {
      var lastRowTag = Math.max(1, sheetTag.getLastRow());
      if (lastRowTag > 1) {
        var rawTagValues = sheetTag.getRange(2, 1, lastRowTag - 1, 2).getValues();
        for (var l = 0; l < rawTagValues.length; l++) {
          var labelText = String(rawTagValues[l][0]).trim();
          var rawTagsText = String(rawTagValues[l][1]);
          if (labelText && rawTagsText) {
             var tArray = rawTagsText.split(/[,，]/).map(function(t) { return t.trim(); }).filter(function(t) { return t !== ''; });
             tagCloudData.push({ label: labelText, tags: tArray });
          }
        }
      }
    }

    annotatePromptCopyStats_(ss, results, log);

    return ContentService.createTextOutput(
      JSON.stringify({
        success: true,
        version: '1.9.2',
        data: results,
        tagCloud: tagCloudData,
        log: log
      })
    ).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 读取网站端复制统计（CopyStats）
// ============================================================
function annotatePromptCopyStats_(ss, items, log) {
  try {
    var sheet = ss.getSheetByName('CopyStats');
    if (!sheet || sheet.getLastRow() <= 1) {
      return;
    }

    var counts = {};
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < values.length; i++) {
      var fid = String(values[i][0] || '').trim();
      if (!fid) continue;
      counts[fid] = (counts[fid] || 0) + 1;
    }

    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var fidFromPreview = extractDriveFileId_(item.previewUrl || '');
      item.fileId = fidFromPreview || '';
      item.copyCount = fidFromPreview ? Number(counts[fidFromPreview] || 0) : 0;
    }
  } catch (err) {
    if (log) log.push('CopyStats 读取失败: ' + (err && err.message ? err.message : err));
  }
}

function extractDriveFileId_(text) {
  var s = String(text || '').trim();
  if (!s) return '';

  var m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m && m[1]) return m[1];

  m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m && m[1]) return m[1];

  m = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m && m[1]) return m[1];

  return '';
}

// ============================================================
// 添加单个模板到 Templates 表
// ============================================================
function addTemplateAction(ss, data, log) {
  try {
    var sheetTpl = ss.getSheetByName('Templates');
    if (!sheetTpl) {
      sheetTpl = ss.insertSheet('Templates');
      var headers = ['模板分类', '软件推荐', '提示词', '效果说明'];
      sheetTpl.getRange(1, 1, 1, headers.length).setValues([headers])
        .setBackground('#fbbc04').setFontWeight('bold');
      sheetTpl.setFrozenRows(1);
    }

    if (sheetTpl.getLastColumn() < 5) {
      sheetTpl.getRange(1, 5).setValue('预览图链接(可选)');
      sheetTpl.setColumnWidth(5, 200);
    }

    var previewUrl = '';
    if (data.imageBase64) {
      log.push('模板预览图上传中...');
      var previewResult = uploadImageToDrive({
        imageBase64: data.imageBase64,
        mimeType: data.mimeType || 'image/png',
        software: data.software || 'Template',
        category: data.category || '模板预览',
        prompt: data.prompt || '',
        note: data.note || '',
        sourceUrl: '',
        driveFolderId: data.driveFolderId || ''
      });
      previewUrl = previewResult.url || '';
      log.push('模板预览图上传成功');
    }

    var lastRow = sheetTpl.getLastRow() + 1;
    var rowData = [
      data.category || '未分类',
      data.software || '',
      data.prompt || '',
      data.note || '',
      previewUrl
    ];
    
    sheetTpl.getRange(lastRow, 1, 1, 5).setValues([rowData]);
    
    return ContentService.createTextOutput(
      JSON.stringify({
        success: true,
        message: '模板添加成功',
        log: log
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: error.message,
        log: log
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// 设置配置云端漫游互传 (Config)
// ============================================================
function syncConfigAction(ss, type, payload, log) {
  try {
    var sheetConfig = ss.getSheetByName('Config');
    if (!sheetConfig) {
      log.push('Config 漫游表不存在，隐式创建');
      sheetConfig = ss.insertSheet('Config');
      sheetConfig.getRange(1, 1, 1, 2).setValues([['配置名称KEY', '配置数据 VALUE (JSON字符串)']])
        .setBackground('#9c27b0').setFontWeight('bold').setFontColor('#ffffff');
      sheetConfig.setFrozenRows(1);
      sheetConfig.setColumnWidth(2, 600);
    }

    if (type === 'upload') {
      sheetConfig.getRange(2, 1, 1, 2).setValues([['cloud_settings', payload]]);

      var backupAt = Utilities.formatDate(new Date(), 'GMT+8', 'yyyyMMdd_HHmmss');
      var versionKey = 'cloud_settings_backup_' + backupAt;
      var appendRow = Math.max(sheetConfig.getLastRow() + 1, 3);
      sheetConfig.getRange(appendRow, 1, 1, 2).setValues([[versionKey, payload]]);
      log.push('Config backup created: ' + versionKey + ' (row ' + appendRow + ')');

      return ContentService.createTextOutput(
        JSON.stringify({
          success: true,
          message: '配置已上传并生成备份版本',
          versionKey: versionKey,
          backupAt: backupAt,
          log: log
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (type === 'upload_legacy') {
      // 直接强行写入第 2 行，保证单点数据同步
      sheetConfig.getRange(2, 1, 1, 2).setValues([['cloud_settings', payload]]);
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, message: '配置已覆写到云端', log: log })
      ).setMimeType(ContentService.MimeType.JSON);
      
    } else if (type === 'download') {
      var lastRow = sheetConfig.getLastRow();
      if (lastRow < 2) {
         throw new Error('云端 Config 暂无保存的数据记录（请先尝试上传一次）');
      }
      var cloudDataStr = sheetConfig.getRange(2, 2).getValue();
      if (!cloudDataStr) {
         throw new Error('未找到有效的云端配置数据');
      }
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, data: cloudDataStr, log: log })
      ).setMimeType(ContentService.MimeType.JSON);
    } else if (type === 'listBackups') {
      var backupRows = [];
      var totalRows = sheetConfig.getLastRow();
      if (totalRows >= 3) {
        var rows = sheetConfig.getRange(3, 1, totalRows - 2, 2).getValues();
        for (var i = rows.length - 1; i >= 0; i--) {
          var key = String(rows[i][0] || '').trim();
          if (key.indexOf('cloud_settings_backup_') === 0) {
            backupRows.push({
              versionKey: key,
              row: i + 3,
              backupAt: key.replace('cloud_settings_backup_', '')
            });
          }
        }
      }
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, backups: backupRows, log: log })
      ).setMimeType(ContentService.MimeType.JSON);
    } else if (type === 'restoreBackup') {
      var targetVersionKey = '';
      if (payload) {
        try {
          var parsedPayload = (typeof payload === 'string') ? JSON.parse(payload) : payload;
          targetVersionKey = String(parsedPayload.versionKey || '').trim();
        } catch (err) {
          targetVersionKey = '';
        }
      }
      if (!targetVersionKey) {
        throw new Error('缺少要恢复的版本号 versionKey');
      }

      var restoreLastRow = sheetConfig.getLastRow();
      if (restoreLastRow < 3) {
        throw new Error('未找到可恢复的备份版本');
      }

      var restoreRows = sheetConfig.getRange(3, 1, restoreLastRow - 2, 2).getValues();
      var matchedPayload = '';
      for (var r = restoreRows.length - 1; r >= 0; r--) {
        if (String(restoreRows[r][0] || '').trim() === targetVersionKey) {
          matchedPayload = String(restoreRows[r][1] || '');
          break;
        }
      }

      if (!matchedPayload) {
        throw new Error('未找到对应备份版本: ' + targetVersionKey);
      }

      sheetConfig.getRange(2, 1, 1, 2).setValues([['cloud_settings', matchedPayload]]);

      return ContentService.createTextOutput(
        JSON.stringify({
          success: true,
          message: '已恢复到备份版本',
          restoredVersionKey: targetVersionKey,
          data: matchedPayload,
          log: log
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: error.message, log: log })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
