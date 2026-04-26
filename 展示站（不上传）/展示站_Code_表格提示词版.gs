/**
 * AI 图片作品库 - 表格提示词版 (独立版本)
 *
 * 说明：
 * 1) 这份是“从 Google 表格 Data 表读取提示词/备注等信息”的版本
 * 2) 不依赖 Drive 评论/描述作为主数据源
 * 3) 适合 Arc 等浏览器无法稳定写入 Drive 评论的场景
 *
 * 使用建议：
 * - 与你当前版本分开部署（单独项目或单独覆盖 Code.gs）
 * - 前端 Index.html 可以继续复用现有版本
 */

var DEFAULT_FOLDER_ID = '';
var DEFAULT_SPREADSHEET_ID = '';
var DATA_SHEET_NAME = 'Data';

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  template.fid = normalizeFolderId_((e && e.parameter && e.parameter.fid) ? e.parameter.fid : DEFAULT_FOLDER_ID);
  template.sid = normalizeSpreadsheetId_((e && e.parameter && e.parameter.sid) ? e.parameter.sid : DEFAULT_SPREADSHEET_ID);
  template.theme = (e && e.parameter && e.parameter.theme) ? e.parameter.theme : 'light';
  template.webAppUrl = ScriptApp.getService().getUrl();

  return template.evaluate()
    .setTitle('AI 图片作品库（表格提示词版）')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Proxy image bytes as base64, so public site visitors can view images
 * even when Drive direct links require authentication.
 */
function getImageData(fileId, maxSide) {
  var fid = String(fileId || '').trim();
  var side = Number(maxSide || 0);
  if (!fid) return JSON.stringify({ success: false, error: 'fileId 为空' });

  try {
    var file = DriveApp.getFileById(fid);
    var blob = file.getBlob();
    var mime = String(blob.getContentType() || '');

    // Resize image for thumbnail/preview to reduce payload.
    // Fallback to original blob if format is unsupported by ImagesService.
    if (side > 0 && mime.indexOf('image/') === 0) {
      try {
        var img = ImagesService.openImage(blob);
        img.resize(side, side);
        blob = img.getBlob();
        if (!blob.getContentType()) blob.setContentType(mime);
      } catch (_e) {}
    }

    var bytes = blob.getBytes();
    var base64 = Utilities.base64Encode(bytes);
    return JSON.stringify({
      success: true,
      fileId: fid,
      mimeType: blob.getContentType() || mime || 'image/jpeg',
      base64: base64
    });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: (err && err.message) ? err.message : String(err),
      fileId: fid
    });
  }
}

