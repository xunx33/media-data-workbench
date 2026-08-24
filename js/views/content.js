function renderContent() {
  // 解析数据表格模块（仅视频工作台显示，置于内容登记页最上方）
  let html = renderTableParser();
  const filtered = getFilteredContents();
  const videoContents = contents.filter(c => isVideo(c.platform)).length;
  html += `<div class="card"><div class="card-title">内容登记 <span class="badge">已登记 ${videoContents}条 · 已录数据 ${stats.length}条</span></div>`;
  html += `<div class="search-box">
    <span class="search-icon">&#128269;</span>
    <input type="text" id="searchInput" placeholder="搜索标题/选题/平台/链接...（输入后按回车或点搜索）" value="${escapeHtml(searchKeyword)}" onkeydown="if(event.key==='Enter')doSearch()">
    ${searchKeyword ? `<button class="search-clear" onclick="clearSearch()">清除</button>` : ''}
    <button class="search-btn" onclick="doSearch()">搜索</button>
  </div>`;
  html += `<div class="filter-pills">
    <span class="filter-pill ${!contentFilterType && !contentDateFilter ? 'active' : ''}" onclick="filterContent('all',this)">全部</span>
    <select class="filter-select" id="dateFilterSelect" onchange="filterDateSelect(this.value)" aria-label="日期筛选">
      <option value="">日期筛选</option>
      <option value="today" ${contentDateFilter === 'today' ? 'selected' : ''}>今日</option>
      <option value="yesterday" ${contentDateFilter === 'yesterday' ? 'selected' : ''}>昨日</option>
      <option value="week" ${contentDateFilter === 'week' ? 'selected' : ''}>本周</option>
      <option value="month" ${contentDateFilter === 'month' ? 'selected' : ''}>本月</option>
    </select>
    <select class="filter-select" id="platformFilterSelect" onchange="filterPlatformSelect(this.value)" aria-label="平台筛选">
      <option value="">平台筛选</option>
      <optgroup label="短视频平台">
        ${VIDEO_PLATFORMS.map(p => `<option value="${p}" ${contentFilterType === p ? 'selected' : ''}>${p}</option>`).join('')}
      </optgroup>
    </select>
    <span class="filter-pill sort-views ${contentSortByViews === 'desc' ? 'active-desc' : contentSortByViews === 'asc' ? 'active-asc' : ''}" onclick="toggleSortViews()">${contentSortByViews === 'desc' ? '播放量 ↓' : contentSortByViews === 'asc' ? '播放量 ↑' : '播放量'}</span>
  </div>`;

  // 列表折叠区（可收起/展开）
  html += `<div class="content-fold" id="contentFold">
    <div class="content-fold-header" onclick="toggleContentFold()">
      <span class="content-fold-title">📋 登记列表 <span class="badge">${filtered.length}条</span></span>
      <span class="content-fold-arrow" id="foldArrow">&#9650;</span>
    </div>
    <div id="contentList" class="content-fold-body">`;
  if (filtered.length === 0) html += `<div class="empty-state"><div class="empty-icon">${searchKeyword ? '&#128270;' : '+'}</div><p>${searchKeyword ? '未找到匹配内容' : '暂无登记记录，点击右下角 + 号登记'}</p></div>`;
  else filtered.forEach(c => html += renderContentItem(c));
  html += '</div></div></div>';

  return html;
}

function openDataModal(contentId) {
  const c = contents.find(x => x.id == contentId || x.id == Number(contentId));
  if (!c) return;
  pendingDataContentId = c.id;
  document.getElementById('modalContent').innerHTML = renderVideoDataModal(c);
  document.getElementById('modalOverlay').classList.add('active');
}

function renderVideoDataModal(c) {
  const s = stats.find(x => x.contentId == c.id || x.contentId == Number(c.id) || (x.platform === c.platform && x.date === c.createdAt));
  const pf = c.platform;
  // 按平台动态选择第二行字段：抖音/快手/视频号=完播率，小红书=平均播放时长（三平台同义：均播时长）
  const secondField = pf === '小红书'
    ? `<div class="form-group"><label>平均播放时长(秒)</label><input type="number" id="statAvgWatch" value="${s && s.avgWatch !== null && s.avgWatch !== undefined ? s.avgWatch : ''}" min="0" step="0.1"></div>`
    : `<div class="form-group"><label>完播率(%)</label><input type="number" id="statCompletion" value="${s && s.completionRate !== null && s.completionRate !== undefined ? s.completionRate : ''}" min="0" max="100" step="0.1"></div>`;
  // 第三行：视频号显示「推荐」替代「收藏」；保持每行 2 个（form-row 是 2 列 Grid）
  const thirdRow = pf === '视频号'
    ? `<div class="form-row">
        <div class="form-group"><label>推荐</label><input type="number" id="statRecommend" value="${s ? s.recommend : ''}" min="0"></div>
        <div class="form-group"><label>分享</label><input type="number" id="statShares" value="${s ? s.shares : ''}" min="0"></div>
      </div>`
    : `<div class="form-row">
        <div class="form-group"><label>收藏</label><input type="number" id="statFavorites" value="${s ? s.favorites : ''}" min="0"></div>
        <div class="form-group"><label>分享</label><input type="number" id="statShares" value="${s ? s.shares : ''}" min="0"></div>
      </div>`;
  // 第四行：抖音/视频号把「平均播放时长」与「涨粉」并排成 2 列；其他平台涨粉单行
  const fourthRow = (pf === '视频号' || pf === '抖音')
    ? `<div class="form-row">
        <div class="form-group"><label>平均播放时长(秒)</label><input type="number" id="statAvgWatch" value="${s && s.avgWatch !== null && s.avgWatch !== undefined ? s.avgWatch : ''}" min="0" step="0.1"></div>
        <div class="form-group"><label>涨粉</label><input type="number" id="statFollowers" value="${s ? s.followers : ''}" min="0"></div>
      </div>`
    : `<div class="form-row">
        <div class="form-group"><label>涨粉</label><input type="number" id="statFollowers" value="${s ? s.followers : ''}" min="0"></div>
      </div>`;
  return `<h3>${pf}数据录入</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px;"><span class="platform-tag video">${pf}</span> ${escapeHtml(c.title)}<br><span style="font-size:12px;color:var(--text3);">日期：${c.createdAt}</span></p>
    <div class="form-group"><label>作品标题/描述（可选）</label><input type="text" id="statTitle" value="${escapeHtml(s && s.title ? s.title : '')}" placeholder="与登记内容一致时留空即可"></div>
    <div class="form-row">
      <div class="form-group"><label>播放量</label><input type="number" id="statViews" value="${s ? s.views : ''}" min="0"></div>
      ${secondField}
    </div>
    <div class="form-row">
      <div class="form-group"><label>点赞</label><input type="number" id="statLikes" value="${s ? s.likes : ''}" min="0"></div>
      <div class="form-group"><label>评论</label><input type="number" id="statComments" value="${s ? s.comments : ''}" min="0"></div>
    </div>
    ${thirdRow}
    ${fourthRow}
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-save btn-danger" style="flex:0.6;" onclick="clearContentData()">清空</button>
      <button class="btn-save" onclick="saveContentData()">保存数据</button>
    </div>`;
}

