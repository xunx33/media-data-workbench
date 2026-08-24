'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'js');

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
const sandbox = {
  console,
  setInterval: () => 0, setTimeout: () => 0, clearInterval: () => {}, clearTimeout: () => {},
  fetch: async () => ({ ok: false, json: async () => [] }),
  document: {
    getElementById() { return fakeEl(); }, querySelector() { return fakeEl(); },
    querySelectorAll() { return []; }, addEventListener() {}, createElement() { return fakeEl(); },
    body: fakeEl(),
  },
  window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { href: '' },
  Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Boolean,
  isNaN, parseInt, parseFloat, encodeURIComponent,
  showToast: () => {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = ['store.js', 'ui.js', 'views/today.js', 'views/llm.js', 'views/calendar.js',
  'views/overview.js', 'views/content.js', 'views/table-parser.js', 'views/data.js',
  'export.js', 'sample-migration.js'];
for (const f of files) {
  vm.runInContext('\n;// === ' + f + ' ===\n' + fs.readFileSync(path.join(JS, f), 'utf8'), sandbox);
}

// 构造样例数据：本月内容 + 多日视频数据
// 注意：store.js 顶层是 let 绑定，必须在上下文内赋值（外部 sandbox.xxx= 只挂到全局对象，会被词法绑定遮蔽）
const today = sandbox.getToday();
const ymd = d => sandbox.getDayStr(d);
const d1 = new Date(); d1.setDate(d1.getDate() - 1);
const d2 = new Date(); d2.setDate(d2.getDate() - 2);
vm.runInContext(`
  workspace = 'video';
  contents = ${JSON.stringify([
    { id: 1, platform: '抖音', title: 't1', createdAt: today },
    { id: 2, platform: '小红书', title: 't2', createdAt: ymd(d1) },
    { id: 3, platform: '视频号', title: 't3', createdAt: ymd(d2) },
  ])};
  stats = ${JSON.stringify([
    { id: 11, contentId: 1, platform: '抖音', date: today, views: 12000, likes: 300, comments: 40, favorites: 55, followers: 20, shares: 8 },
    { id: 12, contentId: 2, platform: '小红书', date: ymd(d1), views: 8000, likes: 210, comments: 25, favorites: 33, followers: 12, shares: 5 },
    { id: 13, contentId: 3, platform: '视频号', date: ymd(d2), views: 26000, likes: 520, comments: 77, favorites: 90, followers: 41, shares: 19 },
  ])};
  reviews = [];
  accountStats = [];
  accountIds = [];
  reviewPlatformFilter = '';
  overviewMonth = new Date();
`, sandbox);

const t1 = vm.runInContext('renderToday()', sandbox);
assert.ok(t1.includes('data-count'), 'renderToday: stat-value 缺 data-count');
assert.ok(t1.includes('statCardHtml') === false, 'renderToday: 不应出现未求值的 statCardHtml 字面量');

const t2 = vm.runInContext('renderOverview()', sandbox);
assert.ok(t2.includes('data-count'), 'renderOverview: 缺 data-count');
assert.ok(t2.includes('data-pie-uid'), 'renderOverview: 饼图缺 data-pie-uid');
assert.ok(t2.includes('class="pie-content"'), 'renderOverview: 饼图缺 pie-content 缩放容器');
assert.ok(t2.includes('pbar') && t2.includes('data-w='), 'renderOverview: 进度条缺 pbar/data-w');

const t3 = vm.runInContext('renderVideoData("month")', sandbox);
assert.ok(t3.includes('data-count'), 'renderVideoData: 缺 data-count');
assert.ok(t3.includes('data-h=') && t3.includes('height:0'), 'renderVideoData: 柱形缺 data-h / 初始 0');
assert.ok(t3.includes('trend-wrap') && t3.includes('trend-tip'), 'renderVideoData: 折线缺 trend-wrap / trend-tip');
assert.ok(t3.includes('trend-hit') && t3.includes('onmousemove="trendTipShow(this)"'), 'renderVideoData: 缺 hit 圆交互');
assert.ok(t3.includes('pathLength="1"') && t3.includes('stroke-dashoffset:1'), 'renderVideoData: 折线缺描绘动画属性');

// 单平台筛选分支
vm.runInContext(`reviewPlatformFilter = '抖音'`, sandbox);
const t4 = vm.runInContext('renderVideoData("week")', sandbox);
assert.ok(t4.includes('data-h='), 'renderVideoData(周/单平台): 柱形缺 data-h');
vm.runInContext(`reviewPlatformFilter = ''`, sandbox);

// statCardHtml 直测
const card = vm.runInContext('statCardHtml(12345, "总播放量")', sandbox);
assert.ok(card.includes('data-count="12345"') && card.includes('1.2w'), 'statCardHtml: 数值/格式异常 -> ' + card);

// 空数据不崩
vm.runInContext(`stats = []; contents = [];`, sandbox);
vm.runInContext('renderOverview()', sandbox);
vm.runInContext('renderVideoData("month")', sandbox);
vm.runInContext('renderToday()', sandbox);

console.log('冒烟测试全部通过 ✅');
