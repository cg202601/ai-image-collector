/**
 * AI Gallery WebApp backend (Google Apps Script)
 * Features:
 * - Read media from Drive folder (recursive)
 * - Parse prompt metadata from Drive comments/description
 * - Like/Favorite reactions (multi-user counts)
 * - Sync tag dictionary from spreadsheet TagCloud sheet
 */

var DEFAULT_FOLDER_ID = '';
// Fill this to enable reactions + tag-cloud sync. Can also pass sid via URL.
var DEFAULT_SPREADSHEET_ID = '';

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  template.fid = normalizeFolderId_((e && e.parameter && e.parameter.fid) ? e.parameter.fid : DEFAULT_FOLDER_ID);
  template.sid = normalizeSpreadsheetId_((e && e.parameter && e.parameter.sid) ? e.parameter.sid : DEFAULT_SPREADSHEET_ID);
  template.theme = (e && e.parameter && e.parameter.theme) ? e.parameter.theme : 'light';
  template.webAppUrl = ScriptApp.getService().getUrl();

  return template.evaluate()
    .setTitle('AI 图片作品库')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getFilesData(folderId, options) {
  var targetId = normalizeFolderId_(folderId || DEFAULT_FOLDER_ID);
  var opt = options || {};
  var recursive = (typeof opt.recursive === 'boolean') ? opt.recursive : true;
  var includeVideos = (typeof opt.includeVideos === 'boolean') ? opt.includeVideos : true;
  var maxItems = Number(opt.maxItems || 3000);
  var maxComments = Number(opt.maxComments || 20);
  var userId = String(opt.userId || '');
  var spreadsheetId = normalizeSpreadsheetId_(String(opt.spreadsheetId || DEFAULT_SPREADSHEET_ID || ''));

  try {
    if (!targetId) {
      return JSON.stringify({
        success: false,
        error: 'fid 参数格式无效，请传文件夹 ID 或完整文件夹链接'
      });
    }
    var root = DriveApp.getFolderById(targetId);
    var list = [];
    collectMediaFiles_(root, '', recursive, includeVideos, list, maxItems, maxComments);
    list.sort(function(a, b) { return Number(b.date || 0) - Number(a.date || 0); });

    var reactionSummary = { byFile: {} };
    var copySummary = { byFile: {} };
    var tagCloud = [];
    var spreadsheetEnabled = false;
    var spreadsheetWarning = '';
    if (spreadsheetId) {
      try {
        var ss = SpreadsheetApp.openById(spreadsheetId);
        reactionSummary = readReactionSummary_(ss, list, userId);
        copySummary = readCopySummary_(ss, list, userId);
        tagCloud = readTagCloud_(ss);
        spreadsheetEnabled = true;
      } catch (sheetErr) {
        // Degrade gracefully: still return gallery data even when sheet permission/scope is not ready.
        spreadsheetWarning = '表格功能暂不可用: ' + (sheetErr && sheetErr.message ? sheetErr.message : sheetErr);
      }
    } else if (String(opt.spreadsheetId || '').trim()) {
      spreadsheetWarning = 'sid 参数格式无效，请传表格 ID 或完整表格链接';
    }

    for (var i = 0; i < list.length; i++) {
      var id = list[i].id;
      var r = reactionSummary.byFile[id] || { likes: 0, favorites: 0, likedByMe: false, favoritedByMe: false };
      list[i].likes = Number(r.likes || 0);
      list[i].favorites = Number(r.favorites || 0);
      list[i].likedByMe = !!r.likedByMe;
      list[i].favoritedByMe = !!r.favoritedByMe;

      var c = copySummary.byFile[id] || { copies: 0, copiedByMe: 0 };
      list[i].copies = Number(c.copies || 0);
      list[i].copiedByMe = Number(c.copiedByMe || 0);
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

function normalizeSpreadsheetId_(input) {
  var s = String(input || '').trim();
  if (!s) return '';

  // Accept raw ID directly
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;

  // Accept full spreadsheet URL and extract /d/<ID>
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (m && m[1]) return m[1];

  // Accept accidental "id=<ID>" style fragments
  m = s.match(/[?&]id=([a-zA-Z0-9-_]+)/i);
  if (m && m[1]) return m[1];

  return '';
}

function normalizeFolderId_(input) {
  var s = String(input || '').trim();
  if (!s) return '';

  // Accept raw ID directly
  if (/^[a-zA-Z0-9-_]{10,}$/.test(s)) return s;

  // Accept full folder URL
  var m = s.match(/\/folders\/([a-zA-Z0-9-_]+)/i);
  if (m && m[1]) return m[1];

  // Accept accidental id= style
  m = s.match(/[?&]id=([a-zA-Z0-9-_]+)/i);
  if (m && m[1]) return m[1];

  return '';
}

/**
 * Toggle like/favorite by user.
 * kind: 'like' | 'favorite'
 */
function toggleReaction(fileId, userId, kind, enabled, spreadsheetId) {
  var fid = String(fileId || '');
  var uid = String(userId || '');
  var k = String(kind || '');
  var en = !!enabled;
  var sid = String(spreadsheetId || DEFAULT_SPREADSHEET_ID || '');
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
    return JSON.stringify({
      success: false,
      error: (err && err.message) ? err.message : String(err)
    });
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

function collectMediaFiles_(folder, parentPath, recursive, includeVideos, out, maxItems, maxComments) {
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
    var meta = getFileMetaFromDrive_(fileId, String(file.getDescription() || ''), maxComments);
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
      prompt: meta.prompt || '',
      note: meta.note || '',
      software: meta.software || '',
      category: meta.category || '',
      sourceUrl: meta.sourceUrl || '',
      rawMetaText: meta.raw || ''
    });
  }

  if (!recursive || out.length >= maxItems) return;
  var folders = folder.getFolders();
  while (folders.hasNext() && out.length < maxItems) {
    collectMediaFiles_(folders.next(), currentPath, true, includeVideos, out, maxItems, maxComments);
  }
}

function getFileMetaFromDrive_(fileId, descriptionText, maxComments) {
  var commentsText = getDriveCommentsText_(fileId, maxComments);
  var raw = [commentsText, descriptionText].filter(function(t) { return t && String(t).trim() !== ''; }).join('\n');
  var parsed = parseMetaText_(raw);
  parsed.raw = raw;
  return parsed;
}

function getDriveCommentsText_(fileId, maxComments) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'drive_comment_v4_' + fileId + '_' + maxComments;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId +
      '/comments?pageSize=' + encodeURIComponent(String(maxComments)) +
      '&fields=comments(content,createdTime)';
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return '';

    var obj = JSON.parse(resp.getContentText() || '{}');
    var comments = obj.comments || [];
    if (!comments.length) return '';
    comments.sort(function(a, b) { return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime(); });
    var text = comments.map(function(c) { return c.content || ''; }).join('\n');
    cache.put(cacheKey, text, 600);
    return text;
  } catch (err) {
    return '';
  }
}

