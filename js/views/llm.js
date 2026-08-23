// ===== 大模型接入（OpenAI 兼容协议）=====
// 配置存 data/llmConfig.json（走 /api/data/llmConfig 接口，data/ 已被 .gitignore 不会上传远端仓库）
// 与内容数据解耦：importData / 清空数据 / 重置示例 均不会触碰该配置，清空需在配置页单独操作

// ===== 渲染：AI 配置与功能页 =====
// 保存成功后进入「已保存」锁定态（输入禁用 + 已保存标记），点「编辑配置」解锁修改
let __llmEditing = false;

// 配置卡展开/收起（状态存 localStorage，重渲染后保持）
let __llmConfigCollapsed = (function(){
  return localStorage.getItem(STORAGE_KEY + 'llmConfigCollapsed') === '1';
})();
function toggleLlmConfig() {
  __llmConfigCollapsed = !__llmConfigCollapsed;
  localStorage.setItem(STORAGE_KEY + 'llmConfigCollapsed', __llmConfigCollapsed ? '1' : '0');
  applyLlmConfigFold();
}
function applyLlmConfigFold() {
  const body = document.getElementById('llmConfigBody');
  const arrow = document.getElementById('llmConfigToggle');
  if (body) body.style.display = __llmConfigCollapsed ? 'none' : 'block';
  if (arrow) {
    arrow.innerHTML = '&#9660;';
    arrow.classList.toggle('collapsed', __llmConfigCollapsed);
  }
}

// AI 视频文案专家 / AI 数据分析专家 / AI 文生视频专家的每日额度（各自计数，存 data/llmQuota.json 走服务端，清浏览器缓存不影响）
const LLM_DAILY_LIMIT = 20;   // 每类每日上限
const LLM_MAX_CHARS = 3000;   // 单条消息最大字数

let __llmQuota = { date: '', chat: 0, review: 0, video: 0 };
let __llmQuotaLoaded = false;

async function loadLlmQuota() {
  const d = getToday();
  try {
    const q = await loadData('llmQuota');
    if (q && typeof q === 'object' && !Array.isArray(q) && q.date && (typeof q.chat === 'number' || typeof q.count === 'number')) {
      // 兼容旧格式：{date,count} → chat；GEO 已移除，其计数 {geo} 转给「AI 数据分析专家」
      __llmQuota = {
        date: q.date,
        chat: typeof q.chat === 'number' ? q.chat : (q.count || 0),
        review: typeof q.review === 'number' ? q.review : (q.geo || 0),
        video: typeof q.video === 'number' ? q.video : 0
      };
    } else {
      __llmQuota = { date: d, chat: 0, review: 0, video: 0 };
    }
    if (__llmQuota.date !== d) __llmQuota = { date: d, chat: 0, review: 0, video: 0 };   // 跨天重置
  } catch (e) {
    __llmQuota = { date: d, chat: 0, review: 0, video: 0 };
  }
  __llmQuotaLoaded = true;
}
function __quotaKey(type) {
  if (type === 'review') return 'review';
  if (type === 'video') return 'video';
  return 'chat';
}
// 未加载完成前返回满额（不误伤），渲染后的下一次更新会校正
function llmQuotaRemaining(type) {
  const key = __quotaKey(type);
  return __llmQuotaLoaded ? Math.max(0, LLM_DAILY_LIMIT - (__llmQuota[key] || 0)) : LLM_DAILY_LIMIT;
}
async function llmQuotaConsume(type) {
  const d = getToday();
  const key = __quotaKey(type);
  if (__llmQuota.date !== d) __llmQuota = { date: d, chat: 0, review: 0, video: 0 };
  __llmQuota[key]++;
  await saveData('llmQuota', __llmQuota);
  return llmQuotaRemaining(type);
}
async function llmQuotaRefund(type) {
  const key = __quotaKey(type);
  if (__llmQuota[key] > 0) {
    __llmQuota[key]--;
    await saveData('llmQuota', __llmQuota);
  }
}
// 页面加载即拉取额度（与 store 初始化并行，随后续渲染校正显示）
loadLlmQuota();

// savedAt 存的是 ISO(UTC)，显示时转本地(+8)时间，避免"上次保存时间"差 8 小时
function formatLocalTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 各 AI 功能标题后面的「已配置/未配置」小胶囊（样式同 API Key 栏旁的 .llm-badge）
function renderLlmStatusBadge() {
  const cfg = llmConfig || {};
  const configured = cfg.baseUrl && cfg.apiKey && cfg.model;
  return configured
    ? '<span class="llm-badge">已配置</span>'
    : '<span class="llm-badge nok">未配置</span>';
}

function renderLLMConfig() {
  const cfg = llmConfig || {};
  const configured = cfg.baseUrl && cfg.apiKey && cfg.model;
  const locked = configured && !__llmEditing;   // 已保存且未在编辑 → 锁定
  const dis = locked ? ' disabled' : '';
  const tempVal = (cfg.temperature === undefined || cfg.temperature === null || cfg.temperature === '') ? '' : cfg.temperature;
  const actions = locked
    ? `<button class="btn-save" onclick="startLLMEdit()">编辑配置</button>
       <button class="btn-test" onclick="testLLMConnection()">测试连接</button>
       <button class="btn-danger" onclick="clearLLMConfig()">清空配置</button>`
    : `<button class="btn-save" onclick="saveLLMConfig()">保存</button>
       <button class="btn-test" onclick="testLLMConnection()">测试连接</button>
       <button class="btn-danger" onclick="clearLLMConfig()">清空配置</button>`;
  return `
  <div class="llm-page">
    <div class="card">
      <div class="card-title" style="cursor:pointer;" onclick="toggleLlmConfig()">AI 大模型配置${renderLlmStatusBadge()}<span class="content-fold-arrow ${__llmConfigCollapsed ? 'collapsed' : ''}" id="llmConfigToggle" style="margin-left:auto;">&#9660;</span></div>
      <div id="llmConfigBody" style="${__llmConfigCollapsed ? 'display:none;' : ''}">
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px;">配置 OpenAI 兼容接口，支持 DeepSeek、豆包、千问等</div>
      <div class="form-group">
        <label>Base URL</label>
        <input type="url" id="llmBaseUrl" value="${escapeHtml(cfg.baseUrl || '')}" placeholder="https://api.deepseek.com/v1 或 http://localhost:11434/v1"${dis}>
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input type="password" id="llmApiKey" value="" placeholder="${configured ? (locked ? '已配置（如需修改请点「编辑配置」）' : '留空则保持已保存的 Key') : 'sk-...'}" autocomplete="off"${dis}>
      </div>
      <div class="form-group">
        <label>模型名称</label>
        <input type="text" id="llmModel" value="${escapeHtml(cfg.model || '')}" placeholder="deepseek-chat"${dis}>
      </div>
      <div class="form-group">
        <label>Temperature（可选，0~2，留空则不传）</label>
        <input type="number" id="llmTemperature" min="0" max="2" step="0.1" value="${escapeHtml(String(tempVal))}" placeholder="例如 1.0"${dis}>
      </div>
      <div class="llm-actions">
        ${actions}
      </div>
      <div class="llm-status ${locked ? 'llm-status-saved' : ''}">${configured
        ? (locked ? '✓ 已保存：' + escapeHtml(cfg.model) + '（' + escapeHtml(formatLocalTime(cfg.savedAt)) + '）' : '已配置：' + escapeHtml(cfg.model) + '（上次保存 ' + escapeHtml(formatLocalTime(cfg.savedAt)) + '）')
        : '尚未配置大模型'}</div>
      <div class="llm-hint">配置只保存在本机 data/ 目录，不会上传代码仓库；「清空数据」不会清除此处配置。</div>
      </div>
    </div>
    ${renderAiVideoCopyCard()}
    ${renderAiVideoPromptCard()}
    ${renderAiReviewCard()}
  </div>`;
}

