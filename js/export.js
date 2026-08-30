function exportData() {
  const data = { version: 5, exportedAt: new Date().toISOString(), contents, stats, reviews, accountStats, accountIds };
  const counts = `内容${contents.length}·视频${stats.length}·复盘${reviews.length}·账号数据${accountStats.length}·账号ID${accountIds.length}`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `新媒体数据工作台_${getToday()}.json`; a.click();
  URL.revokeObjectURL(url); showToast(`已导出：${counts}`);
}

// ===== 导出 Excel（HTML 表格，Excel 双击可直接打开）=====
// 报表含：数据概览 / 账号数据总览（有数据才显示）/ 内容登记 / 视频数据 / 视频平台复盘记录（存在才显示）
// 整体按「日期 + 平台」分组，同一日期的单元格纵向合并；只显示登记条数，不显示任务完成
// 支持导出范围：全部 / 本周（周一~周日）/ 本月（日历月），区间复用数据复盘页的 getPeriodRanges

// 数字单元格：数字原样输出（含 0），null/undefined/空 → 留空（未录入）
function cellNum(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return isNaN(n) ? '' : n;
}

// 各视频平台「适用」的指标：不适用的指标在报表中留白，而非显示 0；有数据时（含 0）照实输出
// 视频指标：平台不适用该项时显示「-」（例如快手不记均播、小红书不记完播率）；适用时 cellNum 输出——0 显示 0、无值留空
// 口径基准 VIDEO_METRIC_APPLY 定义在 store.js（总览汇总/AI 分析/表格解析统一引用）
function videoMetric(s, key) {
  const apply = VIDEO_METRIC_APPLY[s.platform];
  if (apply && apply[key] === false) return '-';
  return cellNum(s[key]);
}

// 通用「日期合并」表格：groups = [{ date, rows: [[cellHtml,...], ...] }]；countText 可自定义标题条数说明
function buildMergedTable(title, colHeaders, groups, note, countText) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const label = countText || `${total} 条`;
  if (total === 0) return `<h2>${escapeHtml(title)}（0 条）</h2><p style="color:#999">（暂无数据）</p>`;
  let html = `<h2>${escapeHtml(title)}（${escapeHtml(label)}）</h2>`;
  if (note) html += `<p style="color:#9ca3af;font-size:12px;margin:2px 0 8px;">${escapeHtml(note)}</p>`;
  html += '<table><thead><tr>' + colHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
  groups.forEach(g => {
    g.rows.forEach((cells, i) => {
      html += '<tr>';
      // 同日期首行写入日期格并纵向合并后续行
      if (i === 0) {
        html += `<td rowspan="${g.rows.length}" style="vertical-align:middle;font-weight:600;background:#f0f7ff;white-space:nowrap;">${escapeHtml(g.date)}</td>`;
      }
      html += cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    });
  });
  html += '</tbody></table>';
  return html;
}

// 数据概览：总体指标 + 各平台分布（每日分布已并入下方内容登记表，此处不再重复）
function buildOverviewSheet(ds) {
  const contents = ds.contents;
  const platformCounts = {};
  ALL_PLATFORMS.forEach(p => { platformCounts[p] = contents.filter(c => c.platform === p).length; });
  const dates = contents.map(c => c.createdAt || '').filter(Boolean).sort();
  const dateRange = dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '-';
  const activePlatforms = ALL_PLATFORMS.filter(p => platformCounts[p] > 0).length;

  let html = `<h2>数据概览</h2>`;
  html += '<table style="width:auto;min-width:440px;margin-bottom:18px;"><tbody>';
  html += `<tr><th>内容登记总数</th><td>${contents.length} 条</td><th>覆盖平台</th><td>${activePlatforms}/${ALL_PLATFORMS.length} 个</td></tr>`;
  html += `<tr><th>日期范围</th><td colspan="3">${escapeHtml(dateRange)}</td></tr>`;
  html += '</tbody></table>';

  html += '<h3 style="margin:14px 0 6px;color:#374151;">各平台登记分布</h3>';
  html += '<div style="display:inline-flex;gap:16px;align-items:flex-start;margin-bottom:18px;">';
  html += '<table style="width:auto;"><thead><tr><th>视频平台</th><th>登记条数</th></tr></thead><tbody>';
  VIDEO_PLATFORMS.forEach(p => {
    html += `<tr><td>${escapeHtml(p)}</td><td style="text-align:center;">${platformCounts[p]}</td></tr>`;
  });
  html += '</tbody></table>';
  html += '</div>';

  return html;
}

