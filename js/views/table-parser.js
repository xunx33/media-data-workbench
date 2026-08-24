// 解析数据表格卡片收起/展开（状态存 localStorage，与 AI 大模型配置卡同款胶囊箭头）
let __parserCollapsed = (function(){
  return localStorage.getItem(STORAGE_KEY + 'tableParserCollapsed') === '1';
})();
function toggleParserFold() {
  __parserCollapsed = !__parserCollapsed;
  localStorage.setItem(STORAGE_KEY + 'tableParserCollapsed', __parserCollapsed ? '1' : '0');
  const body = document.getElementById('parserFoldBody');
  const arrow = document.getElementById('parserToggle');
  if (body) body.style.display = __parserCollapsed ? 'none' : 'block';
  if (arrow) arrow.classList.toggle('collapsed', __parserCollapsed);
}

function renderTableParser() {
  // 解析数据表格仅支持短视频平台导出表
  if (workspace !== 'video') return '';
  let html = `<div class="card"><div class="card-title" style="cursor:pointer;" onclick="toggleParserFold()">解析数据表格<span class="content-fold-arrow ${__parserCollapsed ? 'collapsed' : ''}" id="parserToggle" style="margin-left:auto;">&#9660;</span></div>`;
  html += `<div id="parserFoldBody" style="${__parserCollapsed ? 'display:none;' : ''}">`;
  html += `<p style="font-size:12px;color:var(--text2);margin-bottom:10px;">选择<b>平台</b>后上传该平台导出的数据表（支持 <b>.xlsx</b> / <b>.csv</b> / <b>.tsv</b> / <b>.txt</b>），文件先<b>暂存</b>，确认无误后点「<b>导入解析</b>」：内容自动登记 + 数据自动填充，并同步到发布日历。</p>`;

  // 平台选择（仅 4 个短视频平台）；切换平台时刷新帮助说明 + 重检测暂存文件的匹配警告
  html += `<div class="form-group"><label>数据表所属平台</label><select id="parserPlatform" onchange="onParserPlatformChange()">
    ${VIDEO_PLATFORMS.map(p => `<option value="${p}">${p}</option>`).join('')}
  </select></div>`;

  // 格式说明（随平台切换）——渲染时直接生成，避免延迟填充造成的展开跳动
  html += `<div class="form-group" id="parserHelp" style="font-size:12px;color:var(--text3);line-height:1.7;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-xs);padding:10px 12px;">${buildParserHelpHtml(VIDEO_PLATFORMS[0])}</div>`;

  // 文件上传
  html += `<div class="form-group"><label>上传表格文件</label>
    <div class="upload-zone" id="parserUploadZone" onclick="document.getElementById('parserFile').click()">
      <div class="upload-icon">&#128196;</div>
      <div>点击选择文件，或拖拽到此处</div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">支持 .xlsx / .csv / .tsv / .txt</div>
    </div>
    <input type="file" id="parserFile" accept=".xlsx,.csv,.tsv,.txt,text/plain" style="display:none;" onchange="handleParserFile(this.files[0])">
  </div>`;
  html += `<div class="form-group" id="parserPreview" style="display:none;font-size:12px;color:var(--text2);background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-xs);padding:10px 12px;"></div>`;
  // 导入/取消按钮（上传文件暂存后显示）
  html += `<div class="toolbar" style="margin-top:8px;display:none;" id="parserImportWrap">
    <button class="btn-primary" onclick="confirmImport()">导入解析</button>
    <button class="btn-edit" onclick="cancelPendingImport()">取消</button>
  </div>`;
  html += '<div id="parserResult" style="margin-top:8px;"></div>';
  html += '</div>';
  html += '</div>';

  // 拖拽支持 + 初始填充帮助说明
  setTimeout(() => {
    const zone = document.getElementById('parserUploadZone');
    if (zone) {
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
      zone.addEventListener('dragleave', () => { zone.style.borderColor = 'var(--border-strong)'; });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.style.borderColor = 'var(--border-strong)';
        if (e.dataTransfer.files.length > 0) handleParserFile(e.dataTransfer.files[0]);
      });
    }
    // 恢复暂存状态（切换 Tab 回来仍保留）
    if (pendingParserRows) {
      refreshPendingPreview();
    }
    // 初始填充默认平台（抖音）的表头说明
    updateParserHelp();
  }, 100);
  return html;
}

function buildParserHelpHtml(platform) {
  // 各平台表头说明（随选择的平台高亮当前项）
  const headers = {
    '抖音': '作品名称 | 发布时间 | 播放量 | 完播率 | 平均播放时长(秒) | 点赞量 | 评论量 | 收藏量 | 分享量',
    '快手': '作品 | 发布时间 | 播放量 | 完播率(20.6%) | 评论量 | 点赞量 | 收藏量',
    '小红书': '笔记标题 | 首次发布时间 | 观看量 | 点赞 | 评论 | 收藏 | 涨粉 | 分享 | 人均观看时长(秒)',
    '视频号': '视频描述 | 发布时间 | 完播率 | 平均播放时长(秒) | 播放量 | 推荐 | 喜欢 | 评论量 | 分享量 | 关注量'
  };
  return `<b style="color:var(--text2);">当前平台：${platform}</b> — 上传该平台导出的数据表，系统按以下列名自动识别：<br><br>
    ${Object.keys(headers).map(p => `
      <div style="margin-bottom:4px;${p === platform ? 'background:var(--accent-soft);border-radius:6px;padding:3px 6px;' : ''}">
        <b style="color:${p === platform ? 'var(--accent)' : 'var(--text2)'};">${p}：</b><code>${headers[p]}</code>
      </div>`).join('')}
    <b style="color:var(--text2);">说明：</b>完播率支持 0.35 / 20.6% / 35.6 三种格式，"--" 视为空；发布时间自动截取日期部分；均播时长（秒）自动导入——小红书「人均观看时长」与抖音/视频号「平均播放时长」为同一指标（统一显示为「均播」）；视频号无收藏时记录「推荐」数；空白标题的笔记会以「空标题」占位录入。`;
}