// 解锁编辑态（已保存配置 → 可修改）
function startLLMEdit() {
  __llmEditing = true;
  render();
}

// ===== 保存配置 =====
function saveLLMConfig() {
  const baseUrl = document.getElementById('llmBaseUrl').value.trim();
  const apiKey = document.getElementById('llmApiKey').value.trim();
  const model = document.getElementById('llmModel').value.trim();
  const tRaw = document.getElementById('llmTemperature').value.trim();
  if (!/^https?:\/\//i.test(baseUrl)) { showToast('Base URL 需以 http:// 或 https:// 开头'); return; }
  if (!apiKey && !(llmConfig && llmConfig.apiKey)) { showToast('请输入 API Key'); return; }
  if (!model) { showToast('请输入模型名称'); return; }
  let temperature;
  if (tRaw !== '') {
    temperature = Number(tRaw);
    if (isNaN(temperature) || temperature < 0 || temperature > 2) { showToast('Temperature 需为 0~2 的数字，留空则不传'); return; }
  }
  // API Key 留空 = 保持已保存的 Key（页面从不渲染真实 Key，编辑时重新输入才更换）
  const cfg = {
    baseUrl,
    apiKey: apiKey || (llmConfig && llmConfig.apiKey) || '',
    model,
    savedAt: new Date().toISOString()
  };
  if (temperature !== undefined) cfg.temperature = temperature;
  llmConfig = cfg;
  __llmEditing = false;
  saveData('llmConfig', llmConfig).then(() => showToast('大模型配置已保存'));
  render();
}

// ===== 清空配置（独立于「清空数据」）=====
function clearLLMConfig() {
  showConfirm({
    title: '清空大模型配置',
    desc: '将删除已保存的 Base URL / API Key / 模型名称（仅本机 data/llmConfig.json），不影响内容数据。是否继续？',
    danger: true,
    okText: '确认清空',
    onOk: async () => {
      llmConfig = {};
      await saveData('llmConfig', {});
      render();
      showToast('大模型配置已清空');
    }
  });
}

// ===== 底层请求：OpenAI 兼容 chat/completions =====
async function chatRaw(baseUrl, apiKey, model, messages, temperature, signal) {
  const url = String(baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const body = { model: model, messages: messages };
  // temperature 仅在校验通过（0~2 数字）时透传；未填/无效则不传，避免部分服务端报错
  if (temperature !== undefined && temperature !== null && temperature !== '' && !isNaN(Number(temperature))) {
    body.temperature = Number(temperature);
  }
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(body)
  };
  if (signal) opts.signal = signal;
  const res = await fetch(url, opts);
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j && j.error && j.error.message ? '：' + j.error.message : ''; } catch (e) {}
    throw new Error('HTTP ' + res.status + detail);
  }
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('响应中未找到文本内容');
  return String(text);
}

// 供后续 AI 功能复用的通用调用（使用已保存配置）
async function chatLLM(messages, signal) {
  const cfg = llmConfig || {};
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error('尚未配置大模型，请先在上方填写并保存配置');
  }
  return chatRaw(cfg.baseUrl, cfg.apiKey, cfg.model, messages, cfg.temperature, signal);
}