function getFilesData(folderId, options) {
  var targetId = normalizeFolderId_(folderId || DEFAULT_FOLDER_ID);
  var opt = options || {};
  var recursive = (typeof opt.recursive === 'boolean') ? opt.recursive : true;
  var includeVideos = (typeof opt.includeVideos === 'boolean') ? opt.includeVideos : true;
  var maxItems = Number(opt.maxItems || 3000);
  var userId = String(opt.userId || '');
  var spreadsheetId = normalizeSpreadsheetId_(String(opt.spreadsheetId || DEFAULT_SPREADSHEET_ID || ''));

  try {
    if (!targetId) {
      return JSON.stringify({ success: false, error: 'fid 参数格式无效，请传文件夹 ID 或完整文件夹链接' });
    }

    var root = DriveApp.getFolderById(targetId);
    var list = [];
    collectMediaFiles_(root, '', recursive, includeVideos, list, maxItems);
    list.sort(function(a, b) { return Number(b.date || 0) - Number(a.date || 0); });

    var spreadsheetEnabled = false;
    var spreadsheetWarning = '';
    var tagCloud = [];
    var reactionSummary = { byFile: {} };
    var copySummary = { byFile: {} };
    var dataMetaMap = {};

    if (spreadsheetId) {
      try {
        var ss = SpreadsheetApp.openById(spreadsheetId);
        spreadsheetEnabled = true;
        tagCloud = readTagCloud_(ss);
        reactionSummary = readReactionSummary_(ss, list, userId);
        copySummary = readCopySummary_(ss, list, userId);
        dataMetaMap = readDataMetaMap_(ss);
      } catch (sheetErr) {
        spreadsheetWarning = '表格功能暂不可用: ' + (sheetErr && sheetErr.message ? sheetErr.message : sheetErr);
      }
    } else if (String(opt.spreadsheetId || '').trim()) {
      spreadsheetWarning = 'sid 参数格式无效，请传表格 ID 或完整表格链接';
    }

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var fromSheet = dataMetaMap[item.id] || null;
      if (fromSheet) {
        item.prompt = fromSheet.prompt || '';
        item.note = fromSheet.note || '';
        item.software = fromSheet.software || '';
        item.category = fromSheet.category || '';
        item.sourceUrl = fromSheet.sourceUrl || '';
        item.rowTime = fromSheet.time || '';
      }

      var r = reactionSummary.byFile[item.id] || { likes: 0, favorites: 0, likedByMe: false, favoritedByMe: false };
      item.likes = Number(r.likes || 0);
      item.favorites = Number(r.favorites || 0);
      item.likedByMe = !!r.likedByMe;
      item.favoritedByMe = !!r.favoritedByMe;

      var c = copySummary.byFile[item.id] || { copies: 0, copiedByMe: 0 };
      item.copies = Number(c.copies || 0);
      item.copiedByMe = Number(c.copiedByMe || 0);
    }

    return JSON.stringify({
      success: true,
      rootFolderId: targetId,
      rootFolderName: root.getName(),
      total: list.length,
      spreadsheetEnabled: spreadsheetEnabled,
      spreadsheetWarning: spreadsheetWarning,
      tagCloud: tagCloud,
      data: list
    });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: '读取失败: ' + (err && err.message ? err.message : err),
      debug: { normalizedFid: targetId }
    });
  }
}

/**
 * 点赞/收藏
 */