function updateParserHelp() {
  const platform = document.getElementById('parserPlatform').value;
  const help = document.getElementById('parserHelp');
  if (help) help.innerHTML = buildParserHelpHtml(platform);
}

// 切换平台时：刷新帮助说明 + 重检测暂存文件的匹配警告（选对平台后警告自动消失）
function onParserPlatformChange() {
  updateParserHelp();
  if (pendingParserRows) refreshPendingPreview();
}

// 统一刷新暂存预览（含平台匹配检测警告）
function refreshPendingPreview() {
  const preview = document.getElementById('parserPreview');
  const wrap = document.getElementById('parserImportWrap');
  if (!preview || !pendingParserRows) return;
  const platform = document.getElementById('parserPlatform').value;
  const detect = detectPlatformMismatch(pendingParserRows, platform);
  const warnHtml = detect.mismatch
    ? `<br><span style="color:var(--red);font-weight:600;">⚠️ 表头特征疑似「${escapeHtml(detect.likelyPlatform)}」平台导出，与所选「${platform}」不匹配，请确认平台选择是否正确（可在导入时强制继续）</span>`
    : '';
  preview.style.display = 'block';
  preview.innerHTML = `📄 [${platform}] ${escapeHtml(pendingParserFileName)}：读取到 <b>${pendingParserRows.length - 1}</b> 行数据，表头：<code style="font-size:11px;">${(getHeaderRow(pendingParserRows) || []).slice(0,8).map(h => escapeHtml(h)).join(' / ')}</code><br><span style="color:var(--yellow);">已暂存，确认无误后点击下方「导入解析」开始导入。</span>${warnHtml}`;
  if (wrap) wrap.style.display = 'flex';
}

// 暂存的上传文件（等待用户点击「导入解析」后才真正解析导入）
let pendingParserRows = null;
let pendingParserFileName = '';

// 处理上传文件（仅暂存，不直接导入）
async function handleParserFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  const preview = document.getElementById('parserPreview');
  const platform = document.getElementById('parserPlatform').value;
  if (!platform) { showToast('请先选择数据表所属平台'); return; }

  try {
    let rows;
    if (name.endsWith('.xlsx')) {
      preview.style.display = 'block';
      preview.innerHTML = '⏳ 正在读取 xlsx…';
      const buf = await file.arrayBuffer();
      rows = await parseXlsx(buf);
      if (rows.length === 0) { showToast('xlsx 未解析到数据'); return; }
    } else {
      const text = await file.text();
      rows = parseDelimitedText(text);
      if (rows.length === 0) { showToast('文件未解析到数据'); return; }
    }

    // 上传即拦截：非平台数据表 / 缺少关键列 直接拒绝，不进入暂存
    const detect = detectInvalidTable(rows, platform);
    if (detect.invalid) {
      preview.style.display = 'block';
      preview.innerHTML = `❌ <b>${escapeHtml(file.name)}</b> 不是可导入的平台数据表：${escapeHtml(detect.reason)}<br><span style="font-size:11px;color:var(--text3);">请上传所选平台（${escapeHtml(platform)}）导出的数据表，或检查平台选择是否正确。</span>`;
      pendingParserRows = null;
      pendingParserFileName = '';
      const wrap = document.getElementById('parserImportWrap');
      if (wrap) wrap.style.display = 'none';
      showToast('已拦截：不是有效的平台数据表');
      return;
    }

    // 暂存文件，等待用户确认后导入（预览含平台匹配检测，统一走 refreshPendingPreview）
    pendingParserRows = rows;
    pendingParserFileName = file.name;
    refreshPendingPreview();
    const resultDiv = document.getElementById('parserResult');
    if (resultDiv) resultDiv.innerHTML = '';
    showToast('文件已暂存，点击「导入解析」开始导入');
  } catch (err) {
    console.error(err);
    showToast('读取失败：' + (err.message || '未知错误'));
  }
}

// 点击「导入解析」：先检测平台匹配，再解析导入
function confirmImport() {
  if (!pendingParserRows) { showToast('请先上传文件'); return; }
  const platform = document.getElementById('parserPlatform').value;
  // 兜底拦截：非平台数据表（上传时已检测，此处防止绕过）
  const invalid = detectInvalidTable(pendingParserRows, platform);
  if (invalid.invalid) {
    showToast('已拦截：' + invalid.reason);
    return;
  }
  const detect = detectPlatformMismatch(pendingParserRows, platform);
  if (detect.mismatch) {
    showConfirm({
      title: '平台可能选择错误',
      desc: `检测到该表格表头特征更符合「<b>${detect.likelyPlatform}</b>」平台，而当前选择的是「<b>${platform}</b>」。<br><br>如果是选错平台，请点「取消」后切换平台；如果表格确实来自 ${platform}（格式特殊），可点「强制导入」。`,
      danger: true,
      okText: '强制导入',
      onOk: () => doImport(pendingParserRows, platform)
    });
    return;
  }
  doImport(pendingParserRows, platform);
}

// 执行导入（解析暂存数据并入库）
async function doImport(rows, platform) {
  const type = 'video';   // 解析器仅支持短视频数据
  const result = await parseTableRows(rows, type, platform);
  showParserResult(result, type);
  pendingParserRows = null;
  pendingParserFileName = '';
  const wrap = document.getElementById('parserImportWrap');
  if (wrap) wrap.style.display = 'none';
  const preview = document.getElementById('parserPreview');
  if (preview) {
    preview.innerHTML = '✅ 已导入完成，可继续上传其他文件';
  }
}

