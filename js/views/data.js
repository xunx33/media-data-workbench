// 关联内容标题：优先 contentId 精确匹配，兜底 platform+date 匹配
function findLinkedTitle(record, type) {
  if (record.contentId) {
    const c = contents.find(c => c.id == record.contentId || c.id == Number(record.contentId));
    if (c) return c.title;
  }
  const sameDay = contents.find(c => c.platform === record.platform && c.createdAt === record.date);
  if (sameDay) return sameDay.title;
  return null;
}

function renderData() {
  let html = '';

  // 顶部工具栏：左侧平台筛选标签 + 右侧周期下拉（同一行，窄屏自动换行）
  const curPeriod = getCurPeriod();
  html += '<div class="review-toolbar">';
  html += renderPlatformFilterTags();
  html += `<div class="period-select-row">
    <select id="dataPeriodSelect" onchange="switchDataPeriod(this.value)" aria-label="数据复盘周期">
      <option value="week" ${curPeriod==='week'?'selected':''}>周数据与复盘</option>
      <option value="month" ${curPeriod==='month'?'selected':''}>月数据与复盘</option>
    </select>
  </div>`;
  html += '</div>';

  // 左右两栏：左=统计图表，右=复盘登记
  html += '<div class="data-layout">';
  html += '<div class="data-left">';
  html += renderVideoData(curPeriod);
  html += '</div>';
  html += '<div class="data-right">';
  html += renderReviewPanel(curPeriod);
  html += '</div>';
  html += '</div>';

  return html;
}

// ===== 数据复盘平台筛选标签 =====
// 渲染「全部 + 各平台」标签，平台列表为 4 个短视频平台
function renderPlatformFilterTags() {
  const platforms = VIDEO_PLATFORMS;
  let html = '<div class="platform-filter-row"><span class="filter-label">平台：</span>';
  html += `<span class="filter-pill ${reviewPlatformFilter === '' ? 'active' : ''}" onclick="switchReviewPlatformFilter('')">全部</span>`;
  platforms.forEach(p => {
    html += `<span class="filter-pill ${reviewPlatformFilter === p ? 'active' : ''}" onclick="switchReviewPlatformFilter('${p}')">${p}</span>`;
  });
  html += '</div>';
  return html;
}

function switchReviewPlatformFilter(platform) {
  reviewPlatformFilter = platform;
  render();
}

// ===== 周期状态：视频数据复盘记忆周/月选择 =====
let dataPeriod = { video: 'month' };
function getCurPeriod() { return dataPeriod['video'] || 'month'; }
function switchDataPeriod(p) { dataPeriod['video'] = p; render(); }

// ===== 账号登记（独立 Tab）：不定时快照登记，当天记录=最新总数据，与上次记录对比 =====
function renderAccountTab() {
  return renderAccountData();
}

// 当前周期范围 + 上一周期范围（用于双柱对比）
// 返回 { label, prevLabel, start, end, prevStart, prevEnd }
function getPeriodRanges(period) {
  const today = new Date();
  if (period === 'week') {
    // 本周：周一~今天（与内容登记筛选、每周复盘提醒统一口径；未来日期本就无数据）
    // 上周：上周一~上周日（与「本月 vs 上月整月」的双柱对比口径一致）
    const dow = (today.getDay() + 6) % 7;
    const monday = new Date(today); monday.setDate(today.getDate() - dow);
    const prevMonday = new Date(monday); prevMonday.setDate(monday.getDate() - 7);
    const prevSunday = new Date(prevMonday); prevSunday.setDate(prevMonday.getDate() + 6);
    return {
      label: '本周', prevLabel: '上周',
      start: getDayStr(monday), end: getDayStr(today),
      prevStart: getDayStr(prevMonday), prevEnd: getDayStr(prevSunday)
    };
  }
  // 月：本月；上月
  const y = today.getFullYear(), m = today.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const prevFirst = new Date(y, m - 1, 1);
  const prevLast = new Date(y, m, 0);
  return {
    label: '本月', prevLabel: '上月',
    start: getDayStr(first), end: getDayStr(last),
    prevStart: getDayStr(prevFirst), prevEnd: getDayStr(prevLast)
  };
}

// 复盘时间段标签：周→所在周周一~周日，月→当月1号~月末
function formatReviewRange(period, dateStr) {
  if (!dateStr) return period === 'month' ? '本月' : '本周';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return period === 'month' ? '本月' : '本周';
  if (period === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return '本月·' + getDayStr(start) + ' ~ ' + getDayStr(end);
  }
  // 周：所在周的周一到周日
  const diffToMon = (d.getDay() + 6) % 7;
  const start = new Date(d); start.setDate(d.getDate() - diffToMon);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return '本周·' + getDayStr(start) + ' ~ ' + getDayStr(end);
}

// --- 复盘数据登记面板 ---
function renderReviewPanel(period) {
  const curPeriod = period || getCurPeriod();
  const periodLabel = curPeriod === 'week' ? '本周复盘' : '本月复盘';
  const ranges = getPeriodRanges(curPeriod);
  let html = `<div class="card"><div class="card-title">短视频复盘登记</div>`;

  html += `<div class="form-group"><label>复盘周期（跟随上方选项）</label><div style="font-size:13px;color:var(--accent);font-weight:600;padding:9px 13px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-xs);">${periodLabel}·${ranges.start} ~ ${ranges.end}</div></div>`;
  html += `<div class="form-group"><label>复盘日期</label><input type="date" id="reviewDate" value="${getToday()}"></div>`;
  html += `<div class="form-group"><label>数据小结与亮点分析</label><textarea id="reviewHighlights" placeholder="数据表现 + 亮点：播放/完播/互动表现好的内容、平台、选题…"></textarea></div>`;
  html += `<div class="form-group"><label>问题与不足</label><textarea id="reviewProblems" placeholder="数据不理想的地方、待改进项…"></textarea></div>`;
  html += `<div class="form-group"><label>下期计划</label><textarea id="reviewPlans" placeholder="下周/月计划做什么…"></textarea></div>`;
  html += `<div class="toolbar" style="margin-top:8px;">
    <button class="btn-primary" onclick="saveReview()">保存复盘</button>
  </div>`;

  // 历史复盘列表（仅视频复盘记录）
  const sortedReviews = [...reviews]
    .filter(r => (r.type || 'video') === 'video')
    .sort((a,b) => (b.date||'').localeCompare(a.date||''));
  html += '<div style="margin-top:16px;">';
  html += `<div class="review-history-box">
    <div class="review-history-title">📋 短视频复盘记录 <span class="badge">${sortedReviews.length}条</span></div>
    <div style="font-size:11px;color:var(--text3);line-height:1.6;padding:2px 0 6px;">每个周期（本周/本月）仅保留最新一条：保存新复盘会覆盖本周/本月的旧记录，过期历史不长期留存。</div>
    <div class="review-history-list">`;
  if (sortedReviews.length === 0) {
    html += '<p style="font-size:12px;color:var(--text3);padding:8px 0;">暂无复盘记录</p>';
  } else {
    sortedReviews.forEach(r => {
      html += `<div class="review-item">
        <div class="review-item-head">
          <span class="platform-tag video">短视频·${formatReviewRange(r.period, r.date)}</span>
          <button class="btn-delete-mini" onclick="deleteReview('${r.id}')" title="删除复盘">删除</button>
        </div>
        <div class="review-item-date">${escapeHtml(r.date)}</div>
        ${r.highlights ? `<div class="review-item-line"><span style="color:var(--green);">小结与亮点：</span>${escapeHtml(r.highlights)}</div>` : ''}
        ${r.problems ? `<div class="review-item-line"><span style="color:var(--red);">问题：</span>${escapeHtml(r.problems)}</div>` : ''}
        ${r.plans ? `<div class="review-item-line"><span style="color:var(--purple);">计划：</span>${escapeHtml(r.plans)}</div>` : ''}
      </div>`;
    });
  }
  html += '</div></div></div>';
  return html;
}

