#!/usr/bin/env node
/**
 * 轻量回归测试（零依赖，Node 内置模块即可运行）
 * 运行：node tests/run.js   或   npm test
 *
 * 守护三类最易回归、且用户最在意的问题：
 *  1) 安全核心函数 escapeHtml / safeUrl 行为正确（防 XSS 的最后一道闸）
 *  2) 运行时 XSS 渲染测试：把恶意输入喂给真实的渲染函数，
 *     检查最终生成的 HTML 是否真的把 < > 转义了（防"用户输入被当代码执行"复发）
 *  3) 导出/导入 JSON 字段对称：备份写出去的字段，恢复时必须能读回来
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, err: e.message });
    console.log('  \u2717 ' + name + '\n      ' + e.message);
  }
}

// ============================================================
// 测试 1：escapeHtml / safeUrl / hasCorruptChar 单元正确性
// 用 vm 在带浏览器桩的沙箱里加载真实 store.js，取真实函数测试
// ============================================================
function loadStore() {
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'store.js'), 'utf8'), sandbox);
  return sandbox;
}

function makeSandbox() {
  function fakeEl() {
    return {
      innerHTML: '', value: '', textContent: '', style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
      setAttribute() {}, getAttribute() { return null; }, click() {}, focus() {},
      querySelector() { return fakeEl(); }, querySelectorAll() { return []; },
      getContext() { return new Proxy({}, { get: () => () => ({ width: 0 }) }); },
      getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; },
      children: [], parentNode: null,
    };
  }
  const documentShim = {
    getElementById() { return fakeEl(); },
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    addEventListener() {}, createElement() { return fakeEl(); },
    body: fakeEl(),
  };
  const sandbox = {
    console,
    setInterval: () => 0, setTimeout: () => 0, clearInterval: () => {}, clearTimeout: () => {},
    fetch: async () => ({ ok: false, json: async () => [] }),
    document: documentShim,
    window: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: '' },
    Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Boolean,
    isNaN, parseInt, parseFloat, encodeURIComponent,
    showToast: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

console.log('\n[1] 安全核心函数');
test('escapeHtml 转义 < > & " \'', () => {
  const { escapeHtml } = loadStore();
  assert.strictEqual(escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(escapeHtml('a&b"c\'d'), 'a&amp;b&quot;c&#39;d');
});
test('escapeHtml 对 null/undefined 返回空串', () => {
  const { escapeHtml } = loadStore();
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
});
test('safeUrl 仅放行 http/https，拦截 javascript:/data:/空值', () => {
  const { safeUrl } = loadStore();
  assert.strictEqual(safeUrl('https://example.com'), 'https://example.com');
  assert.strictEqual(safeUrl('http://a.b/c'), 'http://a.b/c');
  assert.strictEqual(safeUrl('javascript:alert(1)'), '');
  assert.strictEqual(safeUrl('data:text/html,<script>'), '');
  assert.strictEqual(safeUrl(''), '');
  assert.strictEqual(safeUrl('  '), '');
});
test('hasCorruptChar 识别 U+FFFD 乱码替换符', () => {
  const { hasCorruptChar } = loadStore();
  assert.strictEqual(hasCorruptChar('正常文字'), false);
  assert.strictEqual(hasCorruptChar('a�b'), true);
});

// ============================================================
// 测试 2：运行时 XSS 渲染测试
// 把恶意输入喂给真实的渲染函数，检查生成 HTML 是否真被转义。
// 做法：在 vm 里加载 store.js + 某个视图文件（真实代码），
// 注入恶意数据后调用其渲染函数，取回拼好的 HTML 字符串做断言。
// ============================================================
const PAYLOAD = '<img src=x onerror=alert(1)>';
const MAL_URL = 'javascript:alert(1)';
const KNOWN_DATA_FIELDS = ['contents', 'stats', 'reviews', 'accountStats', 'accountIds'];

const HARNESS = `
;(function(){
  const __PAYLOAD__ = ${JSON.stringify(PAYLOAD)};
  const __MAL__ = { id:1, title:__PAYLOAD__, topic:__PAYLOAD__, url:${JSON.stringify(MAL_URL)}, platform:'抖音', createdAt:'2026-08-12' };
  // 注入恶意数据（reassign store.js 顶层 let 绑定）
  try { contents = [__MAL__]; } catch(e){}
  try { stats = []; } catch(e){}
  try { reviews = [{ id:1, date:'2026-08-12', period:'week', highlights:__PAYLOAD__, problems:__PAYLOAD__, plans:__PAYLOAD__ }]; } catch(e){}
  try { searchKeyword = __PAYLOAD__; } catch(e){}
  try { contentFilterType=''; contentDateFilter=''; contentSortByViews=''; } catch(e){}
  try { dataSubTab='video'; } catch(e){}
  // AI 页数据：恶意 Base URL / 模型名 / AI 返回文案都会进 innerHTML
  try { llmConfig = { baseUrl:__PAYLOAD__, apiKey:'k', model:__PAYLOAD__, savedAt:'2026-08-12T00:00:00Z' }; } catch(e){}
  try { __aiCopyResult = { titles:[__PAYLOAD__], description:__PAYLOAD__, tags:__PAYLOAD__ }; } catch(e){}
  try { __aiCopyLoading = false; } catch(e){}
  const __calls__ = ['renderContentDetail','renderContentItem','renderVideoDataModal','renderContent','renderReviewPanel','renderLLMConfig','renderAiVideoCopyCard'];
  let __html__ = '';
  let __ran__ = [];
  __calls__.forEach(function(fn){
    if (typeof globalThis[fn] === 'function') {
      try {
        const arg = (fn==='renderContentDetail'||fn==='renderContentItem'||fn==='renderVideoDataModal') ? __MAL__
                  : (fn==='renderReviewPanel' ? 'week' : undefined);
        __html__ += globalThis[fn](arg); __ran__.push(fn);
      }
      catch(e){ __ERR__ = __ERR__ || {}; __ERR__[fn] = e.message; }
    }
  });
  globalThis.__OUT__ = __html__;
  globalThis.__RAN__ = __ran__;
  globalThis.__ERR__ = typeof __ERR__ !== 'undefined' ? __ERR__ : {};
})();
`;

// 像浏览器一样一次性加载全部脚本（共享全局作用域），以正确处理跨文件依赖
// （如 content.js 的 renderContent 依赖 ui.js 的 getFilteredContents）
const RENDER_LOAD_FILES = [
  'store.js', 'ui.js', 'export.js',
  'views/today.js', 'views/table-parser.js', 'views/content.js',
  'views/data.js', 'views/calendar.js', 'views/overview.js', 'views/llm.js',
];

function runCombinedRender() {
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  let code = '';
  for (const f of RENDER_LOAD_FILES) {
    code += '\n;// === ' + f + ' ===\n' + fs.readFileSync(path.join(JS_DIR, f), 'utf8');
  }
  code += '\n' + HARNESS;
  vm.runInContext(code, sandbox);
  return { html: sandbox.__OUT__ || '', ran: sandbox.__RAN__ || [], err: sandbox.__ERR__ || {} };
}

console.log('\n[2] 运行时 XSS 渲染测试（恶意输入必须被转义）');
let combined = null;
test('全部渲染函数在真实代码下成功执行（无脚本错误）', () => {
  combined = runCombinedRender();
  const expected = ['renderContentDetail', 'renderContentItem', 'renderVideoDataModal', 'renderContent', 'renderReviewPanel'];
  const notRan = expected.filter(fn => !combined.ran.includes(fn));
  assert.ok(notRan.length === 0, '以下渲染函数未执行：' + notRan.join(', ') + (Object.keys(combined.err).length ? '；错误：' + JSON.stringify(combined.err) : ''));
});
test('生成的 HTML 不含未转义的原始恶意字符串，且确实发生了转义', () => {
  assert.ok(combined !== null, '尚未执行渲染');
  assert.ok(!combined.html.includes(PAYLOAD), '生成的 HTML 仍含未转义的原始恶意字符串 <img ...>');
  // 关键危险点是「可直接执行的链接属性」：href="javascript:..."。
  // 注意：javascript: 作为转义后的纯文本出现是安全的（不会执行），故只查属性形式。
  assert.ok(!/href\s*=\s*["']?\s*javascript:/i.test(combined.html), '生成的 HTML 仍存在可直接执行的 javascript: 链接属性');
  assert.ok(combined.html.includes('&lt;img'), '未观察到转义后的 &lt;img，转义可能未生效');
});

// ============================================================
// 测试 3：导出 / 导入 JSON 字段对称（备份安全）
// exportData 写出 7 个数据字段，importData（及状态恢复）必须能原样读回
// ============================================================
console.log('\n[3] 导出/导入 JSON 字段对称');
test('导出写出的 7 个字段与导入读取的字段完全一致', () => {
  const src = fs.readFileSync(path.join(JS_DIR, 'export.js'), 'utf8');

  // 导出侧：const data = { ... } 中出现的已知数据字段
  const dataMatch = src.match(/const data = \{([\s\S]*?)\};/);
  assert.ok(dataMatch, '未找到 exportData 的 const data = {...}');
  const exportKeys = new Set(KNOWN_DATA_FIELDS.filter(f => dataMatch[1].includes(f)));

  // 导入侧：data.xxx 读取 + 形如 X = s.xxx 的状态恢复
  const importRead = new Set();
  let m;
  const readRe = /data\.([A-Za-z_$][\w$]*)/g;
  while ((m = readRe.exec(src))) if (KNOWN_DATA_FIELDS.includes(m[1])) importRead.add(m[1]);
  const restoreRe = /\b(contents|stats|reviews|accountStats|accountIds)\s*=\s*[a-zA-Z_$][\w$]*\.(contents|stats|reviews|accountStats|accountIds)/g;
  while ((m = restoreRe.exec(src))) { importRead.add(m[1]); importRead.add(m[2]); }

  const missing = KNOWN_DATA_FIELDS.filter(k => !importRead.has(k));
  const orphan = KNOWN_DATA_FIELDS.filter(k => !exportKeys.has(k));

  if (orphan.length) throw new Error('导出未写出的字段：' + orphan.join(', '));
  if (missing.length) throw new Error('导入未读取的字段：' + missing.join(', '));
  assert.strictEqual(exportKeys.size, KNOWN_DATA_FIELDS.length, '导出字段数异常');
});

// ============================================================
// 测试 4：导出报表含视频复盘记录栏；有复盘时显示、无复盘时不显示；
// 报表中不应再出现任何文书/AI收录相关内容
// 以 <h2> 章节标题作为定位锚点（meta 行也会含这些文字，plain indexOf 会误判）
// ============================================================
console.log('\n[4] 导出报表复盘记录栏');
function buildReportHtmlWithReviews(reviewsData) {
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  let code = '';
  for (const f of RENDER_LOAD_FILES) {
    code += '\n;// === ' + f + ' ===\n' + fs.readFileSync(path.join(JS_DIR, f), 'utf8');
  }
  const inject = `
    ;(function(){
      contents = [{ id:99, platform:'抖音', title:'测试视频', createdAt:'2026-08-12' }];
      reviews = ${JSON.stringify(reviewsData)};
      globalThis.__HTML__ = buildReportHtml('all', '全量');
    })();
  `;
  vm.runInContext(code + inject, sandbox);
  return sandbox.__HTML__ || '';
}
test('有视频复盘记录时显示「视频平台复盘记录」栏', () => {
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })();
  const html = buildReportHtmlWithReviews([
    { id:1, type:'video', period:'week', date: today, highlights:'视频亮点', problems:'视频问题', plans:'视频计划' },
  ]);
  assert.ok(html.indexOf('<h2>视频平台复盘记录') >= 0, '未出现「视频平台复盘记录」栏');
});
test('无复盘记录时不显示复盘栏，且报表不含任何文书/AI收录内容', () => {
  const html = buildReportHtmlWithReviews([]);
  assert.ok(html.indexOf('<h2>视频平台复盘记录</h2>') < 0, '无复盘时不应出现视频平台复盘记录栏');
  assert.ok(html.indexOf('文书') < 0, '报表不应再出现「文书」字样');
  assert.ok(html.indexOf('AI收录') < 0, '报表不应再出现「AI收录」字样');
});

// ============================================================
// 汇总
// ============================================================
console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.log('\n失败详情：');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + f.err));
  process.exit(1);
} else {
  console.log('全部通过 \u2705');
  process.exit(0);
}