function parseMetaText_(text) {
  var out = { prompt: '', note: '', software: '', category: '', sourceUrl: '' };
  if (!text) return out;

  out.prompt = pickFirstByKeys_(text, ['\u63d0\u793a\u8bcd', 'Prompt', 'prompt', '\u5173\u952e\u8bcd', '\u54d2\u8bed']);
  out.note = pickFirstByKeys_(text, ['\u5907\u6ce8', '\u8bf4\u660e', 'note', 'Notes']);
  out.software = pickFirstByKeys_(text, ['\u8f6f\u4ef6', '\u6a21\u578b', 'software', 'model']);
  out.category = pickFirstByKeys_(text, ['\u5206\u7c7b', '\u56fe\u5e93\u5206\u7c7b', 'category']);
  out.sourceUrl = pickFirstByKeys_(text, ['\u6765\u6e90', '\u94fe\u63a5', 'source', 'sourceUrl', 'url']);
  if (!out.sourceUrl) out.sourceUrl = extractFirstUrl_(text);

  if (!out.prompt) {
    var lines = text.split(/\r?\n/).map(function(x) { return String(x || '').trim(); }).filter(function(x) { return x !== ''; });
    var longest = '';
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length > longest.length && lines[i].length <= 2000) longest = lines[i];
    }
    out.prompt = longest || '';
  }
  return out;
}

function pickFirstByKeys_(text, keys) {
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || '').trim();
    if (!line) continue;
    for (var k = 0; k < keys.length; k++) {
      var escaped = keys[k].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('^\\s*[^\\u4e00-\\u9fa5a-zA-Z0-9]*' + escaped + '\\s*[:：]\\s*(.+)$', 'i');
      var m = line.match(re);
      if (m && m[1]) return m[1].trim();
    }
  }
  return '';
}

function extractFirstUrl_(text) {
  var m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : '';
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