function toggleReaction(fileId, userId, kind, enabled, spreadsheetId) {
  var fid = String(fileId || '');
  var uid = String(userId || '');
  var k = String(kind || '');
  var en = !!enabled;
  var sid = normalizeSpreadsheetId_(String(spreadsheetId || DEFAULT_SPREADSHEET_ID || ''));
  if (!sid) return JSON.stringify({ success: false, error: '未配置 spreadsheetId' });
  if (!fid || !uid) return JSON.stringify({ success: false, error: '参数缺失' });
  if (k !== 'like' && k !== 'favorite') return JSON.stringify({ success: false, error: 'kind 必须是 like 或 favorite' });

  try {
    var ss = SpreadsheetApp.openById(sid);
    var sheet = ensureReactionsSheet_(ss);
    var lastRow = sheet.getLastRow();
    var targetRow = 0;

    if (lastRow > 1) {
      var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][0]) === fid && String(values[i][1]) === uid) {
          targetRow = i + 2;
          break;
        }
      }
    }

    var likeVal = false;
    var favVal = false;
    if (targetRow > 0) {
      likeVal = !!sheet.getRange(targetRow, 3).getValue();
      favVal = !!sheet.getRange(targetRow, 4).getValue();
      if (k === 'like') likeVal = en;
      if (k === 'favorite') favVal = en;
      sheet.getRange(targetRow, 3, 1, 3).setValues([[likeVal, favVal, new Date()]]);
    } else {
      if (k === 'like') likeVal = en;
      if (k === 'favorite') favVal = en;
      sheet.appendRow([fid, uid, likeVal, favVal, new Date()]);
    }

    var summary = readSingleFileReactionSummary_(sheet, fid, uid);
    return JSON.stringify({
      success: true,
      fileId: fid,
      likes: summary.likes,
      favorites: summary.favorites,
      likedByMe: summary.likedByMe,
      favoritedByMe: summary.favoritedByMe
    });
  } catch (err) {
    return JSON.stringify({ success: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function recordCopy(fileId, userId, spreadsheetId) {
  var fid = String(fileId || '');
  var uid = String(userId || '');
  var sid = normalizeSpreadsheetId_(String(spreadsheetId || DEFAULT_SPREADSHEET_ID || ''));
  if (!sid) return JSON.stringify({ success: false, error: '未配置 spreadsheetId' });
  if (!fid || !uid) return JSON.stringify({ success: false, error: '参数缺失' });

  try {
    var ss = SpreadsheetApp.openById(sid);
    var sheet = ensureCopyStatsSheet_(ss);
    sheet.appendRow([fid, uid, new Date()]);
    var summary = readSingleFileCopySummary_(sheet, fid, uid);
    return JSON.stringify({
      success: true,
      fileId: fid,
      copies: summary.copies,
      copiedByMe: summary.copiedByMe
    });
  } catch (err) {
    return JSON.stringify({ success: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function collectMediaFiles_(folder, parentPath, recursive, includeVideos, out, maxItems) {
  if (out.length >= maxItems) return;
  var currentPath = parentPath ? (parentPath + '/' + folder.getName()) : folder.getName();
  var files = folder.getFiles();

  while (files.hasNext() && out.length < maxItems) {
    var file = files.next();
    var mimeType = String(file.getMimeType() || '');
    var isImage = mimeType.indexOf('image/') === 0;
    var isVideo = mimeType.indexOf('video/') === 0;
    if (!isImage && !(includeVideos && isVideo)) continue;

    var fileId = file.getId();
    out.push({
      id: fileId,
      name: file.getName(),
      type: isVideo ? 'video' : 'image',
      mimeType: mimeType,
      size: file.getSize(),
      date: file.getLastUpdated().getTime(),
      folderPath: currentPath,
      thumbnail: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1200',
      preview: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w3000',
      download: 'https://drive.google.com/uc?export=download&id=' + fileId,
      driveUrl: file.getUrl(),

      // 这几个字段由 Data 表回填
      prompt: '',
      note: '',
      software: '',
      category: '',
      sourceUrl: ''
    });
  }

  if (!recursive || out.length >= maxItems) return;
  var folders = folder.getFolders();
  while (folders.hasNext() && out.length < maxItems) {
    collectMediaFiles_(folders.next(), currentPath, true, includeVideos, out, maxItems);
  }
}

/**
 * 从 Data 表构建 fileId -> 元数据 映射
 * Data 结构：
 * A时间 B人名 C软件 D项目链接 E图片链接 F生成图 G提示词 H备注 I图库分类
 */
function readDataMetaMap_(ss) {
  var map = {};
  var sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sheet) return map;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return map;

  var values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var time = row[0];
    var software = String(row[2] || '');
    var sourceUrl = String(row[3] || '');
    var imageLink = String(row[4] || '');
    var generatedLink = String(row[5] || '');
    var prompt = String(row[6] || '');
    var note = String(row[7] || '');
    var category = String(row[8] || '');

    var ids = extractAllDriveFileIds_([imageLink, generatedLink, sourceUrl]);
    for (var j = 0; j < ids.length; j++) {
      var fid = ids[j];
      // 同一个 fileId 如果出现多次，优先保留“更完整”的一条
      if (!map[fid] || (prompt && !map[fid].prompt)) {
        map[fid] = {
          time: time,
          software: software,
          sourceUrl: sourceUrl,
          prompt: prompt,
          note: note,
          category: category
        };
      }
    }
  }
  return map;
}

function extractAllDriveFileIds_(texts) {
  var found = {};
  for (var i = 0; i < texts.length; i++) {
    var s = String(texts[i] || '');
    if (!s) continue;

    // id=xxx
    var m;
    var reIdParam = /[?&]id=([a-zA-Z0-9_-]{10,})/g;
    while ((m = reIdParam.exec(s)) !== null) found[m[1]] = true;

    // /d/xxx
    var reD = /\/d\/([a-zA-Z0-9_-]{10,})/g;
    while ((m = reD.exec(s)) !== null) found[m[1]] = true;

    // 纯 ID
    if (/^[a-zA-Z0-9_-]{10,}$/.test(s.trim())) found[s.trim()] = true;
  }
  return Object.keys(found);
}

function ensureReactionsSheet_(ss) {
  var name = 'Reactions';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 5).setValues([['fileId', 'userId', 'like', 'favorite', 'updatedAt']]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 240);
    sheet.setColumnWidth(2, 180);
  }
  return sheet;
}

function readReactionSummary_(ss, files, userId) {
  var out = { byFile: {} };
  var sheet = ensureReactionsSheet_(ss);
  var fileIdSet = {};
  for (var i = 0; i < files.length; i++) fileIdSet[files[i].id] = true;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return out;

  var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (var r = 0; r < values.length; r++) {
    var fid = String(values[r][0] || '');
    if (!fileIdSet[fid]) continue;
    var uid = String(values[r][1] || '');
    var liked = !!values[r][2];
    var favored = !!values[r][3];
    if (!out.byFile[fid]) out.byFile[fid] = { likes: 0, favorites: 0, likedByMe: false, favoritedByMe: false };
    if (liked) out.byFile[fid].likes++;
    if (favored) out.byFile[fid].favorites++;
    if (userId && uid === userId) {
      out.byFile[fid].likedByMe = liked;
      out.byFile[fid].favoritedByMe = favored;
    }
  }
  return out;
}

function readSingleFileReactionSummary_(sheet, fileId, userId) {
  var out = { likes: 0, favorites: 0, likedByMe: false, favoritedByMe: false };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return out;

  var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '') !== fileId) continue;
    var uid = String(values[i][1] || '');
    var liked = !!values[i][2];
    var favored = !!values[i][3];
    if (liked) out.likes++;
    if (favored) out.favorites++;
    if (userId && uid === userId) {
      out.likedByMe = liked;
      out.favoritedByMe = favored;
    }
  }
  return out;
}

