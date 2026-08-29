// ===== 法定节假日数据 =====
// 每个条目：{ start, end, name, color }
// start/end 格式 'YYYY-MM-DD'（含首尾）
const HOLIDAYS_DATA = {
  2026: [
    { start:'2026-01-01', end:'2026-01-03', name:'元旦', color:'#ef4444' },
    { start:'2026-02-15', end:'2026-02-21', name:'春节', color:'#ef4444' },
    { start:'2026-04-04', end:'2026-04-06', name:'清明节', color:'#f97316' },
    { start:'2026-05-01', end:'2026-05-05', name:'劳动节', color:'#ef4444' },
    { start:'2026-05-31', end:'2026-06-02', name:'端午节', color:'#f97316' },
    { start:'2026-09-25', end:'2026-09-27', name:'中秋节', color:'#f97316' },
    { start:'2026-10-01', end:'2026-10-07', name:'国庆节', color:'#ef4444' },
  ],
  2027: [
    { start:'2027-01-01', end:'2027-01-03', name:'元旦', color:'#ef4444' },
    { start:'2027-02-06', end:'2027-02-12', name:'春节', color:'#ef4444' },
    { start:'2027-04-03', end:'2027-04-05', name:'清明节', color:'#f97316' },
    { start:'2027-05-01', end:'2027-05-05', name:'劳动节', color:'#ef4444' },
    { start:'2027-06-19', end:'2027-06-21', name:'端午节', color:'#f97316' },
    { start:'2027-09-15', end:'2027-09-17', name:'中秋节', color:'#f97316' },
    { start:'2027-10-01', end:'2027-10-07', name:'国庆节', color:'#ef4444' },
  ],
  2028: [
    { start:'2028-01-01', end:'2028-01-03', name:'元旦', color:'#ef4444' },
    { start:'2028-01-23', end:'2028-01-29', name:'春节', color:'#ef4444' },
    { start:'2028-04-04', end:'2028-04-06', name:'清明节', color:'#f97316' },
    { start:'2028-05-01', end:'2028-05-05', name:'劳动节', color:'#ef4444' },
    { start:'2028-06-16', end:'2028-06-18', name:'端午节', color:'#f97316' },
    { start:'2028-09-22', end:'2028-09-24', name:'中秋节', color:'#f97316' },
    { start:'2028-10-01', end:'2028-10-07', name:'国庆节', color:'#ef4444' },
  ],
};

// 返回 { name, color } 或 null
function getHolidayInfo(dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const holidays = HOLIDAYS_DATA[y];
  if (!holidays) return null;
  for (const h of holidays) {
    if (dateStr >= h.start && dateStr <= h.end) return { name: h.name, color: h.color };
  }
  return null;
}

