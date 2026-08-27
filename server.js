// ===== 本地数据服务 =====
// 功能：静态文件服务 + JSON 数据读写 API（替代 localStorage）
// 端口：3000（可用环境变量 PORT 覆盖）
// 存储：./data/*.json（每个 key 一个文件）
// 依赖：仅 Node.js 内置模块（http/fs/path）

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const PORT = process.env.PORT || 3000;
// 安全：默认仅本机可访问（绑定 127.0.0.1），避免局域网内任意设备读写数据 / 窃取 LLM 配置。
// 需要手机 / 局域网访问时，以环境变量 MCB_LAN=1 启动才会监听所有网卡。
const HOST = process.env.MCB_LAN === '1' ? undefined : '127.0.0.1';
const DATA_DIR = path.join(__dirname, 'data');

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

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0]; // 去掉 query string

    // API：GET /api/data/{key} → 读取
    if (req.method === 'GET' && url.startsWith('/api/data/')) {
      const key = url.replace('/api/data/', '').replace(/[^a-zA-Z0-9_]/g, '');
      const filePath = path.join(DATA_DIR, key + '.json');
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(fs.readFileSync(filePath, 'utf-8'));
      } else {
        // 文件不存在 → 返回空数组
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end('[]');
      }
      return;
    }

    // API：POST /api/data/{key} → 写入（原子写：先写临时文件再 rename 替换）
    if (req.method === 'POST' && url.startsWith('/api/data/') && url !== '/api/data/batch') {
      const key = url.replace('/api/data/', '').replace(/[^a-zA-Z0-9_]/g, '');
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try { JSON.parse(body); } catch (e) {
          res.writeHead(400); res.end('Invalid JSON'); return;
        }
        const target = path.join(DATA_DIR, key + '.json');
        const tmp = target + '.tmp';
        try {
          fs.writeFileSync(tmp, body);
          fs.renameSync(tmp, target); // 原子替换，中途关窗不会留半截文件
          res.writeHead(200); res.end('OK');
        } catch (e) {
          res.writeHead(500); res.end('Write failed');
        }
      });
      return;
    }

    // API：POST /api/data/batch → 批量写入（两阶段提交 + 失败回滚）
    // 请求体：[{ "key": "contents", "val": [...] }, ...]
    // 第一阶段：全部写 tmp；第二阶段：逐个 rename 替换。
    // 中途失败时：已替换文件用旧内容还原（原不存在则删除）、未替换的删 tmp，尽量保持跨文件一致
    if (req.method === 'POST' && url === '/api/data/batch') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        let updates;
        try { updates = JSON.parse(body); } catch (e) {
          res.writeHead(400); res.end('Invalid JSON'); return;
        }
        if (!Array.isArray(updates) || updates.length === 0) {
          res.writeHead(400); res.end('Empty batch'); return;
        }
        // 校验所有 key 合法
        for (const { key } of updates) {
          if (!key || !/^[a-zA-Z0-9_]+$/.test(key)) {
            res.writeHead(400); res.end('Invalid key: ' + key); return;
          }
        }
        const tmpFiles = [];   // [{ tmp, target, backup }] backup=旧文件内容（原不存在为 null）
        let done = 0;          // 已成功 rename 的个数（回滚时据此区分"已替换/未替换"）
        try {
          // 第一阶段：全部写入 tmp 文件，并备份现有目标内容
          // 注意：先 push 登记、再读备份——若读备份失败，已写 tmp 也能被下方回滚清理
          for (const { key, val } of updates) {
            const target = path.join(DATA_DIR, key + '.json');
            const tmp = target + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(val));
            tmpFiles.push({ tmp, target, backup: null });
            tmpFiles[tmpFiles.length - 1].backup = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null;
          }
          // 第二阶段：逐个 rename 替换（Windows 上 rename 是原子的）
          for (const item of tmpFiles) {
            fs.renameSync(item.tmp, item.target);
            done++;
          }
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
                  const rt = item.target + '.rollback';
                  fs.writeFileSync(rt, item.backup);
                  fs.renameSync(rt, item.target);
                }
              } else {
                fs.unlinkSync(item.tmp);
              }
            } catch {}
          }
          res.writeHead(500); res.end('Batch write failed: ' + e.message);
        }
      });
      return;
    }

    // API：POST /api/ffmpeg/compress → 调用系统已装 ffmpeg 压缩视频（前端优先本地，避免下载 30MB wasm）
