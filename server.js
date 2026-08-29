// ===== 数据服务（本机 / 内网部署两用） =====
// 功能：静态文件服务 + JSON 数据读写 API（替代 localStorage）+ LLM 代理
// 端口：3000（可用环境变量 PORT 覆盖）
// 存储：./data/*.json（每个 key 一个文件，写入均原子替换并轮转 .bak 备份）
// 依赖：仅 Node.js 内置模块
//
// 安全模型（部署到服务器给多人使用时务必阅读）：
//  - 默认绑定 127.0.0.1 仅本机可访问；需要外部访问时设 MCB_LAN=1（或用反向代理），
//    并强烈建议同时设置 ACCESS_TOKEN 开启访问令牌，否则任何能连到端口的人都可读写全部数据。
//  - ACCESS_TOKEN=xxx 时全站需认证：浏览器访问 /__login 输入令牌（存 HttpOnly+SameSite=Strict Cookie，
//    跨站请求不携带 → 同时免疫 CSRF）；也可用 ?token=xxx 或 Authorization: Bearer xxx。
//  - MCB_ALLOWED_HOSTS：允许的 Host 头列表（逗号分隔，默认 localhost,127.0.0.1），
//    防御 DNS rebinding；服务器部署时设为对外域名/IP。
//  - LLM 的 API Key 只存服务端 data/llmConfig.json，GET 接口只返回脱敏结果（hasKey 标记），
//    /api/llm/chat 请求缺 key 时自动用服务端保存的配置兜底 → 同事浏览器无需配置即可用 AI。

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
// 安全：默认仅本机可访问（绑定 127.0.0.1）。部署给多人使用时的推荐架构：
//   nginx（auth_basic 每人一个账号，注入 X-Remote-User 头）→ 反代到本机 127.0.0.1:3000
//   服务端保持 127.0.0.1 绑定，外部无法绕过 nginx 直连（身份头不可伪造）
const HOST = process.env.MCB_LAN === '1' ? undefined : '127.0.0.1';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const ALLOWED_HOSTS = (process.env.MCB_ALLOWED_HOSTS || 'localhost,127.0.0.1')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// 多用户模式：MCB_MULTIUSER=1 时按 nginx 注入的 X-Remote-User 头识别登录者，
// 数据存 data/users/<用户名>/*.json 相互隔离；llmConfig（共享 AI Key）与审计日志为全局。
// MCB_DEFAULT_USER：首次启用时，data/ 根下已有的旧数据自动迁移到该用户名下（默认 admin）。
const MULTIUSER = process.env.MCB_MULTIUSER === '1';
const DEFAULT_USER = (process.env.MCB_DEFAULT_USER || 'admin').replace(/[^a-zA-Z0-9_-]/g, '') || 'admin';
// 共享 AI 配置（llmConfig）的管理员名单：多用户模式下只有名单内用户可修改/清空
// （Key 全员共用，若任何人可改 baseUrl，等于可以把全员共享的 Key 引到自己控制的服务器）
const ADMIN_USERS = (process.env.MCB_ADMIN_USERS || DEFAULT_USER)
  .split(',').map(s => s.trim().replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean);
function isAdminUser(user) { return ADMIN_USERS.includes(user); }
const DATA_DIR = path.resolve(process.env.MCB_DATA_DIR || path.join(__dirname, 'data'));
const USERS_DIR = path.join(DATA_DIR, 'users');
// 各写接口请求体上限
const LIMIT_DATA = 10 * 1024 * 1024;   // 单 key / batch 写入
const LIMIT_LLM = 2 * 1024 * 1024;     // LLM 消息体

// 首次启动自动创建数据目录
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// ===== 静态资源内容指纹（替代手动 ?v= 版本号）=====
// 每次请求 index.html 时按文件当前内容实时计算哈希指纹并注入 ?v=：
//   文件内容变了 → 指纹变 → URL 变 → 浏览器必然重新下载
//   文件没变    → 指纹不变 → URL 不变 → 浏览器放心用缓存
// 服务运行中改代码也立即生效（无需重启）；js/css 共 13 个文件，计算开销毫秒级。
const assetHashes = {};
function collectAssetHashes() {
  const hashes = {};
  const walk = (dir, base) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = base ? base + '/' + name : name;
      if (fs.statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        const hash = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex').slice(0, 10);
        hashes[rel] = hash;
      }
    }
  };
  walk(path.join(__dirname, 'js'), 'js');
  walk(path.join(__dirname, 'css'), 'css');
  return hashes;
}

