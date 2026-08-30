// ===== 安全工具（防 XSS）=====
// 转义 HTML 特殊字符：把 < > & 变成无害文本，防止用户输入被当代码执行
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// 链接安全校验：只允许 http/https 开头，其余一律当作纯文本（防 javascript: 等注入）
function safeUrl(url) {
  if (!url) return '';
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  return '';
}

// ===== 乱码检测（导入/解析后校验，防止非 UTF-8 源数据混入）=====
// 文本是否含 U+FFFD 替换符（非 UTF-8 编码按 UTF-8 解码损坏的典型特征）
function hasCorruptChar(text) {
  if (text === undefined || text === null) return false;
  return String(text).indexOf('\uFFFD') >= 0;
}
// 统计数组中含乱码文本字段的记录数；platform 不在合法平台列表也视为异常
function countCorruptRecords(list, fields) {
  let n = 0;
  (list || []).forEach(r => {
    if (!r || typeof r !== 'object') return;
    let bad = false;
    fields.forEach(f => {
      if (bad) return;
      const v = r[f];
      if (f === 'platform' && v && ALL_PLATFORMS.indexOf(v) === -1) { bad = true; return; }
      if (hasCorruptChar(v)) bad = true;
    });
    if (bad) n++;
  });
  return n;
}

// ===== 视频指标平台适用性（口径基准：导出报表/表格解析/AI 分析/总览汇总统一引用）=====
// （完播率：抖音/快手/视频号；均播时长(秒)：抖音/小红书/视频号；收藏：抖音/快手/小红书；推荐：视频号）
const VIDEO_METRIC_APPLY = {
  '抖音':   { completionRate: true,  avgWatch: true,  favorites: true,  recommend: false },
  '快手':   { completionRate: true,  avgWatch: false, favorites: true,  recommend: false },
  '小红书': { completionRate: false, avgWatch: true,  favorites: true,  recommend: false },
  '视频号': { completionRate: true,  avgWatch: true,  favorites: false, recommend: true },
};
// 汇总用：平台不适用该指标的记录不计入总和（如视频号的收藏），与展示「-」的口径一致
function sumVideoMetric(statsArr, key) {
  return (statsArr || []).reduce((sum, s) => {
    const apply = VIDEO_METRIC_APPLY[s.platform];
    return sum + (apply && apply[key] === false ? 0 : (Number(s[key]) || 0));
  }, 0);
}