// 请求体：原始视频二进制（body 直接是文件内容）；query 可带 duration=秒 用于码率估算
// 成功：200 + video/mp4 二进制；ffmpeg 未安装：503 {error}；压缩失败：500 {error}
const ffmpegAvailable = (() => {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    return r.error ? false : true;
  } catch (e) { return false; }
})();
if (req.method === 'POST' && url === '/api/ffmpeg/compress') {
  const query = req.url.split('?')[1] || '';
  const duration = parseFloat((query.match(/duration=([\d.]+)/) || [])[1]) || 0;
  const srcSize = parseInt((query.match(/size=(\d+)/) || [])[1], 10) || 0;
  const chunks = [];
  let size = 0;
  req.on('data', c => { chunks.push(c); size += c.length; });
  req.on('end', () => {
    const responder = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (!ffmpegAvailable) return responder(503, { error: '未检测到系统 ffmpeg，请安装后重试或使用浏览器回退压缩' });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbff-'));
    const inFile = path.join(tmpDir, 'in' + (duration === 0 ? '' : ''));
    const outFile = path.join(tmpDir, 'out.mp4');
    fs.writeFileSync(inFile, Buffer.concat(chunks));
    // 码率预算：按时长反推（与前端口径一致：压缩目标 6MB = base64 约 8.3MB，低于接口约 9.8MB 请求体上限）
    const audioBit = 64000;
    const seconds = Math.max(duration, 10);
    let videoBit = Math.max(200000, Math.min(1500000, 6 * 1024 * 1024 * 8 / seconds - audioBit));
    // 原视频码率估算：预算码率不超过原码率，避免「越压越大」（源视频较小时直接保原码率）
    if (srcSize > 0 && seconds > 0) {
      const srcBit = srcSize * 8 / seconds;
      if (srcBit < videoBit) videoBit = Math.max(200000, Math.round(srcBit));
    }
    const maxW = duration > 180 ? 540 : 960;
    const vf = "scale='min(" + maxW + ",iw)':-2";
    const child = spawn('ffmpeg', [
      '-y', '-i', inFile, '-vf', vf, '-r', '15',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-b:v', String(Math.round(videoBit)), '-maxrate', String(Math.round(videoBit * 1.45)), '-bufsize', String(Math.round(videoBit * 2.9)),
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outFile
    ], { windowsHide: true });
    let errLog = '';
    child.stderr.on('data', d => { errLog += String(d); });
    child.on('error', e => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) {} responder(503, { error: 'ffmpeg 启动失败：' + e.message }); });
    child.on('close', code => {
      if (code === 0 && fs.existsSync(outFile)) {
        // 压缩后不比原文件小 → 原样返回原始数据（杜绝「越压越大」）
        const outSize = fs.statSync(outFile).size;
        if (srcSize > 0 && outSize >= srcSize) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) {}
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': chunks.reduce((s, c) => s + c.length, 0) });
          res.end(Buffer.concat(chunks));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': outSize });
        fs.createReadStream(outFile).on('close', () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) {} }).pipe(res);
      } else {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) {}
        responder(500, { error: 'ffmpeg 压缩失败：' + errLog.slice(-400) });
      }
    });
  });
  return;
}

// API：GET /api/ffmpeg/check → 检测本机是否已装 ffmpeg（供前端提示用）
if (req.method === 'GET' && url === '/api/ffmpeg/check') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ available: ffmpegAvailable }));
  return;
}
    // 原因：千问 token-plan 等专属域名不返回 CORS 头，浏览器直连会被跨域拦截（Failed to fetch），
    // 统一由本地服务端转发可完全绕过；仅监听 127.0.0.1（默认）时此接口仅本机可用。
    if (req.method === 'POST' && url === '/api/llm/chat') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        let cfg;
        try { cfg = JSON.parse(body); } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: '请求体不是合法 JSON' } }));
          return;
        }
        const { baseUrl, apiKey, model, messages, temperature } = cfg || {};
        if (!/^https?:\/\//i.test(String(baseUrl)) || !apiKey || !model || !Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: '缺少 baseUrl / apiKey / model / messages' } }));
          return;
        }
        const target = String(baseUrl).replace(/\/+$/, '') + '/chat/completions';
        const mod = /^https:/.test(target) ? https : http;
        const upstreamBody = { model, messages };
        if (temperature !== undefined && temperature !== null && temperature !== '' && !isNaN(Number(temperature))) {
          upstreamBody.temperature = Number(temperature);
        }
        let responded = false;
        const upstream = mod.request(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
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
      });
      return;
    }

    // 静态文件白名单：仅允许页面入口、资源目录（css/js/icons）与固定文件，
    // 防止通过 URL 直接下载项目源码（如 /server.js、/tests/、/package.json 等）
    // 先拒绝含路径穿越片段（..）的 URL，避免 /js/../server.js 之类绕过下方前缀白名单
    if (url.split('/').includes('..')) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const allowed =
      url === '/' || url === '/index.html' ||
      url === '/manifest.webmanifest' || url === '/sw.js' ||
      url.startsWith('/css/') || url.startsWith('/js/') || url.startsWith('/icons/');
    if (!allowed) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    // 静态文件服务
    let filePath = path.join(__dirname, url === '/' ? 'index.html' : url);
    const ext = path.extname(filePath);

    // 安全：禁止通过网址直接访问数据目录（data/ 只允许走 /api/data 接口）
    if (filePath.startsWith(DATA_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    // 安全：禁止路径穿越（防止访问项目外的文件）
    if (!filePath.startsWith(__dirname)) {
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
    res.writeHead(500); res.end('Server Error: ' + err.message);
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

server.listen(PORT, HOST, () => {
  const addr = HOST ? `http://localhost:${PORT}` : `http://<电脑IP>:${PORT}（局域网模式 MCB_LAN=1）`;
  console.log('==============================================');
  console.log(`✓ 新媒体数据工作台服务已启动`);
  console.log(`✓ 访问地址: ${addr}`);
  console.log(`✓ 数据存储: ${DATA_DIR}`);
  console.log(`✓ 关闭服务: Ctrl+C`);
  console.log('==============================================');
});