async function saveReview() {
  const type = 'video'; // 复盘仅针对视频平台
  const period = getCurPeriod(); // 周期跟随页面顶部的周/月下拉
  const date = document.getElementById('reviewDate').value || getToday();
  const highlights = document.getElementById('reviewHighlights').value.trim();
  const problems = document.getElementById('reviewProblems').value.trim();
  const plans = document.getElementById('reviewPlans').value.trim();
  if (!highlights && !problems && !plans) { showToast('请至少填写一项内容'); return; }

  // 只保存最新的「本周 / 本月」复盘：
  // 1) 同周期(period) + 同类型(type) 直接覆盖 —— 每次保存即覆盖旧日期的旧数据
  // 2) 丢弃不在当前周 / 当前月的旧复盘，确保只留存最新本周、本月
  // 有旧记录会被覆盖/丢弃时先弹确认（删除不可恢复，与其他删除操作交互一致）
  const weekRange = getPeriodRanges('week');
  const monthRange = getPeriodRanges('month');
  const inWeek = d => d >= weekRange.start && d <= weekRange.end;
  const inMonth = d => d >= monthRange.start && d <= monthRange.end;
  const dropped = reviews.filter(r =>
    (r.period === period && r.type === type) ||
    (r.period === 'week' && !inWeek(r.date || '')) ||
    (r.period === 'month' && !inMonth(r.date || ''))
  );
  const doSave = async () => {
    reviews = reviews.filter(r => !dropped.includes(r));
    reviews.push({ id: Date.now(), type, period, date, highlights, problems, plans });
    await saveData('reviews', reviews); render(); showToast('复盘已保存');
  };
  if (dropped.length > 0) {
    showConfirm({
      title: '保存并清理旧复盘',
      desc: `保存会覆盖/清理 ${dropped.length} 条旧周期复盘（仅保留最新本周、本月各一条），删除不可恢复。是否继续？`,
      okText: '确认保存',
      onOk: doSave
    });
  } else {
    await doSave();
  }
}

function deleteReview(id) {
  showConfirm({
    title: '确认删除',
    desc: '确定删除这条复盘记录吗？',
    danger: true,
    onOk: async () => {
      reviews = reviews.filter(r => r.id != id && r.id != Number(id));
      await saveData('reviews', reviews); render(); showToast('已删除');
    }
  });
}

// 双柱对比柱形图：当前周期实心柱 + 上期半透明柱
// curLabel/prevLabel 跟随当前周期（本周/上周、本月/上月）
// 入场动画：柱高初始 0，data-h 存目标高度，渲染后由 animateChartBars 触发生长（逐柱错峰）
function renderDualBarChart(labels, currVals, prevVals, barClass, fmt, curLabel = '本期', prevLabel = '上期') {
  const maxV = Math.max(...currVals, ...prevVals, 1);
  let html = '<div class="bar-chart">';
  labels.forEach((label, i) => {
    const v = currVals[i] || 0, pv = prevVals[i] || 0;
    const h = Math.max(Math.round(v / maxV * 100), 3);
    const ph = Math.max(Math.round(pv / maxV * 100), 3);
    const delay = (i * 0.06).toFixed(2);
    const delayPrev = (i * 0.06 + 0.03).toFixed(2);
    html += `<div class="bar-col">
      <div class="bar-pair">
        <div class="bar-pair-item" title="${curLabel} ${fmt(v)}">
          <div class="bar-value">${fmt(v)}</div>
          <div class="bar ${barClass}" data-h="${h}" style="height:0;transition-delay:${delay}s"></div>
        </div>
        <div class="bar-pair-item" title="${prevLabel} ${fmt(pv)}">
          <div class="bar-value prev">${fmt(pv)}</div>
          <div class="bar ${barClass} prev" data-h="${ph}" style="height:0;transition-delay:${delayPrev}s"></div>
        </div>
      </div>
      <div class="bar-label">${label}</div>
    </div>`;
  });
  html += '</div>';
  return html;
}