// 取消暂存
function cancelPendingImport() {
  pendingParserRows = null;
  pendingParserFileName = '';
  const wrap = document.getElementById('parserImportWrap');
  if (wrap) wrap.style.display = 'none';
  const preview = document.getElementById('parserPreview');
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  const resultDiv = document.getElementById('parserResult');
  if (resultDiv) resultDiv.innerHTML = '';
  showToast('已取消导入');
}

// 解析分隔文本（csv/tsv/txt）
// 注意：只去行尾空白、保留行首制表符——空标题行行首是 \t，若 trim 掉会导致整行左移一列
function parseDelimitedText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0).map(l => l.replace(/\s+$/, ''));
  if (lines.length === 0) return [];
  const headerLine = lines[0];
  let delimiter = '\t';
  if (headerLine.includes(',')) delimiter = ',';
  else if (headerLine.includes(';')) delimiter = ';';
  return lines.map(line => parseRow(line, delimiter));
}

// 解析一行（支持引号包裹）
function parseRow(line, delimiter) {
  const cells = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === delimiter && !inQuote) { cells.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

// 解析 xlsx（极简：zip 解压 + sharedStrings + sheet XML）
async function parseXlsx(buf) {
  const files = await unzipFiles(buf);
  // 找 sharedStrings 和第一个 sheet
  let sharedStrings = [];
  if (files['xl/sharedStrings.xml']) {
    const ssXml = new TextDecoder().decode(files['xl/sharedStrings.xml']);
    sharedStrings = parseSharedStrings(ssXml);
  }
  const sheetPath = Object.keys(files).find(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  if (!sheetPath) throw new Error('未找到工作表');
  const sheetXml = new TextDecoder().decode(files[sheetPath]);
  return parseSheetXml(sheetXml, sharedStrings);
}

// zip 解压（仅支持 deflate-raw 与 store）
async function unzipFiles(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // 找 EOCD
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('无效的 xlsx 文件（未找到 zip 目录）');
  const entryCount = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const files = {};
  let pos = cdOffset;
  for (let n = 0; n < entryCount; n++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const method = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const uncompSize = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localOffset = dv.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(u8.subarray(pos + 46, pos + 46 + nameLen));
    // 读本地文件头获取数据起始位置
    if (dv.getUint32(localOffset, true) === 0x04034b50) {
      const localNameLen = dv.getUint16(localOffset + 26, true);
      const localExtraLen = dv.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compData = u8.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        files[name] = compData;
      } else if (method === 8) {
        files[name] = await inflateRaw(compData, uncompSize);
      }
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// deflate-raw 解压（浏览器原生）
async function inflateRaw(compData, expectedSize) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([compData]).stream().pipeThrough(ds);
    const result = await new Response(stream).arrayBuffer();
    return new Uint8Array(result);
  }
  throw new Error('当前浏览器不支持 xlsx 解压，请用 CSV 格式');
}

function parseSharedStrings(xml) {
  const strings = [];
  const siRegex = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(xml)) !== null) {
    const inner = m[1];
    // 拼接所有 <t> 文本
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let text = '';
    let tm;
    while ((tm = tRegex.exec(inner)) !== null) {
      text += decodeXml(tm[1]);
    }
    strings.push(text);
  }
  return strings;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRegex.exec(xml)) !== null) {
    const cells = [];
    // 单元格匹配：自闭合空单元格（<c r="A10"/>）优先，否则普通带值单元格
    // 原正则要求 </c> 结尾，会把自闭合空单元格与其后单元格一起吞掉 → 整行左移（空标题行因此丢失）
    const cellRegex = /<c[^>]*r="([A-Z]+)\d+"[^>]*\/>|<c[^>]*r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g;
    let cm;
    const cellMap = {};
    while ((cm = cellRegex.exec(rm[2])) !== null) {
      const selfClosed = cm[1] !== undefined;
      const colLetter = selfClosed ? cm[1] : cm[2];
      const inner = selfClosed ? '' : (cm[3] || '');
      if (!selfClosed) {
        const tMatch = cm[0].match(/t="([^"]+)"/);
        const t = tMatch ? tMatch[1] : '';
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        const isMatch = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
        let val = '';
        if (t === 's' && vMatch) val = sharedStrings[parseInt(vMatch[1])] || '';
        else if (t === 'inlineStr' && isMatch) val = decodeXml(isMatch[1]);
        else if (vMatch) val = decodeXml(vMatch[1]);
        cellMap[colLetter] = val;
      } else {
        cellMap[colLetter] = '';
      }
    }
    // 按列字母顺序排列（A, B, ..., AA, ...）
    const letters = Object.keys(cellMap).sort((a, b) => colToNum(a) - colToNum(b));
    const maxCol = letters.length > 0 ? colToNum(letters[letters.length - 1]) : 0;
    for (let i = 1; i <= maxCol; i++) {
      const colStr = numToCol(i);
      cells.push(cellMap[colStr] !== undefined ? cellMap[colStr] : '');
    }
    rows.push(cells);
  }
  return rows;
}

