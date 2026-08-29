// ===== server.js 安全回归测试 =====
// 启动真实服务实例（独立端口），验证：路径穿越拦截、data/ 目录 403、Host 白名单、
// Content-Type 强制、llmConfig 脱敏、ACCESS_TOKEN 认证流程。
// 注意：写入测试用的 key 以 zz_test_ 开头，测试后自动清理；llmConfig 测试前先备份原文件、结束后还原。

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT1 = 3123; // 无令牌实例
const PORT2 = 3124; // 带令牌实例
const TOKEN = 'test-token-abc123';
let passed = 0, failed = 0;
const failures = [];

function test(name, ok, detail) {
  if (ok) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; failures.push(name + (detail ? '：' + detail : '')); console.log('  \u2717 ' + name + (detail ? '\n      ' + detail : '')); }
}

function request(port, method, urlPath, opts = {}) {
  return new Promise(resolve => {
    const body = opts.body || null;
    const req = http.request({
      host: '127.0.0.1', port, method,
      path: urlPath,
      headers: Object.assign({ 'Host': opts.host || 'localhost' }, opts.headers || {})
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        setCookie: res.headers['set-cookie'] || [],
        body: Buffer.concat(chunks).toString('utf-8')
      }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function startServer(port, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: Object.assign({}, process.env, { PORT: String(port), MCB_LAN: '1' }, env),
      stdio: 'ignore'
    });
    // 轮询等端口就绪（401 = 多用户模式要求身份头，也代表服务已就绪）
    let tries = 0;
    const poll = async () => {
      tries++;
      const r = await request(port, 'GET', '/');
      if (r.status === 200 || r.status === 302 || r.status === 401) return resolve(child);
      if (tries > 50) return reject(new Error('服务器启动超时'));
      setTimeout(poll, 100);
    };
    setTimeout(poll, 150);
    child.on('exit', code => { if (code && code !== 0) reject(new Error('server 提前退出 code=' + code)); });
  });
}

function stopServer(child) {
  return new Promise(resolve => {
    child.kill();
    setTimeout(resolve, 300);
  });
}

