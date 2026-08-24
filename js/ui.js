function formatNum(n) {
  if (n >= 10000) return (n/10000).toFixed(1) + 'w';
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return n || 0;
}

// ===== MODAL =====
let pendingLinkTaskId = null;
// 登记弹窗平台下拉：仅 4 个短视频平台
function platformOptions(selected) {
  const list = VIDEO_PLATFORMS;
  const label = '短视频平台';
  const fallback = list.includes(selected) ? selected : list[0];
  return `<optgroup label="${label}">${list.map(p => `<option value="${p}" ${p === fallback ? 'selected' : ''}>${p}</option>`).join('')}</optgroup>`;
}

function openAddModal(prefillPlatform, taskId, prefillDate) {
  editId = null;
  pendingLinkTaskId = taskId || null;
  const preP = prefillPlatform || VIDEO_PLATFORMS[0];
  const preD = prefillDate || getToday();
  document.getElementById('modalContent').innerHTML = `
    <h3>登记内容</h3>
    <div class="form-row">
      <div class="form-group"><label>平台</label>
        <select id="cPlatform">
          ${platformOptions(preP)}
        </select>
      </div>
      <div class="form-group"><label>日期</label><input type="date" id="cDate" value="${preD}"></div>
    </div>
    <div class="form-group"><label>标题</label><input type="text" id="cTitle" placeholder="内容标题"></div>
    <div class="form-group"><label>选题</label><input type="text" id="cTopic" placeholder="内容选题/主题方向"></div>
    <div class="form-group"><label>链接</label><input type="url" id="cUrl" placeholder="https://... 发布链接"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-save" onclick="saveContent()">保存</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

// 编辑登记弹窗：仅登记内容（数据录入保持独立按钮——必须先有登记内容才能录数据，二者不同时进行）
// 平台下拉按工作台分区只显示对应平台
function editContent(id) {
  const c = contents.find(x => x.id == id || x.id == Number(id));
  if (!c) return;
  editId = c.id;
  document.getElementById('modalContent').innerHTML = `
    <h3>编辑登记</h3>
    <div class="form-row">
      <div class="form-group"><label>平台</label>
        <select id="cPlatform">
          ${platformOptions(c.platform)}
        </select>
      </div>
      <div class="form-group"><label>日期</label><input type="date" id="cDate" value="${c.createdAt}"></div>
    </div>
    <div class="form-group"><label>标题</label><input type="text" id="cTitle" value="${escapeHtml(c.title)}"></div>
    <div class="form-group"><label>选题</label><input type="text" id="cTopic" value="${escapeHtml(c.topic||'')}"></div>
    <div class="form-group"><label>链接</label><input type="url" id="cUrl" value="${escapeHtml(c.url||'')}" placeholder="https://..."></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-save" onclick="saveContent()">保存</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

async function saveContent() {
  const title = document.getElementById('cTitle').value.trim();
  const platform = document.getElementById('cPlatform').value;
  const date = document.getElementById('cDate').value || getToday();
  const topic = document.getElementById('cTopic').value.trim();
  const url = document.getElementById('cUrl').value.trim();
  if (!title) { showToast('请输入标题'); return; }
  if (url && !/^https?:\/\//i.test(url)) { showToast('链接格式错误：需以 http:// 或 https:// 开头'); return; }
  let savedId = null;
  if (editId) {
    const c = contents.find(x => x.id == editId || x.id == Number(editId));
    if (c) {
      const oldPlatform = c.platform, oldDate = c.createdAt;
      // 先判断旧「平台+日期」是否唯一（必须在 c 更新前计算，否则过滤结果失真）
      const oldKeyOnly = contents.filter(x => x.platform === oldPlatform && x.createdAt === oldDate).length === 1;
      c.title = title; c.platform = platform; c.topic = topic; c.url = url; c.createdAt = date; savedId = c.id;
      // 同步关联统计表副本（标题/平台/日期跟随内容变更，避免导出/复盘读到旧平台旧日期）
      // contentId 精确关联必跟随；旧「平台+日期」兜底关联：仅当该旧键唯一时可归属（防止误改同键其他内容的记录）
      let statChanged = false;
      const follow = s => {
        const byContentId = s.contentId == c.id || s.contentId == Number(c.id);
        const byOldKey = s.platform === oldPlatform && s.date === oldDate;
        if (!byContentId && !byOldKey) return;
        // 旧键不唯一时无法确认归属，跳过该记录（其属于另一条内容，标题/平台/日期都不应被改动）
        if (!byContentId && !oldKeyOnly) return;
        s.title = title;
        s.platform = platform; s.date = date;
        statChanged = true;
      };
      stats.forEach(follow);
      if (statChanged) { await saveData('stats', stats); }
    }
  } else {
    savedId = Date.now() + Math.random();
    contents.push({ id: savedId, title, platform, topic, url, createdAt: date });
  }
  await saveData('contents', contents); closeModal();
  pendingLinkTaskId = null;
  render();
  showToast(editId ? '已更新' : '已登记');
}

// ===== UNIFIED CONFIRM =====
function showConfirm({ title, desc, danger = false, okText, onOk }) {
  document.getElementById('modalContent').innerHTML = `
    <h3>${title}</h3>
    <p class="confirm-text">${desc}</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-save ${danger ? 'btn-danger' : ''}" id="confirmOkBtn">${okText || (danger ? '确认删除' : '确认')}</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('confirmOkBtn').onclick = () => {
    closeModal();
    if (onOk) onOk();
  };
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  pendingLinkTaskId = null;
}
// 弹窗退出方式：仅「取消」按钮或键盘ESC；点击空白处不关闭
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

// ===== NAV =====
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // 从「AI 配置与功能」页点导航：先切回短视频工作台再进对应页
    if (workspace === 'llm') switchWorkspace('video');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    // 数据复盘子页固定为视频数据
    if (currentTab === 'data') dataSubTab = 'video';
    if (currentTab === 'calendar' && !selectedDate) selectedDate = getToday();
    // 切换 tab 时重置 AI busy 标志（避免切回来后按钮点不动）
    resetAiBusyFlags();
    render();
  });
});

// ===== WORKSPACE 分区同步（已无下拉框，仅保留入口供启动调用） =====
function syncWorkspaceUI() {}

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ===== 数据卡片统一结构（今日/总览/数据复盘共用）=====
// data-count 存原始数值供入场滚动动画使用（见 animateStatCounts）；extraHtml 挂环比标签等附加内容
function statCardHtml(value, label, extraHtml) {
  const v = Number(value) || 0;
  return '<div class="stat-card"><div class="stat-value" data-count="' + v + '">' + formatNum(v) + '</div>' +
    '<div class="stat-label">' + label + '</div>' + (extraHtml || '') + '</div>';
}

// 环比增长标签：绿色（增长）/ 红色（下降），显示百分比；本期或上期为 0 时不显示（放 ui.js 供 overview/data 共用）
function renderGrowthTag(cur, prev) {
  if (!prev && !cur) return '';
  if (!prev) return cur > 0 ? '<span class="stat-change up">新增</span>' : '';
  if (!cur) return prev > 0 ? '<span class="stat-change down">-100%</span>' : '';
  const pct = ((cur - prev) / prev) * 100;
  if (pct === 0) return '<span class="stat-change flat">0%</span>';
  const cls = pct > 0 ? 'up' : 'down';
  const sign = pct > 0 ? '+' : '';
  return '<span class="stat-change ' + cls + '">' + sign + Math.round(pct) + '%</span>';
}

// ===== 数据看板入场动画（渲染完成后由 app.js render() 统一调度）=====
// 全部基于 requestAnimationFrame / CSS transition；无 rAF 的环境（如测试沙箱）直接跳过，不阻塞渲染
function __nextFrames(fn) { requestAnimationFrame(function(){ requestAnimationFrame(fn); }); }

// 数字卡片：0 → 目标值快速滚动（650ms easeOutCubic，随 render 重放）
function animateStatCounts() {
  if (!window.requestAnimationFrame) return;
  document.querySelectorAll('.stat-value[data-count]').forEach(function(el) {
    const target = parseFloat(el.getAttribute('data-count'));
    if (isNaN(target)) return;
    const dur = 650, t0 = performance.now();
    const frame = function() {
      const p = Math.min((performance.now() - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = formatNum(Math.round(target * e));
      if (p < 1) requestAnimationFrame(frame);
    };
    el.textContent = formatNum(0);
    requestAnimationFrame(frame);
  });
}

// 柱形图 / 进度条：从 0 生长到目标值（元素带 data-h / data-w，初始内联 0，transition 由 CSS 提供）
function animateChartBars() {
  const bars = document.querySelectorAll('.bar[data-h]');
  const pbars = document.querySelectorAll('.pbar[data-w]');
  if (!bars.length && !pbars.length) return;
  __nextFrames(function() {
    bars.forEach(function(b) { b.style.height = b.getAttribute('data-h') + '%'; });
    pbars.forEach(function(b) { b.style.width = b.getAttribute('data-w') + '%'; });
  });
}

// 饼图：整体从中心缩放展开（平面，无扭曲）
function animatePieCharts() {
  if (!window.requestAnimationFrame) return;
  document.querySelectorAll('svg[data-pie-uid] .pie-content').forEach(function(g) {
    requestAnimationFrame(function() {
      g.classList.add('pie-expanded');
    });
  });
}

// 折线图：线条描绘（stroke-dashoffset 1→0）+ 面积渐显 + 数据点级联浮现
function animateTrendLines() {
  const wraps = document.querySelectorAll('.trend-wrap');
  if (!wraps.length) return;
  __nextFrames(function() {
    wraps.forEach(function(w) {
      const line = w.querySelector('.trend-line');
      if (line) line.style.strokeDashoffset = '0';
      const area = w.querySelector('.trend-area');
      if (area) area.style.opacity = '1';
      w.querySelectorAll('.trend-dot').forEach(function(d) { d.style.opacity = '1'; });
    });
  });
}

// 入场动画总入口
function animateDashboard() {
  animateStatCounts();
  animateChartBars();
  animatePieCharts();
  animateTrendLines();
}

// ===== 折线图悬停提示（数据点 hit 圆触发：显示日期 + 数值小框 + 竖向参考线）=====
let __trendTipTimer = null;
function trendTipShow(el) {
  if (__trendTipTimer) { clearTimeout(__trendTipTimer); __trendTipTimer = null; }
  const svg = el.closest('svg');
  const wrap = svg && svg.closest('.trend-wrap');
  if (!wrap) return;
  const tip = wrap.querySelector('.trend-tip');
  const cx = el.getAttribute('cx'), cy = el.getAttribute('cy');
  // viewBox 坐标 → 屏幕坐标（getScreenCTM 自动处理缩放与留白居中）
  const pt = svg.createSVGPoint();
  pt.x = parseFloat(cx); pt.y = parseFloat(cy);
  const sp = pt.matrixTransform(svg.getScreenCTM());
  const wr = wrap.getBoundingClientRect();
  tip.style.left = (sp.x - wr.left) + 'px';
  tip.style.top = (sp.y - wr.top) + 'px';
  tip.querySelector('.trend-tip-date').textContent = el.getAttribute('data-date');
  tip.querySelector('.trend-tip-val').textContent = (el.getAttribute('data-label') || '') + ' ' + el.getAttribute('data-val');
  tip.classList.add('show');
  const guide = svg.querySelector('.trend-guide');
  if (guide) { guide.setAttribute('x1', cx); guide.setAttribute('x2', cx); guide.classList.add('show'); }
  svg.querySelectorAll('.trend-dot.hot').forEach(function(d) { d.classList.remove('hot'); });
  const dot = svg.querySelector('.trend-dot[data-idx="' + el.getAttribute('data-idx') + '"]');
  if (dot) dot.classList.add('hot');
}
function trendTipHide() {
  if (__trendTipTimer) clearTimeout(__trendTipTimer);
  // 短暂延迟再隐藏：在相邻数据点间滑动时避免闪烁
  __trendTipTimer = setTimeout(function() {
    document.querySelectorAll('.trend-tip.show').forEach(function(t) { t.classList.remove('show'); });
    document.querySelectorAll('.trend-guide.show').forEach(function(g) { g.classList.remove('show'); });
    document.querySelectorAll('.trend-dot.hot').forEach(function(d) { d.classList.remove('hot'); });
  }, 100);
}
