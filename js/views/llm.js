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

// AI 视频拆解专家 / AI 视频文案专家 / AI 数据分析专家的每日额度（各自计数，存 data/llmQuota.json 走服务端，清浏览器缓存不影响）
const LLM_DAILY_LIMIT = 20;   // 每类每日上限
const LLM_MAX_CHARS = 3000;   // 单条消息最大字数

let __llmQuota = { date: '', chat: 0, review: 0, dissect: 0 };
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
        dissect: typeof q.dissect === 'number' ? q.dissect : 0
      };
    } else {
      __llmQuota = { date: d, chat: 0, review: 0, dissect: 0 };
    }
    if (__llmQuota.date !== d) __llmQuota = { date: d, chat: 0, review: 0, dissect: 0 };   // 跨天重置
  } catch (e) {
    __llmQuota = { date: d, chat: 0, review: 0, dissect: 0 };
  }
  __llmQuotaLoaded = true;
}
function __quotaKey(type) {
  if (type === 'review') return 'review';
  if (type === 'dissect') return 'dissect';
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
  if (__llmQuota.date !== d) __llmQuota = { date: d, chat: 0, review: 0, dissect: 0 };
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
    ${renderAiVideoDissectCard()}
    ${renderAiVideoCopyCard()}
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

// ===== 底层请求：OpenAI 兼容 chat/completions（经本地服务器 /api/llm/chat 代理转发）=====
// 前端直连会被浏览器跨域（CORS）拦截：千问 token-plan 专属域名（token-plan.*.maas.aliyuncs.com）
// 等不返回 CORS 响应头，浏览器直接 fetch 会报 Failed to fetch；改由本地 Node 服务端转发即可绕过。
async function chatRaw(baseUrl, apiKey, model, messages, temperature, signal) {
  const body = { baseUrl: String(baseUrl).replace(/\/+$/, ''), apiKey: apiKey, model: model, messages: messages };
  // temperature 仅在校验通过（0~2 数字）时透传；未填/无效则不传，避免部分服务端报错
  if (temperature !== undefined && temperature !== null && temperature !== '' && !isNaN(Number(temperature))) {
    body.temperature = Number(temperature);
  }
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
  if (signal) opts.signal = signal;
  const res = await fetch('/api/llm/chat', opts);
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
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 输出结果</span>${aiReviewReply() ? aiReviewHeadButtons() : ''}</div>
        <div class="ai-result-panel" id="overviewAiOutput">${
          isRunning
            ? '<div class="llm-loading"><span>正在按「' + escapeHtml(getAiReviewRange().label) + '」对视频平台进行 AI 数据分析...</span><span class="llm-loading-hint">预计需要1-3分钟（内容量大小），请稍候。</span></div>'
            : aiReviewReply()
              ? '<pre class="llm-reply">' + escapeHtml(aiReviewReply()) + '</pre>'
              : (configured ? '<div class="ai-panel-empty">AI 数据分析专家结果将显示在这里<br>完成后可一键导出 HTML 报表</div>' : '<div class="llm-error">尚未配置大模型，请先在上方填写并保存。</div>')
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
function aiReviewHeadButtons() {
  return '<div style="margin-left:auto;display:flex;gap:6px;">' +
    '<button class="btn-danger" onclick="clearAiReviewReply()" style="font-size:11px;padding:4px 10px;cursor:pointer;">清空</button>' +
    '<button class="btn-save" onclick="exportAiAnalysisToHtml()" style="font-size:11px;padding:4px 10px;background:linear-gradient(135deg,var(--green),#10b981);cursor:pointer;">HTML 导出打印</button>' +
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
    // 重绘页面以刷新结果和标题栏按钮
    render();
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
      render();
      showToast('生成结果已清空');
    }
  });
}

