// start-ui.js — 启动器 UI（Node 版）
const { spawn, execSync } = require('child_process');
const net = require('net');
const path = require('path');
const readline = require('readline');

const PORT = parseInt(process.env.PORT) || 3000;
const ROOT = __dirname;
const SILENT = process.env.MCB_SILENT === '1'; // 静默模式：启动/复用服务后不开交互窗口、直接退出

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function line(icon, color, text) {
  console.log(`  ${color}${icon}${c.reset} ${text}`);
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    setTimeout(() => { socket.destroy(); resolve(false); }, 300);
  });
}

async function waitPortBusy(port, maxMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isPortBusy(port)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

// 用 netstat 查占用端口的 PID（Windows）
function getPortPid(port) {
  try {
    const out = execSync(`netstat -ano | findstr ":${port} " | findstr LISTENING`, { encoding: 'utf8', windowsHide: true });
    const m = out.match(/LISTENING\s+(\d+)/);
    return m ? parseInt(m[1]) : null;
  } catch (e) { return null; }
}

// 用 PowerShell 查 PID 对应的进程名（比 tasklist+正则稳健，兼容中文系统表头）
function getProcessName(pid) {
  try {
    const out = execSync(
      'powershell.exe -NoProfile -Command "(Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue).ProcessName"',
      { encoding: 'utf8', windowsHide: true }
    );
    const name = out.trim();
    return name || null;
  } catch (e) { return null; }
}

function pressEnter() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { resolve(); return; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(`  ${c.gray}按回车键关闭窗口...${c.reset}`);
    rl.once('line', () => { rl.close(); resolve(); });
  });
}

// 打开工作台：由启动脚本（.bat）在自身交互式控制台里用 start "" <url> 拉起浏览器。
// 实测结论：node 子进程（无论 cmd/explorer、无论 detached/windowsHide 组合）都无法从干净状态拉起浏览器，
// 只有 bat 控制台里的 start 可靠。node 在这里只提示访问地址。
function openWorkbench(port) {
  const url = 'http://localhost:' + port;
  line(' ', c.gray, `访问地址：${url}（浏览器由启动脚本拉起）`);
}

(async () => {
  console.log('');
  console.log(`  ${c.bold}${c.cyan}新媒体数据工作台${c.reset}`);
  console.log(`  ${c.gray}================================${c.reset}`);
  console.log('');

  // 1. 端口检测
  if (await isPortBusy(PORT)) {
    // 1a. 验证占用的是不是 node（防止误判其他程序占了端口）
    const pid = getPortPid(PORT);
    const procName = pid ? getProcessName(pid) : null;
    const isNode = procName && procName.toLowerCase().includes('node');

    if (isNode) {
      // 是我们的服务在跑：清晰友好提示
      line('✓', c.green, `后台服务已在运行（PID: ${pid}）`);
      line(' ', c.gray, `请直接打开 http://localhost:${PORT}`);
    } else {
      // 被其他程序占了：明确报错 + 给出解决建议
      line('✗', c.red, `端口 ${PORT} 被其他程序占用（${procName || '未知'}，PID: ${pid || '?'}）`);
      line(' ', c.gray, `换端口启动：set PORT=3001 && ViewStart.bat`);
      console.log('');
      await pressEnter();
      process.exit(1);
    }
  } else {
    // 2. 启动 server.js 为独立后台进程
    line('▶ ', c.cyan, '正在启动 Node.js 服务...');
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,   // 完全后台：不让 server.js 的 console 窗口出现在任务栏
      cwd: ROOT,
    });
    child.unref();

    // 3. 等待就绪
    const ok = await waitPortBusy(PORT, 8000);
    if (ok) {
      line('✓', c.green, `服务已在后台运行  PID: ${child.pid}  端口: ${PORT}`);
    } else {
      line('✗', c.red, '服务启动超时（端口未就绪）');
      line(' ', c.gray, '排查：手动运行 node server.js 查看错误');
      console.log('');
      await pressEnter();
      process.exit(1);
    }
  }

  // 4. 打开工作台（优先 PWA App，退回浏览器）
  console.log('');
  line('🌐', c.cyan, '打开工作台...');
  await openWorkbench(PORT);

  // 5. 成功提示
  console.log('');
  console.log(`  ${c.bold}${c.green}工作台已就绪！${c.reset}`);
  console.log(`  ${c.gray}服务在后台独立运行，可以直接关闭此窗口${c.reset}`);
  console.log(`  ${c.gray}停止服务：任务管理器 → 结束 node.exe 进程${c.reset}`);
  console.log('');

  if (SILENT) { process.exit(0); } // 静默模式：服务已在后台跑，直接退出，不卡交互窗口
  await pressEnter();
  process.exit(0);
})();