// 内容登记：日期 + 平台 + 登记条数（仅显示有登记内容的平台）
function buildContentRegSheet(ds) {
  const contents = ds.contents;
  const map = {};
  contents.forEach(c => {
    const d = c.createdAt || '未注明日期';
    (map[d] = map[d] || {});
    map[d][c.platform] = (map[d][c.platform] || 0) + 1;
  });
  const dates = Object.keys(map).sort();
  const groups = dates.map(d => ({
    date: d,
    rows: [[
      ALL_PLATFORMS.filter(p => map[d][p] > 0).map(p => `${p}×${map[d][p]}`).join('、')
    ]]
  }));
  return buildMergedTable('内容登记', ['日期', '平台明细'], groups,
    '按日期合并一行：当天各平台登记条数（如 抖音×1、小红书×2），日期升序',
    contents.length + ' 条 · ' + dates.length + ' 个日期');
}

// 导出标题以「内容登记」为准（统计表里的 title 是写入时的副本，用户改过登记标题后副本会滞后）
// 优先 contentId 全表精确匹配（避免「同平台同日」兜底抢先命中错误内容），无 contentId 时再兜底同平台同日
function statTitle(s) {
  if (s.contentId) {
    const byId = contents.find(x => x.id == s.contentId || x.id == Number(s.contentId));
    if (byId) return byId.title;
  }
  const sameDay = contents.find(x => x.platform === s.platform && x.createdAt === (s.date || ''));
  return sameDay ? sameDay.title : (s.title || '');
}

// 视频数据：按平台拆成 4 张独立子表（抖音/快手/小红书/视频号），打印互不拥挤
function buildVideoSheet(ds) {
  const headers = ['日期', '标题', '播放量', '完播率(%)', '均播时长(秒)', '点赞', '评论', '收藏', '推荐', '分享', '涨粉'];
  const note = '完播率：抖音/快手/视频号；均播时长(秒)：抖音/小红书/视频号（小红书「人均观看时长」同义）；收藏：抖音/快手/小红书；视频号看「推荐」、不记收藏。';
  let html = `<p style="color:#9ca3af;font-size:12px;margin:2px 0 8px;">${escapeHtml(note)}以下按平台分表：</p>`;
  html += VIDEO_PLATFORMS.map(p => {
    const platList = (ds.stats || []).filter(s => s.platform === p);
    const map = {};
    platList.forEach(s => { const d = s.date || '未注明日期'; (map[d] = map[d] || []).push(s); });
    const dates = Object.keys(map).sort();
    const groups = dates.map(d => ({
      date: d,
      rows: map[d].map(s => [
        escapeHtml(statTitle(s)),
        cellNum(s.views),
        videoMetric(s, 'completionRate'),
        videoMetric(s, 'avgWatch'),
        cellNum(s.likes),
        cellNum(s.comments),
        videoMetric(s, 'favorites'),
        videoMetric(s, 'recommend'),
        cellNum(s.shares),
        cellNum(s.followers),
      ])
    }));
    return buildMergedTable(p + '内容数据', headers, groups, '');
  }).join('');
  return html;
}