// ===== 测试连接：用表单当前值直连（不要求先保存）=====
async function testLLMConnection() {
  const baseUrl = document.getElementById('llmBaseUrl').value.trim();
  const apiKey = document.getElementById('llmApiKey').value.trim() || (llmConfig && llmConfig.apiKey) || '';
  const model = document.getElementById('llmModel').value.trim();
  const tRaw = document.getElementById('llmTemperature') ? document.getElementById('llmTemperature').value.trim() : '';
  if (!/^https?:\/\//i.test(baseUrl)) { showToast('Base URL 需以 http:// 或 https:// 开头'); return; }
  if (!apiKey || !model) { showToast('请填写 API Key 与模型名称'); return; }
  showToast('正在测试连接...');
  try {
    await chatRaw(baseUrl, apiKey, model, [{ role: 'user', content: 'ping' }], tRaw === '' ? undefined : Number(tRaw));
    showToast('连接成功 Let us begin 🎉');
  } catch (e) {
    showToast('连接失败：' + e.message);
  }
}

// ===== AI 功能防打断：切换 tab 不打断运行，返回时恢复 loading 状态 =====
// 两个功能各自独立的取消控制器（互不干扰：一个功能完成/取消时不会影响另一个的 loading 显示）
let __aiReviewController = null;  // AI 数据分析专家
let __aiCopyController = null;    // AI 视频文案专家
function resetAiBusyFlags() {
  // 切换 tab 不打断 AI：busy 标志与请求均保留
  // 渲染函数根据 busy 标志显示 loading + 取消按钮，切回后状态不丢失
}

// ===== AI 数据分析专家（AI 配置与功能页，视频平台）=====
// 按所选周期（全部/本月/本周）取数据（与导出报表同口径的数据表），连同账号运营时长注入系统提示词，让大模型自动分析与复盘
// 视频指标口径：完播率仅抖音/快手/视频号、均播时长仅抖音/小红书/视频号、收藏仅抖音/快手/小红书（视频号看「推荐」、不记收藏）——不适用显示「-」而非 0，提示词已向模型说明

// 周期：默认「本月」（跟随发布总览当前查看的月份），记忆在 localStorage
let __aiReviewPeriod = (function(){
  const p = localStorage.getItem(STORAGE_KEY + 'aiReviewPeriod');
  return (p === 'all' || p === 'week' || p === 'month') ? p : 'month';
})();

function setOverviewAiPeriod(v) {
  if (v === 'all' || v === 'week' || v === 'month') {
    __aiReviewPeriod = v;
    localStorage.setItem(STORAGE_KEY + 'aiReviewPeriod', v);
  }
}
function getOverviewAiMonths() {
  const n = parseFloat(localStorage.getItem(STORAGE_KEY + 'aiReviewMonths') || '0');
  return (!isNaN(n) && n >= 0) ? n : 0;
}
function saveOverviewAiMonths(v) {
  const n = parseFloat(v);
  const months = (!isNaN(n) && n >= 0) ? Math.round(n * 10) / 10 : 0;
  localStorage.setItem(STORAGE_KEY + 'aiReviewMonths', String(months));
  const input = document.getElementById('overviewAiMonths');
  if (input) input.value = months;
}

// 所选周期的起止范围与标签（月=当月，周=本周一~周日）
function getAiReviewRange() {
  if (__aiReviewPeriod === 'all') return { label: '全部', start: null, end: null };
  if (__aiReviewPeriod === 'week') {
    const r = getPeriodRanges('week');
    return { label: '本周（' + r.start + ' ~ ' + r.end + '）', start: r.start, end: r.end };
  }
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const start = y + '-' + String(m).padStart(2, '0') + '-01';
  const last = new Date(y, m, 0).getDate();
  const end = y + '-' + String(m).padStart(2, '0') + '-' + String(last).padStart(2, '0');
  return { label: '本月（' + start + ' ~ ' + end + '）', start: start, end: end };
}
function inReviewRange(d, r) { return !r.start || (d >= r.start && d <= r.end); }

// 系统提示词：总结周期（数据日期范围）与账号运营时长（评估背景）是两类信息，分别注入
function buildAiReviewSystemPrompt(periodLabel, monthsText, withAccountData) {
  let p = '你是一名资深新媒体数据分析师，根据用户提供的数据表进行分析总结并按结构给出评价和建议。下面是视频平台的数据表。\n' +
    '总结周期：' + periodLabel + '。本次仅针对该日期范围内的数据进行总结与复盘。\n' +
    '账号运营时长：' + monthsText + '。请结合账号运营时间长短评估数据表现：运营初期与运营成熟期的指标预期、增长曲线和复盘重点应有所区分，避免用成熟账号的标准苛求早期账号。\n' +
    '数据口径说明（务必区分三种情况）：表中「-」=该平台不适用此指标（例如小红书无完播率、快手无均播时长、视频号无收藏）；空白=该平台适用此指标但本条未录入；0=录入数据为 0。各平台适用对照：完播率=抖音/快手/视频号；均播时长=抖音/小红书/视频号；收藏=抖音/快手/小红书；推荐=视频号；播放/点赞/评论/分享/涨粉=各平台通用。单条视频的「涨粉」为该视频带来的粉丝增长，应结合「账号登记数据」的粉丝变化综合判断（如没有对比变化，表示只录入了一次数据而不是没有总增长）。切勿把「-」当成数据缺失，也不要仅因未看到某些记录就断言某平台不统计某指标。\n' +
    '数据表若含「账号登记数据」，为各平台账号的累计运营数据快照（总发布/总粉丝/总播放/总点赞/总评论/总分享），该板块独立于所选周期、不按周期过滤，每账号仅保留最新3条快照，「对比变化」为上一次与这一次登记快照的差值（正负号表示增减），可据此评估账号健康度、粉丝增长趋势。\n';
  const platforms = VIDEO_PLATFORMS.join('、');
  p += '请做分析与复盘，用中文严格按以下结构输出，风格偏鼓励，表现很差或有问题则直接指出（输出纯文本，不要使用任何 markdown 符号如 #、##、**、* 等）：\n' +
    '【账号表现】\n' +
'总体表现：核心数据与整体表现一句话总结。';
  if (withAccountData) {
    p += '并概括「账号登记数据」中的登记的账号累计规模（总粉丝量、总播放量、总发布量等）、对比变化趋势（如有），两句话说明总体所处量级情况。';
  }
  p += '按' + platforms + '逐平台各用一段（两句话说明），结合该平台数据表现与账号数据表现给出分析要点。\n' +
    '【亮点和优势】\n用「• 」无序符号逐条列出 2-5 条表现好的亮点和优势，每条附数据佐证。\n' +
    '【问题和不足】\n用「• 」无序符号逐条列出 2-5 条数据表现的问题和不足。\n' +
    '【下一步建议】\n用「• 」无序符号列出 2-5 条可执行的优化建议，结合账号运营时长、亮点优势和问题不足给出合理的阶段预期，包括不限于改进内容选题、人设、钩子，适合投流的内容和时机等。\n' +
    '控制篇幅，不要输出数据分析外的无关内容（总篇幅1500字以内）、突出重点、用数据说话。';
  return p;
}

// 分析对象：仅视频平台
let __aiReviewTarget = 'video';
function setAiReviewTarget(v) {
  if (v === 'video') __aiReviewTarget = v;
}

// AI 配置与功能页的 AI 数据分析专家卡片（分析对象 + 周期下拉 + 运营时长输入）
function renderAiReviewCard() {
  const cfg = llmConfig || {};
  const configured = cfg.baseUrl && cfg.apiKey && cfg.model;
  const months = getOverviewAiMonths();
  const isRunning = __overviewAiBusy && __aiReviewController;
  return `<div class="ai-split">
      <div class="ai-panel">
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 数据分析专家</span>${renderLlmStatusBadge()}</div>
        <div class="ai-panel-body">
          <div class="ai-feature-sub">自动汇总周期数据，生成结构化分析报告，可网页直开/打印/存 PDF</div>
          <div class="form-row">
            <div class="form-group"><label>总结周期</label>
              <select id="overviewAiPeriod" onchange="setOverviewAiPeriod(this.value)">
                <option value="all" ${__aiReviewPeriod === 'all' ? 'selected' : ''}>全部</option>
                <option value="month" ${__aiReviewPeriod === 'month' ? 'selected' : ''}>本月</option>
                <option value="week" ${__aiReviewPeriod === 'week' ? 'selected' : ''}>本周</option>
              </select>
            </div>
            <div class="form-group"><label>运营时长（月）</label>
              <input type="number" id="overviewAiMonths" min="0" step="0.1" value="${months || ''}" placeholder="如 1.5、12" onchange="saveOverviewAiMonths(this.value)">
            </div>
          </div>
          <div class="llm-actions" id="overviewAiActions">
            ${isRunning
              ? '<button class="btn-cancel" onclick="cancelAiReview()">取消</button>'
              : '<button class="btn-save" onclick="runOverviewAiReview()">AI 数据分析</button>'
            }
          </div>
          <div class="llm-chat-quota" id="overviewAiQuota">今日 AI 数据分析剩余 ${llmQuotaRemaining('review')} 次</div>
        </div>
      </div>
      <div class="ai-panel">
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 输出结果</span></div>
        <div class="ai-result-panel" id="overviewAiOutput">${
          isRunning
            ? '<div class="llm-loading"><span>正在按「' + escapeHtml(getAiReviewRange().label) + '」对视频平台进行 AI 数据分析...</span><span class="llm-loading-hint">预计需要1-3分钟（内容量大小），请稍候。</span></div>'
            : aiReviewReply()
              ? '<pre class="llm-reply">' + escapeHtml(aiReviewReply()) + '</pre>' + aiReviewReplyButtons()
              : (configured ? '<div class="ai-panel-empty">AI 数据分析专家结果将显示在这里<br>完成后可一键网页直开报表</div>' : '<div class="llm-error">尚未配置大模型，请先在上方填写并保存。</div>')
        }</div>
      </div>
    </div>`;
}

// 构建发给 AI 的数据表文本：汇总 + 明细（与导出报表口径一致，视频不适用指标显示「-」），过长则截断保留最近内容
function buildOverviewReviewData(range) {
  const lines = [];
  const MAX = 6000;
  const monthContents = contents.filter(c => inReviewRange(c.createdAt || '', range));
  let dropped = false;
  const push = s => { if (lines.join('\n').length < MAX) lines.push(s); else dropped = true; };
  // 标题按码点安全截断（保留主标题、去掉长尾标签/描述），让更多记录能塞进提示词
  const shortTitle = t => { const a = Array.from(String(t || '')); return a.length > 24 ? a.slice(0, 24).join('') + '…' : String(t || ''); };
  // 账号登记数据：独立板块（不分周期），放在最前保证不被下方视频数据（MAX 上限）截断。
  // 账号数据登记本身只保留每账号最新3条快照（发布/粉丝/播放/点赞/评论/分享），展示全部快照 + 最早→最新对比变化
  const accSnaps = accountStats.filter(s => isVideo(s.platform));
  if (accSnaps.length) {
    const accGroups = {};
    accSnaps.forEach(s => {
      const key = s.platform + '|' + String(s.accountRef || '');
      (accGroups[key] = accGroups[key] || { platform: s.platform, ref: s.accountRef, items: [] }).items.push(s);
    });
    push('【账号登记数据】格式：平台|账号|最新记录日期|发布|粉丝|播放|点赞|评论|分享|对比变化（最早→最新，每账号保留最新3条快照）');
    Object.keys(accGroups).sort().forEach(key => {
      const g = accGroups[key];
      g.items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const first = g.items[0], latest = g.items[g.items.length - 1];
      const rec = g.ref ? accountIds.find(x => String(x.id) === String(g.ref)) : null;
      const label = rec && rec.accountId ? rec.accountId : '未指定账号';
      const note = rec && rec.note ? '（' + rec.note + '）' : '';
      const delta = k => { const d = (Number(latest[k]) || 0) - (Number(first[k]) || 0); return d > 0 ? '+' + d : String(d); };
      push('  ' + g.platform + '|' + label + note + '|' + latest.date + '|发布' + (latest.posts ?? '') +
        '|粉丝' + (latest.followers ?? '') + '|播放' + (latest.views ?? '') + '|点赞' + (latest.likes ?? '') +
        '|评论' + (latest.comments ?? '') + '|分享' + (latest.shares ?? '') +
        '|粉丝' + delta('followers') + '、播放' + delta('views') + '、点赞' + delta('likes'));
    });
  }
  const vStats = stats.filter(s => inReviewRange(s.date || '', range) && isVideo(s.platform));
  const sum = k => vStats.reduce((s, x) => s + (x[k] || 0), 0);
  push('【短视频平台数据汇总】');
  push('总发布数：' + monthContents.filter(c => isVideo(c.platform)).length +
    '，总播放量：' + sum('views') + '，总点赞：' + sum('likes') + '，总评论：' + sum('comments') +
    '，总收藏（不含视频号）：' + sum('favorites') + '，总涨粉：' + sum('followers'));
  VIDEO_PLATFORMS.forEach(p => {
    const ps = vStats.filter(s => s.platform === p);
    if (ps.length) push('  ' + p + '：发布' + ps.length + '条，播放' + ps.reduce((s,x)=>s+(x.views||0),0) +
      '，点赞' + ps.reduce((s,x)=>s+(x.likes||0),0) + '，评论' + ps.reduce((s,x)=>s+(x.comments||0),0) +
      '，涨粉' + ps.reduce((s,x)=>s+(x.followers||0),0));
  });
  push('【逐条数据】日期|平台|标题|播放|完播%|均播(秒)|点赞|评论|收藏|推荐|分享|涨粉（不适用指标显示 -）');
  vStats.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(s => {
    push('  ' + (s.date || '') + '|' + s.platform + '|' + shortTitle(statTitle(s)) + '|' + (s.views ?? '') +
      '|' + videoMetric(s, 'completionRate') + '|' + videoMetric(s, 'avgWatch') + '|' + (s.likes ?? '') +
      '|' + (s.comments ?? '') + '|' + videoMetric(s, 'favorites') + '|' + videoMetric(s, 'recommend') +
      '|' + (s.shares ?? '') + '|' + (s.followers ?? ''));
  });
  let text = lines.join('\n');
  if (dropped) text += '\n（注意：数据量较大已截断，仅保留了最近内容，较早记录未列入本分析；请勿因未看到较早记录就断定某指标缺失或某平台不统计某指标）';
  return text;
}

let __overviewAiBusy = false;
let __aiReviewCompleted = false;   // 本次分析是否已拿到结果（已完成后取消不再退款）
// AI 数据分析专家结果
const __aiReviewReplies = {};
function aiReviewReply() { return __aiReviewReplies['video'] || ''; }
function aiReviewReplyButtons() {
  return '<div style="margin-top:10px;text-align:right;display:flex;justify-content:flex-end;gap:8px;">' +
    '<button class="btn-danger" onclick="clearAiReviewReply()" style="font-size:12px;padding:6px 14px;cursor:pointer;">清空结果</button>' +
    '<button class="btn-save" onclick="exportAiAnalysisToHtml()" style="font-size:12px;padding:6px 14px;background:linear-gradient(135deg,var(--green),#10b981);cursor:pointer;">🖨️ HTML 网页直开</button>' +
    '</div>';
}
function clearAiReviewReply() {
  showConfirm({
    title: '清空 AI 分析结果',
    desc: '将清空当前的 AI 数据分析结果，是否继续？',
    danger: true,
    okText: '确认清空',
    onOk: async () => {
      __aiReviewReplies['video'] = '';
      render();
      showToast('AI 分析结果已清空');
    }
  });
}

// 导出 AI 数据分析专家结果为 HTML（网页直开，可打印/存 PDF，样式与数据表报表一致）
function exportAiAnalysisToHtml() {
  if (!aiReviewReply()) { showToast('暂无分析结果可导出'); return; }
  const period = __aiReviewPeriod === 'week' ? '本周' : (__aiReviewPeriod === 'month' ? '本月' : '全部');
  const months = getOverviewAiMonths();
  const monthsLabel = months > 0 ? '，账号运营' + months + '个月' : '';
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>AI视频数据分析报告_${period}_${getToday()}</title>
<style>
body { font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; margin: 20px; color: #1f2937; line-height: 1.5; }
h1 { color: #1f2937; border-bottom: 3px solid #5b8cff; padding-bottom: 10px; }
.meta { color: #6b7280; font-size: 14px; margin: 5px 0 20px; }
pre { font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.8; }
</style>
</head><body>
<h1>📊 AI 视频数据分析报告</h1>
<p class="meta">分析周期：${period}${monthsLabel}　|　导出时间：${new Date().toLocaleString('zh-CN')}</p>
<pre>${escapeHtml(aiReviewReply())}</pre>
</body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.focus(); }
  else showToast('浏览器拦截了弹窗，请允许后重试');
}
async function runOverviewAiReview() {
  if (__overviewAiBusy) return;
  const ws = 'video';   // AI 数据分析专家仅针对视频平台
  const out = document.getElementById('overviewAiOutput');
  const cfg = llmConfig || {};
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    if (out) out.innerHTML = '<div class="llm-error">尚未配置大模型，请先在上方填写并保存。</div>';
    return;
  }
  if (!__llmQuotaLoaded) await loadLlmQuota();
  if (llmQuotaRemaining('review') <= 0) { showToast('今日 AI 数据分析专家次数已用完，明天再来吧'); return; }
  const range = getAiReviewRange();
  const months = getOverviewAiMonths();
  const monthsText = months > 0 ? '账号已运营 ' + months + ' 个月' : '未填写账号运营时长';
  __overviewAiBusy = true;
  __aiReviewController = new AbortController();
  __aiReviewCompleted = false;
  if (out) out.innerHTML = '<div class="llm-loading"><span>正在按「' + range.label + '」对视频平台进行 AI 数据分析...</span><span class="llm-loading-hint">预计需要1-3分钟（内容量大小），请稍候。</span></div>';
  // 在操作区域显示取消按钮
  const actionsEl = document.getElementById('overviewAiActions');
  if (actionsEl) actionsEl.innerHTML = '<button class="btn-cancel" onclick="cancelAiReview()">取消</button>';
  await llmQuotaConsume('review');
  const refreshQuota = () => {
    const el = document.getElementById('overviewAiQuota');
    if (el) el.textContent = '今日 AI 数据分析剩余 ' + llmQuotaRemaining('review') + ' 次';
  };
  try {
    const reply = await chatLLM([
      { role: 'system', content: buildAiReviewSystemPrompt(range.label, monthsText, ws === 'video') },
      { role: 'user', content: '以下是 ' + range.label + ' 导出的数据表：\n\n' + buildOverviewReviewData(range) }
    ], __aiReviewController.signal);
    __aiReviewCompleted = true;
    __aiReviewReplies[ws] = reply;
    // 检查 DOM 是否存在（可能已切换 tab 再切回，元素已重建）
    if (document.getElementById('overviewAiOutput')) {
      document.getElementById('overviewAiOutput').innerHTML = '<pre class="llm-reply">' + escapeHtml(reply) + '</pre>' + aiReviewReplyButtons();
    }
    refreshQuota();
  } catch (e) {
    if (e.name !== 'AbortError') {
      await llmQuotaRefund('review');
      refreshQuota();
      if (document.getElementById('overviewAiOutput')) {
        document.getElementById('overviewAiOutput').innerHTML = '<div class="llm-error">请求失败：' + escapeHtml(e.message) + '</div>';
      }
    }
  } finally {
    __overviewAiBusy = false;
    __aiReviewController = null;
    // 仍在总览页时恢复开始按钮（切走则由 render 的 busy 判断处理）
    const actionsEl2 = document.getElementById('overviewAiActions');
    if (actionsEl2 && actionsEl2.querySelector('.btn-cancel')) {
      actionsEl2.innerHTML = '<button class="btn-save" onclick="runOverviewAiReview()">AI 数据分析</button>';
    }
  }
}

function cancelAiReview() {
  if (__aiReviewController) { __aiReviewController.abort(); __aiReviewController = null; }
  __overviewAiBusy = false;
  // 未拿到结果前取消 → 退还本次额度（已完成后取消则不退，避免重复退款）
  if (!__aiReviewCompleted) llmQuotaRefund('review');
  __aiReviewReplies[__aiReviewTarget] = '';
  const out = document.getElementById('overviewAiOutput');
  if (out) out.innerHTML = '<div class="llm-error" style="color:var(--text3);">已取消运行</div>';
  // 恢复开始按钮
  const actionsEl = document.getElementById('overviewAiActions');
  if (actionsEl) actionsEl.innerHTML = '<button class="btn-save" onclick="runOverviewAiReview()">AI 数据分析</button>';
}

// ===== AI 视频文案专家（标题 + 描述 + 标签）=====
let __aiCopyResult = null;
let __aiCopyLoading = false;
// 表单值记忆：切页/重渲染后保留平台选择与选题、卖点、备注输入内容
let __aiCopyPlatform = '';
let __aiCopyTopic = '';
let __aiCopySelling = '';
let __aiCopyRemark = '';
function saveAiCopyForm() {
  const p = document.getElementById('aiCopyPlatform');
  const t = document.getElementById('aiCopyTopic');
  const s = document.getElementById('aiCopySelling');
  const r = document.getElementById('aiCopyRemark');
  if (p) __aiCopyPlatform = p.value;
  if (t) __aiCopyTopic = t.value;
  if (s) __aiCopySelling = s.value;
  if (r) __aiCopyRemark = r.value;
}
function clearAiCopyResult() {
  showConfirm({
    title: '清空生成结果',
    desc: '将清空本次 AI 生成的结果，是否继续？',
    danger: true,
    okText: '确认清空',
    onOk: async () => {
      __aiCopyResult = null;
      renderAiCopyResults();
      showToast('生成结果已清空');
    }
  });
}

function renderAiVideoCopyCard() {
  const cfg = llmConfig || {};
  const configured = cfg.baseUrl && cfg.apiKey && cfg.model;
  // 如果 AI 正在后台运行，显示 loading 状态
  const isRunning = __aiCopyLoading && __aiCopyController;
  return `<div class="ai-split">
      <div class="ai-panel">
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 视频文案专家</span>${renderLlmStatusBadge()}</div>
        <div class="ai-panel-body">
          <div class="ai-feature-sub">根据选题和卖点，一键生成标题、描述和推荐标签</div>
          <div class="form-row">
            <div class="form-group"><label>平台</label>
              <select id="aiCopyPlatform" ${isRunning ? 'disabled' : ''} onchange="saveAiCopyForm()">
                ${VIDEO_PLATFORMS.map(p => `<option value="${p}" ${p === (__aiCopyPlatform || VIDEO_PLATFORMS[0]) ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>选题/主题</label>
              <input type="text" id="aiCopyTopic" value="${escapeHtml(__aiCopyTopic || '')}" placeholder="如：夏日防晒好物分享" ${isRunning ? 'disabled' : ''} oninput="saveAiCopyForm()">
            </div>
          </div>
          <div style="display:flex;gap:10px;">
            <div class="form-group" style="flex:1;margin-bottom:0;"><label>行业卖点（可选）</label>
              <input type="text" id="aiCopySelling" value="${escapeHtml(__aiCopySelling || '')}" placeholder="如：平价、不搓泥、油皮友好" ${isRunning ? 'disabled' : ''} oninput="saveAiCopyForm()">
            </div>
            <div class="form-group" style="flex:1;margin-bottom:0;"><label>用户备注（可选）</label>
              <input type="text" id="aiCopyRemark" value="${escapeHtml(__aiCopyRemark || '')}" placeholder="画面内容、生成风格等" ${isRunning ? 'disabled' : ''} oninput="saveAiCopyForm()">
            </div>
          </div>
          <div class="llm-actions" id="aiCopyActions">
            ${isRunning
              ? '<button class="btn-cancel" onclick="cancelAiCopy()">取消</button>'
              : '<button class="btn-save" onclick="generateAiVideoCopy()">AI 生成描述</button>'
            }
          </div>
          <div class="llm-chat-quota" id="aiCopyQuota">今日 AI 视频文案专家剩余 ${llmQuotaRemaining('chat')} 次</div>
        </div>
      </div>
      <div class="ai-panel">
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 输出结果</span></div>
        <div class="ai-result-panel" id="aiCopyResults">${
          isRunning
            ? '<div class="llm-loading"><span>正在生成文案...</span><span class="llm-loading-hint">预计需要30-60秒，请稍候。</span></div>'
            : (__aiCopyResult ? buildAiCopyResultsHtml() : (!configured ? '<div class="llm-error">尚未配置大模型，请先在上方填写并保存。</div>' : '<div class="ai-panel-empty">AI 生成的标题、描述与标签将显示在这里<br>点击结果即可复制</div>'))
        }</div>
      </div>
    </div>`;
}

async function generateAiVideoCopy() {
  if (__aiCopyLoading) return;
  saveAiCopyForm();
  const platform = __aiCopyPlatform;
  const topic = (__aiCopyTopic || '').trim();
  const selling = (__aiCopySelling || '').trim();
  const remark = (__aiCopyRemark || '').trim();
  
  if (!topic) { showToast('请输入选题/主题'); return; }
  
  const cfg = llmConfig || {};
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) { showToast('请先在 AI大模型配置栏 配置 模型接口'); return; }
  if (!__llmQuotaLoaded) await loadLlmQuota();
  if (llmQuotaRemaining('chat') <= 0) { showToast('今日 AI 视频文案专家额度已用尽，明天再来'); return; }
  
  __aiCopyLoading = true;
  __aiCopyResult = null;
  __aiCopyController = new AbortController();
  renderAiCopyResults();
  // 在操作区域显示取消按钮
  const actionsEl = document.getElementById('aiCopyActions');
  if (actionsEl) actionsEl.innerHTML = '<button class="btn-cancel" onclick="cancelAiCopy()">取消</button>';
  // 扣减额度（等请求真正开始前计数，失败时下方 llmQuotaRefund 退还）
  await llmQuotaConsume('chat');

  try {
    const systemPrompt = buildVideoCopyPrompt(platform, topic, selling, remark);
    const reply = await chatRaw(cfg.baseUrl, cfg.apiKey, cfg.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请为${platform}平台生成关于「${topic}」的视频标题、描述、标签文案` }
    ], cfg.temperature, __aiCopyController.signal);
    
    __aiCopyResult = parseVideoCopyResult(reply);
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast('生成失败：' + e.message);
      await llmQuotaRefund('chat');
    }
  }
  
  __aiCopyLoading = false;
  __aiCopyController = null;
  // 检查 DOM 是否存在（可能已切换 tab 再切回，元素已重建）
  if (document.getElementById('aiCopyResults')) {
    renderAiCopyResults();
  }
  // 仍在今日页时恢复开始按钮（切走则由 render 的 busy 判断处理）
  const actionsEl2 = document.getElementById('aiCopyActions');
  if (actionsEl2 && actionsEl2.querySelector('.btn-cancel')) {
    actionsEl2.innerHTML = '<button class="btn-save" onclick="generateAiVideoCopy()">AI 生成描述</button>';
  }
  const qEl = document.getElementById('aiCopyQuota');
  if (qEl) qEl.textContent = '今日 AI 视频文案专家剩余 ' + llmQuotaRemaining('chat') + ' 次';
}