function colToNum(letters) {
  let num = 0;
  for (let i = 0; i < letters.length; i++) num = num * 26 + (letters.charCodeAt(i) - 64);
  return num;
}
function numToCol(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ===== 平台表头配置（每个平台独立的列名规则）=====
// 每个字段的识别词按优先级排列，命中第一个即止
const PLATFORM_HEADERS = {
  '抖音': {
    date: ['发布时间', '日期', '时间', 'date'],
    title: ['作品名称', '作品标题', '标题', '作品', 'title'],
    views: ['播放量', '播放数', '播放', 'views', 'view'],
    completion: ['完播率', '完播', 'completion'],
    avgWatch: ['平均播放时长', '人均播放时长', '人均观看时长', 'avgwatch'],
    likes: ['点赞量', '点赞数', '点赞', 'likes', 'like'],
    comments: ['评论量', '评论数', '评论', 'comments', 'comment'],
    favorites: ['收藏量', '收藏数', '收藏', 'favorites', 'favorite'],
    shares: ['分享量', '分享数', '分享', '转发', 'shares', 'share'],
    followers: ['粉丝增量', '涨粉量', '涨粉', '粉丝增长']
  },
  '快手': {
    date: ['发布时间', '日期', '时间', 'date'],
    title: ['作品名称', '作品', '标题', 'title'],
    views: ['播放量', '播放数', '播放', 'views', 'view'],
    completion: ['完播率', '完播', 'completion'],
    likes: ['点赞量', '点赞数', '点赞', 'likes', 'like'],
    comments: ['评论量', '评论数', '评论', 'comments', 'comment'],
    favorites: ['收藏量', '收藏数', '收藏', 'favorites', 'favorite'],
    shares: ['分享量', '分享数', '分享', '转发', 'shares', 'share'],
    followers: ['涨粉量', '涨粉', '粉丝增量', '粉丝增长']
  },
  '小红书': {
    headerRow: 2,   // 表头在第2行（第1行是提示语）
    date: ['首次发布时间', '发布时间', '日期', '时间', 'date'],
    title: ['笔记标题', '作品名称', '作品', '标题', 'title'],
    views: ['观看量', '浏览量', '播放量', '播放', 'views', 'view'],
    completion: ['完播率', '完播', 'completion'],
    avgWatch: ['人均观看时长', '人均播放时长', 'avgwatchduration', 'avgwatch'],
    likes: ['点赞', '赞', '喜欢', 'likes', 'like'],
    comments: ['评论', '评论量', '评论数', 'comments', 'comment'],
    favorites: ['收藏', '收藏量', '收藏数', 'favorites', 'favorite'],
    shares: ['分享', '转发', '分享量', 'shares', 'share'],
    followers: ['涨粉', '涨粉量', '粉丝增量', '粉丝增长']
  },
  '视频号': {
    date: ['发布时间', '日期', '时间', 'date'],
    title: ['视频描述', '作品名称', '作品', '标题', 'title'],
    views: ['播放量', '播放数', '播放', 'views', 'view'],
    completion: ['完播率', '完播', 'completion'],
    avgWatch: ['平均播放时长', '人均播放时长', '人均观看时长', 'avgwatch'],
    recommend: ['推荐', '推荐量', '推荐数', 'recommend'],
    likes: ['喜欢', '点赞', '赞', 'likes', 'like'],
    comments: ['评论量', '评论数', '评论', 'comments', 'comment'],
    favorites: ['收藏量', '收藏数', '收藏', 'favorites', 'favorite'],
    shares: ['分享量', '分享数', '分享', '转发', 'shares', 'share'],
    followers: ['关注量', '涨粉', '涨粉量', '粉丝增量', '粉丝增长']
  }
};

// ===== 平台签名检测（表头特征匹配，用于提示表格平台与所选平台是否一致）=====
// 词源：4 个平台真实导出表头（抖音作品列表导出/快手作品列表明细/小红书笔记列表明细/视频号动态数据明细）
// 每个词都是该平台的「独有列名」，避免交叉误报（如"完播率"四平台都有、"封面点击率"抖音小红书都有、"平均播放时长"抖音视频号都有，均不采用）
const PLATFORM_SIGNATURES = {
  '抖音': ['审核状态', '5s完播率', '2s跳出率', '主页访问量', '粉丝增量'],
  '快手': ['涨粉量', '作品'],
  '小红书': ['笔记标题', '首次发布时间', '曝光', '弹幕', '人均观看时长'],
  '视频号': ['视频ID', '转发聊天和朋友圈', '设为铃声', '企微', '关注量']
};

// 检测是否为可导入的平台数据表（非平台表格/缺少关键列 → 拦截）
function detectInvalidTable(rows, platform) {
  if (!rows || rows.length === 0) return { invalid: true, reason: '文件为空，未读取到任何行' };
  const header = getHeaderRow(rows).map(h => String(h || ''));
  // 1) 平台签名特征：4 个平台的关键词全部不命中 → 不是任何短视频平台导出的数据表
  const sigTotal = Object.values(PLATFORM_SIGNATURES).reduce(
    (sum, kws) => sum + kws.filter(kw => header.some(h => h.includes(kw))).length, 0);
  if (sigTotal === 0) return { invalid: true, reason: '表头不含任何平台数据特征，不是短视频平台导出的数据表' };
  // 2) 缺少日期列（日期是每条数据的必填定位）
  const rules = PLATFORM_HEADERS[platform] || PLATFORM_HEADERS['抖音'];
  const hasDate = (rules.date || []).some(kw => header.some(h => h.includes(kw)));
  if (!hasDate) return { invalid: true, reason: '表头缺少日期/时间列（应含「发布时间/日期/时间」），不是有效的数据表' };
  return { invalid: false };
}

// 取真实表头行：自动扫描前 5 行，找出"最像表头"的行（按命中的字段词种类去重计数）
// 兼容小红书第1行是"最多导出..."提示语（13列同一词只算1种），也兼容用户未切换平台下拉的情况
function getHeaderRow(rows) {
  if (!rows || rows.length === 0) return [];
  const knownWords = ['发布时间', '日期', '时间', '标题', '作品', '笔记', '视频', '播放', '观看', '点赞', '评论', '收藏', '分享', '完播', '涨粉', '粉丝', '关注', '曝光', '体裁'];
  let bestLine = rows[0];
  let bestScore = -1;
  rows.slice(0, 5).forEach(line => {
    const hit = new Set();
    line.forEach(cell => {
      knownWords.forEach(kw => { if (String(cell || '').includes(kw)) hit.add(kw); });
    });
    if (hit.size > bestScore) { bestScore = hit.size; bestLine = line; }
  });
  return bestLine;
}

// 检测表格表头特征与所选平台是否匹配
// 返回 { mismatch, likelyPlatform, scores }：mismatch=是否疑似不匹配，likelyPlatform=更像哪个平台
function detectPlatformMismatch(rows, selectedPlatform) {
  const empty = { mismatch: false, likelyPlatform: '', scores: {} };
  if (!rows || rows.length === 0) return empty;

  // 遍历前 5 行（兼容小红书表头在第2行），找出平台签名命中总数最多的行作为表头
  const tryLines = rows.slice(0, Math.min(5, rows.length));
  let best = { scores: {}, total: -1 };
  tryLines.forEach(line => {
    const scores = {};
    Object.keys(PLATFORM_SIGNATURES).forEach(p => {
      scores[p] = PLATFORM_SIGNATURES[p].filter(kw => line.some(cell => String(cell || '').includes(kw))).length;
    });
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    if (total > best.total) best = { scores, total };
  });

  const scores = best.scores;
  const selectedScore = scores[selectedPlatform] || 0;
  let likelyPlatform = '';
  let bestScore = 0;
  Object.keys(scores).forEach(p => {
    if (p !== selectedPlatform && scores[p] > bestScore) { bestScore = scores[p]; likelyPlatform = p; }
  });
  // 不匹配：所选平台的表头特征命中数明显低于其他平台（选错平台的概率高）
  const mismatch = bestScore >= 1 && selectedScore < bestScore;
  return { mismatch, likelyPlatform: mismatch ? likelyPlatform : '', scores };
}

// 统一解析行数据
async function parseTableRows(rows, type, platform) {
  if (rows.length < 2) { showToast('数据至少需要表头+一行数据'); return null; }
  // 记录起始长度：解析后检测本次新增内容的乱码
  const startC = contents.length, startS = stats.length;

  // 根据平台选择对应的表头规则
  const rules = PLATFORM_HEADERS[platform] || PLATFORM_HEADERS['抖音'];

  // 表头行偏移：部分平台（如小红书）第1行是提示语，表头在第2行
  const headerRowIdx = (rules.headerRow || 1) - 1;
  if (rows.length <= headerRowIdx) { showToast('数据行不足，未找到表头'); return null; }
  const header = rows[headerRowIdx].map(h => String(h).toLowerCase().replace(/[\s_\-]+/g, ''));

  // 识别列：优先精确匹配，其次包含匹配（避免"平均播放时长"误命中"播放"）
  const findCol = (names) => {
    for (const n of names) {
      const exact = header.indexOf(n);
      if (exact >= 0) return exact;
    }
    return header.findIndex(h => names.some(n => h.includes(n)));
  };
  const colDate = findCol(rules.date);
  const colTitle = findCol(rules.title);
  const colViews = findCol(rules.views || ['播放']);
  const colCompletion = findCol(rules.completion || ['完播']);
  const colAvgWatch = findCol(rules.avgWatch || ['人均观看']);
  const colRecommend = findCol(rules.recommend || ['推荐']);
  const colLikes = findCol(rules.likes || ['点赞']);
  const colComments = findCol(rules.comments || ['评论']);
  const colFavorites = findCol(rules.favorites || ['收藏']);
  const colShares = findCol(rules.shares || ['分享']);
  const colFollowers = findCol(rules.followers || ['涨粉', '粉丝']);

  if (colDate < 0) { showToast('未找到日期/时间列，请检查表头'); return null; }

  // 数据从表头行之后开始
  const dataStart = headerRowIdx + 1;
  // 解析数据行（平台来自用户选择，不依赖表内平台列或文件名）
  let parsedCount = 0;
  let contentCreatedCount = 0;
  const results = [];
  const overwriteWarnings = [];  // 同日期同标题但数据不同、被后一条覆盖的提示
  const newlyCreatedIds = new Set();   // 本次导入内新建的内容 id：占位标题匹配时排除，避免同一次导入内互相合并
  for (let i = dataStart; i < rows.length; i++) {
    const cells = rows[i];
    const date = colDate >= 0 ? cells[colDate] : '';
    const normDate = normalizeDate(date);
    if (!normDate || !platform) continue;

    let title = colTitle >= 0 ? String(cells[colTitle] || '').trim() : '';
    const titleEmpty = !title;   // 原表标题是否为空（占位标题无法唯一标识内容）
    // 空白标题 → 占位符「空标题」，保证内容与数据照常录入
    if (!title) title = platform === '小红书' ? '空标题' : (platform + ' ' + normDate + ' 作品');
    const views = colViews >= 0 ? cellNumOrNull(cells[colViews]) : null;
    const completion = colCompletion >= 0 ? parseCompletion(cells[colCompletion]) : null;
    // 小红书：人均观看时长（秒）；视频号：推荐数
    const avgWatch = colAvgWatch >= 0 ? parseAvgWatch(cells[colAvgWatch]) : null;
    const recommend = colRecommend >= 0 ? cellNumOrNull(cells[colRecommend]) : null;
    const likes = colLikes >= 0 ? cellNumOrNull(cells[colLikes]) : null;
    const comments = colComments >= 0 ? cellNumOrNull(cells[colComments]) : null;
    const favorites = colFavorites >= 0 ? cellNumOrNull(cells[colFavorites]) : null;
    const shares = colShares >= 0 ? cellNumOrNull(cells[colShares]) : null;
    const followers = colFollowers >= 0 ? cellNumOrNull(cells[colFollowers]) : null;

    // 内容登记：优先按「平台+日期+标题」匹配已登记内容（同日多条作品不会互相覆盖，避免数据丢失），
    // 没有则自动登记一条（标题取表格作品名，平台/日期从表格读取）；重复导入同一文件可命中并复用。
    // 占位标题（原表标题为空自动生成）无法唯一标识内容：仅当该平台当天恰好只有一条同名占位时才复用（幂等），
    // 多条同名占位（如一天多篇「空标题」小红书笔记）无法区分 → 逐条新建，避免互相覆盖丢数据
    const normTitle = (title || '').trim();
    let content = null;
    let autoCreated = false;
    if (!titleEmpty) {
      content = contents.find(c => c.platform === platform && c.createdAt === normDate && (c.title || '').trim() === normTitle);
    } else {
      // 占位标题：仅当该平台当天「此前已存在」恰好一条同名占位时才复用（幂等重导入）；
      // 本次导入内新建的占位（newlyCreatedIds）不参与匹配，多条空标题逐条新建、互不覆盖
      const placeholders = contents.filter(c => c.platform === platform && c.createdAt === normDate && (c.title || '').trim() === normTitle && !newlyCreatedIds.has(c.id));
      if (placeholders.length === 1) content = placeholders[0];
    }
    if (!content) {
      content = {
        id: Date.now() + Math.random(),
        title: normTitle || (platform + ' ' + normDate + ' 作品'),
        platform,
        topic: '',
        url: '',
        createdAt: normDate
      };
      contents.push(content);
      newlyCreatedIds.add(content.id);
      autoCreated = true;
    }

    // 数据登记：按关联内容匹配（同一内容重导入时覆盖更新，不同内容互不影响）；占位标题仅按 contentId 匹配（新内容无旧记录 → 新建）
    const existing = !titleEmpty
      ? stats.find(s => s.contentId == content.id || s.contentId == Number(content.id) || (s.platform === platform && s.date === normDate && (s.title || '').trim() === normTitle))
      : stats.find(s => s.contentId == content.id || s.contentId == Number(content.id));
    const newStat = { platform, date: normDate, title: normTitle || content.title, views, completionRate: completion, avgWatch, recommend, likes, comments, favorites, shares, followers, contentId: content.id };
    if (existing) {
      // 检测「同日期同标题但数据不同」：后一条会覆盖前一条，收集起来提醒用户知情（重复导入同一文件数据相同 → 不提醒）
      const dataKeys = ['views', 'completionRate', 'avgWatch', 'recommend', 'likes', 'comments', 'favorites', 'shares', 'followers'];
      const norm = v => (v === null || v === undefined || v === '') ? null : Number(v);
      const differs = dataKeys.some(k => norm(existing[k]) !== norm(newStat[k]));
      if (differs) overwriteWarnings.push(normDate + ' · ' + platform + '「' + content.title + '」');
      Object.assign(existing, newStat);
    }
    else stats.push({ id: Date.now() + Math.random(), ...newStat });
    parsedCount++;
    if (autoCreated) contentCreatedCount++;
    // 任务联动：该平台当日任务自动完成 + 标记已登记链接

    let summary = `播放${formatNum(views)}`;
    if (completion !== null) summary += ` 完播${completion}%`;
    if (avgWatch !== null) summary += ` 均播${avgWatch}s`;
    if (recommend > 0) summary += ` 推荐${recommend}`;
    results.push(`<div style="font-size:12px;color:var(--green);">✓ ${normDate} ${platform} ${autoCreated ? '🆕 自动登记' : '已并入'}「${escapeHtml(content.title)}」${summary}</div>`);
  }

  await saveData('contents', contents);
  await saveData('stats', stats);
  // 乱码检测：本次新增内容/数据的标题与平台
  const newCorrupt = countCorruptRecords(contents.slice(startC), ['title', 'platform'])
    + countCorruptRecords(stats.slice(startS), ['title', 'platform']);
  if (newCorrupt > 0) showToast('⚠️ 本次解析出 ' + newCorrupt + ' 条乱码记录：源表格可能不是 UTF-8 编码，建议改用 xlsx 或另存为 UTF-8 再导入');
  return { parsedCount, contentCreatedCount, results, overwriteWarnings };
}

function showParserResult(result, type) {
  const resultDiv = document.getElementById('parserResult');
  if (!result) return;
  if (result.parsedCount > 0) {
    const createdInfo = result.contentCreatedCount > 0 ? `（含自动登记内容 ${result.contentCreatedCount} 条）` : '';
    resultDiv.innerHTML = `<div style="font-size:13px;font-weight:600;color:var(--green);margin-bottom:6px;">✅ 成功处理 ${result.parsedCount} 条数据${createdInfo}</div>${result.results.join('')}`;
    const warns = result.overwriteWarnings || [];
    if (warns.length > 0) {
      // 同日期同标题但数据不同：已用后一条覆盖，明确提醒用户知情
      const list = warns.slice(0, 5).join('、');
      const more = warns.length > 5 ? ` 等共 ${warns.length} 条` : '';
      resultDiv.innerHTML += `<div style="font-size:12px;color:var(--red);font-weight:600;margin-top:10px;">⚠️ ${warns.length} 条「同日期同标题但数据不同」已用后一条覆盖：${list}${more}<br><span style="font-weight:400;color:var(--text3);">若这些是互不相同的作品，请先在内容登记里改标题区分后再导入。</span></div>`;
      showToast(`⚠️ 有 ${warns.length} 条同标题不同数据被覆盖`);
    } else {
      showToast(`解析完成：${result.parsedCount} 条数据` + (result.contentCreatedCount ? ` + 新登记 ${result.contentCreatedCount} 条内容` : ''));
    }
    render();
  } else {
    resultDiv.innerHTML = `<div style="font-size:13px;color:var(--red);">❌ 未解析到有效数据，请检查表头是否包含日期列、数据表是否与所选平台匹配</div>`;
    showToast('解析失败：无有效数据');
  }
}

// 归一化日期为 YYYY-MM-DD
function normalizeDate(s) {
  if (!s) return '';
  s = String(s).trim();
  // Excel 日期序列号（如视频号导出：46233 → 2026-07-30，从 1899-12-30 起算的天数）
  if (/^\d+(\.\d+)?$/.test(s)) {
    const num = parseFloat(s);
    // 合理日期范围：20000~60000 对应 1954-10-27 ~ 2064-04-12
    if (num >= 20000 && num <= 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(num) * 86400000);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    return '';
  }
  // 带时间戳的日期：YYYY-MM-DD HH:MM:SS / YYYY/MM/DD HH:MM / YYYY-MM-DDTHH:MM
  s = s.replace(/[T\s].*$/, '');
  // 已经是 YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${y}-${String(parseInt(m)).padStart(2,'0')}-${String(parseInt(d)).padStart(2,'0')}`;
  }
  // YYYY/MM/DD 或 YYYY.MM.DD
  let m = s.match(/(\d{4})[\/.年](\d{1,2})[\/.月](\d{1,2})日?/);
  if (m) return `${m[1]}-${String(parseInt(m[2])).padStart(2,'0')}-${String(parseInt(m[3])).padStart(2,'0')}`;
  // MM/DD/YYYY
  m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) return `${m[3]}-${String(parseInt(m[1])).padStart(2,'0')}-${String(parseInt(m[2])).padStart(2,'0')}`;
  return '';
}