(async () => {
  console.log('\n[server-security] 路径穿越 / 访问控制 / 配置脱敏');

  // ===== 实例 1：无令牌模式 =====
  let s1;
  try {
    s1 = await startServer(PORT1, {});
  } catch (e) {
    console.log('  \u2717 无令牌实例启动失败：' + e.message);
    process.exit(1);
  }

  try {
    // --- 静态资源路径穿越 ---
    let r = await request(PORT1, 'GET', '/js/..%5Cserver.js');
    test('反斜杠编码穿越 %5C 被拒', r.status === 403, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/js/..\\server.js');
    test('反斜杠明文穿越被拒', r.status === 403, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/js/../server.js');
    test('正斜杠穿越被拒', r.status === 403, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/css/%2e%2e/%2e%2e/server.js');
    test('双重编码层级穿越被拒', r.status === 403, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/server.js');
    test('直接下载源码被拒', r.status === 403, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/data/llmConfig.json');
    test('data 目录直接访问被拒', r.status === 403, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/data/contents.json');
    test('data 目录数据文件访问被拒', r.status === 403, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/js/app.js');
    test('白名单静态资源正常放行', r.status === 200, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/');
    test('首页正常放行', r.status === 200 && r.body.includes('新媒体数据工作台'), 'status=' + r.status);
    test('响应带 nosniff 头', r.headers['x-content-type-options'] === 'nosniff');

    // --- Host 白名单 ---
    r = await request(PORT1, 'GET', '/', { host: 'evil.example.com' });
    test('非白名单 Host 被拒（DNS rebinding 防护）', r.status === 403, 'status=' + r.status);
    r = await request(PORT1, 'GET', '/', { host: '127.0.0.1:' + PORT1 });
    test('127.0.0.1 Host 放行', r.status === 200, 'status=' + r.status);

    // --- llmConfig 脱敏 ---
    const cfgPath = path.join(ROOT, 'data', 'llmConfig.json');
    const cfgBackup = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf-8') : null;
    try {
      r = await request(PORT1, 'GET', '/api/data/llmConfig');
      const cfg = JSON.parse(r.body);
      test('GET llmConfig 不返回 apiKey', !('apiKey' in cfg), JSON.stringify(Object.keys(cfg)));
      test('GET llmConfig 返回 hasKey 标记', typeof cfg.hasKey === 'boolean', r.body.slice(0, 120));

      // --- 写入：Content-Type 强制 ---
      r = await request(PORT1, 'POST', '/api/data/zz_test_sec', { body: '[1]' });
      test('POST 缺 Content-Type 被拒 415', r.status === 415, 'status=' + r.status);
      r = await request(PORT1, 'POST', '/api/data/zz_test_sec', { body: '[1]', headers: { 'Content-Type': 'text/plain' } });
      test('POST text/plain 被拒 415', r.status === 415, 'status=' + r.status);
      r = await request(PORT1, 'POST', '/api/data/zz_test_sec', { body: '[1]', headers: { 'Content-Type': 'application/json' } });
      test('POST application/json 正常写入', r.status === 200, 'status=' + r.status);
      r = await request(PORT1, 'POST', '/api/data/batch', {
        body: JSON.stringify([{ key: 'zz_test_sec', val: [2, 3] }]),
        headers: { 'Content-Type': 'application/json' }
      });
      test('batch application/json 正常写入', r.status === 200, 'status=' + r.status);

      // --- llmConfig「留空保留 Key」合并 ---
      // 先确保有一个已知 key 的配置
      await request(PORT1, 'POST', '/api/data/llmConfig', {
        body: JSON.stringify({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-xyz', model: 'test-model' }),
        headers: { 'Content-Type': 'application/json' }
      });
      r = await request(PORT1, 'POST', '/api/data/llmConfig', {
        body: JSON.stringify({ baseUrl: 'https://changed.example.com/v1', apiKey: '', model: 'test-model' }),
        headers: { 'Content-Type': 'application/json' }
      });
      const rawNow = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      test('apiKey 留空时服务端保留旧 Key', rawNow.apiKey === 'sk-test-xyz', JSON.stringify(rawNow.apiKey));
      test('其他字段正常更新', rawNow.baseUrl === 'https://changed.example.com/v1');
      r = await request(PORT1, 'POST', '/api/data/llmConfig', {
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      const cleared = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      test('空对象清空配置（含 Key）', !cleared.apiKey && !cleared.baseUrl, r.body);
    } finally {
      // 还原真实 llmConfig
      if (cfgBackup !== null) fs.writeFileSync(cfgPath, cfgBackup);
      else if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
    }
  } finally {
    await stopServer(s1);
  }

  // 清理测试写入的文件
  for (const f of ['zz_test_sec.json', 'zz_test_sec.json.bak']) {
    const p = path.join(ROOT, 'data', f);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) {} }
  }

  // ===== 实例 2：带令牌模式 =====
  console.log('\n[server-security] ACCESS_TOKEN 认证');
  let s2;
  try {
    s2 = await startServer(PORT2, { ACCESS_TOKEN: TOKEN });
  } catch (e) {
    console.log('  \u2717 令牌实例启动失败：' + e.message);
    process.exit(1);
  }
  try {
    let r = await request(PORT2, 'GET', '/');
    test('未认证访问首页重定向登录页', r.status === 302 && r.headers.location === '/__login', 'status=' + r.status);
    r = await request(PORT2, 'GET', '/api/data/contents');
    test('未认证 API 返回 401 JSON', r.status === 401 && r.body.includes('未认证'), 'status=' + r.status);
    r = await request(PORT2, 'GET', '/__login');
    test('登录页可访问', r.status === 200 && r.body.includes('访问令牌'), 'status=' + r.status);
    r = await request(PORT2, 'POST', '/__login', { body: 'token=wrong', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    test('错误令牌被拒', r.status === 200 && r.body.includes('令牌错误'), 'status=' + r.status);
    r = await request(PORT2, 'POST', '/__login', {
      body: 'token=' + encodeURIComponent(TOKEN),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const cookie = (r.setCookie[0] || '').split(';')[0];
    test('正确令牌设置 Cookie 并跳转', r.status === 302 && cookie.startsWith('mcb_token='), 'status=' + r.status);
    r = await request(PORT2, 'GET', '/', { headers: { 'Cookie': cookie } });
    test('携带令牌 Cookie 放行', r.status === 200, 'status=' + r.status);
    r = await request(PORT2, 'GET', '/api/data/contents?token=' + encodeURIComponent(TOKEN));
    test('query 令牌放行 API', r.status === 200, 'status=' + r.status);
    r = await request(PORT2, 'POST', '/api/data/zz_test_sec', {
      body: '[]', headers: { 'Content-Type': 'application/json' }
    });
    test('无令牌 POST 被拒 401', r.status === 401, 'status=' + r.status);
  } finally {
    await stopServer(s2);
  }
  const p = path.join(ROOT, 'data', 'zz_test_sec.json');
  if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) {} }

  // ===== 实例 3：多用户模式（数据按登录用户隔离，llmConfig 全局共享） =====
  console.log('\n[server-security] 多用户模式（MCB_MULTIUSER=1）');
  const os = require('os');
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-multi-'));
  // 预置旧格式根数据：contents.json 应被迁移到默认用户名下，llmConfig.json 应保持全局
  fs.writeFileSync(path.join(tmpData, 'contents.json'), JSON.stringify([{ id: 'legacy1', title: '旧数据' }]));
  fs.writeFileSync(path.join(tmpData, 'llmConfig.json'), JSON.stringify({ baseUrl: 'https://api.g.com/v1', apiKey: 'sk-shared', model: 'm1' }));
  let s3;
  try {
    s3 = await startServer(PORT2 + 1, {
      MCB_MULTIUSER: '1',
      MCB_DATA_DIR: tmpData,
      MCB_DEFAULT_USER: 'boss',
      MCB_ALLOWED_HOSTS: 'localhost,127.0.0.1'
    });
  } catch (e) {
    console.log('  \u2717 多用户实例启动失败：' + e.message);
    process.exit(1);
  }
  const P3 = PORT2 + 1;
  const asUser = u => ({ headers: { 'X-Remote-User': u } });
  try {
    // 启动迁移：根目录 contents.json → users/boss/，llmConfig 留在全局
    test('旧数据迁移到默认用户目录', fs.existsSync(path.join(tmpData, 'users', 'boss', 'contents.json')));
    test('迁移后根目录不再有 contents.json', !fs.existsSync(path.join(tmpData, 'contents.json')));
    test('llmConfig 保持全局共享', fs.existsSync(path.join(tmpData, 'llmConfig.json')));
    const migrated = JSON.parse(fs.readFileSync(path.join(tmpData, 'users', 'boss', 'contents.json'), 'utf-8'));
    test('迁移数据内容完整', migrated.length === 1 && migrated[0].id === 'legacy1');

    // 缺身份头 → 401
    let r = await request(P3, 'GET', '/api/data/contents');
    test('多用户模式缺 X-Remote-User 被拒 401', r.status === 401, 'status=' + r.status);

    // 用户隔离：alice 写入，boss 读不到
    r = await request(P3, 'POST', '/api/data/contents', {
      body: JSON.stringify([{ id: 'alice-1', title: 'alice的数据' }]),
      headers: Object.assign({ 'Content-Type': 'application/json' }, asUser('alice').headers)
    });
    test('alice 正常写入', r.status === 200, 'status=' + r.status);
    r = await request(P3, 'GET', '/api/data/contents', asUser('boss'));
    test('boss 读不到 alice 的数据（隔离生效）', !r.body.includes('alice-1'), r.body.slice(0, 80));
    r = await request(P3, 'GET', '/api/data/contents', asUser('alice'));
    test('alice 能读到自己的数据', JSON.parse(r.body).length === 1, r.body.slice(0, 80));
    r = await request(P3, 'GET', '/api/data/contents', asUser('boss'));
    // boss 的目录里是迁移过来的旧数据
    test('boss 读到的是自己名下的迁移数据', JSON.parse(r.body).length === 1 && JSON.parse(r.body)[0].id === 'legacy1', r.body.slice(0, 80));

    // llmConfig 全局共享：alice 能读到共享 Key 标记（脱敏）
    r = await request(P3, 'GET', '/api/data/llmConfig', asUser('alice'));
    const masked = JSON.parse(r.body);
    test('任意用户可读共享 llmConfig（脱敏）', masked.hasKey === true && masked.baseUrl === 'https://api.g.com/v1' && !masked.apiKey, r.body.slice(0, 120));

    // 身份头非法字符被清洗（直连伪造已被 127.0.0.1 绑定挡住，这里是纵深防御）
    r = await request(P3, 'GET', '/api/me', { headers: { 'X-Remote-User': '../evil' } });
    test('非法用户名字符被清洗', r.status === 200 && JSON.parse(r.body).user === 'evil', r.body);

    // /api/me 返回当前用户
    r = await request(P3, 'GET', '/api/me', asUser('alice'));
    test('/api/me 返回当前登录用户', JSON.parse(r.body).user === 'alice', r.body);

    // 审计日志存在且有 alice 的写入记录
    const logPath = path.join(tmpData, 'activity.log');
    test('审计日志记录用户写入', fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf-8').includes('user=alice action=write key=contents'));

    // llmConfig 写权限：仅管理员（boss=MCB_DEFAULT_USER）可改，普通用户 403
    r = await request(P3, 'POST', '/api/data/llmConfig', {
      body: JSON.stringify({ baseUrl: 'https://evil.example.com/v1', apiKey: 'sk-steal', model: 'm' }),
      headers: Object.assign({ 'Content-Type': 'application/json' }, asUser('alice').headers)
    });
    test('非管理员修改共享 AI 配置被拒 403', r.status === 403, 'status=' + r.status);
    const cfgAfter = JSON.parse(fs.readFileSync(path.join(tmpData, 'llmConfig.json'), 'utf-8'));
    test('被拒后共享配置未被篡改', cfgAfter.baseUrl === 'https://api.g.com/v1' && cfgAfter.apiKey === 'sk-shared');
    r = await request(P3, 'POST', '/api/data/llmConfig', {
      body: JSON.stringify({ baseUrl: 'https://api.g.com/v1', apiKey: 'sk-shared', model: 'm1' }),
      headers: Object.assign({ 'Content-Type': 'application/json' }, asUser('boss').headers)
    });
    test('管理员可正常修改共享 AI 配置', r.status === 200, 'status=' + r.status);

    // ===== 服务端 AI 额度 =====
    const today = new Date().toISOString().slice(0, 10);
    // alice 额度耗尽 → /api/llm/chat 429（服务端权威校验，绕过页面也没用）
    fs.writeFileSync(path.join(tmpData, 'users', 'alice', 'llmQuota.json'), JSON.stringify({ date: today, chat: 999, review: 0 }));
    r = await request(P3, 'POST', '/api/llm/chat', {
      body: JSON.stringify({ baseUrl: 'https://api.g.com/v1', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }], quotaType: 'chat' }),
      headers: Object.assign({ 'Content-Type': 'application/json' }, asUser('alice').headers)
    });
    test('额度用尽的用户调用 AI 被拒 429', r.status === 429 && r.body.includes('额度已用尽'), 'status=' + r.status + ' ' + r.body.slice(0, 100));
    // llmQuota 是服务端专管文件：客户端不可写
    r = await request(P3, 'POST', '/api/data/llmQuota', {
      body: JSON.stringify({ date: today, chat: 0, review: 0 }),
      headers: Object.assign({ 'Content-Type': 'application/json' }, asUser('alice').headers)
    });
    test('客户端写 llmQuota 被拒 403（防自行重置额度）', r.status === 403, 'status=' + r.status);
    r = await request(P3, 'POST', '/api/data/batch', {
      body: JSON.stringify([{ key: 'llmQuota', val: { date: today, chat: 0, review: 0 } }]),
      headers: Object.assign({ 'Content-Type': 'application/json' }, asUser('alice').headers)
    });
    test('batch 写 llmQuota 同样被拒 403', r.status === 403, 'status=' + r.status);
    // bob 额度未用尽 → 通过额度关（被后续 SSRF 拦截返回 403，证明未到上游、且未真实消耗）
    r = await request(P3, 'POST', '/api/llm/chat', {
      body: JSON.stringify({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }], quotaType: 'chat' }),
      headers: Object.assign({ 'Content-Type': 'application/json' }, asUser('bob').headers)
    });
    test('额度未用尽通过校验（被 SSRF 拦截 403）', r.status === 403 && r.body.includes('本机'), 'status=' + r.status);
    // SSRF 被拦发生在扣减之前 → bob 的额度文件尚未创建（即未消耗）；若存在也必须是 0
    const bobQuotaPath = path.join(tmpData, 'users', 'bob', 'llmQuota.json');
    const bobQuota = fs.existsSync(bobQuotaPath) ? JSON.parse(fs.readFileSync(bobQuotaPath, 'utf-8')) : { chat: 0 };
    test('SSRF 被拦的请求不消耗额度', (bobQuota.chat || 0) === 0, JSON.stringify(bobQuota));
    // GET llmQuota 由服务端动态生成并下发 limit
    r = await request(P3, 'GET', '/api/data/llmQuota', asUser('alice'));
    const quotaView = JSON.parse(r.body);
    test('GET llmQuota 服务端生成并附 limit', quotaView.limit === 20 && quotaView.date === today && quotaView.chat === 999, r.body.slice(0, 120));
  } finally {
    await stopServer(s3);
  }
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) {}

  console.log('\n结果：通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed > 0) {
    console.log('失败详情：');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('服务端安全测试全部通过 \u2705');
})();