function buildVideoCopyPrompt(platform, topic, sellingPoints, remark) {
  return `你是一名${platform}平台资深新媒体文案专家。请根据以下信息生成视频的标题、描述、标签等文案。

视频主题：${topic}
行业卖点：${sellingPoints || '用户自定'}
用户备注：${remark || '无'}（若填写了画面内容提示、生成风格等要求，请在生成文案时遵循）

请严格按以下格式输出（不要使用任何markdown符号）：

【标题】
标题1
标题2
标题3

【描述】
一段20-50字的视频描述（不包含标签），自然植入关键词，引导用户互动

【标签】
#标签1 #标签2 #标签3 #标签4 #标签5（5-8个，用空格分隔）

要求：
- 标题和描述符合${platform}平台调性（如小红书要种草感、抖音要抓眼球）
- 描述自然流畅抓人眼球，不要生硬堆砌关键词
- 标签精准匹配平台热门话题
- 只输出上述内容，不要输出其他解释和无关内容`;
}

function parseVideoCopyResult(text) {
  const result = { titles: [], description: '', tags: '' };
  
  // 解析标题
  const titleMatch = text.match(/【标题】\s*([\s\S]*?)(?=【描述】|$)/i);
  if (titleMatch) {
    result.titles = titleMatch[1].split('\n').map(l => l.replace(/^\d+[\.\、]\s*/, '').trim()).filter(Boolean).slice(0, 3);
  }
  
  // 解析描述
  const descMatch = text.match(/【描述】\s*([\s\S]*?)(?=【标签】|$)/i);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }
  
  // 解析标签
  const tagMatch = text.match(/【标签】\s*([\s\S]*?)$/i);
  if (tagMatch) {
    result.tags = tagMatch[1].trim();
  }
  
  return result;
}