// 近 N 天趋势折线图（纯 SVG 自绘，零依赖）
// points: [{date:'YYYY-MM-DD', value:number}] 按日期升序
// 返回 SVG 折线 + 结束值标注；数据不足 2 天时返回空；onClick=全局函数名（点击数据点跳转，如跳发布日历）
// 入场动画：线条描绘（dashoffset）+ 面积渐显 + 数据点级联浮现（见 animateTrendLines）
// 悬停交互：透明 hit 圆触发小框显示日期与数值 + 竖向参考线（trendTipShow / trendTipHide）
function renderTrendLine(points, { color = 'var(--accent)', fmt = formatNum, height = 160, onClick = null, label = '总播放', prevAvg = null, trendLabel = null } = {}) {
  const data = points.filter(p => p && p.value !== undefined && p.value !== null);
  if (data.length < 2) {
    if (data.length === 1) {
      return `<div class="trend-box"><div class="trend-single">近30天共 <b style="color:${color};">${fmt(data[0].value)}</b></div></div>`;
    }
    return '';
  }
  // viewBox 用合理宽高比（约 4:1），让 SVG 拉伸后比例变形可控
  const VBW = 800, VBH = 200;
  const padL = 60, padR = 50, padT = 30, padB = 36;  // 给两端点和日期标签留空间
  const maxV = Math.max(...data.map(d => d.value), 1);
  const minV = Math.min(...data.map(d => d.value), 0);
  const span = (maxV - minV) || 1;
  const stepX = (VBW - padL - padR) / (data.length - 1);
  const pts = data.map((d, i) => {
    const x = padL + i * stepX;
    const y = padT + (VBH - padT - padB) * (1 - (d.value - minV) / span);
    return { x, y, ...d };
  });
  const path = pts.map((p, i) => (i === 0 ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ');
  const area = path + ` L${pts[pts.length-1].x.toFixed(1)},${(VBH-padB).toFixed(1)} L${pts[0].x.toFixed(1)},${(VBH-padB).toFixed(1)} Z`;
  // 日期标签：数据 ≤ 7 天全部显示（周模式友好），>7 天均匀抽 5 个（月模式不挤）
  const labelCount = data.length <= 7 ? data.length : Math.min(5, data.length);
  const labelIdxs = [];
  for (let i = 0; i < labelCount; i++) {
    labelIdxs.push(Math.round(i * (data.length - 1) / (labelCount - 1)));
  }
  const labels = labelIdxs.map(i => pts[i]);
  const last = pts[pts.length-1];
  const first = pts[0];
  // 较上周期日均对比（prevAvg 由调用方传入）
  const curAvg = data.reduce((s, d) => s + d.value, 0) / data.length;
  let trendBadge = '';
  if (prevAvg === null) {
    // 无上期数据：仅显示本期日均
    trendBadge = `<span class="trend-flat">日均 ${fmt(Math.round(curAvg))}</span>`;
  } else if (!prevAvg && curAvg > 0) {
    trendBadge = `<span class="trend-up">▲ 新增</span>`;
  } else if (prevAvg && !curAvg) {
    trendBadge = `<span class="trend-down">▼ -100%</span>`;
  } else if (prevAvg) {
    const risePct = Math.round((curAvg - prevAvg) / prevAvg * 100);
    if (risePct > 0) trendBadge = `<span class="trend-up">▲ +${risePct}%</span>`;
    else if (risePct < 0) trendBadge = `<span class="trend-down">▼ ${risePct}%</span>`;
    else trendBadge = `<span class="trend-flat">— 持平</span>`;
  } else {
    trendBadge = `<span class="trend-flat">— 持平</span>`;
  }
  // 对比说明（如"较上月日均"）紧贴升降百分比，作为一个整体阅读（用容器包裹，避免被 flex space-between 撑开）
  if (trendLabel && prevAvg !== null) {
    trendBadge = '<span class="trend-compare-group"><span class="trend-compare-label">' + trendLabel + '</span>' + trendBadge + '</span>';
  }
  // 数值标注：局部峰值点（比左右都高）+ 最后一点；峰值过多时取最高的 5 个
  const peakIdxs = [];
  for (let i = 1; i < data.length - 1; i++) {
    if (data[i].value > data[i-1].value && data[i].value >= data[i+1].value) peakIdxs.push(i);
  }
  if (peakIdxs.length > 5) {
    peakIdxs.sort((a, b) => data[b].value - data[a].value);
    peakIdxs.length = 5;
  }
  const labeledIdxs = new Set(peakIdxs);
  labeledIdxs.add(data.length - 1); // 最后一点始终标注
  const valLabels = [...labeledIdxs].sort((a, b) => a - b).map(i => pts[i]);

  // 可见数据点：入场级联浮现（opacity 0→1，逐点延迟）；悬停放大/描边由 CSS .trend-dot:hover / .hot 处理
  // 内联 transition 需合并 r / stroke-width 项，否则会覆盖 CSS 里 hover 放大效果的过渡
  const dots = pts.map((p, i) => {
    return `<circle class="trend-dot" data-idx="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${color}" style="opacity:0;transition:opacity 0.3s ease ${(0.55 + i * 0.03).toFixed(2)}s, r 0.12s ease, stroke-width 0.12s ease;"/>`;
  }).join('');
  // 透明 hit 圆：覆盖数据点周围区域，鼠标放上去/滑过即触发提示框；点击保留跳转（如跳发布日历）
  const hits = pts.map((p, i) => {
    const click = onClick ? ` onclick="${onClick}('${p.date}')"` : '';
    return `<circle class="trend-hit" data-idx="${i}" data-date="${p.date}" data-label="${label}" data-val="${fmt(p.value)}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="13" fill="transparent"${click} onmousemove="trendTipShow(this)" onmouseleave="trendTipHide()"/>`;
  }).join('');

  return `<div class="trend-box">
    <div class="trend-head"><span class="trend-label">${first.date} ~ ${last.date}</span>${trendBadge}</div>
    <div class="trend-wrap">
    <svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMidYMid meet" class="trend-svg">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <path class="trend-area" d="${area}" fill="url(#trendFill)" style="opacity:0;transition:opacity 0.7s ease 0.35s;"/>
      <path class="trend-line" d="${path}" pathLength="1" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" style="stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 0.95s ease;"/>
      <line class="trend-guide" x1="0" x2="0" y1="${padT}" y2="${VBH - padB}"/>
      ${valLabels.map(p => `<text x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" text-anchor="middle" font-size="18" font-weight="700" fill="${color}" style="paint-order:stroke;stroke:var(--bg);stroke-width:4px;">${fmt(p.value)}</text>`).join('')}
      ${labels.map(l => `<text x="${l.x.toFixed(1)}" y="${(VBH - 10).toFixed(1)}" text-anchor="middle" font-size="18" fill="var(--text3)">${l.date.slice(5)}</text>`).join('')}
      ${dots}
      ${hits}
    </svg>
    <div class="trend-tip"><div class="trend-tip-date"></div><div class="trend-tip-val"></div></div>
    </div>
  </div>`;
}

// 近 30 天按天汇总：records 数组 → [{date, value}]
function aggregateDaily(records, getVal, days = 30, endDate) {
  const map = {};
  records.forEach(r => { const d = r.date; if (d) map[d] = (map[d] || 0) + getVal(r); });
  const out = [];
  const end = endDate || new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end); d.setDate(end.getDate() - i);
    const key = getDayStr(d);
    out.push({ date: key, value: map[key] || 0 });
  }
  return out;
}

// 本月 vs 上月图例（支持自定义周期标签）
function renderChartLegend(barClass, curLabel, prevLabel) {
  return `<div class="chart-legend">
    <span class="legend-item"><span class="legend-dot ${barClass}"></span>${curLabel || '当前'}</span>
    <span class="legend-item"><span class="legend-dot ${barClass} prev"></span>${prevLabel || '上期'}</span>
  </div>`;
}

// --- Video data（仅统计展示）---
function renderVideoData(period) {
  const ranges = getPeriodRanges(period || 'month');
  // 平台筛选：''=全部视频平台 | 具体平台
  const pf = reviewPlatformFilter;
  const byPf = s => isVideo(s.platform) && (!pf || s.platform === pf);
  const currStats = stats.filter(s => byPf(s) && s.date >= ranges.start && s.date <= ranges.end);
  const prevStats = stats.filter(s => byPf(s) && s.date >= ranges.prevStart && s.date <= ranges.prevEnd);
  // 总发布数以「登记内容」为准（当前周期 + 平台筛选），不以录入数据条数为准
  const totalCount = contents.filter(c => byPf(c) && c.createdAt >= ranges.start && c.createdAt <= ranges.end).length;
  const totalViews = currStats.reduce((sum, s) => sum + (s.views || 0), 0);
  const totalLikes = currStats.reduce((sum, s) => sum + (s.likes || 0), 0);
  const totalComments = currStats.reduce((sum, s) => sum + (s.comments || 0), 0);
  const totalFavorites = sumVideoMetric(currStats, 'favorites');
  const totalFollowers = currStats.reduce((sum, s) => sum + (s.followers || 0), 0);
  // 上一周期对比值（环比基数）
  const prevCount = contents.filter(c => byPf(c) && c.createdAt >= ranges.prevStart && c.createdAt <= ranges.prevEnd).length;
  const prevViews = prevStats.reduce((sum, s) => sum + (s.views || 0), 0);
  const prevLikes = prevStats.reduce((sum, s) => sum + (s.likes || 0), 0);
  const prevComments = prevStats.reduce((sum, s) => sum + (s.comments || 0), 0);
  const prevFavorites = sumVideoMetric(prevStats, 'favorites');
  const prevFollowers = prevStats.reduce((sum, s) => sum + (s.followers || 0), 0);
  const titleSuffix = pf ? ' · ' + pf : '';

  let html = `<div class="card"><div class="card-title">短视频平台${ranges.label}数据${titleSuffix} <span class="badge">${ranges.start} ~ ${ranges.end}</span></div>
    <div class="stats-grid">
      ${statCardHtml(totalCount, '总发布数', renderGrowthTag(totalCount, prevCount))}
      ${statCardHtml(totalViews, '总播放量', renderGrowthTag(totalViews, prevViews))}
      ${statCardHtml(totalLikes, '总点赞', renderGrowthTag(totalLikes, prevLikes))}
      ${statCardHtml(totalComments, '总评论', renderGrowthTag(totalComments, prevComments))}
      ${statCardHtml(totalFavorites, '总收藏', renderGrowthTag(totalFavorites, prevFavorites))}
      ${statCardHtml(totalFollowers, '总涨粉', renderGrowthTag(totalFollowers, prevFollowers))}
    </div></div>`;

  // Bar chart（当前周期 vs 上期双柱对比）
  if (pf) {
    // 单平台筛选：展示该平台 4 个通用指标（播放/点赞/评论/分享）的双柱对比，避免单根柱过于单薄
    // 标题命名统一：「平台名 数据对比」
    const metrics = [
      { key: 'views',    label: '播放量' },
      { key: 'likes',    label: '点赞量' },
      { key: 'comments', label: '评论量' },
      { key: 'shares',   label: '分享量' },
    ];
    const curVals  = metrics.map(m => currStats.reduce((sum, s) => sum + (s[m.key] || 0), 0));
    const prevVals = metrics.map(m => prevStats.reduce((sum, s) => sum + (s[m.key] || 0), 0));
    html += `<div class="card"><div class="card-title">${pf} 数据对比 <span class="badge">${ranges.label} vs ${ranges.prevLabel}</span></div>`;
    html += renderChartLegend('video', ranges.label, ranges.prevLabel);
    html += renderDualBarChart(metrics.map(m => m.label), curVals, prevVals, 'video', formatNum, ranges.label, ranges.prevLabel);
    html += '</div>';
  } else {
    // 全部平台：各平台播放量对比
    html += `<div class="card"><div class="card-title">各平台播放量对比 <span class="badge">${ranges.label} vs ${ranges.prevLabel}</span></div>`;
    const platformViews = {};
    const prevPlatformViews = {};
    VIDEO_PLATFORMS.forEach(p => { platformViews[p] = 0; prevPlatformViews[p] = 0; });
    currStats.forEach(s => { if (platformViews[s.platform] !== undefined) platformViews[s.platform] += s.views; });
    prevStats.forEach(s => { if (prevPlatformViews[s.platform] !== undefined) prevPlatformViews[s.platform] += s.views; });
    html += renderChartLegend('video', ranges.label, ranges.prevLabel);
    html += renderDualBarChart(VIDEO_PLATFORMS, VIDEO_PLATFORMS.map(p => platformViews[p]), VIDEO_PLATFORMS.map(p => prevPlatformViews[p]), 'video', formatNum, ranges.label, ranges.prevLabel);
    html += '</div>';
  }

  // 播放量趋势折线图（跟随周期：周=本周一~周日，月=近30天）
  const isWeek = (period || 'month') === 'week';
  const trendDays = isWeek ? 7 : 30;
  const trendBase = isWeek ? '本周播放量趋势' : '本月播放量趋势';
  // 标题不带平台后缀（badge「本周 · 平台 · 点击数据点跳转当日」已含平台，避免重复）
  const trendTitle = trendBase;
  // 周模式窗口=本周一~周日（与周期范围一致，含未来日期补零，确保始终渲染7点折线）
  const trendEnd = isWeek ? new Date(ranges.end + 'T00:00:00') : new Date();
  const trendPts = aggregateDaily(stats.filter(s => byPf(s)), s => s.views || 0, trendDays, trendEnd);
  // 上一周期日均（用于趋势图环比标签）
  const prevTrendEnd = new Date(trendEnd);
  prevTrendEnd.setDate(prevTrendEnd.getDate() - trendDays);
  const prevTrendPts = aggregateDaily(stats.filter(s => byPf(s)), s => s.views || 0, trendDays, prevTrendEnd);
  const prevDailyAvg = prevTrendPts.length ? Math.round(prevTrendPts.reduce((s, p) => s + p.value, 0) / prevTrendPts.length) : 0;
  const trendLabel = isWeek ? '较上周日均' : '较上月日均';
  html += `<div class="card"><div class="card-title">${trendTitle} <span class="badge">${isWeek ? '本周' : '近30天'} · ${pf || '4平台合计'} · 点击数据点跳转当日</span></div>${renderTrendLine(trendPts, { color: '#fb923c', onClick: 'goCalendarDate', prevAvg: prevDailyAvg || null, trendLabel: trendLabel })}</div>`;

  // 未关联记录（录了数据但找不到对应内容）— 折叠面板
  const orphanStats = [...currStats].filter(s => findLinkedTitle(s, 'video') === null).sort((a,b) => b.date.localeCompare(a.date));  html += `<div class="card"><div class="card-title">未关联记录 <span class="badge">${orphanStats.length}</span></div>`;
  if (orphanStats.length === 0) {
    html += '<p style="font-size:12px;color:var(--text2);padding:6px 0;">当前周期无未关联记录</p>';
  } else {
    html += '<p style="font-size:12px;color:var(--orange);margin-bottom:8px;">以下数据未找到对应登记内容（已失效或被删除），可删除或补录内容</p>';
    html += '<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>日期</th><th>平台</th><th>播放</th><th>点赞</th><th>操作</th></tr></thead><tbody>';
    orphanStats.forEach(s => {
      html += `<tr><td>${escapeHtml(s.date)}</td><td><span class="platform-tag video">${escapeHtml(s.platform)}</span></td><td>${formatNum(s.views)}</td><td>${formatNum(s.likes)}</td><td><button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;" onclick="deleteStat('${String(s.id).replace(/[^a-zA-Z0-9_-]/g, '')}')">删除</button></td></tr>`;
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';
  return html;
}

function deleteStat(id) {
  showConfirm({
    title: '确认删除',
    desc: '将删除这条视频数据记录（播放/点赞/评论等），内容登记本身不受影响，统计数字会随之更新。',
    danger: true,
    onOk: async () => {
      stats = stats.filter(s => s.id != id && s.id != Number(id));
      await saveData('stats', stats); render(); showToast('已删除');
    }
  });
}

// ===== 账号总数据（视频平台账号级快照）=====
// 快照式：每平台按日期记一条累计数据（日期以当天为准）
const ACCOUNT_FIELDS = [
  { key: 'posts', label: '发布量', ph: '累计发布数' },
  { key: 'followers', label: '粉丝量', ph: '粉丝总数' },
  { key: 'views', label: '总播放量', ph: '累计播放量' },
  { key: 'likes', label: '总点赞量', ph: '累计点赞量' },
  { key: 'comments', label: '总评论量', ph: '累计评论量' },
  { key: 'shares', label: '总转发/分享', ph: '累计转发/分享' }
];

let accSelectedPlatform = '抖音'; // 记录表单当前选中的平台（标题右侧按钮切换）

function selectAccountPlatform(p) { accSelectedPlatform = p; render(); }

function renderAccountData() {
  let html = '';

  // 1. 记录表单（日期固定为今天=最新总数据快照；平台在标题右侧按钮选择；账号ID/备注随平台联动）
  html += '<div class="card"><div class="card-title">记录账号数据 ';
  html += '<span class="platform-filter-row">' + VIDEO_PLATFORMS.map(function(p){ return '<span class="filter-pill' + (p === accSelectedPlatform ? ' active' : '') + '" onclick="selectAccountPlatform(\'' + p + '\')">' + p + '</span>'; }).join('') + '</span>';
  html += '</div>';
  // 账号ID + 备注 + 登录手机号 + 实名人 + 运营人（输入框始终为空，避免预填导致保存后内容"看着没清"；已保存内容见下方表格）
  html += '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">';
  html += '<div class="form-group" style="margin-bottom:0;flex:1 1 140px;"><label>' + accSelectedPlatform + ' 账号ID</label><input type="text" id="accAccountId" placeholder="未设置"></div>';
  html += '<div class="form-group" style="margin-bottom:0;flex:1 1 140px;"><label>备注</label><input type="text" id="accAccountNote" placeholder="昵称/主页链接等（可选）"></div>';
  html += '<div class="form-group" style="margin-bottom:0;flex:1 1 140px;"><label>登录手机号</label><input type="text" id="accAccountPhone" placeholder="账号登录手机号"></div>';
  html += '<div class="form-group" style="margin-bottom:0;flex:1 1 140px;"><label>实名人姓名</label><input type="text" id="accAccountRealName" placeholder="实名认证姓名"></div>';
  html += '<div class="form-group" style="margin-bottom:0;flex:1 1 140px;"><label>运营人</label><input type="text" id="accAccountOperator" placeholder="负责运营的人"></div>';
  // 保存 — 主题主色；padding/font 与 input 同高（约 43px），贴齐 input 底边
  html += '<div style="margin-left:auto;align-self:flex-end;display:flex;justify-content:flex-end;">';
  html += '<button class="btn-save" onclick="saveAccountIdOnly()" style="padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;">保存</button>';
  html += '</div></div>';
  // 已保存的账号ID（始终渲染表格，避免空/非空切换时跳动；每行带删除按钮）
  var savedIds = accountIds.filter(function(r){ return (r.accountId && r.accountId.trim()) || (r.note && r.note.trim()) || (r.phone && r.phone.trim()) || (r.realName && r.realName.trim()) || (r.operator && r.operator.trim()); });
  html += '<div style="margin:10px 0 2px;"><div style="font-size:12px;color:var(--text3);margin-bottom:4px;">已保存的账号ID（' + savedIds.length + '条）</div>';
  html += '<table class="data-table"><thead><tr><th style="width:90px;">平台</th><th>账号ID</th><th>备注</th><th>登录手机号</th><th>实名人姓名</th><th>运营人</th><th style="width:120px;text-align:right;"></th></tr></thead><tbody>';
  if (savedIds.length === 0) {
    html += '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:14px 0;">暂无，保存后显示在此处</td></tr>';
  } else {
    // 按平台顺序（同平台多条按保存先后）展示所有记录
    savedIds.slice().sort(function(a,b){
      var ia = VIDEO_PLATFORMS.indexOf(a.platform), ib = VIDEO_PLATFORMS.indexOf(b.platform);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.id - b.id;
    }).forEach(function(sr) {
      html += '<tr><td><span class="platform-tag video">' + escapeHtml(sr.platform) + '</span></td><td>' + escapeHtml(sr.accountId || '') + '</td><td>' + escapeHtml(sr.note || '') + '</td><td>' + escapeHtml(sr.phone || '') + '</td><td>' + escapeHtml(sr.realName || '') + '</td><td>' + escapeHtml(sr.operator || '') + '</td>';
      html += '<td style="white-space:nowrap;text-align:right;"><button class="btn-edit-mini" onclick="editAccountId(\'' + sr.id + '\')">编辑</button> <button class="btn-delete-mini" onclick="deleteAccountId(\'' + sr.id + '\')">删除</button></td></tr>';
    });
  }
  html += '</tbody></table></div>';
  // 分割线：账号ID区 与 指标登记区 分隔
  html += '<div style="border-top:1px dashed var(--border);margin:12px 0;"></div>';
  // 账号选择（该平台已登记的账号；无账号时仅「未指定账号」）
  var accRecs = accountIds.filter(function(x){ return x.platform === accSelectedPlatform; });
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>' + accSelectedPlatform + ' 账号</label><select id="accAccountRef"><option value="">未指定账号</option>';
  accRecs.forEach(function(rec) {
    html += '<option value="' + rec.id + '">' + escapeHtml(rec.accountId || '') + (rec.note ? '（' + escapeHtml(rec.note) + '）' : '') + '</option>';
  });
  html += '</select></div></div>';
  html += '<div class="form-row">' + ACCOUNT_FIELDS.map(function(f){ return '<div class="form-group"><label>' + f.label + '</label><input type="number" id="acc_' + f.key + '" min="0" placeholder="' + f.ph + '"></div>'; }).join('') + '</div>';
  html += '<div class="toolbar" style="margin-top:8px;align-items:center;"><button class="btn-primary" onclick="saveAccountSnapshot()">保存账号数据（' + accSelectedPlatform + '）</button><span class="badge">今日 ' + getToday() + ' · 最新总数据</span></div>';
  html += '</div>';

  // 2. 各平台最新快照汇总（按「平台+账号」每行，取该账号最新一次记录）
  html += '<div class="card"><div class="card-title">各平台最新账号数据 <span class="badge">按账号最新快照</span></div>';
  html += '<table class="data-table"><thead><tr><th>平台</th><th>账号</th><th>日期</th><th>发布</th><th>粉丝</th><th>播放</th><th>点赞</th><th>评论</th><th>转发/分享</th></tr></thead><tbody>';
  VIDEO_PLATFORMS.forEach(function(p) {
    var recs = accountIds.filter(function(x){ return x.platform === p; });
    var any = false;
    if (recs.length > 0) {
      recs.forEach(function(rec) {
        var r = latestAccountSnapshot(p, rec.id);
        any = true;
        html += '<tr><td><span class="platform-tag video">' + p + '</span></td><td>' + escapeHtml(rec.accountId || '') + '</td>';
        if (r) {
          html += '<td>' + escapeHtml(r.date) + '</td><td>' + formatNum(r.posts) + '</td><td>' + formatNum(r.followers) + '</td><td>' + formatNum(r.views) + '</td>';
          html += '<td>' + formatNum(r.likes) + '</td><td>' + formatNum(r.comments) + '</td><td>' + formatNum(r.shares) + '</td></tr>';
        } else {
          html += '<td colspan="7" style="color:var(--text3);">暂无数据</td></tr>';
        }
      });
    }
    // 未指定账号的快照单独一行（旧数据或没选账号记录的）
    var orphan = latestUnspecifiedAccount(p);
    if (orphan) {
      any = true;
      html += '<tr><td><span class="platform-tag video">' + p + '</span></td><td style="color:var(--text3);">未指定账号</td><td>' + escapeHtml(orphan.date) + '</td>';
      html += '<td>' + formatNum(orphan.posts) + '</td><td>' + formatNum(orphan.followers) + '</td><td>' + formatNum(orphan.views) + '</td>';
      html += '<td>' + formatNum(orphan.likes) + '</td><td>' + formatNum(orphan.comments) + '</td><td>' + formatNum(orphan.shares) + '</td></tr>';
    }
    if (!any) {
      html += '<tr><td><span class="platform-tag video">' + p + '</span></td><td colspan="8" style="color:var(--text3);">暂无数据</td></tr>';
    }
  });
  html += '</tbody></table></div>';

  // 4. 历史记录（按「平台+账号」分组，每个账号独立保留最新 3 条；标题右侧带清空按钮 + 弹窗确认）
  html += '<div class="card"><div class="card-title">历史记录 <span class="badge">每平台每账号各保留最新3条</span>';
  html += '<button class="btn-danger-mini" style="margin-left:10px;padding:3px 10px;font-size:11px;" onclick="clearAccountHistory()">清空</button></div>';
  if (accountStats.length === 0) {
    html += '<p style="font-size:12px;color:var(--text3);padding:8px 0;">暂无账号数据记录，从上方表单开始记录</p>';
  } else {
    // 按「平台+账号」分组：每组按日期倒序只取最新 3 条
    // 组 key = 平台 + '|' + (账号ref 或 '未指定账号')
    var accountGroups = {};
    accountStats.forEach(function(s) {
      var refStr = String(s.accountRef || '');
      var label = refStr ? accountLabel(s.accountRef) : '未指定账号';
      var key = s.platform + '|' + refStr;
      if (!accountGroups[key]) accountGroups[key] = { platform: s.platform, label: label, items: [] };
      accountGroups[key].items.push(s);
    });
    // 按平台顺序排序（同平台内按账号标签排序）
    var ordered = Object.keys(accountGroups).map(function(k){ return accountGroups[k]; }).sort(function(a, b){
      var ia = VIDEO_PLATFORMS.indexOf(a.platform), ib = VIDEO_PLATFORMS.indexOf(b.platform);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || String(a.label).localeCompare(String(b.label), 'zh');
    });
    ordered.forEach(function(g) {
      var group = g.items.sort(function(a,b){ return (b.date || '').localeCompare(a.date || ''); }).slice(0, 3);
      if (group.length === 0) return;
      html += '<div style="margin:6px 0 2px;"><span class="platform-tag video" style="display:inline-block;">' + escapeHtml(g.platform) + '</span> <span style="font-size:12px;font-weight:600;">' + escapeHtml(g.label) + '</span> <span style="font-size:11px;color:var(--text3);">最新 ' + group.length + ' 条</span></div>';
      html += '<table class="data-table"><thead><tr><th>日期</th><th>发布</th><th>粉丝</th><th>播放</th><th>点赞</th><th>评论</th><th>转发/分享</th><th style="text-align:right;"></th></tr></thead><tbody>';
      group.forEach(function(r) {
        var prev = accountPrevSnapshot(r);
        html += '<tr><td>' + escapeHtml(r.date) + '</td>';
        html += '<td>' + accountDeltaCell(r, prev, 'posts') + '</td><td>' + accountDeltaCell(r, prev, 'followers') + '</td><td>' + accountDeltaCell(r, prev, 'views') + '</td>';
        html += '<td>' + accountDeltaCell(r, prev, 'likes') + '</td><td>' + accountDeltaCell(r, prev, 'comments') + '</td><td>' + accountDeltaCell(r, prev, 'shares') + '</td>';
        html += '<td style="white-space:nowrap;text-align:right;"><button class="btn-edit-mini" onclick="editAccountSnapshot(\'' + r.id + '\')">编辑</button> <button class="btn-delete-mini" onclick="deleteAccountSnapshot(\'' + r.id + '\')">删除</button></td></tr>';
      });
      html += '</tbody></table>';
    });
  }
  html += '</div>';

  return html;
}

// 清空历史记录（弹窗确认后清空全部账号数据快照）
function clearAccountHistory() {
  if (accountStats.length === 0) { showToast('暂无历史记录可清空'); return; }
  showConfirm({
    title: '清空历史记录',
    desc: '确定清空全部账号数据历史记录吗？（共 ' + accountStats.length + ' 条，不可恢复）',
    danger: true,
    onOk: async function() {
      accountStats = [];
      await saveData('accountStats', accountStats); render(); showToast('历史记录已清空');
    }
  });
}

// 与上次记录对比：同平台同账号早于当前记录且日期最近的一条（供历史记录表格逐格差值）
function accountPrevSnapshot(r) {
  var prev = null;
  accountStats.forEach(function(s) {
    if (s.platform === r.platform && String(s.accountRef || '') === String(r.accountRef || '') && (s.date || '') < (r.date || '') && (!prev || (s.date || '') > (prev.date || ''))) prev = s;
  });
  return prev;
}

// 单个数据格：数值 + 与上一条记录的差值箭头（升↑绿 / 降↓红）；无上一条记录则只显数值
function accountDeltaCell(r, prev, key) {
  var val = formatNum(r[key]);
  if (!prev) return val;
  var cur = Number(r[key]) || 0;
  var before = Number(prev[key]) || 0;
  var d = cur - before;
  if (d === 0) return val;
  var arrow = d > 0 ? '↑' : '↓';
  var color = d > 0 ? 'var(--green)' : 'var(--red)';
  return val + ' <span class="acc-delta" style="color:' + color + ';">' + arrow + (d > 0 ? '+' : '') + formatNum(d) + '</span>';
}

// 某平台（可选绑定账号 ref）最近一条快照；ref 不传 = 不限账号取最新
function latestAccountSnapshot(platform, ref, list) {
  var arr = list || accountStats;
  var best = null;
  arr.forEach(function(s) {
    var refOk = (ref === undefined || ref === null || ref === '') ? true : String(s.accountRef || '') === String(ref);
    if (s.platform === platform && refOk && (!best || (s.date || '') > (best.date || ''))) best = s;
  });
  return best;
}

// 该平台「未指定账号」快照（accountRef 为空，或指向不存在的账号记录）
function latestUnspecifiedAccount(platform) {
  var refs = accountIds.filter(function(x){ return x.platform === platform; }).map(function(x){ return String(x.id); });
  var best = null;
  accountStats.forEach(function(s) {
    if (s.platform !== platform) return;
    var refStr = String(s.accountRef || '');
    if (refStr && refs.indexOf(refStr) >= 0) return; // 已归属某账号
    if (!best || (s.date || '') > (best.date || '')) best = s;
  });
  return best;
}

// 账号显示名：未指定/无记录 → 「未指定账号」
function accountLabel(ref) {
  if (ref === undefined || ref === null || ref === '') return '未指定账号';
  var rec = accountIds.find(function(x){ return String(x.id) === String(ref); });
  return rec && rec.accountId ? rec.accountId : '未指定账号';
}

// 保存：日期=当天，平台=标题右侧按钮选中的平台，账号=表单下拉选中的账号；
// 同日同平台同账号覆盖，否则新增（账号ID由独立按钮保存）
async function saveAccountSnapshot() {
  var date = getToday();
  var platform = accSelectedPlatform;
  var accountRef = (document.getElementById('accAccountRef').value || '').trim() || null;
  var vals = {};
  ACCOUNT_FIELDS.forEach(function(f) { vals[f.key] = Math.max(0, parseInt(document.getElementById('acc_' + f.key).value, 10) || 0); });
  if (ACCOUNT_FIELDS.every(function(f){ return vals[f.key] === 0; })) { showToast('请至少填写一项指标数据'); return; }
  // 记录时间（导出时标注数据时效）
  var now = new Date();
  var recordedAt = date + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  var existing = accountStats.find(function(s){ return s.platform === platform && s.date === date && String(s.accountRef || '') === String(accountRef || ''); });
  if (existing) { Object.assign(existing, vals); existing.recordedAt = recordedAt; }
  else { accountStats.push(Object.assign({ id: Date.now(), date: date, platform: platform, accountRef: accountRef, recordedAt: recordedAt }, vals)); }
  await saveData('accountStats', accountStats); render(); showToast('账号数据已保存');
}

// 单独保存当前平台的账号ID/备注（两字段都空则删除该平台记录）
// 保存账号ID：每次新增一条记录（一个平台可登记多个账号，不覆盖已有记录）
async function saveAccountIdOnly() {
  var platform = accSelectedPlatform;
  var accountId = (document.getElementById('accAccountId').value || '').trim();
  var note = (document.getElementById('accAccountNote').value || '').trim();
  var phone = (document.getElementById('accAccountPhone').value || '').trim();
  var realName = (document.getElementById('accAccountRealName').value || '').trim();
  var operator = (document.getElementById('accAccountOperator').value || '').trim();
  if (!accountId && !note && !phone && !realName && !operator) { showToast('请至少填写一项信息'); return; }
  accountIds.push({ id: genId(), platform: platform, accountId: accountId, note: note, phone: phone, realName: realName, operator: operator });
  await saveData('accountIds', accountIds); render(); showToast(platform + '账号ID已保存');
}

// 编辑单条账号ID记录（弹窗修改平台/账号ID/备注/手机号/实名人/运营人）
function editAccountId(id) {
  var rec = accountIds.find(function(x){ return String(x.id) === String(id); });
  if (!rec) { showToast('该记录不存在'); return; }
  var opts = VIDEO_PLATFORMS.map(function(p){ return '<option value="' + p + '"' + (p === rec.platform ? ' selected' : '') + '>' + p + '</option>'; }).join('');
  document.getElementById('modalContent').innerHTML = `
    <h3>编辑账号ID</h3>
    <div class="form-group"><label>平台</label><select id="editAccPlatform">${opts}</select></div>
    <div class="form-group"><label>账号ID</label><input type="text" id="editAccAccountId" value="${escapeHtml(rec.accountId || '')}"></div>
    <div class="form-group"><label>备注</label><input type="text" id="editAccNote" value="${escapeHtml(rec.note || '')}"></div>
    <div class="form-group"><label>登录手机号</label><input type="text" id="editAccPhone" value="${escapeHtml(rec.phone || '')}"></div>
    <div class="form-group"><label>实名人姓名</label><input type="text" id="editAccRealName" value="${escapeHtml(rec.realName || '')}"></div>
    <div class="form-group"><label>运营人</label><input type="text" id="editAccOperator" value="${escapeHtml(rec.operator || '')}"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-save" onclick="saveAccountIdEdit('${rec.id}')">保存</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

// 保存编辑后的账号ID记录
async function saveAccountIdEdit(id) {
  var rec = accountIds.find(function(x){ return String(x.id) === String(id); });
  if (!rec) { showToast('该记录不存在'); return; }
  rec.platform = document.getElementById('editAccPlatform').value;
  rec.accountId = (document.getElementById('editAccAccountId').value || '').trim();
  rec.note = (document.getElementById('editAccNote').value || '').trim();
  rec.phone = (document.getElementById('editAccPhone').value || '').trim();
  rec.realName = (document.getElementById('editAccRealName').value || '').trim();
  rec.operator = (document.getElementById('editAccOperator').value || '').trim();
  if (!rec.accountId && !rec.note && !rec.phone && !rec.realName && !rec.operator) { showToast('请至少填写一项信息'); return; }
  closeModal();
  await saveData('accountIds', accountIds); render(); showToast('账号ID已更新');
}

// 删除单条账号ID记录（按记录 id）
function deleteAccountId(id) {
  var rec = accountIds.find(function(x){ return String(x.id) === String(id); });
  if (!rec) { showToast('该记录不存在'); return; }
  showConfirm({
    title: '确认删除',
    desc: '确定删除' + rec.platform + '的这条账号ID记录吗？',
    danger: true,
    onOk: async function() {
      accountIds = accountIds.filter(function(r){ return String(r.id) !== String(id); });
      await saveData('accountIds', accountIds); render(); showToast(rec.platform + '账号ID已删除');
    }
  });
}

function deleteAccountSnapshot(id) {
  showConfirm({
    title: '确认删除',
    desc: '确定删除这条账号数据记录吗？',
    danger: true,
    onOk: async function() {
      accountStats = accountStats.filter(function(s){ return s.id != id && s.id != Number(id); });
      await saveData('accountStats', accountStats); render(); showToast('已删除');
    }
  });
}

// 历史记录快照编辑：当前正在编辑的账号引用（切平台时保持选择）
let __editSnapAccountRef = '';
// 切平台时刷新账号下拉（选项 = 该平台已登记的账号，与保存表单口径一致）
function refreshEditSnapAccount(platform) {
  const sel = document.getElementById('editSnapAccount');
  if (!sel) return;
  const recs = accountIds.filter(function(x){ return x.platform === platform; });
  let opts = '<option value="">未指定账号</option>';
  recs.forEach(function(a){
    opts += '<option value="' + a.id + '"' + (String(a.id) === String(__editSnapAccountRef || '') ? ' selected' : '') + '>' + escapeHtml(a.accountId || '') + (a.note ? '（' + escapeHtml(a.note) + '）' : '') + '</option>';
  });
  sel.innerHTML = opts;
}

// 编辑单条账号数据快照（弹窗改平台/日期/账号/发布/粉丝/播放/点赞/评论/转发）
function editAccountSnapshot(id) {
  const rec = accountStats.find(function(s){ return String(s.id) === String(id); });
  if (!rec) { showToast('该记录不存在'); return; }
  __editSnapAccountRef = rec.accountRef || '';
  const platOpts = VIDEO_PLATFORMS.map(function(p){ return '<option value="' + p + '"' + (p === rec.platform ? ' selected' : '') + '>' + p + '</option>'; }).join('');
  const accRecs = accountIds.filter(function(x){ return x.platform === rec.platform; });
  let accOpts = '<option value="">未指定账号</option>';
  accRecs.forEach(function(a){
    accOpts += '<option value="' + a.id + '"' + (String(a.id) === String(rec.accountRef || '') ? ' selected' : '') + '>' + escapeHtml(a.accountId || '') + (a.note ? '（' + escapeHtml(a.note) + '）' : '') + '</option>';
  });
  document.getElementById('modalContent').innerHTML = `
    <h3>编辑账号数据</h3>
    <div class="form-row">
      <div class="form-group"><label>平台</label><select id="editSnapPlatform" onchange="refreshEditSnapAccount(this.value)">${platOpts}</select></div>
      <div class="form-group"><label>记录日期</label><input type="date" id="editSnapDate" value="${escapeHtml(rec.date || '')}"></div>
    </div>
    <div class="form-group"><label>账号</label><select id="editSnapAccount">${accOpts}</select></div>
    <div class="form-row">${ACCOUNT_FIELDS.map(function(f){
      const cur = rec[f.key];
      return `<div class="form-group"><label>${f.label}</label><input type="number" id="editSnap_${f.key}" min="0" value="${cur === undefined || cur === null ? '' : cur}" placeholder="${f.ph}"></div>`;
    }).join('')}</div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-save" onclick="saveAccountSnapshotEdit('${rec.id}')">保存</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

// 保存编辑后的账号数据快照
async function saveAccountSnapshotEdit(id) {
  const rec = accountStats.find(function(s){ return String(s.id) === String(id); });
  if (!rec) { showToast('该记录不存在'); return; }
  const platform = document.getElementById('editSnapPlatform').value;
  const accountRef = (document.getElementById('editSnapAccount').value || '').trim() || null;
  const date = document.getElementById('editSnapDate').value || getToday();
  const vals = {};
  ACCOUNT_FIELDS.forEach(function(f){ vals[f.key] = Math.max(0, parseInt(document.getElementById('editSnap_' + f.key).value, 10) || 0); });
  if (ACCOUNT_FIELDS.every(function(f){ return vals[f.key] === 0; })) { showToast('请至少填写一项指标数据'); return; }
  // 与保存表单口径一致：同日同平台同账号只保留一条（编辑改键后若有重复记录则合并掉）
  accountStats = accountStats.filter(function(s){
    return String(s.id) === String(id) || !(s.platform === platform && s.date === date && String(s.accountRef || '') === String(accountRef || ''));
  });
  rec.platform = platform; rec.accountRef = accountRef; rec.date = date;
  Object.assign(rec, vals);
  await saveData('accountStats', accountStats); closeModal(); render(); showToast('账号数据已更新');
}


