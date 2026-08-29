function renderToday() {
  const today = getToday();
  const counts = getDayCounts(today);
  // 标题：日期 + 打卡提醒
  const todayLabel = (() => {
    const parts = today.split('-');
    return parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';
  })();

  let html = `<div class="today-section"><h3>今日待办 <span style="font-size:13px;color:var(--text2);font-weight:500;">${todayLabel} · 今日你登记了吗？</span></h3>`;

  html += '<div style="font-size:13px;color:var(--video-orange-light);margin-bottom:6px;font-weight:600;">短视频平台</div><ul class="today-list">';
  VIDEO_PLATFORMS.forEach(p => html += renderPlatformTodayItem(p, counts[p], today, 'video'));
  html += '</ul>';
  // 视频平台直达快链（URL 可在「修改链接」弹窗中自定义，存 localStorage）
  html += '<div class="ai-links"><div class="ai-links-header"><div class="ai-links-title video">视频平台直达</div><button class="ai-links-edit" onclick="openQuickLinksEditor(\'video\')">修改链接</button></div><div class="ai-links-list">';
  getQuickLinks('video').filter(l => safeUrl(l.url)).forEach(l => html += `<a class="ai-link video" href="${escapeHtml(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.name)}</a>`);
  html += '</div></div>';

  html += '</div>';

  // 今日发布概览（只统计短视频平台）
  // 两张卡片：今日登记（登记条数）、已录数据（已录入平台数据的条数）
  const todayContents = contents.filter(c => c.createdAt === today && isVideo(c.platform));
  const vTotal = todayContents.length;
  const withData = todayContents.filter(c => stats.some(s =>
    s.contentId == c.id || s.contentId == Number(c.id) || (s.platform === c.platform && s.date === c.createdAt)
  )).length;
  html += `<div class="card"><div class="card-title">今日发布概览</div>
    <div class="stats-grid">
      ${statCardHtml(vTotal, '今日登记')}
      ${statCardHtml(withData, '已录数据')}
    </div></div>`;

  return html;
}

