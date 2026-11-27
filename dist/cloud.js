(() => {
 'use strict';
 const $ = id => document.getElementById(id), STORE = 'space-crew-flights-v1', PROFILES = 'space-crew-players-v1';
 const browserBoard = window.SpaceCrewBrowserBoard;
 const names = { keyboard: '空格键', mouse: '鼠标', touch: '触屏' };
 const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
 const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
 let report = null, view = 'ranking', mode = 'keyboard', offset = 0, items = [], generation = 0, busy = false, payload = null, memoryProfiles = [];
 let active = null, phase = 'home', liveTimer = null, boardTimer = null, liveGeneration = 0, liveBusy = false, liveQueued = false, pendingLive = null, pendingLiveError = '', lastRank = null, previousRanks = new Map(), previousScope = '';
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
  if (browserBoard) return browserBoard.request(path, options);
  if (!/^https?:$/.test(location.protocol)) throw Error('离线文件模式不连接共享榜。请通过已部署的网站或本机服务使用排行榜。');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
   const response = await fetch(path, { ...options, signal: controller.signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
   if (!(response.headers.get('Content-Type') || '').includes('application/json')) throw Error('共享榜服务未就绪。请使用支持数据库的游戏网址。');
   const data = await response.json();
   if (!response.ok) throw Error(data.error || '排行榜暂时无法连接。');
   return data;
  } catch (error) {
   if (error.name === 'AbortError') throw Error('连接超时，请稍后重试。');
   throw error;
  } finally { clearTimeout(timer); }
 }
 function setStats(data) {
  for (const prefix of ['home', 'board']) {
   $(prefix + 'Players').textContent = Number(data.totalPlayers).toLocaleString('zh-CN');
   $(prefix + 'Games').textContent = Number(data.totalGames).toLocaleString('zh-CN');
  }
  $('communityStatus').textContent = browserBoard ? '仅统计此浏览器 · 相同昵称去重' : '已提交正式成绩 · 昵称档案去重';
 }
 async function loadStats() {
  try { setStats(await request('/api/stats')); }
  catch { $('communityStatus').textContent = browserBoard ? '此浏览器暂时无法读取成绩' : '共享数据暂不可用 · 本机游戏仍可使用'; }
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
 async function submitResult() {
  if (!payload || $('submitScoreButton').disabled) return;
  const button = $('submitScoreButton'); button.disabled = true; button.textContent = '正在保存…';
  $('submissionStatus').textContent = '正在自动保存最终成绩与历史记录…';
  try {
   const data = await request('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
   storeNickname(payload.nickname, 'submitted'); setStats(data);
   button.textContent = '已自动保存'; $('submissionStatus').classList.add('success');
   const destination = browserBoard ? '此浏览器' : '共享榜';
   $('submissionStatus').textContent = `${payload.nickname} 的 ${data.saved.score} 分成绩已保存到${destination}，积分榜已更新。`;
  } catch (error) {
   button.disabled = false; button.textContent = '重试保存';
   $('submissionStatus').textContent = error.message || '暂时无法保存到共享榜，本机成绩已保留。';
  }
 }
 async function onResult(value) {
  onStop(); report = value; payload = null;
  $('onlineResult').innerHTML = `<div class="nickname-copy"><div class="eyebrow">FLIGHT LOG / AUTO SAVE</div><h3>挑战完成，正在记录你的成绩</h3><p>玩家：<strong>${escape(value.nickname)}</strong>。最终成绩会自动加入${browserBoard ? '本机' : '共享'}积分榜。</p></div><div class="result-save-controls"><button class="button primary" id="submitScoreButton">自动保存成绩</button><p id="submissionStatus" class="submission-status" role="status">正在准备保存…</p><button class="button secondary small" id="resultBoardButton">查看积分榜与历史</button></div>`;
  $('submitScoreButton').addEventListener('click', submitResult);
  $('resultBoardButton').addEventListener('click', open);
  try {
   const player = profileFor(value.nickname);
   payload = { id: value.id, nickname: value.nickname, playerToken: player.token, mode: value.mode, records: value.records };
   storeNickname(value.nickname, 'pending');
   await submitResult();
  } catch { $('submissionStatus').textContent = '无法识别昵称档案，成绩已保存在本机。'; }
 }
 function date(value) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(new Date(value)); }
 function movement(change) {
  return change > 0 ? `<span class="rank-movement rising">上升 ${change} 位</span>` : change < 0 ? `<span class="rank-movement falling">下降 ${Math.abs(change)} 位</span>` : '<span class="rank-movement unchanged">位次保持</span>';
 }
 function drawRows() {
  if (!items.length) {
   const emptyTitle = view === 'ranking' ? '还没有上榜成绩' : '这个昵称还没有此操作方式的成绩';
   $('leaderboardContent').innerHTML = `<div class="empty-state"><h3>${emptyTitle}</h3><p>开始前填写昵称，完成正式挑战就能留下记录。</p></div>`; return;
  }
  const scope = `${view}:${mode}`, sameScope = previousScope === scope;
  $('leaderboardContent').innerHTML = `<div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>${view === 'ranking' ? '排名 / 变化' : '次数'}</th><th>玩家 / 时间</th><th>得分</th><th>反应 / 正确率</th></tr></thead><tbody>${items.map((r, i) => {
   const previous = sameScope && r.playerRef ? previousRanks.get(r.playerRef) : undefined;
   const change = previous === undefined ? null : previous - r.rank;
   return `<tr class="${change ? 'rank-row-moved' : ''}"><td><span class="rank-number ${view === 'ranking' && r.rank <= 3 ? 'medal' : ''}">${view === 'ranking' ? String(r.rank).padStart(2, '0') : i + 1}</span>${view === 'ranking' ? change === null ? '<span class="rank-movement unchanged">首次显示</span>' : movement(change) : ''}</td><td><strong>${escape(r.nickname)}</strong><small>${date(r.createdAt)} · 北京时间</small></td><td class="rank-score">${Number(r.score)}<small> 分</small></td><td>${r.medianMs === null ? '—' : Number(r.medianMs)} ms<small>正确率 ${Number(r.accuracy)}%</small></td></tr>`;
  }).join('')}</tbody></table></div>`;
  previousRanks = new Map(items.filter(r => r.playerRef).map(r => [r.playerRef, r.rank])); previousScope = scope;
 }
 function fillProfiles() {
  const all = profiles(), selected = $('historyPlayerSelect').value;
  $('historyPlayerSelect').innerHTML = all.map((p, i) => `<option value="${i}">${escape(p.nickname)}</option>`).join('');
  if (selected && all[Number(selected)]) $('historyPlayerSelect').value = selected;
  else $('historyPlayerSelect').value = '0';
 }
 async function loadBoard(append = false, silent = false) {
  const wanted = Math.max(20, items.length);
  const run = ++generation;
  if (!append) { offset = 0; if (!silent) { items = []; $('leaderboardContent').innerHTML = '<p class="board-loading">正在读取飞行记录…</p>'; } }
  busy = true; $('boardLoadMore').disabled = true; $('boardRefreshButton').disabled = true;
  $('boardStatus').textContent = ''; $('boardLoadMore').hidden = true;
  try {
   let data;
   if (view === 'ranking') {
    data = await request(`/api/leaderboard?mode=${mode}&offset=${offset}`);
    if (silent) { let merged = [...data.items]; while (data.hasMore && merged.length < wanted) { data = await request(`/api/leaderboard?mode=${mode}&offset=${merged.length}`); merged.push(...data.items); } data.items = merged; }
   }
   else {
    const player = profiles()[Number($('historyPlayerSelect').value)];
    if (!player) { $('leaderboardContent').innerHTML = '<div class="empty-state"><h3>先留下一个昵称</h3><p>完成正式挑战后，可以在这里查看你的历史成绩。</p></div>'; return; }
    data = await request(`/api/history?mode=${mode}&offset=${offset}`, { headers: { Authorization: `Bearer ${player.token}` } });
   }
   if (run !== generation) return;
   if (view === 'ranking') setStats(data);
   items = append ? [...items, ...data.items] : data.items; offset = items.length;
   drawRows(); $('boardLoadMore').hidden = !data.hasMore;
   $('boardStatus').textContent = view === 'ranking' ? `${names[mode]}榜 · ${data.count} 位玩家 · 已自动更新` : `共 ${data.count} 次正式成绩 · 最新在前`;
  } catch (error) {
   if (run !== generation) return;
   if (!append) $('leaderboardContent').innerHTML = `<div class="empty-state"><h3>成绩记录暂时无法读取</h3><p>${escape(error.message || '请稍后点击刷新再试。')}</p></div>`;
   $('boardStatus').textContent = '未能读取成绩，可点击刷新重试。';
   if (append) $('boardLoadMore').hidden = false;
  } finally {
   if (run === generation) { busy = false; $('boardLoadMore').disabled = false; $('boardRefreshButton').disabled = false; }
  }
 }
 function open() {
  window.dispatchEvent(new Event('spacecrew:pause'));
  mode = $('inputMode').value; view = 'ranking'; fillProfiles(); updateFilters();
  if (!$('leaderboardDialog').open) $('leaderboardDialog').showModal();
  const loading = loadBoard(); scheduleBoard(); return loading;
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
 function scheduleBoard() {
  clearTimeout(boardTimer);
  if (!$('leaderboardDialog').open) return;
  boardTimer = setTimeout(() => {
   if ($('leaderboardDialog').open && !document.hidden && view === 'ranking' && !busy) loadBoard(false, true);
   scheduleBoard();
  }, 5000);
 }
 function paintLive() {
  if (!active || !['briefing', 'feedback', 'paused'].includes(phase)) return;
  if (pendingLiveError) {
   $('liveRankStatus').textContent = pendingLiveError; pendingLiveError = '';
   if (lastRank === null) { $('liveRank').textContent = '—'; $('liveRankDelta').textContent = '积分榜暂不可用'; }
   else { $('liveRankDelta').textContent = '上次读取的位次'; $('liveRankDelta').className = ''; }
  }
  if (!pendingLive) return;
  const data = pendingLive; pendingLive = null;
  if (data.completed !== active.records.length) return;
  const change = lastRank === null ? null : lastRank - data.rank;
  $('liveRank').textContent = `第 ${data.rank} 名`;
  $('liveRankDelta').textContent = change === null ? '首次定位' : change > 0 ? `上升 ${change} 位` : change < 0 ? `下降 ${Math.abs(change)} 位` : '位次保持';
  $('liveRankDelta').className = change > 0 ? 'rising' : change < 0 ? 'falling' : '';
  $('liveRankRows').innerHTML = data.items.map(r => `<div class="live-rank-row ${r.isYou ? 'is-you' : ''} ${r.isYou && change ? 'rank-row-moved' : ''}"><span class="mini-rank">${r.rank}</span><span class="mini-nickname">${escape(r.isYou ? active.nickname : r.nickname)}${r.isYou ? '<small>你 · 预计</small>' : ''}</span><strong>${r.score}<small> 分</small></strong></div>`).join('');
  $('liveRankStatus').textContent = data.rankedScore > data.score ? `历史最佳 ${data.rankedScore} 分参与预计排名；本轮当前 ${data.score} 分。` : '每题更新预计位次，完整挑战结束后正式保存。';
  lastRank = data.rank;
 }
 async function refreshLive() {
  if (!active || active.isPractice) return;
  if (liveBusy) { liveQueued = true; return; }
  liveBusy = true; liveQueued = false;
  const version = liveGeneration, snapshot = { id: active.id, nickname: active.nickname, playerToken: active.player.token, mode: active.mode, records: [...active.records] };
  try {
   const data = await request('/api/live-position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) });
   if (version !== liveGeneration || !active) return;
   if (data.completed === active.records.length) { pendingLive = data; paintLive(); }
  } catch {
   if (version !== liveGeneration || !active) return;
   pendingLiveError = browserBoard ? '暂时无法读取本机榜，当前积分照常更新。' : '共享榜暂时无法连接，当前积分照常更新；联网后自动重试。'; paintLive();
  } finally {
   if (version === liveGeneration) { liveBusy = false; if (liveQueued) refreshLive(); }
  }
 }
 function scheduleLive() {
  clearTimeout(liveTimer);
  if (!active || active.isPractice) return;
  liveTimer = setTimeout(() => { if (!document.hidden) refreshLive(); scheduleLive(); }, 5000);
 }
 function onStop() {
  clearTimeout(liveTimer); active = null; phase = 'home'; liveGeneration++; liveBusy = false; liveQueued = false; pendingLive = null; pendingLiveError = '';
 }
 function onStart(session) {
  onStop(); lastRank = null; phase = 'briefing';
  $('liveRank').textContent = session.isPractice ? '—' : '读取中';
  $('liveRankDelta').textContent = session.isPractice ? '练习不上榜' : '预计名次尚未结算';
  $('liveRankRows').innerHTML = session.isPractice ? '<p>练习模式不参与积分榜</p>' : '<p>正在读取你附近的位次…</p>';
  $('liveBoardBadge').textContent = session.isPractice ? '练习' : '实时预览';
  try {
   active = { ...session, records: [], player: profileFor(session.nickname) };
   if (!session.isPractice) { scheduleLive(); return refreshLive(); }
  } catch { $('liveRankStatus').textContent = '无法建立昵称档案，当前挑战仍可继续。'; }
 }
 function onProgress(snapshot) {
  phase = snapshot.state;
  if (!active || snapshot.id !== active.id) return;
  const changed = snapshot.records.length !== active.records.length;
  active.records = snapshot.records;
  paintLive();
  if (changed && !active.isPractice) return refreshLive();
 }
 function onPhase(value) { phase = value; paintLive(); }
 $('leaderboardDialog').addEventListener('close', () => { clearTimeout(boardTimer); generation++; });
 const recentPlayer = profiles()[0]; if (recentPlayer && !$('playerNickname').value) $('playerNickname').value = recentPlayer.nickname;
 window.SpaceCrewOnline = { onResult, open, onStart, onProgress, onPhase, onStop };
 loadStats();
})();