// ===== 唯一 ID 生成 =====
// 字符串拼接而非数值加法：Date.now() 量级下浮点小数仅约 4096 个离散值，
// 同一毫秒批量生成（如表格批量导入）会碰撞，导致编辑/删除命中错误记录
let __idSeq = 0;
function genId() {
  return Date.now().toString(36) + '-' + (++__idSeq).toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ===== 月份切换防溢出 =====
// 直接 setMonth 在 29~31 日会跳月（如 8月31日 setMonth(+1) → 10月1日），先固定到 1 日再偏移
function shiftMonth(dateObj, delta) {
  const d = new Date(dateObj.getFullYear(), dateObj.getMonth() + delta, 1);
  dateObj.setTime(d.getTime());
}

// ===== CONFIG =====
const VIDEO_PLATFORMS = ['抖音', '快手', '小红书', '视频号'];
const ALL_PLATFORMS = [...VIDEO_PLATFORMS];
const PLATFORM_SHORT = { '抖音':'抖','快手':'快','小红书':'红','视频号':'视' };

// ===== 数据读写（异步 fetch） =====
// API：GET/POST /api/data/{key}  →  server.js 服务
// 失败时返回空数组（与原 localStorage 行为一致），同时记录失败 key：
// 核心数据加载失败时后续保存会被禁止——否则「服务重启间隙打开页面 → 内存空数组 →
// 一次保存」会把真实数据整体覆盖丢失。
const __failedLoadKeys = new Set();
async function loadData(key) {
  try {
    const res = await fetch('/api/data/' + key);
    if (!res.ok) { __failedLoadKeys.add(key); return []; }
    return await res.json();
  } catch (e) {
    console.warn('[loadData] ' + key + ' 失败:', e);
    __failedLoadKeys.add(key);
    return [];
  }
}

// 核心数据键：这些键加载失败时禁止再写入（防止空/残缺数据覆盖磁盘真实数据）
const CORE_DATA_KEYS = ['contents', 'stats', 'reviews', 'accountStats', 'accountIds'];
function coreDataLoadFailed() {
  return CORE_DATA_KEYS.some(k => __failedLoadKeys.has(k));
}

// 数据未加载横幅（区别于保存失败横幅）：点击可刷新重试
function showDataNotLoadedBanner() {
  if (typeof document === 'undefined' || !document.getElementById || !document.body) return;
  if (document.getElementById('data-not-loaded-banner')) return;
  const div = document.createElement('div');
  div.id = 'data-not-loaded-banner';
  div.innerHTML = '⛔ 后台数据未能加载，已禁止写入以防止覆盖真实数据 —— 请检查服务后点击此横幅刷新页面';
  div.style.cssText = 'position:fixed;top:38px;left:0;right:0;background:#b84c2b;color:#fff;text-align:center;padding:8px;z-index:99999;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer';
  div.onclick = () => location.reload();
  document.body.appendChild(div);
}

// 保存失败提示：写入被后端拒绝（非 2xx / 网络错误）时显示持久横幅，直到后续保存成功才消失。
// 不打断正常流程，但用户能明确看到「改动可能未落盘」，避免静默吞错导致内存与磁盘状态漂移。
let __saveFailedShown = false;
function showSaveFailedBanner(reason) {
  __saveFailedShown = true;
  if (typeof document === 'undefined' || !document.getElementById) return;
  let div = document.getElementById('save-failed-banner');
  if (!div) {
    div = document.createElement('div');
    div.id = 'save-failed-banner';
    div.style.cssText = 'position:fixed;top:38px;left:0;right:0;background:#d97706;color:#fff;text-align:center;padding:8px;z-index:99998;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
    document.body.appendChild(div);
  }
  // 有服务器返回的具体原因（如权限拦截）则原样展示，避免误导去查磁盘
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  div.innerHTML = reason
    ? '⚠️ 保存被拒绝：' + esc(reason)
    : '⚠️ 数据保存失败（后台写入异常），当前改动可能未落盘，请检查后台服务与磁盘空间';
}
function clearSaveFailedBanner() {
  if (!__saveFailedShown) return;
  __saveFailedShown = false;
  if (typeof document === 'undefined' || !document.getElementById) return;
  document.getElementById('save-failed-banner')?.remove();
}

// 串行化同 key 的保存请求（防竞态：先发的请求先到后到达会被覆盖）
const _inflightSaves = {};
async function saveData(key, val) {
  // 核心数据加载失败时禁止写入（防止空数据整体覆盖磁盘真实数据）
  if (CORE_DATA_KEYS.includes(key) && coreDataLoadFailed()) {
    console.warn('[saveData] ' + key + ' 被拒绝：数据未成功加载，禁止写入');
    showDataNotLoadedBanner();
    return;
  }
  // 等待同一 key 的上一次保存完成
  if (_inflightSaves[key]) {
    try { await _inflightSaves[key]; } catch (e) {}
  }
  const p = (async () => {
    const res = await fetch('/api/data/' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(val)
    });
    if (!res.ok) throw new Error(await serverRejectReason(res));
    clearSaveFailedBanner();
  })();
  _inflightSaves[key] = p;
  try { await p; } catch (e) {
    console.warn('[saveData] ' + key + ' 失败:', e);
    showSaveFailedBanner(e.message.startsWith('HTTP ') ? '' : e.message);
  }
  delete _inflightSaves[key];
}