function parseIntNum(v) {
  if (v === undefined || v === null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  // 严格校验：整数 或 小数（最多一个小数点），拦截 "1.2.3" / "1..2" / "1.2e3" 等脏数据
  const match = s.match(/^-?(\d+\.?\d*|\.\d+)$/);
  if (!match) {
    console.warn('[parseIntNum] 非数字输入被拦截:', v);
    return 0;
  }
  const num = parseFloat(match[0]);
  return isNaN(num) ? 0 : Math.round(num);
}

// 表格单元格数字解析：空值/缺失 → null（与手动录入 numOrNull 一致：未录入留空）；有值 → parseIntNum
function cellNumOrNull(v) {
  if (v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '--') return null;
  return parseIntNum(v);
}

// 完播率解析：支持 35.6%、0.356、35.6 等
function parseCompletion(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.includes('%')) {
    return Math.round(parseFloat(s.replace('%', '')) * 10) / 10;
  }
  const num = parseFloat(s);
  if (isNaN(num)) return null;
  // 0-1 之间视为小数（0.356 → 35.6%），否则视为百分比
  if (num > 0 && num <= 1) return Math.round(num * 1000) / 10;
  return Math.round(num * 10) / 10;
}

// 人均观看时长解析：支持 "12"、"7.03秒"、"9.2s" 等
function parseAvgWatch(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  const num = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return null;
  return Math.round(num * 10) / 10;
}