// 把 HTML 里 <script src> / <link href> 的 ?v= 替换为内容指纹
function injectAssetHashes(html) {
  const hashes = collectAssetHashes();
  Object.assign(assetHashes, hashes);
  return html.replace(/(src|href)="([^"]+\.(?:js|css))(?:\?v=[^"]*)?"/g, (m, attr, file) => {
    const hash = hashes[file];
    return hash ? `${attr}="${file}?v=${hash}"` : m;
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

// ===== 通用辅助 =====

// 恒定时间字符串比较（令牌校验用，避免时序侧信道）
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

function isJsonContentType(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
  return ct === 'application/json';
}

// 读请求体，超限直接 413 并返回 null（调用方据此终止）
function readBody(req, res, limit) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0, done = false;
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('413 Payload Too Large');
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', () => { if (!done) { done = true; resolve(null); } });
  });
}

// ===== 写入：全局串行 + 原子替换 + .bak 轮转 =====
// 所有写（单 key 与 batch）进同一条 promise 链串行执行，杜绝多请求/多用户并发交错；
// tmp 文件名带随机后缀，避免共享固定 .tmp 路径被并发写坏；rename 前把旧文件复制为 .bak（保留一代）。
let writeChain = Promise.resolve();
function enqueueWrite(fn) {
  const run = writeChain.catch(() => {}).then(fn);
  writeChain = run;
  return run;
}
function uniqueTmp(target) {
  return target + '.' + process.pid + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
}
function atomicWrite(target, content) {
  const tmp = uniqueTmp(target);
  fs.writeFileSync(tmp, content);
  try { if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak'); } catch (e) { /* 备份失败不阻塞写入 */ }
  fs.renameSync(tmp, target);
}
function readDataFile(key, baseDir) {
  const p = path.join(baseDir || DATA_DIR, key + '.json');
  try { return fs.readFileSync(p, 'utf-8'); } catch (e) { return null; }
}

// ===== 多用户模式 =====
// key 的归属目录：llmConfig（共享 AI Key）固定全局；多用户模式其余（含 llmQuota 额度、
// 导入快照）按用户隔离；单用户模式一律用根目录
function userDir(user) { return path.join(USERS_DIR, user); }
function keyBaseDir(key, user) {
  if (key === 'llmConfig') return DATA_DIR;
  return (MULTIUSER && user) ? userDir(user) : DATA_DIR;
}
function ensureUserDir(user) {
  const dir = userDir(user);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
// 审计日志：记录谁在什么时候写了什么（登录记录由 nginx access.log 提供）
function auditLog(user, action, detail) {
  try {
    fs.appendFileSync(path.join(DATA_DIR, 'activity.log'),
      '[' + new Date().toISOString() + '] user=' + (user || '-') + ' action=' + action + ' ' + (detail || '') + '\n');
  } catch (e) { /* 日志失败不影响主流程 */ }
}
// 首次启用多用户模式时，把 data/ 根下已有的旧数据（llmConfig 除外）迁移到默认用户名下
function migrateRootDataToDefaultUser() {
  if (!MULTIUSER) return;
  ensureUserDir(DEFAULT_USER);
  const defDir = userDir(DEFAULT_USER);
  let moved = 0;
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json') || name === 'llmConfig.json') continue;
    const src = path.join(DATA_DIR, name);
    const dst = path.join(defDir, name);
    try {
      if (fs.statSync(src).isFile() && !fs.existsSync(dst)) {
        fs.renameSync(src, dst);
        moved++;
      }
    } catch (e) { console.warn('迁移失败:', name, e.message); }
  }
  if (moved > 0) console.log(`✓ 已将 ${moved} 个旧数据文件迁移到默认用户「${DEFAULT_USER}」名下`);
}

// llmConfig 写入预处理：apiKey 为空字符串 = 保留已存 Key（页面从不回显真实 Key）；
// 空对象（清空配置）则整体清除；hasKey 永不落盘（由 GET 动态计算）
function prepareLlmConfigWrite(rawText) {
  let val;
  try { val = JSON.parse(rawText); } catch (e) { return rawText; }
  if (!val || typeof val !== 'object' || Array.isArray(val)) return rawText;
  if (val.apiKey === '') {
    try {
      const old = JSON.parse(readDataFile('llmConfig') || 'null');
      if (old && typeof old.apiKey === 'string') val.apiKey = old.apiKey;
    } catch (e) { /* 旧配置不存在则无法保留 */ }
  }
  delete val.hasKey;
  return JSON.stringify(val);
}

// llmConfig 读取脱敏：永不返回 apiKey，仅以 hasKey 标记是否已配置
function maskLlmConfig(rawText) {
  let obj;
  try { obj = JSON.parse(rawText || '{}'); } catch (e) { return {}; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const masked = Object.assign({}, obj);
  masked.hasKey = typeof masked.apiKey === 'string' && masked.apiKey.length > 0;
  delete masked.apiKey;
  return masked;
}

// ===== 登录页（仅 ACCESS_TOKEN 模式使用） =====
const LOGIN_PAGE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>访问验证</title></head>' +
  '<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;' +
  'min-height:100vh;margin:0;background:#0e1a28;color:#e8f1fa;">' +
  '<form method="POST" action="/__login" style="background:#152739;padding:32px;border-radius:14px;' +
  'box-shadow:0 8px 28px rgba(0,0,0,.45);width:280px;">' +
  '<h2 style="margin:0 0 8px;font-size:18px;">新媒体数据工作台</h2>' +
  '<p style="margin:0 0 16px;font-size:12px;color:#7e9ab5;">请输入访问令牌</p>' +
  '__ERR__' +
  '<input type="password" name="token" autofocus required placeholder="访问令牌" ' +
  'style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #224262;' +
  'background:#0e1a28;color:#e8f1fa;font-size:14px;margin-bottom:12px;">' +
  '<button type="submit" style="width:100%;padding:10px;border:none;border-radius:8px;' +
  'background:#4aa3ea;color:#071422;font-weight:600;font-size:14px;cursor:pointer;">进入</button>' +
  '</form></body></html>';

function loginPage(err) {
  return LOGIN_PAGE.replace('__ERR__', err
    ? '<p style="margin:0 0 12px;font-size:12px;color:#ef7b5a;">令牌错误，请重试</p>'
    : '');
}

const server = http.createServer(async (req, res) => {
  // 统一加 nosniff，杜绝浏览器对响应内容做 MIME 嗅探
  const _writeHead = res.writeHead.bind(res);
  res.writeHead = (code, headers) => _writeHead(code, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers));

  try {
    const url = req.url.split('?')[0]; // 去掉 query string

    // 安全：Host 白名单（防御 DNS rebinding；部署时用 MCB_ALLOWED_HOSTS 加上对外域名/IP）
    const hostName = String(req.headers.host || '').split(':')[0].trim().toLowerCase();
    if (!hostName || !ALLOWED_HOSTS.includes(hostName)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    // 安全：访问令牌（设置 ACCESS_TOKEN 环境变量后启用；/__login 本身豁免）
    if (ACCESS_TOKEN) {
      if (url === '/__login') {
        if (req.method === 'POST') {
          const body = await readBody(req, res, 4096);
          if (body === null) return;
          const m = String(body).match(/(^|&)token=([^&]*)/);
          const supplied = m ? decodeURIComponent(m[2].replace(/\+/g, ' ')) : '';
          if (supplied && safeEqual(supplied, ACCESS_TOKEN)) {
            res.writeHead(302, {
              'Set-Cookie': 'mcb_token=' + encodeURIComponent(ACCESS_TOKEN) +
                '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000',
              'Location': '/'
            });
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(loginPage(true));
          }
          return;
        }
        // GET /__login：已带正确令牌则直接进首页
        if (safeEqual(parseCookies(req).mcb_token, ACCESS_TOKEN)) {
          res.writeHead(302, { 'Location': '/' });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPage(false));
        return;
      }
      // 令牌来源优先级：Cookie → Authorization: Bearer → ?token=
      const q = req.url.split('?')[1] || '';
      const qToken = (q.match(/(^|&)token=([^&]*)/) || [])[2];
      const supplied = parseCookies(req).mcb_token ||
        String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
        (qToken ? decodeURIComponent(qToken) : '');
      if (!supplied || !safeEqual(supplied, ACCESS_TOKEN)) {
        if (url.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { message: '未认证' } }));
        } else {
          res.writeHead(302, { 'Location': '/__login' });
          res.end();
        }
        return;
      }
    }

    // ===== 多用户模式：从反代注入的 X-Remote-User 识别登录者 =====
    // 该头只能来自本机反代（服务绑定 127.0.0.1，外部无法直连伪造），缺头一律拒绝
    let currentUser = '';
    if (MULTIUSER) {
      const user = String(req.headers['x-remote-user'] || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('401 需经 nginx 认证访问（未收到 X-Remote-User 头）');
        return;
      }
      currentUser = user;
      ensureUserDir(user);
    }

    // API：GET /api/me → 当前登录用户（前端顶栏展示）
    if (req.method === 'GET' && url === '/api/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: currentUser }));
      return;
    }

    // API：GET /api/data/{key} → 读取（llmConfig 脱敏且全局共享；其余按用户隔离）
    if (req.method === 'GET' && url.startsWith('/api/data/')) {
      const key = url.replace('/api/data/', '').replace(/[^a-zA-Z0-9_]/g, '');
      if (!key) { res.writeHead(400); res.end('Invalid key'); return; }
      const raw = readDataFile(key, keyBaseDir(key, currentUser));
      const text = key === 'llmConfig'
        ? JSON.stringify(maskLlmConfig(raw))
        : (raw !== null ? raw : '[]');
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(text);
      return;
    }

    // API：POST /api/data/{key} → 写入（排队串行 + 原子替换 + .bak 轮转）
    if (req.method === 'POST' && url.startsWith('/api/data/') && url !== '/api/data/batch') {
      const key = url.replace('/api/data/', '').replace(/[^a-zA-Z0-9_]/g, '');
      if (!key) { res.writeHead(400); res.end('Invalid key'); return; }
      // 多用户模式：共享 AI 配置仅管理员可改（Key 全员共用，防止被指向外部服务器或误清空）
      if (key === 'llmConfig' && MULTIUSER && !isAdminUser(currentUser)) {
        auditLog(currentUser, 'deny', 'llmConfig 非管理员');
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 仅管理员可修改 AI 配置');
        return;
      }
      if (!isJsonContentType(req)) {
        res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('415 Unsupported Media Type');
        return;
      }
      const body = await readBody(req, res, LIMIT_DATA);
      if (body === null) return;
      try { JSON.parse(String(body)); } catch (e) {
        res.writeHead(400); res.end('Invalid JSON'); return;
      }
      const content = key === 'llmConfig' ? prepareLlmConfigWrite(String(body)) : String(body);
      const target = path.join(keyBaseDir(key, currentUser), key + '.json');
      try {
        await enqueueWrite(() => atomicWrite(target, content));
        auditLog(currentUser, 'write', 'key=' + key + ' bytes=' + Buffer.byteLength(content));
        res.writeHead(200); res.end('OK');
      } catch (e) {
        console.error('写入失败:', key, e && e.message);
        res.writeHead(500); res.end('Write failed');
      }
      return;
    }

    // API：POST /api/data/batch → 批量写入（两阶段提交 + 失败回滚，进同一写队列串行）
    // 请求体：[{ "key": "contents", "val": [...] }, ...]
    // 第一阶段：全部写 tmp；第二阶段：逐个 rename 替换。
    // 中途失败时：已替换文件用旧内容还原（原不存在则删除）、未替换的删 tmp，尽量保持跨文件一致
    if (req.method === 'POST' && url === '/api/data/batch') {
      if (!isJsonContentType(req)) {
        res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('415 Unsupported Media Type');
        return;
      }
      const body = await readBody(req, res, LIMIT_DATA);
      if (body === null) return;
      let updates;
      try { updates = JSON.parse(String(body)); } catch (e) {
        res.writeHead(400); res.end('Invalid JSON'); return;
      }
      if (!Array.isArray(updates) || updates.length === 0) {
        res.writeHead(400); res.end('Empty batch'); return;
      }
      // 校验所有 key 合法，并预先处理 llmConfig 的「留空保留 Key」合并
      for (const item of updates) {
        if (!item || !item.key || !/^[a-zA-Z0-9_]+$/.test(item.key)) {
          res.writeHead(400); res.end('Invalid key'); return;
        }
        // 多用户模式：共享 AI 配置仅管理员可改
        if (item.key === 'llmConfig' && MULTIUSER && !isAdminUser(currentUser)) {
          auditLog(currentUser, 'deny', 'llmConfig batch 非管理员');
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403 仅管理员可修改 AI 配置');
          return;
        }
        if (item.key === 'llmConfig') {
          item.val = JSON.parse(prepareLlmConfigWrite(JSON.stringify(item.val === undefined ? {} : item.val)));
        }
      }
      const tmpFiles = [];   // [{ tmp, target, backup }] backup=旧文件内容（原不存在为 null）
      let done = 0;          // 已成功 rename 的个数（回滚时据此区分"已替换/未替换"）
      try {
        await enqueueWrite(async () => {
          // 第一阶段：全部写入 tmp 文件（唯一随机名），并备份现有目标内容
          for (const { key, val } of updates) {
            const target = path.join(keyBaseDir(key, currentUser), key + '.json');
            const tmp = uniqueTmp(target);
            fs.writeFileSync(tmp, JSON.stringify(val));
            tmpFiles.push({ tmp, target, backup: null });
            tmpFiles[tmpFiles.length - 1].backup = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null;
          }
          // 第二阶段：逐个 rename 替换（rename 原子；先轮转 .bak 备份）
          for (const item of tmpFiles) {
            try { if (fs.existsSync(item.target)) fs.copyFileSync(item.target, item.target + '.bak'); } catch (e) {}
            fs.renameSync(item.tmp, item.target);
            done++;
          }
        });
        auditLog(currentUser, 'batch', 'keys=' + updates.map(u => u.key).join(','));
        res.writeHead(200); res.end('OK');
      } catch (e) {
        // 回滚：已替换的还原旧内容（原文件不存在则删除），未替换的删 tmp
        for (let i = 0; i < tmpFiles.length; i++) {
          const item = tmpFiles[i];
          try {
            if (i < done) {
              if (item.backup === null) {
                fs.unlinkSync(item.target);
              } else {
                const rt = uniqueTmp(item.target);
                fs.writeFileSync(rt, item.backup);
                fs.renameSync(rt, item.target);
              }
            } else {
              fs.unlinkSync(item.tmp);
            }
          } catch {}
        }
        console.error('批量写入失败:', e && e.message);
        res.writeHead(500); res.end('Batch write failed');
      }
      return;
    }

    // API：POST /api/llm/chat → OpenAI 兼容 chat/completions 代理转发。
    // 前端直连部分大模型域名会被 CORS 拦截，统一由服务端转发；
    // 请求缺 baseUrl/apiKey/model 时自动用服务端保存的 llmConfig 兜底
    // → 部署场景下只有管理员存 Key，同事浏览器无需配置即可使用 AI，Key 永不下发。
    if (req.method === 'POST' && url === '/api/llm/chat') {
      if (!isJsonContentType(req)) {
        res.writeHead(415, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Content-Type 需为 application/json' } }));
        return;
      }
      const body = await readBody(req, res, LIMIT_LLM);
      if (body === null) return;
      let cfg;
      try { cfg = JSON.parse(String(body)); } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '请求体不是合法 JSON' } }));
        return;
      }
      const { baseUrl, apiKey, model, messages, temperature } = cfg || {};
      // 服务端配置兜底：请求里缺哪项就用已存 llmConfig 的对应项补上
      let effBase = baseUrl, effKey = apiKey, effModel = model;
      if (!effBase || !effKey || !effModel) {
        let stored = null;
        try { stored = JSON.parse(readDataFile('llmConfig') || 'null'); } catch (e) {}
        if (stored && typeof stored === 'object') {
          if (!effBase && stored.baseUrl) effBase = stored.baseUrl;
          if (!effKey && stored.apiKey) effKey = stored.apiKey;
          if (!effModel && stored.model) effModel = stored.model;
        }
      }
      if (!/^https?:\/\//i.test(String(effBase)) || !effKey || !effModel || !Array.isArray(messages) || messages.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '缺少 baseUrl / apiKey / model / messages，且服务端也没有可用配置' } }));
        return;
      }
      auditLog(currentUser, 'llm', 'model=' + effModel + ' msgs=' + messages.length);
      const target = String(effBase).replace(/\/+$/, '') + '/chat/completions';
      // 防 SSRF：禁止把请求转发到本机/链路本地地址（大模型服务都是公网地址，正常使用不受影响）
      let upstreamHost = '';
      try { upstreamHost = new URL(target).hostname; } catch (e) {}
      if (/^(localhost|127\.|0\.0\.0\.0|::1|\[::1\]|169\.254\.)/i.test(upstreamHost)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '不允许转发到本机/链路本地地址' } }));
        return;
      }
      const mod = /^https:/i.test(target) ? https : http;
      const upstreamBody = { model: effModel, messages };
      if (temperature !== undefined && temperature !== null && temperature !== '' && !isNaN(Number(temperature))) {
        upstreamBody.temperature = Number(temperature);
      }
      let responded = false;
      const upstream = mod.request(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + effKey
        }
      }, (up) => {
        const chunks = [];
        up.on('data', c => chunks.push(c));
        up.on('end', () => {
          if (responded) return;
          responded = true;
          res.writeHead(up.statusCode || 502, { 'Content-Type': up.headers['content-type'] || 'application/json' });
          res.end(Buffer.concat(chunks));
        });
      });
      upstream.setTimeout(180000, () => upstream.destroy(new Error('上游请求超时')));
      upstream.on('error', (e) => {
        if (responded) return;
        responded = true;
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '无法连接大模型服务：' + e.message } }));
      });
      upstream.write(JSON.stringify(upstreamBody));
      upstream.end();
      return;
    }

    // 静态文件白名单：仅允许页面入口、资源目录（css/js/icons）与固定文件，
    // 防止通过 URL 直接下载项目源码（如 /server.js、/tests/、/package.json 等）
    // 拒绝反斜杠（Windows 上 path.join 会把它当分隔符，可构造 /js/..\server.js 绕过前缀白名单）
    // 原始 URL 与解码后 URL 都查：双保险覆盖 %2e%2e、%5C 等编码变体
    const urlCandidates = [url];
    try { urlCandidates.push(decodeURIComponent(url)); } catch (e) {
      res.writeHead(403); res.end('Forbidden'); return;  // 畸形编码直接拒绝
    }
    for (const u of urlCandidates) {
      if (u.includes('\\') || u.split('/').includes('..')) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
    }
    const allowed =
      url === '/' || url === '/index.html' ||
      url === '/manifest.webmanifest' || url === '/sw.js' ||
      url.startsWith('/css/') || url.startsWith('/js/') || url.startsWith('/icons/');
    if (!allowed) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    // 静态文件服务（resolve 归一化后断言仍在项目内，作为最后防线）
    let filePath = path.resolve(__dirname, url === '/' ? 'index.html' : '.' + url);
    const ext = path.extname(filePath);

    // 安全：禁止通过网址直接访问数据目录（data/ 只允许走 /api/data 接口）
    if (filePath === DATA_DIR || filePath.startsWith(DATA_DIR + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    // 安全：禁止路径穿越（防止访问项目外的文件）
    if (filePath !== __dirname && !filePath.startsWith(__dirname + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not Found');
      return;
    }

    // index.html：注入内容指纹 + no-cache（每次都拿最新引用，配合指纹实现"改完即刷新"）
    if (url === '/' || url === '/index.html') {
      const html = injectAssetHashes(fs.readFileSync(filePath, 'utf-8'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(html);
      return;
    }

    // 带内容指纹的 js/css：永久缓存（URL 带指纹，内容不变 URL 不变，可放心缓存）
    const query = req.url.split('?')[1] || '';
    if ((ext === '.js' || ext === '.css') && query.indexOf('v=') === 0) {
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.end(fs.readFileSync(filePath));
      return;
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(filePath));
  } catch (err) {
    console.error('服务器错误:', err && err.stack || err);
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server Error');
    } catch (e) { /* 响应头已发出则忽略 */ }
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('==============================================');
    console.error(`✗ 端口 ${PORT} 已被占用`);
    console.error(`  若已是本工作台在运行：直接访问 http://localhost:${PORT}`);
    console.error(`  否则换端口启动：set PORT=3001 再启动`);
    console.error('==============================================');
    process.exit(1);
  }
  console.error('服务器错误:', err && err.message);
  process.exit(1);
});

// 多用户模式：首次启用时把根目录旧数据迁移到默认用户名下（llmConfig 保持全局共享）
migrateRootDataToDefaultUser();

server.listen(PORT, HOST, () => {
  const addr = HOST ? `http://localhost:${PORT}` : `http://<电脑IP>:${PORT}（MCB_LAN=1 模式）`;
  console.log('==============================================');
  console.log(`✓ 新媒体数据工作台服务已启动`);
  console.log(`✓ 访问地址: ${addr}`);
  console.log(`✓ 数据存储: ${DATA_DIR}${MULTIUSER ? '（多用户模式：data/users/<用户名>/ 按登录用户隔离）' : ''}`);
  console.log(`✓ 访问认证: ${MULTIUSER ? 'nginx 认证（X-Remote-User）' : ACCESS_TOKEN ? '访问令牌已启用' : '未启用（仅本机默认模式）'}`);
  console.log(`✓ 关闭服务: Ctrl+C`);
  console.log('==============================================');
});