// 批量保存（跨文件原子：后端先写全部 tmp，再全部 rename，失败自动回滚）
// updates: [{ key, val }, ...]
async function saveDataBatch(updates) {
  // 核心数据加载失败时禁止写入（防止空数据整体覆盖磁盘真实数据）
  if (updates.some(u => CORE_DATA_KEYS.includes(u.key)) && coreDataLoadFailed()) {
    console.warn('[saveDataBatch] 被拒绝：数据未成功加载，禁止写入');
    showDataNotLoadedBanner();
    return;
  }
  // 等待所有 key 的未完成保存
  for (const { key } of updates) {
    if (_inflightSaves[key]) {
      try { await _inflightSaves[key]; } catch (e) {}
    }
  }
  const p = (async () => {
    const res = await fetch('/api/data/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error(await serverRejectReason(res));
    clearSaveFailedBanner();
  })();
  // 标记所有 key 为进行中
  updates.forEach(({ key }) => { _inflightSaves[key] = p; });
  try { await p; } catch (e) {
    console.warn('[saveDataBatch] 失败:', e);
    showSaveFailedBanner(e.message.startsWith('HTTP ') ? '' : e.message);
  }
  // 清除标记
  updates.forEach(({ key }) => { delete _inflightSaves[key]; });
}

// 从服务端拒绝响应中提取人类可读原因（权限拦截等），供保存失败横幅展示
async function serverRejectReason(res) {
  try {
    const t = await res.text();
    const jm = t.trim().startsWith('{') ? ((JSON.parse(t).error || {}).message) : null;
    const msg = jm || t.replace(/^\d{3}\s*/, '').trim();
    if (msg) return msg.slice(0, 60) + '（HTTP ' + res.status + '）';
  } catch (e) {}
  return 'HTTP ' + res.status;
}

// ===== STATE（异步初始化） =====
let contents = [];
let stats = [];       // video stats: views/likes/shares/comments
let reviews = [];     // 周/月复盘记录
let accountStats = []; // 视频平台账号总数据快照（投稿/粉丝/播放/点赞/评论/互动）
let accountIds = [];   // 视频平台账号ID（平台 → 账号ID + 备注，静态信息）
let llmConfig = {};     // 大模型接入配置（baseUrl/apiKey/model，存 data/llmConfig.json，不随清空数据删除）

// 备份提醒标记（用 localStorage 即可，无需走 server）
const STORAGE_KEY = 'wb_content_workbench_v2_';

function getToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function isVideo(p) { return VIDEO_PLATFORMS.includes(p); }

// ===== 完成判定（以登记为准，条数累计制）=====
function getPlatformContents(date, platform) {
  return contents.filter(c => c.platform === platform && c.createdAt === date);
}
function getDayCounts(date) {
  const counts = {};
  ALL_PLATFORMS.forEach(p => { counts[p] = getPlatformContents(date, p).length; });
  return counts;
}

function getDayStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// 数据自动迁移：给旧版 stats 补 contentId + title
async function migrateStatsData() {
  let migrated = false;
  stats.forEach(s => {
    if (s.contentId === undefined || s.title === undefined) {
      const c = contents.find(x => x.platform === s.platform && x.createdAt === s.date);
      if (c) {
        if (s.contentId === undefined) s.contentId = c.id;
        if (s.title === undefined) s.title = c.title;
        migrated = true;
      }
    }
    if (s.completionRate === undefined) { s.completionRate = null; migrated = true; }
    if (s.favorites === undefined) { s.favorites = 0; migrated = true; }
    // 小红书数据语义迁移：旧示例数据的 completionRate → avgWatch（小红书官方字段是"人均观看时长"）
    if (s.platform === '小红书' && s.completionRate !== null && s.completionRate !== undefined && s.avgWatch === undefined) {
      s.avgWatch = s.completionRate;
      s.completionRate = null;
      migrated = true;
    }
  });
  if (migrated) {
    await saveData('stats', stats);
  }
}

// 复盘记录迁移：清理示例数据塞的多余字段
async function migrateReviews() {
  let migrated = false;
  reviews.forEach(r => {
    // 视图只存 6 字段：type/period/date/highlights/problems/plans/metrics
    // 旧示例数据塞了 ai 字段，删除
    if (r.ai !== undefined) { delete r.ai; migrated = true; }
  });
  if (migrated) await saveData('reviews', reviews);
}

// 账号数据迁移：旧字段 interactions → shares（互动量改名为总转发/分享）
async function migrateAccountStats() {
  let migrated = false;
  accountStats.forEach(s => {
    if (s.shares === undefined && s.interactions !== undefined) {
      s.shares = s.interactions;
      delete s.interactions;
      migrated = true;
    }
  });
  if (migrated) await saveData('accountStats', accountStats);
}

// ===== 异步初始化（暴露 storeReady 给 app.js 等待） =====
// storeReady：数据加载 + 任务生成 + 数据迁移全部完成后 resolve
window.storeReady = (async () => {
  try {
    // 并行加载数据文件
    [contents, stats, reviews, accountStats, accountIds] = await Promise.all([
      loadData('contents'),
      loadData('stats'),
      loadData('reviews'),
      loadData('accountStats'),
      loadData('accountIds')
    ]);
    // 大模型接入配置独立加载（不参与 importData/清空数据等 7 类数据操作）
    // loadData 对缺失文件返回 []，此处做对象归一化
    {
      const cfg = await loadData('llmConfig');
      llmConfig = (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) ? cfg : {};
    }
    // 数据迁移
    await migrateStatsData();
    await migrateReviews();
    await migrateAccountStats();
    console.log('[store] 初始化完成', {
      contents: contents.length,
      stats: stats.length, reviews: reviews.length,
      accountStats: accountStats.length, accountIds: accountIds.length
    });
  } catch (e) {
    console.error('[store] 初始化失败:', e);
  }
})();

// ===== UI 状态 =====
let currentTab = 'today';
// 工作台分区：仅短视频工作台（'video'）与 AI 功能页（'llm'）
let workspace = 'video';
// 切换分区：'video' ↔ 'llm'（AI 配置与功能页）；从配置页点导航栏会自动回到短视频工作台
function switchWorkspace(w) {
  if (w === 'llm') {
    workspace = 'llm';
    localStorage.setItem(STORAGE_KEY + 'workspace', workspace);
    currentTab = 'today';
    render();
    return;
  }
  workspace = 'video';
  localStorage.setItem(STORAGE_KEY + 'workspace', workspace);
  currentTab = 'today';
  if (reviewPlatformFilter && !VIDEO_PLATFORMS.includes(reviewPlatformFilter)) reviewPlatformFilter = '';
  render();
}
let currentMonth = new Date();
let selectedDate = null;
let reviewPlatformFilter = '';   // 数据复盘平台筛选：''=全部 | 具体平台名
let editId = null;
let overviewMonth = new Date();
let searchKeyword = '';
let contentFilterType = '';
let contentDateFilter = '';   // 内容登记日期筛选：''=全部 | today | yesterday | week | month
let contentSortByViews = '';
let contentPage = 1;             // 内容登记列表当前页码（每页 10 条）
let contentFoldOpen = true;

// 待办页 / 日历页：内容详情展开状态（key = "平台|日期"）
// 保存（编辑/录入数据）后 render() 重绘时据此恢复展开，避免"保存后自动收起"
let expandedTaskKeys = new Set();

// ===== 心跳检测：服务断开时显示横幅 =====
// 策略：每 5 秒定时 ping + 页面切回前台时立即 ping + render 时主动 ping
// 用户每次操作（点击/切换 tab）必然触发 render → 主动检测服务
let __serviceAlive = true;
let __lastPingTime = 0;

async function pingService(force) {
  const now = Date.now();
  if (!force && now - __lastPingTime < 2000) return;  // 2 秒内已 ping 过则跳过
  __lastPingTime = now;
  // 手动超时（不用 AbortSignal.timeout，兼容旧浏览器）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch('/api/data/contents?ping=1', { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error('not ok');
    if (!__serviceAlive) { __serviceAlive = true; hideServiceDeadBanner(); }
  } catch (e) {
    if (__serviceAlive) { __serviceAlive = false; showServiceDeadBanner(); }
  } finally {
    clearTimeout(timer);
  }
}

setInterval(() => pingService(true), 5000);

// 页面切回前台时立即 ping（visibilitychange）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pingService(true);
});

function showServiceDeadBanner() {
  if (document.getElementById('service-dead-banner')) return;
  const div = document.createElement('div');
  div.id = 'service-dead-banner';
  div.innerHTML = '⚠️ 后台服务已断开，请重新启动 <b>ViewStart.bat</b>（数据可能不完整）';
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#e53e3e;color:#fff;text-align:center;padding:10px;z-index:99999;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
  document.body.appendChild(div);
}
function hideServiceDeadBanner() {
  document.getElementById('service-dead-banner')?.remove();
}

// 暴露给 render 使用：用户每次操作时主动 ping
window.pingService = pingService;