function isYesValue(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  if (!s) return false;
  return ['是', '1', 'true', 'y', 'yes', '√', '✓', '✔', '有', '已'].includes(s);
}

function getFilteredContents() {
  const today = getToday();
  let filtered = [...contents];

  // 仅保留短视频平台内容，不干扰后续搜索/日期/平台筛选
  filtered = filtered.filter(c => isVideo(c.platform));

  // Apply search
  if (searchKeyword) {
    const kw = searchKeyword.toLowerCase();
    filtered = filtered.filter(c =>
      (c.title || '').toLowerCase().includes(kw) ||
      (c.topic || '').toLowerCase().includes(kw) ||
      (c.platform || '').toLowerCase().includes(kw) ||
      (c.url || '').toLowerCase().includes(kw)
    );
  }

  // Apply date range filter（''=全部 | today | yesterday | week | month）
  if (contentDateFilter === 'today') filtered = filtered.filter(c => c.createdAt === today);
  else if (contentDateFilter === 'yesterday') {
    const y = getDayStr(new Date(Date.now() - 86400000));
    filtered = filtered.filter(c => c.createdAt === y);
  } else if (contentDateFilter === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 本周一
    const monday = getDayStr(d);
    filtered = filtered.filter(c => c.createdAt >= monday && c.createdAt <= today);
  } else if (contentDateFilter === 'month') {
    const m = today.slice(0, 7);
    filtered = filtered.filter(c => (c.createdAt || '').startsWith(m));
  }

  // Apply platform filter（具体平台名）
  if (contentFilterType && ALL_PLATFORMS.includes(contentFilterType)) filtered = filtered.filter(c => c.platform === contentFilterType);

  // 播放量排序（短视频平台）
  if (contentSortByViews === 'desc' || contentSortByViews === 'asc') {
    filtered = filtered.filter(c => isVideo(c.platform));
    const viewOf = c => {
      const s = stats.find(x => x.contentId == c.id || x.contentId == Number(c.id) || (x.platform === c.platform && x.date === c.createdAt));
      return s ? (s.views || 0) : -1; // 无数据视为 -1（排最后）
    };
    filtered.sort((a, b) => {
      const va = viewOf(a), vb = viewOf(b);
      if (va === vb) return (b.createdAt||'').localeCompare(a.createdAt||''); // 同值按日期新在前
      if (contentSortByViews === 'desc') return vb - va; // 降序：大的在前
      return va - vb; // 升序：小的在前（-1 自然排最后）
    });
  } else {
    filtered.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  }
  return filtered;
}