function ensureCopyStatsSheet_(ss) {
  var name = 'CopyStats';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 3).setValues([['fileId', 'userId', 'copiedAt']]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 240);
    sheet.setColumnWidth(2, 180);
  }
  return sheet;
}

function readCopySummary_(ss, files, userId) {
  var out = { byFile: {} };
  var sheet = ensureCopyStatsSheet_(ss);
  var fileIdSet = {};
  for (var i = 0; i < files.length; i++) fileIdSet[files[i].id] = true;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return out;

  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var r = 0; r < values.length; r++) {
    var fid = String(values[r][0] || '');
    if (!fileIdSet[fid]) continue;
    var uid = String(values[r][1] || '');
    if (!out.byFile[fid]) out.byFile[fid] = { copies: 0, copiedByMe: 0 };
    out.byFile[fid].copies++;
    if (userId && uid === userId) out.byFile[fid].copiedByMe++;
  }
  return out;
}

function readSingleFileCopySummary_(sheet, fileId, userId) {
  var out = { copies: 0, copiedByMe: 0 };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return out;

  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '') !== fileId) continue;
    out.copies++;
    if (userId && String(values[i][1] || '') === userId) out.copiedByMe++;
  }
  return out;
}

function readTagCloud_(ss) {
  var sheet = ss.getSheetByName('TagCloud');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var label = String(rows[i][0] || '').trim();
    var tagsText = String(rows[i][1] || '').trim();
    if (!label || !tagsText) continue;
    var tags = tagsText.split(/[,，]/).map(function(t) { return String(t || '').trim(); }).filter(function(t) { return t !== ''; });
    result.push({ label: label, tags: tags });
  }
  return result;
}

function normalizeSpreadsheetId_(input) {
  var s = String(input || '').trim();
  if (!s) return '';
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (m && m[1]) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9-_]+)/i);
  if (m && m[1]) return m[1];
  return '';
}

function normalizeFolderId_(input) {
  var s = String(input || '').trim();
  if (!s) return '';
  if (/^[a-zA-Z0-9-_]{10,}$/.test(s)) return s;
  var m = s.match(/\/folders\/([a-zA-Z0-9-_]+)/i);
  if (m && m[1]) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9-_]+)/i);
  if (m && m[1]) return m[1];
  return '';
}