function renderCalendar() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = getToday();

  let html = `<div class="card"><div class="calendar-header"><div class="calendar-nav">
    <button onclick="changeMonth(-1)">&#8249;</button>
    <span class="calendar-month">${year}年${month+1}月</span>
    <button onclick="changeMonth(1)">&#8250;</button>
  </div><button class="btn-today" onclick="goToday()">今天</button></div>`;

  html += `<div class="calendar-grid">
    <div class="day-header">日</div><div class="day-header">一</div><div class="day-header">二</div><div class="day-header">三</div><div class="day-header">四</div><div class="day-header">五</div><div class="day-header">六</div>`;

  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = 0; i < firstDay; i++) html += `<div class="calendar-day other-month">${prevMonthDays - firstDay + i + 1}</div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedDate;
    const holiday = getHolidayInfo(dateStr);
    // 圆点统一逻辑：
    //   第一点=当日登记：无任何登记留空 / 部分平台有登记=黄 / 全部平台都有登记=绿
    //   第二点=数据录入：当日登记内容全部已录入数据=绿 / 个别未录入=黄 / 无登记内容不显示
    const dayStats = getDayPlatformStatus(dateStr);
    let classes = 'calendar-day';
    if (isToday) classes += ' today';
    if (isSelected) classes += ' selected';
    if (holiday) classes += ' holiday';
    html += `<div class="${classes}" onclick="selectDay('${dateStr}')"${holiday ? ' title="'+holiday.name+'"' : ''}>${d}`;
    // 节假日角标（非选中态显示红色小标）
    if (holiday && !isSelected) html += `<span class="holiday-tag" style="background:${holiday.color}">${holiday.name}</span>`;
    html += '<div class="dots">';
    if (dayStats.hasContent) {
      html += dayStats.allRegistered
        ? '<span class="dot done"></span>'
        : '<span class="dot warn"></span>';
      if (dayStats.hasDataEntry) {
        html += dayStats.allDataEntered
          ? '<span class="dot done"></span>'
          : '<span class="dot warn"></span>';
      }
    }
    html += '</div></div>';
  }
  html += '</div></div>';

  if (selectedDate) {
    const counts = getDayCounts(selectedDate);
    const isPast = selectedDate < todayStr;
    const selHoliday = getHolidayInfo(selectedDate);
    html += `<div class="day-detail"><h4>${selectedDate} 发布任务${selHoliday ? '　<span style="font-size:12px;font-weight:400;color:#ef4444;">🎉 ' + selHoliday.name + '（法定节假日）</span>' : ''}</h4>`;
    // 只显示短视频平台
    html += '<div style="font-size:12px;color:var(--video-orange-light);margin-bottom:4px;font-weight:600;">短视频平台（全部 4 个有内容）</div>';
    VIDEO_PLATFORMS.forEach(p => html += renderDayPlatformItem(p, counts[p], selectedDate, 'video'));
    html += '</div>';
  }
  return html;
}

// 单平台日历行：平台标签 + 已发条数/未登记 + [+1] 按钮 + 内容展开
function renderDayPlatformItem(platform, count, date, type) {
  const list = getPlatformContents(date, platform);
  const taskKey = platform + '|' + date;   // 展开状态 key（保存重绘后据此恢复展开）
  const isOpen = expandedTaskKeys.has(taskKey);
  let html = `<div class="day-task ${count > 0 ? 'has-detail' : ''}">
    <div class="day-task-row">
      <span class="task-name">
        <span class="platform-tag ${type}">${platform}</span>
        ${count > 0
          ? `<span style="color:var(--green);font-size:12px;font-weight:600;">已发 ${count} 条</span><span class="expand-toggle ${isOpen ? 'open' : ''}" onclick="toggleTaskDetail(this, '${taskKey}')">&#9660;</span>`
          : `<span style="color:var(--text3);font-size:12px;">未登记</span>`}
      </span>
      <button class="btn-done" onclick="openAddModal('${platform}', null, '${date}')">+1</button>
    </div>`;
  if (count > 0) {
    html += `<div class="task-detail ${isOpen ? 'open' : ''}">`;
    list.forEach(c => html += renderContentDetail(c));
    html += `</div>`;
  }
  html += '</div>';
  return html;
}

function changeMonth(delta) { shiftMonth(currentMonth, delta); render(); }
function goToday() { currentMonth = new Date(); selectedDate = getToday(); render(); }
function selectDay(date) { selectedDate = date; render(); }

// 当日平台登记 + 数据录入状态（视频平台）
// 返回：{ hasContent, allRegistered, hasDataEntry, allDataEntered }
//   hasContent    ：当日是否登记了内容（任一平台）
//   allRegistered ：全部平台都有登记
//   hasDataEntry  ：登记的内容中是否有任何一条已录入数据（视频 stats）
//   allDataEntered：每条登记内容都已录入数据
function getDayPlatformStatus(date) {
  const platforms = VIDEO_PLATFORMS;
  const dayContents = contents.filter(c => platforms.includes(c.platform) && c.createdAt === date);
  const hasContent = dayContents.length > 0;
  // 全部平台有登记 = 每个平台至少 1 条
  const allRegistered = platforms.every(p => dayContents.some(c => c.platform === p));
  // 数据录入判定：视频内容看 stats（按内容关联）
  const hasData = c => stats.some(s => s.contentId == c.id || s.contentId == Number(c.id));
  const entered = dayContents.filter(hasData);
  return {
    hasContent,
    allRegistered,
    hasDataEntry: entered.length > 0,
    allDataEntered: dayContents.length > 0 && entered.length === dayContents.length
  };
}

// 从数据复盘折线图点击数据点跳转：切到发布日历并定位到该日期所在月、选中该日
function goCalendarDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) { showToast('无效日期'); return; }
  currentMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  selectedDate = dateStr;
  currentTab = 'calendar';
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'calendar'));
  render();
}

// 折叠/展开登记内容列表（状态存 contentFoldOpen，render 后自动应用）
function toggleContentFold() {
  contentFoldOpen = !contentFoldOpen;
  applyContentFold();
}
function applyContentFold() {
  const body = document.getElementById('contentList');
  const arrow = document.getElementById('foldArrow');
  if (body) body.style.display = contentFoldOpen ? 'block' : 'none';
  if (arrow) arrow.innerHTML = contentFoldOpen ? '&#9650;' : '&#9660;';
}