function buildAiCopyResultsHtml() {
  if (!__aiCopyResult || (!__aiCopyResult.titles.length && !__aiCopyResult.description)) {
    return '';
  }
  
  const r = __aiCopyResult;
  let html = '';
  
  // 标题
  if (r.titles.length) {
    html += '<div style="font-size:12px;color:var(--text3);margin-bottom:6px;font-weight:600;">标题（点击复制）</div>';
    r.titles.forEach(t => {
      html += `<div class="ai-copy-item" onclick="copyAiCopyText('${escapeHtml(t).replace(/'/g, "\\'")}')">${escapeHtml(t)}
      </div>`;
    });
  }
  
  // 描述
  if (r.description) {
    html += '<div style="font-size:12px;color:var(--text3);margin:10px 0 6px;font-weight:600;">视频描述（点击复制）</div>';
    html += `<div class="ai-copy-item" onclick="copyAiCopyText('${escapeHtml(r.description).replace(/'/g, "\\'")}')">${escapeHtml(r.description)}</div>`;
  }
  
  // 标签
  if (r.tags) {
    html += '<div style="font-size:12px;color:var(--text3);margin:10px 0 6px;font-weight:600;">推荐标签（点击复制）</div>';
    html += `<div class="ai-copy-item" onclick="copyAiCopyText('${escapeHtml(r.tags).replace(/'/g, "\\'")}')">${escapeHtml(r.tags)}</div>`;
  }

  html += '<div style="margin-top:10px;text-align:right;"><button class="btn-danger" onclick="clearAiCopyResult()" style="font-size:12px;padding:6px 14px;cursor:pointer;">清空结果</button></div>';

  return html;
}