// 单平台今日行：平台标签 + 已发条数/未登记 + [+1] 按钮 + 内容展开
function renderPlatformTodayItem(platform, count, date, type) {
  const list = getPlatformContents(date, platform);
  const taskKey = platform + '|' + date;   // 展开状态 key（保存重绘后据此恢复展开）
  const isOpen = expandedTaskKeys.has(taskKey);
  let html = `<li class="today-item ${count > 0 ? 'has-detail' : ''}">
    <div class="today-item-row">
      <span class="left">
        <span class="platform-initial ${type}">${PLATFORM_SHORT[platform] || (platform ? platform.charAt(0) : '')}</span><span class="platform-tag ${type}">${platform}</span>
        ${count > 0
          ? `<span style="color:var(--green);font-size:12px;font-weight:600;">已发 ${count} 条</span><span class="expand-toggle ${isOpen ? 'open' : ''}" onclick="toggleTaskDetail(this, '${taskKey}')">&#9660;</span>`
          : `<span style="color:var(--text3);font-size:12px;">未登记</span>`}
      </span>
      <span class="status-dot ${count > 0 ? 'done' : 'pending'}" title="${count > 0 ? '已登记' : '未登记'}"></span>
      <button class="btn-done" onclick="openAddModal('${platform}', null, '${date}')">+1</button>
    </div>`;
  if (count > 0) {
    html += `<div class="task-detail ${isOpen ? 'open' : ''}">`;
    list.forEach(c => html += renderContentDetail(c));
    html += `</div>`;
  }
  html += '</li>';
  return html;
}

// 单条内容详情：标题/链接/日期+选题 + 数据摘要 + 操作（数据录入/编辑/删除）
// 布局：左侧信息列（flex:1）+ 右侧竖排操作按钮，避免按钮挤压内容列宽度
function renderContentDetail(content) {
  const type = 'video';
  const safeLink = safeUrl(content.url);
  let html = `<div class="content-detail-item">
    <div class="task-detail-info">
    <div class="task-detail-row"><span class="detail-label">标题</span><span>${escapeHtml(content.title)}</span></div>
    ${safeLink ? `<div class="task-detail-row"><span class="detail-label">链接</span><a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer" style="color:var(--link-blue);word-break:break-all;">${escapeHtml(content.url)}</a></div>` : ''}
    <div class="task-detail-row"><span class="detail-label">日期</span><span>${escapeHtml(content.createdAt || '')}${content.topic ? ' · 选题：' + escapeHtml(content.topic) : ''}</span></div>`;

  // 数据摘要（视频，按平台动态显示）
  const s = stats.find(x => x.contentId == content.id || x.contentId == Number(content.id));
  if (s) {
    // 摘要为单行文本，未录入用「-」占位保持可读（与数据栏网格逻辑不同）
    const fmtSum = v => (v === null || v === undefined || v === '') ? '-' : formatNum(v);
    const completion = s.completionRate !== null && s.completionRate !== undefined ? s.completionRate + '%' : '-';
    const avgWatch = s.avgWatch !== null && s.avgWatch !== undefined ? s.avgWatch + 's' : '-';
    const secondItem = content.platform === '小红书'
      ? '均播' + avgWatch
      : (content.platform === '视频号' || content.platform === '抖音')
        ? '完播' + completion + '·均播' + avgWatch
        : '完播' + completion;
    const favItem = content.platform === '视频号' ? '推荐' + fmtSum(s.recommend) : '收藏' + fmtSum(s.favorites);
    html += `<div class="task-detail-row"><span class="detail-label">数据</span><span>播放${fmtSum(s.views)} · ${secondItem} · 点赞${fmtSum(s.likes)} · 评论${fmtSum(s.comments)} · ${favItem} · 分享${fmtSum(s.shares)} · 涨粉${fmtSum(s.followers)}</span></div>`;
  }
  html += '</div>';

  // 操作入口：数据录入 / 编辑 / 删除（右侧竖排）
  html += `<div class="task-detail-actions">
    <button class="btn-data-entry" onclick="openDataModal('${content.id}')">数据录入</button>
    <button class="btn-edit" onclick="editContent('${content.id}')">编辑</button>
    <button class="btn-delete" onclick="deleteContent('${content.id}')">删除</button>
  </div>`;
  html += '</div>';
  return html;
}

// 展开/收起任务详情（记录到 expandedTaskKeys，保存重绘后保持展开）
function toggleTaskDetail(arrowEl, taskKey) {
  // 兼容两种容器：今日待办 li.today-item / 日历 div.day-task
  const container = arrowEl.closest('.today-item') || arrowEl.closest('.day-task');
  if (!container) return;
  const detail = container.querySelector('.task-detail');
  if (!detail) return;
  const isOpen = detail.classList.contains('open');
  if (isOpen) {
    detail.classList.remove('open');
    arrowEl.classList.remove('open');
    if (taskKey) expandedTaskKeys.delete(taskKey);
  } else {
    detail.classList.add('open');
    arrowEl.classList.add('open');
    if (taskKey) expandedTaskKeys.add(taskKey);
  }
}

// ===== 快链自定义（视频平台直达）=====
// 默认链接集中管理；用户改过的链接存 localStorage（与工作台分区记忆一致，不占服务器 7 类数据）
const QUICK_LINKS_DEFAULT = {
  video: [
    { name: '抖音', url: 'https://www.douyin.com/' },
    { name: '小红书', url: 'https://www.xiaohongshu.com/' },
    { name: '视频号', url: 'https://channels.weixin.qq.com/' },
    { name: '快手', url: 'https://www.kuaishou.com/' },
    { name: '小红书创作平台', url: 'https://creator.xiaohongshu.com/' },
    { name: '快手创作服务平台', url: 'https://cp.kuaishou.com/' },
    { name: '抖音创作者中心', url: 'https://creator.douyin.com/' }
  ]
};

// 读取某组（platform/ai）的用户覆盖
function getQuickLinkOverrides(group) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY + 'quickLinks') || '{}');
    return (all && all[group] && typeof all[group] === 'object') ? all[group] : {};
  } catch (e) { return {}; }
}

function setQuickLinkOverrides(group, overrides) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(STORAGE_KEY + 'quickLinks') || '{}') || {}; } catch (e) {}
  all[group] = overrides || {};
  localStorage.setItem(STORAGE_KEY + 'quickLinks', JSON.stringify(all));
}

// 合并默认与用户覆盖
function getQuickLinks(group) {
  const overrides = getQuickLinkOverrides(group);
  return (QUICK_LINKS_DEFAULT[group] || []).map(l => ({
    name: l.name,
    url: overrides[l.name] ? String(overrides[l.name]) : l.url
  }));
}

// 打开快链编辑弹窗：一键修改该组内所有平台的链接
function openQuickLinksEditor(group) {
  const title = '视频平台直达';
  const links = getQuickLinks(group);
  const rows = links.map((l, i) => `
    <div class="form-group">
      <label>${escapeHtml(l.name)}</label>
      <input type="url" id="ql_inp_${i}" value="${escapeHtml(l.url)}" placeholder="https://...">
    </div>`).join('');
  document.getElementById('modalContent').innerHTML = `
    <h3>修改「${title}」链接</h3>
    ${rows}
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-save" onclick="saveQuickLinksEditor('${group}')">保存</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

function saveQuickLinksEditor(group) {
  const links = getQuickLinks(group);
  const overrides = {};
  for (let i = 0; i < links.length; i++) {
    const input = document.getElementById('ql_inp_' + i);
    const val = input.value.trim();
    if (!val) { showToast('「' + links[i].name + '」链接不能为空'); return; }
    if (!/^https?:\/\//i.test(val)) { showToast('「' + links[i].name + '」需以 http:// 或 https:// 开头'); return; }
    overrides[links[i].name] = val;
  }
  setQuickLinkOverrides(group, overrides);
  closeModal();
  render();
  showToast('链接已更新');
}