function aiCopyHeadButtons() {
  return '<div style="margin-left:auto;display:flex;gap:6px;">' +
    '<button class="btn-danger" onclick="clearAiCopyResult()" style="font-size:11px;padding:4px 10px;cursor:pointer;">清空</button>' +
    '</div>';
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
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 输出结果</span>${__aiCopyResult ? aiCopyHeadButtons() : ''}</div>
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
  // 重绘页面以刷新结果和标题栏按钮
  render();
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

// ===== AI 视频拆解专家（识别拆解视频 → 去重二创方案）=====
// 多模态：视频直接以 video_url(base64) 发给支持视觉的模型（如 qwen3.7-plus）
// 视频超 20MB 时自动降码率/分辨率压缩（canvas + MediaRecorder 纯前端，不依赖服务器）
const AI_DISSECT_MAX_BYTES = 20 * 1024 * 1024;   // 接口上传上限（按 tokenplan 假设 20MB）
const AI_DISSECT_TARGET_BYTES = 10 * 1024 * 1024; // 压缩目标（10MB：过大时服务端解析多模态文件易超时）

let __aiDissectFile = null;        // 当前选中的视频 File
let __aiDissectMeta = null;        // {size, duration, compressed, note}
let __aiDissectLoading = false;
let __aiDissectCompressing = false; // 压缩进行中（压缩与拆解分离：压缩完成后需再次点击才开始拆解）
let __aiDissectCompressed = null;   // 压缩后的视频 Blob 缓存（拆解时优先使用，避免重复压缩）
let __aiDissectCompressText = '';   // 压缩进度文本（显示在右侧输出结果栏）
let __aiDissectResult = null;
let __aiDissectError = '';         // 拆解失败原因（持久显示在结果栏，避免被后续 toast 覆盖）
let __aiDissectDuration = '30';    // 二创时长（秒，下拉选择）
let __aiDissectStyle = '自动';      // 口播风格（下拉选择：自动/新闻/幽默/干货/犀利/煽情）
let __aiDissectBrand = '';         // 品牌植入（可选）
let __aiDissectNote = '';          // 补充要求（可选，自由文本）
let __aiDissectRunId = 0;          // 自增，防止旧回调污染新状态
let __aiDissectCompressCtrl = null; // 压缩取消控制器（AbortController）

// 取消压缩：中断压缩流程，保留原文件可重新点击压缩
function cancelDissectCompress() {
  if (__aiDissectCompressCtrl) __aiDissectCompressCtrl.abort();
}

function formatBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + 'KB';
  return n + 'B';
}
function formatDuration(s) {
  s = Math.round(s || 0);
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? m + '分' + String(sec).padStart(2, '0') + '秒' : sec + '秒';
}