function renderAiCopyResults() {
  const el = document.getElementById('aiCopyResults');
  if (!el) return;
  
  if (__aiCopyLoading) {
    el.innerHTML = '<div class="llm-loading"><span>正在生成文案...</span><span class="llm-loading-hint">预计需要30-60秒，请稍候。</span></div>';
    return;
  }
  
  el.innerHTML = buildAiCopyResultsHtml();
}

function copyAiCopyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('已复制'));
  } else {
    // 降级方案
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制');
  }
}

function cancelAiCopy() {
  if (__aiCopyController) { __aiCopyController.abort(); __aiCopyController = null; }
  __aiCopyLoading = false;
  renderAiCopyResults();
  // 恢复开始按钮
  const actionsEl = document.getElementById('aiCopyActions');
  if (actionsEl) actionsEl.innerHTML = '<button class="btn-save" onclick="generateAiVideoCopy()">AI 生成描述</button>';
  showToast('已取消生成');
}

// ===== AI 文生视频专家（生成文生视频画面提示词）=====
// 角色：资深文生视频提示词工程师兼导演，把画面描述转化为可直接用于文生视频模型的画面提示词
const VIDEO_GEN_TOOLS = ['Seedance（豆包、即梦）', 'Wan（千问万相）', 'Hailuo（MiniMax）', 'Kling（快手）', 'Sora（OpenAI）', 'Runway', '通用'];
const VIDEO_GEN_STYLES = ['写实', '电影感', '动漫', '3D', '水墨', '国风', '赛博朋克', '其他'];
const VIDEO_GEN_DURATIONS = ['5s', '10s', '15s'];

