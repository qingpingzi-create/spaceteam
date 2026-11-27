(() => {
 'use strict';
 const $ = id => document.getElementById(id), STORE = 'space-crew-flights-v1', PROFILES = 'space-crew-players-v1';
 const names = { keyboard: '空格键', mouse: '鼠标', touch: '触屏' };
 const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
 const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
 let report = null, view = 'ranking', mode = 'keyboard', offset = 0, items = [], generation = 0, busy = false, payload = null, memoryProfiles = [];
 function read(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value || fallback; } catch { return fallback; } }
 function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
 function profiles() { const value = read(PROFILES, memoryProfiles); return Array.isArray(value) ? value.filter(p => p && typeof p.nickname === 'string' && /^[a-f0-9]{64}$/.test(p.token)) : []; }
 function profileFor(nickname) {
  const all = profiles(), key = nickname.toLocaleLowerCase('zh-CN');
  let player = all.find(p => p.nickname.toLocaleLowerCase('zh-CN') === key);
  if (!player) {
   const bytes = crypto.getRandomValues(new Uint8Array(32));
   player = { nickname, token: [...bytes].map(x => x.toString(16).padStart(2, '0')).join('') };
  }
  memoryProfiles = [player, ...all.filter(p => p.token !== player.token)];
  const remembered = write(PROFILES, memoryProfiles);
  return { ...player, remembered };
 }
 async function request(path, options = {}) {
  if (!/^https?:$/.test(location.protocol)) throw Error('离线文件模式不连接共享榜。请通过已部署的网站或本机服务使用排行榜。');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
   const response = await fetch(path, { ...options, signal: controller.signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
   if (!(response.headers.get('Content-Type') || '').includes('application/json')) throw Error('共享榜服务未就绪。请使用支持数据库的游戏网址。');
   const data = await response.json();
   if (!response.ok) throw Error(data.error || '排行榜暂时无法连接。');
   return data;
  } catch (error) {
   if (error.name === 'AbortError') throw Error('连接超时，成绩已保存在本机，可以再次提交。');
   throw error;
  } finally { clearTimeout(timer); }
 }
 function setStats(data) {
  for (const prefix of ['home', 'board']) {
   $(prefix + 'Players').textContent = Number(data.totalPlayers).toLocaleString('zh-CN');
   $(prefix + 'Games').textContent = Number(data.totalGames).toLocaleString('zh-CN');
  }
  $('communityStatus').textContent = '已提交正式成绩 · 昵称档案去重';
 }
 async function loadStats() {
  try { setStats(await request('/api/stats')); }
  catch { $('communityStatus').textContent = '共享数据暂不可用 · 本机游戏仍可使用'; }
 }
 function storeNickname(nickname, status) {
  report.nickname = nickname; report.cloudStatus = status;
  const local = read(STORE, []);
  if (Array.isArray(local)) write(STORE, local.map(r => r.id === report.id ? { ...r, nickname, cloudStatus: status } : r));
  $('resultPlayerName').textContent = nickname;
  const prior = Array.isArray(local) ? local.find(r => r.id !== report.id && r.mode === report.mode && r.nickname?.toLocaleLowerCase('zh-CN') === nickname.toLocaleLowerCase('zh-CN')) : null;
  const delta = prior ? report.result.total - prior.result.total : null;
  $('resultImprovement').textContent = prior ? `昵称「${nickname}」本次 ${report.result.total} 分，${delta > 0 ? '比上次提高 ' + delta + ' 分' : delta === 0 ? '与上次同分' : '比上次低 ' + Math.abs(delta) + ' 分'}。请在同设备、同操作方式下比较。` : `这是昵称「${nickname}」在本机的第一份${names[report.mode]}记录。继续挑战，就能比较自己的进步。`;
 }
 function onResult(value) {
  report = value; payload = null;
  const recent = profiles()[0]?.nickname || '';
  $('onlineResult').innerHTML = `<div class="nickname-copy"><div class="eyebrow">LEAVE YOUR CALL SIGN</div><h3>给这次飞行，留下你的昵称</h3><p>提交后加入共享排行榜，历次成绩会长期保留。使用昵称即可，无需填写真实姓名。</p></div><form id="nicknameForm" class="nickname-form"><label for="playerNickname">玩家昵称</label><div class="nickname-input-row"><input id="playerNickname" name="nickname" type="text" maxlength="32" autocomplete="nickname" placeholder="例如：追星小宇航员" value="${escape(recent)}" required><button class="button primary" type="submit" id="submitScoreButton">保存昵称并上榜</button></div><p id="submissionStatus" class="submission-status" role="status">昵称 1～16 个字符。同一浏览器的相同昵称视为同一位玩家。</p></form><div class="submitted-actions" id="submittedActions" hidden><button class="button secondary small" id="resultBoardButton">查看排行榜与历史</button></div>`;
  $('nicknameForm').addEventListener('submit', async event => {
   event.preventDefault(); if ($('submitScoreButton').disabled) return;
   const nickname = normalize($('playerNickname').value);
   if ([...nickname].length < 1 || [...nickname].length > 16 || /[<>\p{C}]/u.test(nickname)) { $('submissionStatus').textContent = '请输入 1～16 个字符的昵称，避免尖括号和控制字符。'; return; }
   const button = $('submitScoreButton'), field = $('playerNickname');
   try {
    if (!payload) {
     const player = profileFor(nickname);
     payload = { id: report.id, nickname, playerToken: player.token, mode: report.mode, records: report.records };
     storeNickname(nickname, 'pending');
     if (!player.remembered) $('submissionStatus').textContent = '此浏览器无法记住昵称档案；本次仍可提交，重新打开后无法识别原玩家。';
    }
    field.disabled = true; button.disabled = true; button.textContent = '正在提交…';
    $('submissionStatus').textContent = '正在保存到共享排行榜…';
    const data = await request('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    storeNickname(payload.nickname, 'submitted'); setStats(data);
    button.textContent = '已保存并上榜';
    $('submissionStatus').textContent = `已记录 ${payload.nickname} 的 ${data.saved.score} 分成绩。重复点击或重试不会增加次数。`;
    $('submissionStatus').classList.add('success'); $('submittedActions').hidden = false;
   } catch (error) {
    button.disabled = false; button.textContent = '重试提交';
    $('submissionStatus').textContent = error.message || '暂时无法提交，成绩仍保存在本机。';
    $('submittedActions').hidden = false;
   }
  });
  $('resultBoardButton').addEventListener('click', open);
 }
 function date(value) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(new Date(value)); }
 function drawRows() {
  if (!items.length) {
   $('leaderboardContent').innerHTML = `<div class="empty-state"><h3>${view === 'ranking' ? '还没有上榜成绩' : '这个昵称还没有此操作方式的云端成绩'}</h3><p>完成正式挑战并提交昵称，留下第一份飞行记录。</p></div>`; return;
  }
  $('leaderboardContent').innerHTML = `<div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>${view === 'ranking' ? '排名' : '次数'}</th><th>玩家 / 时间</th><th>得分</th><th>反应 / 正确率</th></tr></thead><tbody>${items.map((r, i) => `<tr><td><span class="rank-number ${view === 'ranking' && r.rank <= 3 ? 'medal' : ''}">${view === 'ranking' ? String(r.rank).padStart(2, '0') : i + 1}</span></td><td><strong>${escape(r.nickname)}</strong><small>${date(r.createdAt)} · 北京时间</small></td><td class="rank-score">${Number(r.score)}<small> 分</small></td><td>${r.medianMs === null ? '—' : Number(r.medianMs)} ms<small>正确率 ${Number(r.accuracy)}%</small></td></tr>`).join('')}</tbody></table></div>`;
 }
 function fillProfiles() {
  const all = profiles(), selected = $('historyPlayerSelect').value;
  $('historyPlayerSelect').innerHTML = all.map((p, i) => `<option value="${i}">${escape(p.nickname)}</option>`).join('');
  if (selected && all[Number(selected)]) $('historyPlayerSelect').value = selected;
  else $('historyPlayerSelect').value = '0';
 }
 async function loadBoard(append = false) {
  const run = ++generation;
  if (!append) { offset = 0; items = []; $('leaderboardContent').innerHTML = '<p class="board-loading">正在读取飞行记录…</p>'; }
  busy = true; $('boardLoadMore').disabled = true; $('boardRefreshButton').disabled = true;
  $('boardStatus').textContent = ''; $('boardLoadMore').hidden = true;
  try {
   let data;
   if (view === 'ranking') data = await request(`/api/leaderboard?mode=${mode}&offset=${offset}`);
   else {
    const player = profiles()[Number($('historyPlayerSelect').value)];
    if (!player) { $('leaderboardContent').innerHTML = '<div class="empty-state"><h3>先留下一个昵称</h3><p>完成正式挑战并提交昵称后，可以在这里查看你的云端历史成绩。</p></div>'; return; }
    data = await request(`/api/history?mode=${mode}&offset=${offset}`, { headers: { Authorization: `Bearer ${player.token}` } });
   }
   if (run !== generation) return;
   if (view === 'ranking') setStats(data);
   items = [...items, ...data.items]; offset = items.length;
   drawRows(); $('boardLoadMore').hidden = !data.hasMore;
   $('boardStatus').textContent = view === 'ranking' ? `${names[mode]}榜 · ${data.count} 位玩家 · 每人最高分` : `共 ${data.count} 次正式成绩 · 最新在前`;
  } catch (error) {
   if (run !== generation) return;
   if (!append) $('leaderboardContent').innerHTML = `<div class="empty-state"><h3>共享记录暂时无法读取</h3><p>${escape(error.message || '请稍后点击刷新再试。')}</p></div>`;
   $('boardStatus').textContent = '未能连接共享数据，可点击刷新重试。';
   if (append) $('boardLoadMore').hidden = false;
  } finally {
   if (run === generation) { busy = false; $('boardLoadMore').disabled = false; $('boardRefreshButton').disabled = false; }
  }
 }
 function open() {
  window.dispatchEvent(new Event('spacecrew:pause'));
  mode = $('inputMode').value; view = 'ranking'; fillProfiles(); updateFilters();
  if (!$('leaderboardDialog').open) $('leaderboardDialog').showModal();
  loadBoard();
 }
 function updateFilters() {
  document.querySelectorAll('[data-board-mode]').forEach(b => { b.classList.toggle('active', b.dataset.boardMode === mode); b.setAttribute('aria-pressed', String(b.dataset.boardMode === mode)); });
  document.querySelectorAll('[data-board-view]').forEach(b => { b.classList.toggle('active', b.dataset.boardView === view); b.setAttribute('aria-pressed', String(b.dataset.boardView === view)); });
  $('historyPlayerField').hidden = view !== 'history';
 }
 $('leaderboardButton').addEventListener('click', open); $('homeLeaderboardButton').addEventListener('click', open);
 $('boardModeFilters').addEventListener('click', event => { const button = event.target.closest('[data-board-mode]'); if (button && !busy) { mode = button.dataset.boardMode; updateFilters(); loadBoard(); } });
 $('boardViewFilters').addEventListener('click', event => { const button = event.target.closest('[data-board-view]'); if (button && !busy) { view = button.dataset.boardView; fillProfiles(); updateFilters(); loadBoard(); } });
 $('historyPlayerSelect').addEventListener('change', () => loadBoard());
 $('boardRefreshButton').addEventListener('click', () => { loadStats(); loadBoard(); });
 $('boardLoadMore').addEventListener('click', () => { if (!busy) loadBoard(true); });
 window.SpaceCrewOnline = { onResult, open };
 loadStats();
})();