// 卡片：上传视频 + 输出（与其余 AI 专家一致的双栏布局）
function renderAiVideoDissectCard() {
  const cfg = llmConfig || {};
  const configured = cfg.baseUrl && cfg.apiKey && cfg.model;
  const isRunning = __aiDissectLoading;
  return `<div class="ai-split">
      <div class="ai-panel">
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 视频拆解专家</span>${renderLlmStatusBadge()}</div>
        <div class="ai-panel-body">
          <div class="ai-feature-sub">上传视频，AI 拆解原视频内容并生成去重二创口播稿与分镜画面建议</div>
          <div class="form-group"><label>上传视频</label>
            <div class="upload-zone" id="aiDissectZone" onclick="document.getElementById('aiDissectFile').click()"
              ondragover="event.preventDefault();this.style.borderColor='var(--accent)'"
              ondragleave="this.style.borderColor=''"
              ondrop="event.preventDefault();this.style.borderColor='';if(event.dataTransfer.files.length>0)handleAiDissectFile(event.dataTransfer.files[0])">
              <div class="upload-icon">&#127916;</div>
              <div>${__aiDissectFile ? '已选择：' + escapeHtml(__aiDissectFile.name) : '点击选择视频，或拖拽到此处'}</div>
              ${__aiDissectMeta ? `<div style="font-size:11px;color:var(--text3);margin-top:4px;">${formatBytes(__aiDissectMeta.size)} · ${formatDuration(__aiDissectMeta.duration)}${__aiDissectCompressed ? ' · 已自动压缩 ' + formatBytes(__aiDissectCompressed.size) : (__aiDissectFile && __aiDissectFile.size > AI_DISSECT_MAX_BYTES && !__aiDissectCompressing ? ' · 超 20MB，点击「AI 拆解二创」先压缩' : '')}</div>` : '<div style="font-size:11px;color:var(--text3);margin-top:4px;">支持 mp4/mov/webm 等 · 超过 20MB 自动降码率压缩</div>'}
            </div>
            <input type="file" id="aiDissectFile" accept="video/*" style="display:none;" onchange="handleAiDissectFile(this.files[0])">
          </div>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group"><label>二创时长</label>
              <select ${isRunning ? 'disabled' : ''} onchange="__aiDissectDuration=this.value">
                ${['15', '30', '45', '60', '90'].map(d => `<option value="${d}" ${String(__aiDissectDuration) === d ? 'selected' : ''}>${d} 秒</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>口播风格</label>
              <select ${isRunning ? 'disabled' : ''} onchange="__aiDissectStyle=this.value">
                ${['自动', '新闻', '幽默', '干货', '犀利', '煽情'].map(s => `<option${__aiDissectStyle === s ? ' selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group"><label>品牌植入（可选）</label>
            <input type="text" value="${escapeHtml(__aiDissectBrand || '')}" placeholder="品牌名及方式，如「XX 面膜，中段软植入」" ${isRunning ? 'disabled' : ''} oninput="__aiDissectBrand=this.value">
          </div>
          <div class="form-group"><label>补充要求（可选）</label>
            <input type="text" value="${escapeHtml(__aiDissectNote || '')}" placeholder="其他自定义要求，留空则全权交给 AI" ${isRunning ? 'disabled' : ''} oninput="__aiDissectNote=this.value">
          </div>
          <div class="llm-actions" id="aiDissectActions">
            ${__aiDissectCompressing
              ? '<button class="btn-cancel" onclick="cancelDissectCompress()">取消压缩</button>'
              : isRunning
                ? '<button class="btn-save" disabled>处理中...</button>'
                : '<button class="btn-save" onclick="runAiVideoDissect()">AI 拆解二创</button>'
            }
          </div>
          <div class="llm-chat-quota">今日 AI 视频拆解专家剩余 ${llmQuotaRemaining('dissect')} 次</div>
        </div>
      </div>
      <div class="ai-panel">
        <div class="ai-panel-head"><span class="ai-panel-dot"></span><span class="ai-panel-title">AI 输出结果</span>${__aiDissectResult ? aiDissectHeadButtons() : ''}</div>
        <div class="ai-result-panel">${
          __aiDissectCompressing
            ? '<div class="llm-loading"><span id="aiDissectCompressText">' + escapeHtml(__aiDissectCompressText || '正在压缩视频...（与视频时长同步，请稍候）') + '</span><span class="llm-loading-hint">压缩完成后请再次点击「AI 拆解二创」开始拆解。</span></div>'
            : isRunning
            ? '<div class="llm-loading"><span>正在拆解并生成二创方案...</span><span class="llm-loading-hint">预计需要 1-3 分钟，请稍候。</span></div>'
            : __aiDissectError
              ? '<div class="llm-error">拆解失败：' + escapeHtml(__aiDissectError) + '<br><span style="font-size:11px;color:var(--text3);">可调整参数后重试；若反复失败请检查模型是否支持视频输入</span></div>'
              : __aiDissectResult
              ? '<pre class="llm-reply">' + escapeHtml(__aiDissectResult) + '</pre>'
              : (!configured ? '<div class="llm-error">尚未配置大模型，请先在上方填写并保存。</div>' : '<div class="ai-panel-empty">原视频拆解 + 去重二创口播稿 + 分镜建议将显示在这里</div>')
        }</div>
      </div>
    </div>`;
}
function aiDissectHeadButtons() {
  return '<div style="margin-left:auto;display:flex;gap:6px;">' +
    '<button class="btn-danger" onclick="clearAiVideoDissectResult()" style="font-size:11px;padding:4px 10px;cursor:pointer;">清空</button>' +
    '</div>';
}

// 选择视频：读取时长元数据，超 20MB 立即开始自动压缩
function handleAiDissectFile(file) {
  if (!file) return;
  if (!/^video\//.test(file.type) && !/\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(file.name)) {
    showToast('请选择视频文件（mp4/mov/webm 等）');
    return;
  }
  const runId = ++__aiDissectRunId;
  __aiDissectFile = file;
  __aiDissectResult = null;
  __aiDissectError = '';
  __aiDissectLoading = false;
  __aiDissectCompressing = false;
  __aiDissectCompressed = null;   // 新文件需重新压缩
  __aiDissectCompressText = '';
  __aiDissectMeta = { size: file.size, duration: 0, compressed: false, note: '' };
  // 读时长
  const url = URL.createObjectURL(file);
  const vid = document.createElement('video');
  vid.preload = 'metadata';
  vid.onloadedmetadata = () => {
    if (runId !== __aiDissectRunId) return;
    __aiDissectMeta.duration = vid.duration || 0;
    URL.revokeObjectURL(url);
    render();
    showToast('视频已选择' + (file.size > AI_DISSECT_MAX_BYTES ? '，超过 20MB，点击分析时将自动压缩' : ''));
  };
  vid.onerror = () => {
    if (runId !== __aiDissectRunId) return;
    URL.revokeObjectURL(url);
    __aiDissectMeta.duration = 0;
    render();
    showToast('读取视频信息失败，但可在分析时尝试');
  };
  vid.src = url;
}

// ===== ffmpeg.wasm 压缩（比 MediaRecorder 实时录制快数倍；CDN 按需加载，仅首次需下载）=====
let __ffmpegLoading = null;   // 加载中 promise 缓存（防并发重复加载）
const FFMPEG_BASE = 'https://cdn.jsdelivr.net/npm';
function loadFfmpeg() {
  if (window.__ffmpegInstance) return Promise.resolve(window.__ffmpegInstance);
  if (__ffmpegLoading) return __ffmpegLoading;
  __ffmpegLoading = (async () => {
    const loadScript = src => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('压缩引擎脚本加载失败'));
      document.head.appendChild(s);
    });
    if (!window.FFmpegWASM) await loadScript(FFMPEG_BASE + '/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
    if (!window.FFmpegUtil) await loadScript(FFMPEG_BASE + '/@ffmpeg/util@0.12.1/dist/umd/index.js');
    const { FFmpeg } = window.FFmpegWASM;
    const { toBlobURL } = window.FFmpegUtil;
    const coreBase = FFMPEG_BASE + '/@ffmpeg/core@0.12.6/dist/umd';
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      classWorkerURL: await toBlobURL(FFMPEG_BASE + '/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js', 'text/javascript'),
      coreURL: await toBlobURL(coreBase + '/ffmpeg-core.js', 'text/javascript'),
      wasmURL: await toBlobURL(coreBase + '/ffmpeg-core.wasm', 'application/wasm')
    });
    window.__ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();
  // 加载失败时清缓存，允许下次重试（否则永远拿失败的 promise）
  __ffmpegLoading.catch(() => { __ffmpegLoading = null; });
  return __ffmpegLoading;
}