// 手动搜索：读取输入框内容触发（回车 或 点搜索按钮），不随输入实时搜索
function doSearch() {
  const input = document.getElementById('searchInput');
  searchKeyword = input ? input.value.trim() : '';
  render();
}

function clearSearch() {
  searchKeyword = '';
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  render();
}

function highlightText(text, keyword) {
  const safeText = escapeHtml(text);
  if (!keyword) return safeText;
  const escapedKw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedKw})`, 'gi');
  return safeText.replace(regex, '<span class="search-highlight">$1</span>');
}

// 统一数据栏显示：未录入(null/undefined/空) → 留空；录入 0 → '0'
function fmtData(v) {
  if (v === null || v === undefined || v === '') return '';
  return formatNum(v);
}

// 平台适用性（与导出报表 VIDEO_METRIC_APPLY 保持一致）：
// 完播率：抖音/快手/视频号；均播：抖音/小红书/视频号；收藏：抖音/快手/小红书；推荐：仅视频号
const VIDEO_METRIC_APPLY_VIEW = {
  '抖音':   { completionRate: true,  avgWatch: true,  favorites: true,  recommend: false },
  '快手':   { completionRate: true,  avgWatch: false, favorites: true,  recommend: false },
  '小红书': { completionRate: false, avgWatch: true,  favorites: true,  recommend: false },
  '视频号': { completionRate: true,  avgWatch: true,  favorites: false, recommend: true },
};
// 平台不适用 → '-';适用时原样（未录入留空 / 0 / 数值）
function metricView(pf, key, v) {
  const apply = VIDEO_METRIC_APPLY_VIEW[pf];
  if (apply && apply[key] === false) return '-';
  return v;
}

function renderContentItem(c) {
  const type = 'video';
  const kw = searchKeyword;
  const titleHtml = highlightText(c.title, kw);
  const topicHtml = c.topic ? highlightText(c.topic, kw) : '';
  const platformHtml = highlightText(c.platform, kw);

  // 已登记的数据（右侧数据栏，统一显示全部指标，不适用 → ❌）
  let dataHtml = '';
  let hasData = false;
  const s = stats.find(x => x.contentId == c.id || x.contentId == Number(c.id) || (x.platform === c.platform && x.date === c.createdAt));
  if (s) {
    hasData = true;
    // 适用指标：未录入留空；不适用由 metricView 显示 '-'
    const completion = s.completionRate !== null && s.completionRate !== undefined ? s.completionRate + '%' : '';
    const avgWatch = s.avgWatch !== null && s.avgWatch !== undefined ? s.avgWatch + 's' : '';
    dataHtml = `<div class="content-data-item"><span>播放</span><b>${fmtData(s.views)}</b></div>
      <div class="content-data-item"><span>完播</span><b>${metricView(c.platform, 'completionRate', completion)}</b></div>
      <div class="content-data-item"><span>均播</span><b>${metricView(c.platform, 'avgWatch', avgWatch)}</b></div>
      <div class="content-data-item"><span>点赞</span><b>${fmtData(s.likes)}</b></div>
      <div class="content-data-item"><span>评论</span><b>${fmtData(s.comments)}</b></div>
      <div class="content-data-item"><span>收藏</span><b>${metricView(c.platform, 'favorites', fmtData(s.favorites))}</b></div>
      <div class="content-data-item"><span>推荐</span><b>${metricView(c.platform, 'recommend', fmtData(s.recommend))}</b></div>
      <div class="content-data-item"><span>分享</span><b>${fmtData(s.shares)}</b></div>
      <div class="content-data-item"><span>涨粉</span><b>${fmtData(s.followers)}</b></div>`;
  }

  // 左侧信息栏
  let leftHtml = `<div class="content-header">
      <span class="content-title">${titleHtml}</span>
      <span class="platform-tag ${type}">${platformHtml}</span>
    </div>`;
  if (c.url) {
    const safeLink = safeUrl(c.url);
    // 按码点安全截断（避免切断多字节字符或高亮 span 标签造成残缺 HTML）
    const shortUrl = c.url.length > 50 ? Array.from(c.url).slice(0, 50).join('') + '…' : c.url;
    const urlHtml = highlightText(shortUrl, kw);
    leftHtml += `<div class="content-url"><span style="color:var(--text2);">链接：</span><a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer">${urlHtml}</a></div>`;
  }
  // 最后一行：日期在前，选题在后（同一行同字号）
  leftHtml += `<div class="content-meta">${c.createdAt || ''}${c.topic ? `<span class="meta-topic"><span style="color:var(--text2);">· 选题：</span>${topicHtml}</span>` : ''}</div>`;
  leftHtml += `<div class="content-actions">
    <button class="btn-edit" onclick="editContent('${c.id}')">编辑</button>
    <button class="btn-delete" onclick="deleteContent('${c.id}')">删除</button>
  </div>`;

  // 右侧数据栏（数据展示 + 右下角数据录入按钮）
  const rightHtml = `<div class="content-data-side ${hasData ? 'has-data' : ''}">
    <div class="content-data-grid">
      ${hasData ? dataHtml : '<div class="content-data-empty">暂无数据</div>'}
    </div>
    <div class="content-data-btn-wrap">
      <button class="btn-data-entry" onclick="openDataModal('${c.id}')">数据录入</button>
    </div>
  </div>`;

  return `<div class="content-item ${type}">
    <div class="platform-initial ${type}">${PLATFORM_SHORT[c.platform] || (c.platform ? c.platform.charAt(0) : '')}</div>
    <div class="content-main">${leftHtml}</div>
    ${rightHtml}
  </div>`;
}