// 复盘记录表：视频平台复盘
// 仅在导出数据里存在视频复盘记录时才生成（范围外或为空则不显示该栏）
function buildReviewSheet(ds, type, title) {
  const list = (ds.reviews || []).filter(r => r.type === type);
  if (list.length === 0) return '';
  const periodOrder = { week: 0, month: 1 };
  list.sort((a, b) =>
    ((periodOrder[a.period] ?? 9) - (periodOrder[b.period] ?? 9)) ||
    String(a.date || '').localeCompare(String(b.date || '')));
  const headers = ['复盘周期', '复盘日期', '数据小结与亮点分析', '问题与不足', '下期计划'];
  let html = `<h2>${escapeHtml(title)}</h2>`;
  html += '<table><thead><tr>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
  list.forEach(r => {
    const periodLabel = r.period === 'week' ? '本周' : (r.period === 'month' ? '本月' : (r.period || ''));
    html += `<tr>
      <td style="font-weight:600;white-space:nowrap;">${escapeHtml(periodLabel)}</td>
      <td style="white-space:nowrap;">${escapeHtml(r.date || '')}</td>
      <td>${escapeHtml(r.highlights || '')}</td>
      <td>${escapeHtml(r.problems || '')}</td>
      <td>${escapeHtml(r.plans || '')}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

// 视频平台账号数据（仅导出各平台最新一次记录，标注记录日期/时间；未登记账号ID时留空）
function buildAccountSheet(ds) {
  const list = ds.accountStats || [];
  const accIds = ds.accountIds || [];
  // 各平台最新一次记录（不限账号）
  const latestOf = (p) => {
    let best = null;
    list.forEach(s => { if (s.platform === p && (!best || (s.date || '') > (best.date || ''))) best = s; });
    return best;
  };
  // 该账号（accountRef）最新一次记录
  const latestOfRef = (p, ref) => {
    let best = null;
    list.forEach(s => {
      if (s.platform === p && String(s.accountRef || '') === String(ref || '') && (!best || (s.date || '') > (best.date || ''))) best = s;
    });
    return best;
  };
  // 该平台「未指定账号」最新快照
  const latestUnspecified = (p) => {
    const refs = accIds.filter(x => x.platform === p).map(x => String(x.id));
    let best = null;
    list.forEach(s => {
      if (s.platform !== p) return;
      const refStr = String(s.accountRef || '');
      if (refStr && refs.includes(refStr)) return;
      if (!best || (s.date || '') > (best.date || '')) best = s;
    });
    return best;
  };
  const rowHtml = (p, accountId, note, operator, r) => `<tr>
    <td>${escapeHtml(p)}</td>
    <td>${escapeHtml(accountId || '')}</td>
    <td>${escapeHtml(note || '')}</td>
    <td>${escapeHtml(operator || '')}</td>
    <td>${r ? escapeHtml(r.date) : ''}</td>
    <td>${r ? cellNum(r.posts) : ''}</td>
    <td>${r ? cellNum(r.followers) : ''}</td>
    <td>${r ? cellNum(r.views) : ''}</td>
    <td>${r ? cellNum(r.likes) : ''}</td>
    <td>${r ? cellNum(r.comments) : ''}</td>
    <td>${r ? cellNum(r.shares) : ''}</td>
  </tr>`;
  let html = '<h2>账号数据总览</h2>';
  html += '<p style="color:#9ca3af;font-size:12px;margin:2px 0 8px;">账号ID列出全部登记记录（一个平台可有多个账号）；数据列对应该账号最近一次记录（未绑定账号的历史数据归「未指定账号」行），未登记账号ID时该栏留空</p>';
  html += '<table><thead><tr><th>平台</th><th>账号ID</th><th>备注</th><th>运营人</th><th>记录日期</th><th>发布量</th><th>粉丝量</th><th>总播放量</th><th>总点赞量</th><th>总评论量</th><th>总转发/分享</th></tr></thead><tbody>';
  const hasVal = r => r && ((r.accountId && r.accountId.trim()) || (r.note && r.note.trim()));
  const validIds = accIds.filter(hasVal);
  VIDEO_PLATFORMS.forEach(p => {
    const recs = validIds.filter(r => r.platform === p);
    if (recs.length === 0) {
      // 无账号ID记录：有数据则保留一行（ID/备注留空）
      const r = latestOf(p);
      if (r) html += rowHtml(p, '', '', '', r);
    } else {
      // 有账号ID记录：每条一行，数据列优先该账号最新快照（无则平台最新）
      recs.forEach(rec => {
        const r = latestOfRef(p, rec.id) || latestOf(p);
        html += rowHtml(p, rec.accountId, rec.note, rec.operator, r);
      });
    }
    // 未指定账号的历史数据单独一行
    const orphan = latestUnspecified(p);
    if (orphan) html += rowHtml(p, '', '未指定账号', '', orphan);
  });
  html += '</tbody></table>';
  return html;
}

// ===== 导出下拉菜单控制 =====
function toggleExportMenu(e) {
  if (e) e.stopPropagation();
  const m = document.getElementById('exportMenu');
  if (!m) return;
  if (m.classList.contains('open')) { m.classList.remove('open'); return; }
  m.classList.add('open');
  // fixed 定位：锚定触发按钮正下方（移动端滑动容器 overflow 裁剪不影响弹出层），靠右缘时自动内收
  const trigger = m.parentElement.querySelector('.export-trigger') || (e && e.target);
  if (trigger && trigger.getBoundingClientRect) {
    const r = trigger.getBoundingClientRect();
    const width = m.offsetWidth || 130;
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + 'px';
    m.style.top = (r.bottom + 6) + 'px';
  }
}
function doExport(scope) {
  const m = document.getElementById('exportMenu');
  if (m) m.classList.remove('open');
  openExportChoice(scope);
}

// 导出格式选择弹窗：Excel 下载 或 打印 HTML 预览
function openExportChoice(scope) {
  scope = scope || 'all';
  const scopeLabel = { all: '全量', week: '本周', month: '本月' }[scope] || '全量';
  document.getElementById('modalContent').innerHTML = `
    <h3>导出${scopeLabel}数据</h3>
    <p class="confirm-text">选择导出格式：</p>
    <div class="modal-actions" style="flex-direction:column;gap:8px;align-items:stretch;">
      <button class="btn-save" style="background:linear-gradient(135deg,var(--green),#10b981);" onclick="exportExcel('${scope}'); closeModal();">📊 Excel表格（.xls格式报表，可手动修改）</button>
      <button class="btn-save" style="background:linear-gradient(135deg,var(--accent-2),var(--accent));" onclick="printReport('${scope}'); closeModal();">🖨️ HTML网页（网页端直开，可打印或存为PDF）</button>
      <button class="btn-cancel" onclick="closeModal()">取消</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}
// 点击页面其他地方自动收起下拉
document.addEventListener('click', function() {
  const m = document.getElementById('exportMenu');
  if (m) m.classList.remove('open');
});

// ===== 导出 Excel 报表（HTML 格式 .xls 下载 + 打印预览共用构建）=====
// 按范围筛选数据并构建完整报表 HTML
function buildReportHtml(scope, scopeLabel) {
  let range = null;
  if (scope === 'week' || scope === 'month') range = getPeriodRanges(scope);
  const inRange = d => !range || (d >= range.start && d <= range.end);
  const ds = {
    contents: contents.filter(c => inRange(c.createdAt || '')),
    stats: stats.filter(s => inRange(s.date || '')),
    accountStats: accountStats.filter(s => inRange(s.date || '')),
    reviews: reviews.filter(r => inRange(r.date || '')), // 复盘记录按日期纳入导出范围
    accountIds: accountIds, // 账号ID为静态信息，不按日期过滤
  };
  // 复盘记录栏：有视频复盘才显示
  const videoReviews = ds.reviews.filter(r => r.type === 'video');
  // 视频平台账号数据：有账号ID或有账号快照数据才显示
  const hasVideoAccounts = (ds.accountIds || []).some(function(r){
    return (r.accountId && r.accountId.trim()) || (r.note && r.note.trim());
  }) || (ds.accountStats || []).length > 0;
  const metaParts = ['数据概览'];
  if (hasVideoAccounts) metaParts.push('账号数据总览');
  metaParts.push('内容登记', '视频数据');
  if (videoReviews.length) metaParts.push('视频平台复盘记录');
  const sectionsArr = [
    buildOverviewSheet(ds),
    hasVideoAccounts ? buildAccountSheet(ds) : '',
    buildContentRegSheet(ds),
    buildVideoSheet(ds),
  ];
  if (videoReviews.length) sectionsArr.push(buildReviewSheet(ds, 'video', '视频平台复盘记录'));
  const sections = sectionsArr.join('');
  const rangeText = range ? `（${range.start} ~ ${range.end}）` : '';
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>新媒体数据工作台数据报表_${scopeLabel}_${getToday()}</title>
<style>
body { font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; margin: 20px; color: #1f2937; line-height: 1.5; }
h1 { color: #1f2937; border-bottom: 3px solid #5b8cff; padding-bottom: 10px; }
h2 { color: #5b8cff; border-bottom: 2px solid #93c5fd; padding-bottom: 5px; margin-top: 30px; }
h3 { color: #374151; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 20px; font-size: 13px; }
th, td { border: 1px solid #d1d5db; padding: 7px 11px; text-align: left; }
th { background: #f3f4f6; font-weight: 600; color: #374151; }
tr:nth-child(even) td { background: #f9fafb; }
.meta { color: #6b7280; font-size: 14px; margin: 5px 0; }
</style>
</head><body>
<h1>📊 新媒体数据工作台数据报表（${scopeLabel}${rangeText}）</h1>
<p class="meta">导出时间：${new Date().toLocaleString('zh-CN')}　|　报表含：${metaParts.join(' · ')}</p>
${sections}
</body></html>`;
  return html;
}

// 导出 Excel 报表（下载 .xls，HTML 表格格式，可打印）
function exportExcel(scope) {
  scope = scope || 'all';
  const scopeLabel = { all: '全量', week: '本周', month: '本月' }[scope] || '全量';
  const html = buildReportHtml(scope, scopeLabel);
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `新媒体数据工作台_${scopeLabel}_${getToday()}.xls`;
  a.click();
  URL.revokeObjectURL(url);
  const hasVReview = reviews.some(r => r.type === 'video');
  const hasVAccounts = accountIds.some(function(r){
    return (r.accountId && r.accountId.trim()) || (r.note && r.note.trim());
  }) || accountStats.length > 0;
  const toastParts = ['数据概览'];
  if (hasVAccounts) toastParts.push('账号数据总览');
  toastParts.push('内容登记/视频数据');
  if (hasVReview) toastParts.push('视频平台复盘记录');
  showToast(`已导出${scopeLabel}Excel 报表（${toastParts.join('/')}）`);
}

// 打印预览：打开 HTML 报表新窗口
function printReport(scope) {
  scope = scope || 'all';
  const scopeLabel = { all: '全量', week: '本周', month: '本月' }[scope] || '全量';
  const html = buildReportHtml(scope, scopeLabel);
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.focus(); }
  else showToast('浏览器拦截了弹窗，请允许后重试');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = JSON.parse(e.target.result);
      const picked = [];
      // 先清空再填充：备份里缺失的字段也会被重置为空，避免旧数据残留（恢复更彻底）
      // 字段必须是数组；非数组（损坏/手改的 JSON）统一视为空，避免把对象写入磁盘导致后续渲染崩溃
      const asArr = (v) => Array.isArray(v) ? v : [];
      contents = asArr(data.contents);          if (data.contents) picked.push('内容' + contents.length);
      stats = asArr(data.stats);                if (data.stats)    picked.push('视频' + stats.length);
      reviews = asArr(data.reviews);            if (data.reviews)  picked.push('复盘' + reviews.length);
      accountStats = asArr(data.accountStats);  if (data.accountStats) picked.push('账号数据' + accountStats.length);
      accountIds = asArr(data.accountIds);      if (data.accountIds)   picked.push('账号ID' + accountIds.length);
      // 安全清洗：id/contentId 会拼进 onclick 的 JS 字符串上下文，统一收紧到安全字符集，
      // 防止恶意备份文件借 id 注入脚本
      const cleanId = v => String(v == null ? '' : v).replace(/[^a-zA-Z0-9_-]/g, '');
      [contents, stats, reviews, accountStats, accountIds].forEach(arr => arr.forEach(rec => {
        if (rec && typeof rec === 'object') {
          if ('id' in rec) rec.id = cleanId(rec.id);
          if ('contentId' in rec) rec.contentId = cleanId(rec.contentId);
        }
      }));
      // 导入前自动快照：把当前 5 类数据整体存为 data/ 内一个快照文件，选错备份可人工回退
      try {
        const snapKey = 'import_snapshot_' + new Date().toISOString().replace(/[:.]/g, '-');
        await saveData(snapKey, {
          contents, stats: stats, reviews, accountStats, accountIds,
          savedAt: new Date().toISOString(), note: '导入前自动快照'
        });
        picked.push('（已存导入前快照 ' + snapKey + '）');
      } catch (e) { /* 快照失败不阻断导入 */ }
      // 一次性原子写入全部 5 类数据（写完成后才继续，避免"已导入"提示时数据还没落盘）
      await saveDataBatch([
        { key: 'contents', val: contents },
        { key: 'stats', val: stats },
        { key: 'reviews', val: reviews },
        { key: 'accountStats', val: accountStats },
        { key: 'accountIds', val: accountIds }
      ]);
      render();
      // 乱码检测：导入后扫描关键文本字段（标题/平台/账号ID/备注等）
      const corrupt = countCorruptRecords(contents, ['title', 'topic', 'url', 'platform'])
        + countCorruptRecords(stats, ['title', 'platform'])
        + countCorruptRecords(accountIds, ['accountId', 'note'])
        + countCorruptRecords(accountStats, ['platform'])
        + countCorruptRecords(reviews, ['highlights', 'problems', 'plans']);
      const corruptTip = corrupt > 0 ? ' ⚠️含' + corrupt + '条乱码记录（源文件编码可能非 UTF-8）' : '';
      showToast('已导入：' + picked.join('·') + corruptTip);
    } catch(err) { showToast('导入失败：文件格式错误'); }
  };
  reader.readAsText(file); event.target.value = '';
}

function clearAllData() {
  document.getElementById('modalContent').innerHTML = `
    <h3>确认清空</h3>
    <p class="confirm-text">即将清空所有数据（发布任务、内容登记、视频数据、复盘记录、账号总数据），此操作不可恢复！<br><br>建议先导出备份。</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-danger" onclick="confirmClear()">确认清空</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

async function confirmClear() {
  contents = []; stats = []; reviews = []; accountStats = []; accountIds = [];
  // 全部清空（batch 原子保存，写完成后才提示）
  await saveDataBatch([
    { key: 'contents', val: [] },
    { key: 'stats', val: [] },
    { key: 'reviews', val: [] },
    { key: 'accountStats', val: [] },
    { key: 'accountIds', val: [] }
  ]);
  selectedDate = null; closeModal(); render();
  showToast('已清空，已重置今日任务');
}

function fillSampleData() {
  showConfirm({
    title: '重置示例数据',
    desc: '将重置为示例数据（最近3天，覆盖全部登记 + 账号总数据），当前数据会被覆盖。是否继续？',
    danger: true,
    onOk: async () => {
      const s = buildSampleData(getToday());
      contents = s.contents; stats = s.stats; reviews = s.reviews; accountStats = s.accountStats; accountIds = s.accountIds;
      await saveDataBatch([
        { key: 'contents', val: contents },
        { key: 'stats', val: stats },
        { key: 'reviews', val: reviews },
        { key: 'accountStats', val: accountStats },
        { key: 'accountIds', val: accountIds }
      ]);
      render(); showToast('已重置示例数据（最近3天）');
    }
  });
}