let pendingDataContentId = null;

// 清空当前弹窗的数据录入内容（不保存）
function clearContentData() {
  ['statTitle', 'statViews', 'statCompletion', 'statAvgWatch', 'statLikes', 'statComments', 'statFavorites', 'statRecommend', 'statShares', 'statFollowers'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  showToast('已清空，点击保存后生效');
}

async function saveContentData() {
  const c = contents.find(x => x.id == pendingDataContentId || x.id == Number(pendingDataContentId));
  if (!c) { showToast('内容不存在'); return; }
  // 安全读取：弹窗按平台只渲染部分输入框（小红书无完播率、视频号无收藏），
  // 缺失的输入框直接返回空串，避免 null.value 抛异常导致保存失败
  const gv = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  // 空输入 → null（未录入留空）；录入 0 → 0；非法数字 → 0
  const numOrNull = raw => {
    const t = String(raw).trim();
    if (t === '') return null;
    const n = Number(t);
    return isNaN(n) ? 0 : n;
  };
  const title = (gv('statTitle').trim()) || c.title;
  const views = numOrNull(gv('statViews'));
  const completionInput = gv('statCompletion');
  const completionRate = completionInput !== '' ? parseFloat(completionInput) : null;
  const avgWatchInput = gv('statAvgWatch');
  const avgWatch = avgWatchInput !== '' ? parseFloat(avgWatchInput) : null;
  const recommend = numOrNull(gv('statRecommend'));
  const likes = numOrNull(gv('statLikes'));
  const comments = numOrNull(gv('statComments'));
  const favorites = numOrNull(gv('statFavorites'));
  const shares = numOrNull(gv('statShares'));
  const followers = numOrNull(gv('statFollowers'));
  const existing = stats.find(x => x.contentId == c.id || x.contentId == Number(c.id) || (x.platform === c.platform && x.date === c.createdAt));
  const statData = { platform: c.platform, date: c.createdAt, title, views, completionRate, avgWatch, recommend, likes, comments, favorites, shares, followers, contentId: c.id };
  if (existing) Object.assign(existing, statData);
  else stats.push({ id: Date.now() + Math.random(), ...statData });
  await saveData('stats', stats);
  pendingDataContentId = null;
  closeModal(); render();
  showToast('数据已保存');
}

function filterContent(filter, el) {
  contentFilterType = filter === 'all' ? '' : filter;
  if (filter === 'all') contentDateFilter = ''; // 点「全部」同时清掉日期筛选
  render();
}

// 日期筛选下拉：今日/昨日/本周/本月；选回「日期筛选」空值 → 取消日期过滤
function filterDateSelect(value) {
  contentDateFilter = value;
  render();
}

// 平台筛选下拉：选中平台 → 按平台过滤；选回「平台筛选」空值 → 取消平台过滤
function filterPlatformSelect(value) {
  contentFilterType = value;
  render();
}

// 播放量排序：默认(日期) → 降序 → 升序 → 默认 循环
function toggleSortViews() {
  contentSortByViews = contentSortByViews === 'desc' ? 'asc' : contentSortByViews === 'asc' ? '' : 'desc';
  render();
}

function deleteContent(id) {
  showConfirm({
    title: '确认删除',
    desc: '确定删除这条记录吗？将连同其录入的视频数据一并删除，不可恢复。',
    danger: true,
    onOk: async () => {
      const numId = Number(id);
      const c = contents.find(x => x.id == id || x.id == numId);
      contents = contents.filter(x => x.id != id && x.id != numId);
      // 同步清理关联的视频数据（与 findLinkedTitle 关联逻辑对称）：
      // 1) contentId 精确匹配；2) 兜底 platform + date 匹配（老数据/未绑定 contentId 的记录）
      const isLinked = s =>
        s.contentId == id || s.contentId == numId ||
        (c && s.platform === c.platform && s.date === c.createdAt);
      stats = stats.filter(s => !isLinked(s));
      await saveDataBatch([
        { key: 'contents', val: contents },
        { key: 'stats', val: stats }
      ]);
      render();
      showToast('已删除');
    }
  });
}
