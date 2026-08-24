function renderOverview() {
  const year = overviewMonth.getFullYear();
  const month = overviewMonth.getMonth() + 1;
  const monthStr = `${year}-${String(month).padStart(2,'0')}`;

  let html = `<div class="card"><div class="calendar-header"><div class="calendar-nav">
    <button onclick="changeOverviewMonth(-1)">&#8249;</button>
    <span class="calendar-month">${year}年${month}月</span>
    <button onclick="changeOverviewMonth(1)">&#8250;</button>
  </div><button class="btn-today" onclick="goOverviewThisMonth()">本月</button></div>`;

  // 总览统计（以登记为准，条数累计制）
  // 日期可能缺失（旧数据/手改 JSON），统一用 (x || '') 防护避免整页崩溃
  const monthContents = contents.filter(c => (c.createdAt || '').startsWith(monthStr));
  const vDone = monthContents.filter(c => isVideo(c.platform)).length;

  // 视频平台数据汇总（与数据复盘页同口径：总发布数/总播放量/总点赞/总评论/总收藏/总涨粉）
  const monthVideoStats = stats.filter(s => (s.date || '').startsWith(monthStr) && isVideo(s.platform));
  const monthViews = monthVideoStats.reduce((sum, s) => sum + (s.views || 0), 0);
  const monthLikes = monthVideoStats.reduce((sum, s) => sum + (s.likes || 0), 0);
  const monthComments = monthVideoStats.reduce((sum, s) => sum + (s.comments || 0), 0);
  const monthFavorites = monthVideoStats.reduce((sum, s) => sum + (s.favorites || 0), 0);
  const monthFollowers = monthVideoStats.reduce((sum, s) => sum + (s.followers || 0), 0);

  // 上月数据（用于环比计算）
  const prevMonth = new Date(year, month - 2, 1); // month-2 因为 getMonth() 是 0-indexed，month 是 1-indexed
  const prevYear = prevMonth.getFullYear();
  const prevMonthNum = prevMonth.getMonth() + 1;
  const prevMonthStr = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`;
  const prevVideoStats = stats.filter(s => (s.date || '').startsWith(prevMonthStr) && isVideo(s.platform));
  const prevCount = contents.filter(c => (c.createdAt || '').startsWith(prevMonthStr) && isVideo(c.platform)).length;
  const prevViews = prevVideoStats.reduce((sum, s) => sum + (s.views || 0), 0);
  const prevLikes = prevVideoStats.reduce((sum, s) => sum + (s.likes || 0), 0);
  const prevComments = prevVideoStats.reduce((sum, s) => sum + (s.comments || 0), 0);
  const prevFavorites = prevVideoStats.reduce((sum, s) => sum + (s.favorites || 0), 0);
  const prevFollowers = prevVideoStats.reduce((sum, s) => sum + (s.followers || 0), 0);

  html += `<div class="card"><div class="card-title">本月数据总览</div>`;
  html += `<div class="stats-grid">
    ${statCardHtml(vDone, '总发布数', renderGrowthTag(vDone, prevCount))}
    ${statCardHtml(monthViews, '总播放量', renderGrowthTag(monthViews, prevViews))}
    ${statCardHtml(monthLikes, '总点赞', renderGrowthTag(monthLikes, prevLikes))}
    ${statCardHtml(monthComments, '总评论', renderGrowthTag(monthComments, prevComments))}
    ${statCardHtml(monthFavorites, '总收藏', renderGrowthTag(monthFavorites, prevFavorites))}
    ${statCardHtml(monthFollowers, '总涨粉', renderGrowthTag(monthFollowers, prevFollowers))}
  </div>`;
  html += `</div>`;

  // 各平台数据占比饼图（专注本月）：播放/点赞/评论/涨粉 各平台占比，2 列网格
  const metrics = [
    { label: '播放量', sum: monthViews, key: 'views' },
    { label: '点赞量', sum: monthLikes, key: 'likes' },
    { label: '评论量', sum: monthComments, key: 'comments' },
    { label: '涨粉量', sum: monthFollowers, key: 'followers' },
  ];
  html += '<div class="card"><div class="card-title">各平台数据占比 <span class="badge">本月</span></div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">';
  metrics.forEach(m => {
    const segs = VIDEO_PLATFORMS.map((p, i) => {
      const v = monthVideoStats.filter(s => s.platform === p).reduce((sum, s) => sum + (s[m.key] || 0), 0);
      return { label: p, value: v, color: PIE_COLORS.video[i] };
    });
    html += `<div><div style="font-size:13px;font-weight:600;margin-bottom:4px;">${m.label}</div>`;
    html += renderPieChart(segs, m.sum, 'video');
    html += '</div>';
  });
  html += '</div></div>';

  // 各平台明细 + 进度条（条数 / 当月天数）
  const daysInMonth = new Date(year, month, 0).getDate();
  const platformCounts = {};
  ALL_PLATFORMS.forEach(p => platformCounts[p] = { done: 0, total: daysInMonth });
  monthContents.forEach(c => {
    if (platformCounts[c.platform]) platformCounts[c.platform].done += 1;
  });
  html += '<div class="card"><div class="card-title">各平台发布明细</div>';
  html += '<div class="section-label"><span style="color:var(--video-orange-light);">短视频平台</span><span class="count">' + VIDEO_PLATFORMS.length + '</span></div>';
  html += '<div class="platform-rows">';
  VIDEO_PLATFORMS.forEach(p => {
    const c = platformCounts[p];
    const pct = Math.min(100, Math.round(c.done / c.total * 100));
    html += `<div class="platform-row video">
      <div class="platform-row-icon video">${PLATFORM_SHORT[p]}</div>
      <div class="platform-row-info">
        <div class="platform-row-name">${p}</div>
        <div class="platform-row-stat">${c.done} 条 / ${c.total} 天 · ${pct}%</div>
        <div class="pbar-track"><div class="pbar" data-w="${pct}"></div></div>
      </div>
    </div>`;
  });
  html += '</div></div>';

  return html;
}

// ===== 饼图（SVG 零依赖）=====
// 平台配色（视频 4 色，与平台顺序对应）
const PIE_COLORS = {
  video: ['#ff6b35', '#ffa940', '#ff4d6d', '#5b8cff']
};
// segments: [{label, value, color}]；total 为总和（用于占比）
function renderPieChart(segments, total, type) {
  const sum = total || segments.reduce((s, x) => s + (x.value || 0), 0);
  const R = 42, CX = 50, CY = 50;
  const uid = 'p' + Math.random().toString(36).slice(2, 7);
  // 有数据：按占比画扇区；无数据：画空心占位圆
  let chart;
  if (sum <= 0) {
    chart = `<svg viewBox="0 0 100 100" width="140" height="140" style="flex-shrink:0;">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--border)" stroke-width="14" stroke-dasharray="2 3"/>
      <text x="${CX}" y="${CY+4}" text-anchor="middle" font-size="9" fill="var(--text3)">暂无数据</text>
    </svg>`;
  } else {
    // 扇区 path：从 12 点方向顺时针；直接生成完整 d，入场动画改用整体 scale 缩放展开
    let acc = 0;
    const pathElems = [];
    segments.forEach((s, i) => {
      const frac = (s.value || 0) / sum;
      if (frac <= 0) return;
      const a0f = acc, a1f = acc + frac;
      acc += frac;
      const a0 = a0f * 360 - 90, a1 = a1f * 360 - 90;
      const x0 = CX + R * Math.cos(a0 * Math.PI / 180);
      const y0 = CY + R * Math.sin(a0 * Math.PI / 180);
      const x1 = CX + R * Math.cos(a1 * Math.PI / 180);
      const y1 = CY + R * Math.sin(a1 * Math.PI / 180);
      const large = frac > 0.5 ? 1 : 0;
      const d = 'M ' + CX + ' ' + CY + ' L ' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' Z';
      pathElems.push(`<path data-u="${uid}" data-i="${i}" d="${d}" fill="${s.color}" stroke="var(--card-solid)" stroke-width="1" style="cursor:pointer;transition:opacity 0.2s,transform 0.2s;" onmouseover="pieHighlight('${uid}',${i},true)" onmouseout="pieHighlight('${uid}',${i},false)"/>`);
    });
    chart = `<svg viewBox="0 0 100 100" width="140" height="140" style="flex-shrink:0;" data-pie-uid="${uid}">
      <g class="pie-content">
        ${pathElems.join('')}
        <circle cx="${CX}" cy="${CY}" r="${R*0.45}" fill="var(--card-solid)"/>
        <text x="${CX}" y="${CY+3}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text)">${formatNum(sum)}</text>
      </g>
    </svg>`;
  }
  // 图例（平台 + 数值 + 占比：数值紧跟平台名，百分比靠右）
  const legend = segments.map((s, i) => {
    const pct = sum > 0 ? Math.round((s.value || 0) / sum * 100) : 0;
    return `<div data-u="${uid}" data-i="${i}" style="display:flex;align-items:center;gap:6px;font-size:13.5px;color:var(--text2);padding:4px 6px;border-radius:6px;cursor:pointer;transition:all 0.2s;" onmouseover="pieHighlight('${uid}',${i},true)" onmouseout="pieHighlight('${uid}',${i},false)">
      <span style="width:10px;height:10px;border-radius:3px;background:${s.color};flex-shrink:0;"></span>
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:72%;">${s.label}</span>
      <span style="color:var(--text);font-weight:600;margin-left:2px;">${formatNum(s.value)}</span>
      <span style="color:var(--text3);margin-left:auto;flex-shrink:0;">${pct}%</span>
    </div>`;
  }).join('');
  return `<div style="display:flex;gap:14px;align-items:center;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-xs);padding:12px 14px;">
    ${chart}
    <div style="flex:1;min-width:0;">${legend}</div>
  </div>`;
}

// 饼图悬停高亮：hover 扇区或图例时，对应项高亮 + 其余变淡
function pieHighlight(uid, idx, on) {
  var paths = document.querySelectorAll('path[data-u="' + uid + '"]');
  var legends = document.querySelectorAll('div[data-u="' + uid + '"]');
  if (!paths.length) return;
  paths.forEach(function(p) {
    var i = parseInt(p.getAttribute('data-i'), 10);
    if (!on) {
      p.style.opacity = '1';
      p.style.filter = 'none';
      p.style.stroke = 'var(--card-solid)';
      p.style.strokeWidth = '1';
    } else if (i === idx) {
      p.style.opacity = '1';
      p.style.filter = 'brightness(1.15) drop-shadow(0 0 6px ' + p.getAttribute('fill') + ')';
      p.style.stroke = 'var(--text)';
      p.style.strokeWidth = '2.5';
    } else {
      p.style.opacity = '0.35';
      p.style.filter = 'none';
      p.style.stroke = 'var(--card-solid)';
      p.style.strokeWidth = '1';
    }
  });
  legends.forEach(function(l) {
    var i = parseInt(l.getAttribute('data-i'), 10);
    if (!on) {
      l.style.background = '';
      l.style.fontWeight = '';
      l.style.opacity = '1';
    } else if (i === idx) {
      l.style.background = 'var(--accent-soft)';
      l.style.fontWeight = '600';
      l.style.opacity = '1';
    } else {
      l.style.background = '';
      l.style.fontWeight = '';
      l.style.opacity = '0.45';
    }
  });
}

function changeOverviewMonth(delta) { overviewMonth.setMonth(overviewMonth.getMonth() + delta); render(); }
function goOverviewThisMonth() { overviewMonth = new Date(); render(); }