let __aiVpController = null;
let __aiVpLoading = false;
let __aiVpResult = null;
// 表单值记忆：切页/重渲染后保留工具与内容输入
let __aiVpTool = VIDEO_GEN_TOOLS[VIDEO_GEN_TOOLS.length - 1];  // 默认「通用」
let __aiVpDesc = '';
let __aiVpStyle = '';
let __aiVpDuration = '5s';
function saveAiVpForm() {
  const tool = document.getElementById('aiVpTool');
  const desc = document.getElementById('aiVpDesc');
  const style = document.getElementById('aiVpStyle');
  const duration = document.getElementById('aiVpDuration');
  if (tool) __aiVpTool = tool.value;
  if (desc) __aiVpDesc = desc.value;
  if (style) __aiVpStyle = style.value;
  if (duration) __aiVpDuration = duration.value;
}

// 系统提示词：精准定义角色与六要素解构能力，并按生成工具/风格/时长微调
function buildVideoPromptSystemPrompt(tool, style, duration) {
  const toolNote = {
    'Seedance（豆包、即梦）': 'Seedance（豆包、即梦）：支持自然语言长描述 + 明确镜头语言，写实与影视感强，鼓励详细的场景与运镜描写。',
    'Wan（千问万相）': 'Wan（千问万相）：结构化、标签化的画面要素描述更稳，主语+场景+动作+光线清晰分层。',
    'Hailuo（MiniMax）': 'Hailuo（MiniMax/海螺）：重视电影感与氛围，运镜词（推拉摇移跟）与情绪渲染要具体。',
    'Kling（快手）': 'Kling（快手/可灵）：自然语言描述为主，人物动作与物理规律要合理，避免超现实变形。',
    'Sora（OpenAI）': 'Sora（OpenAI）：支持长文本自然语言描述，擅长复杂场景与电影感画面，物理与光影真实；可一次生成多镜头片段，鼓励详细的环境、动作与运镜描写。',
    'Runway': 'Runway：电影级画质与镜头控制，擅长运动动态与相机语言；以「主体+动作+环境」清晰描述，英文提示词效果最佳。',
    '通用': '通用写法：兼顾各主流文生视频模型，要素完整、措辞直白、无极端特殊语法。'
  }[tool] || '';
  return '你是一名资深文生视频提示词工程师兼影视导演，精通主流文生视频大模型（Seedance/豆包、即梦、Wan/千问万相、Hailuo/MiniMax、Kling/快手、Sora/OpenAI、Runway 等）的提示词写作方法。\n' +
    '你的任务：把用户提供的画面描述或想法，转化为一段可直接粘贴到文生视频工具里的高质量画面提示词。\n' +
    '当前生成工具：' + tool + '。' + toolNote + '\n' +
    '【六要素解构法】写提示词时把画面拆成六个要素逐项落实，缺一不可：\n' +
    '1. 主体：画面主角是什么（人/物/动物/场景主体），外形、穿着、材质、数量等可成像细节\n' +
    '2. 场景环境：背景与所处空间（室内/室外、城市/自然、时代氛围），环境的具体特征\n' +
    '3. 动作动态：主体的运动与状态（用什么动词描述，如"缓缓转身""汽水开盖喷出气泡"），符合物理规律\n' +
    '4. 镜头运动：镜头语言（固定机位/缓慢推近/环绕/跟随/拉升等），以及景别（特写/近景/中景/远景）\n' +
    '5. 光影氛围：光线方向、色温、明暗对比、天气/时段，营造的情绪氛围\n' +
    '6. 风格质感：画面风格（写实/电影感/动漫/3D/水墨/国风/赛博朋克等）与画面质感（胶片颗粒/高清/柔光/景深等）\n' +
    '【写作原则】\n' +
    '- 画面描述必须具体、可成像：明确颜色、材质、光线、构图、视角，杜绝"好看""大气"等抽象模糊词\n' +
    '- 用动词与运动词表达动态，让模型理解画面随时间怎么变化\n' +
    '- 提示词以中英两种自然语言输出（指出推荐使用哪种语言），段落通顺、可直接整段复制使用\n' +
    (style && style !== '其他' ? ('- 画面风格锁定为「' + style + '」，在风格要素中给出对应的风格关键词与质感描述\n') : '') +
    '时长设定：' + (duration || '5s') + '，提示词篇幅必须与时长匹配（中文按字数、英文按单词数），严禁超长：\n' +
    '- 5s：中文 60-100 字 / 英文 40-70 词；单场景、单镜头为主，画面简洁、动作集中\n' +
    '- 10s：中文 100-160 字 / 英文 70-110 词；单场景可含 2-3 个镜头/动作，节奏适中\n' +
    '- 15s：中文 160-260 字 / 英文 110-180 词；可多镜头、有起承转合或镜头切换\n' +
    '【输出要求】严格按以下结构输出（直接输出纯文本，不要使用任何 markdown 符号如 #、**、*）：\n' +
    '【中文画面提示词】\n一段中文画面提示词（含六要素，严格控制在上述时长对应的篇幅内，精炼打磨，可直接粘贴到文生视频工具）\n' +
    '【英文画面提示词】\n一段对应的英文画面提示词（含六要素，严格控制在上述时长对应的篇幅内）\n' +
    '只输出上述两项内容，删除重复与冗余描述，不要输出其他解释、无关内容或参数建议。';
}