// ffmpeg 压缩：按时长算码率（目标 18MB 内）+ 限宽 720/1280 + 24fps + ultrafast 快速编码
async function compressVideoWithFfmpeg(file, durationSec, onProgress, signal) {
  if (signal && signal.aborted) throw new DOMException('已取消', 'AbortError');
  const ffmpeg = await loadFfmpeg();
  const onAbort = () => {
    try { ffmpeg.terminate(); } catch (e) {}   // 硬终止：exec promise 立即 reject
    window.__ffmpegInstance = null;            // terminate 后实例不可复用，下次重建
    __ffmpegLoading = null;                    // 同步清加载缓存（否则永远拿到已 terminate 的实例）
  };
  signal.addEventListener('abort', onAbort);
  try {
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
    const inName = 'in.' + (ext || 'mp4');
    const outName = 'out.mp4';
    await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    if (signal && signal.aborted) throw new DOMException('已取消', 'AbortError');
    // 码率与回退方案同口径：预算 10MB 反推（过大服务端解析易超时）
    const audioBit = 64000;
    const videoBit = Math.max(200000, Math.min(1500000, AI_DISSECT_TARGET_BYTES * 8 / Math.max(durationSec, 10) - audioBit));
    const maxW = durationSec > 180 ? 540 : 960;
    const vf = "scale='min(" + maxW + ",iw)':-2";
    const progressHandler = ({ progress }) => {
      if (onProgress && progress > 0 && progress <= 1) onProgress(progress);
    };
    ffmpeg.on('progress', progressHandler);
    let execErr = null;
    try {
      await ffmpeg.exec([
        '-i', inName,
        '-vf', vf, '-r', '15',
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-b:v', String(Math.round(videoBit)), '-maxrate', String(Math.round(videoBit * 1.45)), '-bufsize', String(Math.round(videoBit * 2.9)),
        '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', '-y', outName
      ]);
    } catch (e) { execErr = e; }
    ffmpeg.off('progress', progressHandler);
    try { await ffmpeg.deleteFile(inName); } catch (e) {}
    if (signal && signal.aborted || execErr) {
      try { await ffmpeg.deleteFile(outName); } catch (e) {}
      if (signal && signal.aborted) throw new DOMException('已取消', 'AbortError');
      throw execErr || new Error('压缩执行失败');
    }
    const data = await ffmpeg.readFile(outName);
    try { await ffmpeg.deleteFile(outName); } catch (e) {}
    if (signal && signal.aborted) throw new DOMException('已取消', 'AbortError');
    return new Blob([data.buffer], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// 纯前端压缩：canvas 缩放 + captureStream + MediaRecorder 低码率重录（mp4→webm 根据浏览器能力）
function pickRecorderMime() {
  if (!window.MediaRecorder) return '';
  const c = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  for (const m of c) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
  return '';
}

async function compressVideoBlob(blob, onProgress, signal) {
  if (signal && signal.aborted) throw new DOMException('已取消', 'AbortError');
  const url = URL.createObjectURL(blob);
  const vid = document.createElement('video');
  vid.muted = true;
  vid.playsInline = true;
  vid.preload = 'auto';
  await new Promise((resolve, reject) => {
    vid.onloadedmetadata = resolve;
    vid.onerror = () => reject(new Error('无法读取视频文件'));
    vid.src = url;
  });
  const duration = vid.duration || 0;
  if (!duration) { URL.revokeObjectURL(url); return blob; }
  // 按时长估算码率：预算给 18MB，按 (bitrate+audioBitrate) 反推
  const budgetBits = AI_DISSECT_TARGET_BYTES * 8;
  const audioBit = 64000;
  const durationSec = Math.max(duration, 10);
  const videoBit = Math.max(200000, Math.min(2500000, budgetBits / durationSec - audioBit));
  // 分辨率：短视频保留 720p；长视频降 480p；竖屏按宽约束
  const maxW = duration > 180 ? 720 : 1280;
  const scale = Math.min(1, maxW / vid.videoWidth);
  const w = Math.max(2, Math.round(vid.videoWidth * scale / 2) * 2);
  const h = Math.max(2, Math.round(vid.videoHeight * scale / 2) * 2);
  const fps = 24;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const canvasStream = canvas.captureStream(fps);
  // 尝试带上原始音轨（部分浏览器 captureStream 含音频）
  let stream = canvasStream;
  try {
    const native = vid.captureStream();
    const audioTracks = native.getAudioTracks();
    if (audioTracks.length) {
      stream = new MediaStream([canvasStream.getVideoTracks()[0], ...audioTracks]);
    }
  } catch (e) {}
  const mime = pickRecorderMime();
  if (!mime) { URL.revokeObjectURL(url); throw new Error('当前浏览器不支持视频转码，请换 Chrome/Edge'); }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(videoBit), audioBitsPerSecond: audioBit });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(resolve => { rec.onstop = () => resolve(); });
  // 取消：暂停播放 + 停止录制，让下方 ended 等待尽快返回
  const onAbort = () => { try { vid.pause(); } catch (e) {} try { if (rec.state !== 'inactive') rec.stop(); } catch (e) {} };
  if (signal) signal.addEventListener('abort', onAbort);
  // 绘制循环：逐帧画到 canvas
  let raf = 0;
  const draw = () => {
    if (!vid.paused && !vid.ended) {
      ctx.drawImage(vid, 0, 0, w, h);
      if (onProgress) onProgress(Math.min(0.99, (vid.currentTime || 0) / duration));
    }
    raf = requestAnimationFrame(draw);
  };
  await vid.play().catch(() => {});
  rec.start(500);
  draw();
  await new Promise(resolve => {
    vid.addEventListener('ended', resolve);
    vid.addEventListener('error', resolve);
    if (signal) signal.addEventListener('abort', resolve);
  });
  cancelAnimationFrame(raf);
  if (!(signal && signal.aborted)) await new Promise(r => setTimeout(r, 500));   // 录尾帧缓冲
  try { if (rec.state !== 'inactive') rec.stop(); } catch (e) {}
  await stopped;
  if (signal) signal.removeEventListener('abort', onAbort);
  URL.revokeObjectURL(url);
  if (signal && signal.aborted) throw new DOMException('已取消', 'AbortError');
  return new Blob(chunks, { type: mime });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// 系统提示词：固定输出结构 + 按表单选项分位置注入（时长→口播稿规则 / 风格→创作要求 / 品牌→植入要求）；自由补充走用户消息
function buildVideoDissectPrompt(durationSec, style, brand) {
  const styleText = {
    '自动': '口播风格根据原视频调性自动匹配最合适的一种',
    '新闻': '口播风格为新闻播报腔：客观正式、字正腔圆、信息感强',
    '幽默': '口播风格为幽默搞笑：轻松玩梗、有网感、节奏明快',
    '干货': '口播风格为专业干货：条理清晰、信息密度高、像行业老手分享经验',
    '犀利': '口播风格为犀利点评：观点鲜明、言辞直接、一针见血',
    '煽情': '口播风格为煽情共鸣：情感渲染、故事化叙述、引发共情'
  }[style] || '口播风格根据原视频调性自动匹配最合适的一种';
  const brandLine = (brand && brand.trim())
    ? '品牌植入：将「' + brand.trim() + '」自然融入口播稿（开头口播/中段软植入/结尾引导均可，不生硬不堆砌），并在画面建议中给出对应植入画面。\n'
    : '';
  return '你是一名资深的短视频二创导演兼内容拆解专家，擅长拆解爆款视频的构成并产出可落地的去重二创方案。\n' +
    '请分析用户提供的视频（可识别画面、镜头、字幕、口播内容），输出以下三部分内容（纯文本，不要使用任何 markdown 符号如 #、**、*）：\n' +
    '【原视频拆解】\n' +
    '时长：视频总时长\n' +
    '主题：用一两句话概括核心主题，并简要介绍内容亮点。\n' +
    '【二创口播稿+字幕】\n' +
    '总时长为 ' + durationSec + ' 秒，以 5-10 秒为一段切分为多段，逐段输出该段落的配音字幕（每段字幕时长与段长匹配）。' + styleText + '。去重原则：保留原视频核心信息点，但换表达不换内核——叙述视角、语言风格、信息组织顺序均需调整，避免与原视频文案雷同；开头段落要有钩子，结尾段落要有引导互动。\n' +
    brandLine +
    '【二创画面建议】\n' +
    '与口播稿分段一一对应，以 5-10 秒为一段切分（共几段以口播稿总时长为准，不固定段数），逐段给出：画面建议（场景/人物动作/运镜/素材类型）、口播字幕、转场或音效提示。表述要具体可直接照着拍或剪。\n' +
    '只输出上述三个部分，不要输出其他解释或无关内容。';
}

// 主流程（两阶段分离）：
// 阶段一：视频超 20MB 且未压缩过 → 仅压缩（不扣额度），完成后提示再次点击
// 阶段二：拆解（优先用已压缩的缓存，即使压缩后仍超限也直接尝试发送，不会循环压缩）
async function runAiVideoDissect() {
  if (__aiDissectLoading || __aiDissectCompressing) return;
  const cfg = llmConfig || {};
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) { showToast('请先在 AI大模型配置栏 配置 模型接口'); return; }
  if (!__aiDissectFile) { showToast('请先选择视频文件'); return; }
  if (!__llmQuotaLoaded) await loadLlmQuota();
  if (llmQuotaRemaining('dissect') <= 0) { showToast('今日 AI 视频拆解专家额度已用尽，明天再来'); return; }

  const runId = ++__aiDissectRunId;

  // ===== 阶段一：超 20MB 且尚无压缩缓存 → 弹窗确认后再压缩 =====
  if (!__aiDissectCompressed && __aiDissectFile.size > AI_DISSECT_MAX_BYTES) {
    showConfirm({
      title: '视频超过大小限制',
      desc: '当前视频 ' + formatBytes(__aiDissectFile.size) + '，超过接口 20MB 上限，需要先压缩（降码率+降分辨率，与视频时长同步）。压缩完成后需再次点击「AI 拆解二创」开始拆解。是否继续？',
      okText: '继续',
      onOk: () => runDissectCompressStage(runId)
    });
    return;
  }

  // ===== 阶段二：拆解（用压缩缓存或原文件）=====
  __aiDissectLoading = true;
  __aiDissectResult = null;
  __aiDissectError = '';
  render();
  await llmQuotaConsume('dissect');

  try {
    const blob = __aiDissectCompressed || __aiDissectFile;
    const b64 = await blobToBase64(blob);
    // blob.type 可能带编码参数（如 video/mp4;codecs=avc1...），data URL 只保留主类型，避免 API 解析失败
    let type = (blob.type && blob.type !== '' && blob.type !== 'application/octet-stream') ? blob.type : 'video/mp4';
    type = String(type).split(';')[0].trim() || 'video/mp4';
    const sendReq = () => chatRaw(cfg.baseUrl, cfg.apiKey, cfg.model, [
      { role: 'system', content: buildVideoDissectPrompt(__aiDissectDuration, __aiDissectStyle, __aiDissectBrand) },
      { role: 'user', content: [
        { type: 'text', text: '请拆解分析这个视频，并按你的输出规范给出去重二创方案。' + (__aiDissectNote && __aiDissectNote.trim() ? '补充要求（请务必落实）：' + __aiDissectNote.trim() : '') },
        { type: 'video_url', video_url: { url: 'data:' + type + ';base64,' + b64 } }
      ]}
    ], cfg.temperature);
    let reply;
    try {
      reply = await sendReq();
    } catch (e) {
      // 服务端解析多模态文件偶发超时：自动重试一次（重试前检查是否已被新任务取代）
      if (runId !== __aiDissectRunId) throw e;
      if (!/timed?\s*out|timeout/i.test(String(e && e.message))) throw e;
      showToast('服务端处理超时，自动重试一次...');
      reply = await sendReq();
    }
    if (runId !== __aiDissectRunId) return;
    __aiDissectResult = reply;
    __aiDissectLoading = false;
    render();
    showToast('分析完成');
  } catch (e) {
    if (runId !== __aiDissectRunId) return;
    __aiDissectLoading = false;
    if (e.name !== 'AbortError') {
      __aiDissectError = e.message;   // 失败原因持久显示在结果栏（toast 会被后续提示覆盖）
      render();
      showToast('拆解失败');
      await llmQuotaRefund('dissect');
    } else {
      render();
    }
  }
}

// 压缩阶段（确认弹窗后调用）：压缩完成后不自动拆解，提示用户再次点击；支持取消
// 优先 ffmpeg.wasm（快数倍）；加载失败/环境不支持时自动回退 MediaRecorder 实时录制
async function runDissectCompressStage(runId) {
  __aiDissectCompressing = true;
  __aiDissectCompressText = '视频 ' + formatBytes(__aiDissectFile.size) + '，正在压缩...';
  render();
  const ctrl = new AbortController();
  __aiDissectCompressCtrl = ctrl;
  const setProg = t => {
    __aiDissectCompressText = t;
    const el = document.getElementById('aiDissectCompressText');
    if (el) el.textContent = t;   // 进度直接更新 DOM，不触发重绘
  };
  const durationSec = (__aiDissectMeta && __aiDissectMeta.duration) || 0;
  try {
    let out;
    try {
      setProg('正在加载压缩引擎（首次需下载约 30MB，仅此一次）...');
      out = await compressVideoWithFfmpeg(__aiDissectFile, durationSec, p => {
        setProg('正在压缩视频... ' + Math.round(p * 100) + '%（ffmpeg 加速）');
      }, ctrl.signal);
    } catch (e) {
      if (ctrl.signal.aborted) throw e;   // 用户取消：直接走取消流程
      showToast('压缩引擎加载失败，已回退实时压缩（较慢）');
      setProg('压缩引擎不可用，回退浏览器实时压缩（较慢，与视频时长同步）...');
      out = await compressVideoBlob(__aiDissectFile, p => {
        setProg('正在压缩视频... ' + Math.round(p * 100) + '%（与视频时长同步）');
      }, ctrl.signal);
    }
    if (runId !== __aiDissectRunId) return;
    __aiDissectCompressed = out;
    __aiDissectMeta.compressed = true;
    __aiDissectCompressing = false;
    __aiDissectCompressText = '';
    render();
    showToast(out.size > AI_DISSECT_MAX_BYTES
      ? '压缩后仍超 20MB（' + formatBytes(out.size) + '），再次点击「AI 拆解二创」将尝试直接发送'
      : '压缩完成（' + formatBytes(out.size) + '），再次点击「AI 拆解二创」开始拆解');
  } catch (e) {
    if (runId !== __aiDissectRunId) return;
    __aiDissectCompressing = false;
    __aiDissectCompressText = '';
    render();
    if (e.name === 'AbortError') showToast('已取消压缩');
    else showToast('压缩失败：' + e.message);
  }
  __aiDissectCompressCtrl = null;
}

function clearAiVideoDissectResult() {
  __aiDissectResult = null;
  __aiDissectError = '';
  render();
  showToast('结果已清空');
}