// 文生视频专家卡片（生成工具 + 风格 + 时长 + 画面描述，右栏结果）
function renderAiVideoPromptCard() {
  const cfg = llmConfig || {};
  const configured = cfg.baseUrl && cfg.apiKey && cfg.model;
  const isRunning = __aiVpLoading && __aiVpController;
  return `<div class="ai-split">
      <div class="ai-panel">
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 文生视频专家</span>${renderLlmStatusBadge()}</div>
        <div class="ai-panel-body">
          <div class="ai-feature-sub">根据画面内容，生成可直接用于文生视频工具的画面提示词</div>
          <div style="display:flex;gap:10px;">
            <div class="form-group" style="flex:1;margin-bottom:0;"><label>生成工具</label>
              <select id="aiVpTool" ${isRunning ? 'disabled' : ''} onchange="saveAiVpForm()">
                ${VIDEO_GEN_TOOLS.map(t => `<option value="${t}" ${t === __aiVpTool ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:1;margin-bottom:0;"><label>风格（可选）</label>
              <select id="aiVpStyle" ${isRunning ? 'disabled' : ''} onchange="saveAiVpForm()">
                <option value="">自动判断</option>
                ${VIDEO_GEN_STYLES.map(s => `<option value="${s}" ${s === __aiVpStyle ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:1;margin-bottom:0;"><label>时长</label>
              <select id="aiVpDuration" ${isRunning ? 'disabled' : ''} onchange="saveAiVpForm()">
                ${VIDEO_GEN_DURATIONS.map(v => `<option value="${v}" ${v === __aiVpDuration ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group"><label>视频主题 / 画面描述</label>
            <textarea id="aiVpDesc" rows="3" placeholder="想生成的画面内容：如「夏日汽水开盖瞬间，气泡涌出，清凉水珠飞溅，阳光透过瓶身」" ${isRunning ? 'disabled' : ''} oninput="saveAiVpForm()">${escapeHtml(__aiVpDesc || '')}</textarea>
          </div>
          <div class="llm-actions" id="aiVpActions">
            ${isRunning
              ? '<button class="btn-cancel" onclick="cancelAiVideoPrompt()">取消</button>'
              : '<button class="btn-save" onclick="generateAiVideoPrompt()">AI 生成画面提示词</button>'
            }
          </div>
          <div class="llm-chat-quota" id="aiVpQuota">今日 AI 文生视频剩余 ${llmQuotaRemaining('video')} 次</div>
        </div>
      </div>
      <div class="ai-panel">
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 输出结果</span></div>
        <div class="ai-result-panel" id="aiVpResults">${
          isRunning
            ? '<div class="llm-loading"><span>正在生成画面提示词...</span><span class="llm-loading-hint">预计需要30-60秒，请稍候。</span></div>'
            : (__aiVpResult ? buildAiVpResultsHtml() : (!configured ? '<div class="llm-error">尚未配置大模型，请先在上方填写并保存。</div>' : '<div class="ai-panel-empty">生成的中文/英文画面提示词将显示在这里<br>点击即可复制</div>'))
        }</div>
      </div>
    </div>`;
}

async function generateAiVideoPrompt() {
  if (__aiVpLoading) return;
  saveAiVpForm();
  const desc = (__aiVpDesc || '').trim();
  if (!desc) { showToast('请输入视频主题 / 画面描述'); return; }
  const cfg = llmConfig || {};
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) { showToast('请先在AI大模型配置栏 配置 模型接口'); return; }
  if (!__llmQuotaLoaded) await loadLlmQuota();
  if (llmQuotaRemaining('video') <= 0) { showToast('今日 AI 文生视频额度已用尽，明天再来'); return; }

  __aiVpLoading = true;
  __aiVpResult = null;
  __aiVpController = new AbortController();
  renderAiVpResults();
  // 在操作区域显示取消按钮
  const actionsEl = document.getElementById('aiVpActions');
  if (actionsEl) actionsEl.innerHTML = '<button class="btn-cancel" onclick="cancelAiVideoPrompt()">取消</button>';
  // 扣减额度（失败时下方 llmQuotaRefund 退还）
  await llmQuotaConsume('video');

  try {
    const systemPrompt = buildVideoPromptSystemPrompt(__aiVpTool, __aiVpStyle, __aiVpDuration);
    const reply = await chatRaw(cfg.baseUrl, cfg.apiKey, cfg.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '请为以下内容生成文生视频画面提示词：\n' + desc }
    ], cfg.temperature, __aiVpController.signal);
    __aiVpResult = reply;
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast('生成失败：' + e.message);
      await llmQuotaRefund('video');
    }
  }

  __aiVpLoading = false;
  __aiVpController = null;
  if (document.getElementById('aiVpResults')) renderAiVpResults();
  // 恢复开始按钮
  const actionsEl2 = document.getElementById('aiVpActions');
  if (actionsEl2 && actionsEl2.querySelector('.btn-cancel')) {
    actionsEl2.innerHTML = '<button class="btn-save" onclick="generateAiVideoPrompt()">AI 生成画面提示词</button>';
  }
  const qEl = document.getElementById('aiVpQuota');
  if (qEl) qEl.textContent = '今日 AI 文生视频剩余 ' + llmQuotaRemaining('video') + ' 次';
}

// 解析输出：按「中文画面提示词 / 英文画面提示词」两段拆开；模型未按结构输出时兜底整段
function parseVideoPromptResult(text) {
  const r = { zh: '', en: '' };
  const zhMatch = String(text || '').match(/【中文画面提示词】\s*([\s\S]*?)(?=【英文画面提示词】|$)/i);
  if (zhMatch) r.zh = zhMatch[1].trim();
  const enMatch = String(text || '').match(/【英文画面提示词】\s*([\s\S]*?)$/i);
  if (enMatch) r.en = enMatch[1].trim();
  return r;
}

// 点击复制当前项（读取自身文本，避免长文本/换行嵌入 onclick 导致截断）
function copyAiCopyByEl(el) {
  copyAiCopyText((el && el.textContent) || '');
}

function buildAiVpResultsHtml() {
  if (!__aiVpResult) return '';
  const r = parseVideoPromptResult(__aiVpResult);
  let html = '';
  if (r.zh) {
    html += '<div style="font-size:12px;color:var(--text3);margin-bottom:6px;font-weight:600;">中文画面提示词（点击复制）</div>';
    html += `<div class="ai-copy-item" onclick="copyAiCopyByEl(this)">${escapeHtml(r.zh)}</div>`;
  }
  if (r.en) {
    html += '<div style="font-size:12px;color:var(--text3);margin:10px 0 6px;font-weight:600;">英文画面提示词（点击复制）</div>';
    html += `<div class="ai-copy-item" onclick="copyAiCopyByEl(this)">${escapeHtml(r.en)}</div>`;
  }
  if (!r.zh && !r.en) {
    // 兜底：模型未按结构输出时，整段作为可复制块
    html += `<div class="ai-copy-item" onclick="copyAiCopyByEl(this)">${escapeHtml(__aiVpResult)}</div>`;
  }
  html += '<div style="margin-top:10px;text-align:right;"><button class="btn-danger" onclick="clearAiVideoPromptResult()" style="font-size:12px;padding:6px 14px;cursor:pointer;">清空结果</button></div>';
  return html;
}

function renderAiVpResults() {
  const el = document.getElementById('aiVpResults');
  if (!el) return;
  if (__aiVpLoading) {
    el.innerHTML = '<div class="llm-loading"><span>正在生成画面提示词...</span><span class="llm-loading-hint">预计需要30-60秒，请稍候。</span></div>';
    return;
  }
  el.innerHTML = buildAiVpResultsHtml();
}

function clearAiVideoPromptResult() {
  __aiVpResult = null;
  renderAiVpResults();
  showToast('结果已清空');
}

function cancelAiVideoPrompt() {
  if (__aiVpController) { __aiVpController.abort(); __aiVpController = null; }
  __aiVpLoading = false;
  renderAiVpResults();
  // 恢复开始按钮
  const actionsEl = document.getElementById('aiVpActions');
  if (actionsEl) actionsEl.innerHTML = '<button class="btn-save" onclick="generateAiVideoPrompt()">AI 生成画面提示词</button>';
  showToast('已取消生成');
}