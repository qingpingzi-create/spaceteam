(() => {
 'use strict';
 const $ = id => document.getElementById(id);
 const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
 const art = name => `<svg class="target-art" aria-hidden="true"><use href="#art-${name}"/></svg>`;
 const modeNames = { keyboard: '空格键', mouse: '鼠标', touch: '触屏' };
 const STORE = 'space-crew-flights-v1';
 const screens = ['homeScreen', 'gameScreen', 'resultScreen'];
 let timer = null, raf = null, revision = 0, state = 'home', round = 1, trial = 0, records = [];
 let isPractice = false, mode = 'keyboard', roundTrials = [], signalAt = null, signalDeadline = null, currentKind = 'go';
 let resumeAction = null, exitResumeAction = null, currentReport = null, historyFilter = 'keyboard';
 let soundEnabled = false, audio = null, toastTimer = null, storageAvailable = true;
 let sessionId = '', sequenceOne = 10, sequenceTwo = 20;

 function readHistory() {
   try {
     const raw = JSON.parse(localStorage.getItem(STORE) || '[]');
     if (!Array.isArray(raw)) return [];
     return raw.filter(r => r && r.version === 1 && modeNames[r.mode] && typeof r.id === 'string' && Number.isFinite(r.timestamp) && r.result && Number.isFinite(r.result.total) && Array.isArray(r.records)).slice(0, 50);
   } catch { storageAvailable = false; return []; }
 }
 function saveHistory(items) {
   try { localStorage.setItem(STORE, JSON.stringify(items.slice(0, 50))); return true; }
   catch { storageAvailable = false; return false; }
 }
 function toast(message) {
   clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
   toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3800);
 }
 function stopClock() {
   clearTimeout(timer); cancelAnimationFrame(raf); timer = null; raf = null; revision++;
 }
 function later(callback, delay) {
   const version = revision;
   timer = setTimeout(() => { if (version === revision) callback(); }, delay);
 }
 function showScreen(name) {
   screens.forEach(id => { $(id).hidden = id !== name; });
   window.scrollTo({ top: 0, behavior: 'instant' });
 }
 function sound(success) {
   if (!soundEnabled) return;
   try {
     if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
     const osc = audio.createOscillator(), gain = audio.createGain();
     osc.connect(gain); gain.connect(audio.destination); osc.type = 'sine';
     osc.frequency.setValueAtTime(success ? 660 : 220, audio.currentTime);
     gain.gain.setValueAtTime(.045, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .12);
     osc.start(); osc.stop(audio.currentTime + .13);
   } catch { /* The game remains fully usable without audio. */ }
 }
 function warmAudio() {
   if (!soundEnabled) return;
   try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(() => {}); } catch {}
 }
 function setArena(className, content, instruction = '') {
   $('arena').className = `arena ${className}`;
   $('arenaContent').innerHTML = content;
   $('arenaInstruction').innerHTML = instruction;
 }
 function inputHint() {
   return mode === 'keyboard' ? '按 <span class="keycap">空格键</span>' : mode === 'mouse' ? '点击此区域' : '轻触此区域';
 }
 function announce(text) { $('liveAnnouncement').textContent = text; }
 function overlay(html) { $('arenaOverlay').innerHTML = html; $('arenaOverlay').hidden = false; }
 function hideOverlay() { $('arenaOverlay').hidden = true; $('arenaOverlay').innerHTML = ''; $('pauseButton').innerHTML = `${icon('pause')} 暂停`; }
 function shuffle(array) {
   for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
   return array;
 }
 function updateHome() {
   const selected = $('inputMode').value;
   const sameMode = readHistory().filter(r => r.mode === selected);
   if (sameMode.length) {
     const best = Math.max(...sameMode.map(r => r.result.total));
     $('personalBest').innerHTML = `${icon('star')}<span>本机${modeNames[selected]}最佳成绩 <b>${best} 分</b> <span style="color:#5f758b;margin:0 7px">/</span> 已完成 ${sameMode.length} 次挑战，下一次继续进步。</span>`;
   } else {
     $('personalBest').innerHTML = `${icon('star')}<span>你的第一份飞行记录，正在等待出发。完成正式挑战即可解锁。</span>`;
   }
 }
 function home() {
   stopClock(); hideOverlay(); state = 'home'; resumeAction = null;
   showScreen('homeScreen'); updateHome(); $('startButton').focus({ preventScroll: true });
 }
 function updateDashboard() {
   const result = ReactionScore.calculate(records);
   const latest = [...records].reverse().find(r => r.outcome === 'hit');
   $('lastReaction').innerHTML = `${latest ? Math.round(latest.rt) : '—'} <small>ms</small>`;
   $('liveAccuracy').textContent = records.length ? `${result.accuracy}%` : '—';
   $('liveMistakes').innerHTML = `${result.early + result.falseAlarms} <small>次</small>`;
   $('trialCounter').textContent = `${Math.min(state === 'feedback' ? trial : trial + 1, roundTrials.length)} / ${roundTrials.length}`;
   const finished = round === 1 ? trial : sequenceOne + trial;
   $('gameProgress').style.width = `${100 * finished / (sequenceOne + sequenceTwo)}%`;
   $('gameEyebrow').textContent = `MISSION 0${round} / ${isPractice ? 'TRAINING' : 'CHALLENGE'}`;
   $('gameTitle').textContent = round === 1 ? '火箭发射' : '保护飞船';
   $('stageOneTab').classList.toggle('active', round === 1); $('stageTwoTab').classList.toggle('active', round === 2);
   $('liveRule').innerHTML = round === 1 ? '<b>绿灯出现后</b>再操作。<br>红灯时，请耐心等待。' : '<b class="orange-text">橙色陨石：立即拦截</b><br><b class="cyan-text">蓝色友军：不要操作</b>';
 }
 function begin(practice) {
   stopClock(); hideOverlay(); warmAudio(); isPractice = practice; mode = $('inputMode').value;
   records = []; round = 1; trial = 0; sequenceOne = practice ? 3 : 10; sequenceTwo = practice ? 5 : 20;
   roundTrials = Array(sequenceOne).fill('go'); sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
   currentReport = null; $('practiceBadge').hidden = !practice;
   $('pauseButton').disabled = false; $('exitButton').disabled = false;
   showScreen('gameScreen'); updateDashboard(); briefing();
 }
 function briefing() {
   stopClock(); state = 'briefing'; updateDashboard(); setArena('', '', '');
   const first = round === 1;
   overlay(`<svg class="overlay-art" aria-hidden="true"><use href="#art-${first ? 'rocket' : 'friend'}"/></svg><div class="eyebrow">${isPractice ? '练习' : '正式挑战'} · 第 ${round} 关</div><h2>${first ? '等绿灯，再出发' : '看清目标，保护友军'}</h2><p>${first ? `红灯时等待，出现绿色圆形后${mode === 'keyboard' ? '按空格键' : '点击反应区域'}。提前操作算抢跑。共 ${sequenceOne} 次。` : `看到橙色陨石就${mode === 'keyboard' ? '按空格键' : '点击'}，看到蓝色飞船不要操作。共 ${sequenceTwo} 次。`}</p><button class="button primary" id="readyButton">${first ? '准备好了' : '开始保护飞船'}</button>`);
   $('readyButton').addEventListener('click', () => countdown()); $('readyButton').focus({ preventScroll: true });
   announce(first ? '第一关：等绿灯再操作。准备好了后开始。' : '第二关：拦截陨石，放行友军。');
 }
 function countdown() {
   stopClock(); hideOverlay(); state = 'countdown'; $('arena').focus({ preventScroll: true });
   let remaining = 3;
   const tick = () => {
     setArena('', `<span class="countdown-number">${remaining}</span><span class="countdown-hint">放松双手，准备接收信号</span>`, inputHint());
     if (remaining-- > 1) later(tick, 800); else later(waitForSignal, 800);
   };
   tick();
 }
 function waitForSignal() {
   stopClock(); state = 'waiting'; signalAt = null; signalDeadline = null;
   currentKind = roundTrials[trial];
   setArena('waiting', `<span class="status-orb">${icon(round === 1 ? 'clock' : 'shield')}</span><h2>${round === 1 ? '等待绿灯…' : '等待目标…'}</h2><p>先别操作，信号随时出现</p>`, '保持专注，等待信号');
   updateDashboard();
   later(revealSignal, 1000 + Math.random() * 1500);
 }
 function revealSignal() {
   stopClock(); state = 'arming';
   const deadline = round === 1 ? 1800 : 1400;
   const version = revision;
   // Two frames separate the waiting and signal state; the clock begins when
   // the stimulus is submitted for the next paint, never when its timer fires.
   raf = requestAnimationFrame(() => {
     if (version !== revision) return;
     raf = requestAnimationFrame(() => {
       if (version !== revision) return;
       if (round === 1) setArena('go', `<span class="status-orb">${icon('rocket')}</span><h2>立即发射！</h2><p>绿色信号已就绪</p>`, inputHint());
       else if (currentKind === 'go') setArena('intercept', `${art('asteroid')}<h2>陨石！立即拦截</h2><p>保护你的飞船</p>`, inputHint());
       else setArena('no-go', `${art('friend')}<h2>友军！请放行</h2><p>保持等待，不要操作</p>`, '不按键 · 不点击');
       state = 'signal'; signalAt = performance.now(); signalDeadline = signalAt + deadline;
       later(() => record(currentKind === 'no-go' ? 'correctReject' : 'miss'), deadline);
     });
   });
 }
 function respond(source) {
   if (source !== mode) return;
   if (state === 'waiting' || state === 'arming') { record('early'); return; }
   if (state !== 'signal') return;
   const now = performance.now();
   // Do not let a delayed timeout task turn a late response into a valid hit.
   if (now > signalDeadline) { record(currentKind === 'no-go' ? 'correctReject' : 'miss'); return; }
   const elapsed = now - signalAt;
   if (currentKind === 'no-go') record('falseAlarm');
   else if (elapsed < 100) record('anticipation');
   else record('hit', elapsed);
 }
 function record(outcome, rt = null) {
   if (!['waiting', 'arming', 'signal'].includes(state)) return;
   stopClock(); state = 'feedback';
   records.push({ round, trial: trial + 1, kind: currentKind, outcome, rt: rt === null ? null : Math.round(rt * 10) / 10 });
   const feedback = {
     hit: ['漂亮，接收到信号！', '保持这个节奏', true],
     correctReject: ['友军安全通过', '判断正确，继续保持', true],
     early: ['抢跑啦，先等信号', '这次计为错误，下次再稳一点', false],
     anticipation: ['太早了，可能预判了信号', '不足 100 ms，计为预判错误', false],
     falseAlarm: ['这是友军，要放行', '先看清目标，再做判断', false],
     miss: ['这次错过了信号', '调整一下注意力，下一次继续', false]
   }[outcome];
   const number = outcome === 'hit' ? `<div class="feedback-number">${Math.round(rt)} <small>ms</small></div>` : '';
   setArena('feedback', `<span class="feedback-symbol ${feedback[2] ? '' : 'error'}">${icon(feedback[2] ? 'check' : 'clock')}</span>${number}<h2>${feedback[0]}</h2><p>${feedback[1]}</p>`, '反馈期间不用操作');
   sound(feedback[2]); announce(feedback[0]);
   trial++; updateDashboard();
   later(advance, outcome === 'hit' ? 950 : 1350);
 }
 function advance() {
   if (trial < roundTrials.length) { waitForSignal(); return; }
   if (round === 1) {
     round = 2; trial = 0;
     roundTrials = shuffle([...Array(isPractice ? 3 : 14).fill('go'), ...Array(isPractice ? 2 : 6).fill('no-go')]);
     briefing();
   } else finish();
 }
 function getResumeAction(previous) {
   if (previous === 'briefing') return briefing;
   if (previous === 'feedback') return advance;
   return countdown;
 }
 function pause(reason = '挑战已暂停') {
   if (!['waiting', 'arming', 'signal', 'countdown', 'feedback', 'briefing'].includes(state)) return;
   resumeAction = getResumeAction(state); stopClock(); state = 'paused';
   overlay(`${icon('pause')}<div class="eyebrow">TAKE A BREATH</div><h2>${reason}</h2><p>已经完成的成绩会保留。未完成的这一题会重新开始，不计入错误。</p><div class="overlay-actions"><button class="button primary" id="resumeButton">继续挑战</button><button class="button secondary" id="pauseHomeButton">返回首页</button></div>`);
   $('pauseButton').innerHTML = `${icon('play')} 继续`;
   $('resumeButton').addEventListener('click', () => { const action = resumeAction; hideOverlay(); action(); });
   $('pauseHomeButton').addEventListener('click', askExit); $('resumeButton').focus({ preventScroll: true });
   announce(reason);
 }
 function askExit() {
   if (state === 'home' || state === 'result' || state === 'practiceDone' || state === 'exitConfirm') return;
   exitResumeAction = state === 'paused' ? () => pauseAgain() : getResumeAction(state);
   stopClock(); state = 'exitConfirm';
   overlay(`<div class="eyebrow">MISSION CONTROL</div><h2>结束这次挑战？</h2><p>未完成的挑战不会计分或保存记录。你也可以继续完成任务。</p><div class="overlay-actions"><button class="button primary" id="keepPlayingButton">继续挑战</button><button class="button secondary" id="confirmExitButton">结束并返回首页</button></div>`);
   $('keepPlayingButton').addEventListener('click', () => { hideOverlay(); exitResumeAction(); });
   $('confirmExitButton').addEventListener('click', home); $('keepPlayingButton').focus({ preventScroll: true });
 }
 function pauseAgain() {
   state = 'paused'; $('pauseButton').innerHTML = `${icon('play')} 继续`;
   overlay(`${icon('pause')}<h2>挑战已暂停</h2><p>准备好后继续。未完成的一题会重新开始。</p><button class="button primary" id="resumeButton">继续挑战</button>`);
   $('resumeButton').addEventListener('click', () => { hideOverlay(); resumeAction(); }); $('resumeButton').focus({ preventScroll: true });
 }
 function dateLabel(timestamp) {
   return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
 }
 function reportAdvice(result) {
   if (result.validHits < 3) return '有效反应次数还不够。先确认操作方式与首页选择一致，再用练习模式熟悉信号。';
   if (result.early >= 3) return `本轮有 ${result.early} 次抢跑或预判。放松双手，等目标真正出现后再行动，准确比抢先更重要。`;
   if (result.falseAlarms >= 2) return `你误拦了 ${result.falseAlarms} 艘友军。先辨认“橙色陨石 / 蓝色飞船”，再决定是否操作。`;
   if (result.misses >= 3) return `本轮错过了 ${result.misses} 个目标。保持视线在反应区域中央，完成一关后可以暂停休息。`;
   if (result.deviation > 100) return '你已经能接住信号了。下一轮试着放松手臂、保持坐姿，让每一次反应都更接近。';
   if (result.accuracy >= 90) return '判断很稳！下一轮在保持正确率的前提下，试着更及时地回应信号。';
   return '继续保持专注，先把目标看清。准确率提升后，速度与稳定性得分也会一起提高。';
 }
 function finish() {
   stopClock(); $('gameProgress').style.width = '100%';
   if (isPractice) {
     state = 'practiceDone';
     const correct = ReactionScore.calculate(records).correct;
     overlay(`${icon('check')}<div class="eyebrow">TRAINING COMPLETE</div><h2>练习完成，准备出发！</h2><p>本次答对 ${correct} / 8 次。练习不评分、不保存。<br>正式挑战包含 10 次火箭发射与 20 次飞船守护。</p><div class="overlay-actions"><button class="button primary" id="startAfterPractice">开始正式挑战</button><button class="button secondary" id="practiceHome">返回首页</button></div>`);
     $('startAfterPractice').addEventListener('click', () => begin(false)); $('practiceHome').addEventListener('click', home);
     $('startAfterPractice').focus({ preventScroll: true }); $('pauseButton').disabled = true; $('exitButton').disabled = true; return;
   }
   state = 'result'; hideOverlay();
   const result = ReactionScore.calculate(records), all = readHistory(), previous = all.find(r => r.mode === mode);
   const earlierBest = all.filter(r => r.mode === mode).reduce((best, r) => Math.max(best, r.result.total), -1);
   currentReport = { version: 1, id: sessionId, timestamp: Date.now(), mode, result, records: [...records] };
   const saved = saveHistory([currentReport, ...all.filter(r => r.id !== sessionId)]);
   const title = result.total >= 90 ? '专注之星' : result.total >= 75 ? '敏捷领航员' : result.total >= 60 ? '太空探索者' : '成长中的飞行员';
   const metric = result.median === null ? '—' : result.median;
   const row = (label, value, max) => `<div class="score-row"><span>${label}</span><div class="score-bar"><span style="width:${100 * value / max}%"></span></div><strong>${value} / ${max}</strong></div>`;
   const delta = previous ? result.total - previous.result.total : null;
   const improvement = previous ? (delta > 0 ? `比上次同为${modeNames[mode]}的挑战提高了 ${delta} 分。继续保持自己的节奏！` : delta === 0 ? `与上次${modeNames[mode]}挑战同分。稳定地完成，也是进步的一部分。` : `比上次${modeNames[mode]}挑战低 ${Math.abs(delta)} 分。稍作休息，再试一次；单次成绩会有波动。`) : '第一份飞行记录已完成。下一次使用相同设备与操作方式，就可以看到个人变化。';
   $('resultScreen').innerHTML = `<div class="result-heading"><div class="eyebrow">MISSION COMPLETE / 任务完成</div><h1>每一次专注，都值得记录</h1><p>30 次挑战已完成。<span id="resultPlayerName">待填写昵称</span> · 本次反应力报告。</p></div><div class="report-grid"><div class="score-card"><div class="score-ring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="88"/><circle class="ring-fill" cx="100" cy="100" r="88" stroke-dasharray="${result.total * 5.5292} 552.92"/></svg><div class="score-number">${result.total}<small>综合得分 / 100</small></div></div><h2>${title}</h2><p>快一点，准一点，稳一点。<br>与上一次的自己一起成长。</p><span class="report-tag">${result.total > earlierBest && earlierBest >= 0 ? '本机同操作方式最佳成绩' : `${modeNames[mode]}模式 · ${dateLabel(currentReport.timestamp)}`}</span></div><div class="report-content"><div class="metric-cards"><div class="metric-card">${icon('bolt')}<span>典型反应时间</span><strong>${metric} <small>ms</small></strong><small>${result.validHits} 次有效反应的中位数</small></div><div class="metric-card">${icon('target')}<span>判断正确率</span><strong>${result.accuracy}<small> %</small></strong><small>${result.correct} / 30 次判断正确</small></div><div class="metric-card">${icon('chart')}<span>反应波动</span><strong>${result.deviation === null ? '—' : result.deviation} <small>ms</small></strong><small>中位绝对偏差 · 越小越稳</small></div></div><div class="breakdown-card"><h3>你的得分构成</h3>${row('速度', result.speed, 50)}${row('准确性', result.precision, 35)}${row('稳定性', result.stability, 15)}</div><div class="advice-card"><h3>给下一次挑战的你</h3><p>${reportAdvice(result)}</p></div></div></div><div class="improvement">${icon('star')}<span id="resultImprovement">${improvement}${!saved ? ' 当前浏览器无法保存记录，请下载成绩。' : ''}</span></div><div class="online-result" id="onlineResult"></div><div class="report-actions"><button class="button primary" id="replayButton">再挑战一次</button><button class="button secondary" id="downloadButton">${icon('download')}下载成绩</button><button class="button quiet" id="resultHomeButton">返回首页</button></div><p class="result-notes">抢跑 / 预判 ${result.early} 次 · 误点友军 ${result.falseAlarms} 次 · 漏答 ${result.misses} 次<br>这是本次游戏的表现评分，适合在同设备、同操作方式下比较个人变化。<button id="resultScoringButton">查看计分规则</button></p>`;
   showScreen('resultScreen'); $('replayButton').addEventListener('click', () => begin(false)); $('resultHomeButton').addEventListener('click', home);
   $('downloadButton').addEventListener('click', downloadReport); $('resultScoringButton').addEventListener('click', showHelp);
   window.SpaceCrewOnline?.onResult(currentReport);
   $('replayButton').focus({ preventScroll: true }); announce(`挑战完成，总分 ${result.total} 分，正确率 ${result.accuracy}%。`);
 }
 function downloadReport() {
   if (!currentReport) return;
   const { result, records: trials } = currentReport;
   const names = { hit: '正确响应', correctReject: '正确放行', early: '抢跑', anticipation: '预判', falseAlarm: '误点友军', miss: '漏答' };
   const rows = [ ['太空小队反应力挑战成绩'], ['玩家昵称', currentReport.nickname || '未填写'], ['时间', new Date(currentReport.timestamp).toLocaleString('zh-CN', { hour12: false })], ['操作方式', modeNames[currentReport.mode]], ['总分', result.total], ['速度分（满分50）', result.speed], ['准确性分（满分35）', result.precision], ['稳定性分（满分15）', result.stability], ['正确率（%）', result.accuracy], ['反应时间中位数（ms）', result.median ?? '无有效数据'], ['反应时间中位绝对偏差（ms）', result.deviation ?? '无有效数据'], ['说明', '游戏计分，未经年龄常模校准；仅适合同设备同操作方式下比较个人变化。'], [], ['关卡', '题次', '目标', '结果', '有效反应时间（ms）'], ...trials.map(t => [t.round === 1 ? '火箭发射' : '保护飞船', t.trial, t.kind === 'no-go' ? '友军' : t.round === 1 ? '绿灯' : '陨石', names[t.outcome], t.rt ?? '']) ];
   const safeCell = value => { const text = String(value); return /^[=+@\-\t\r]/.test(text) ? "\'" + text : text; };
   const csv = '\uFEFF' + rows.map(row => row.map(v => `"${safeCell(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
   const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
   a.href = url; a.download = `太空小队_成绩_${new Date(currentReport.timestamp).toISOString().replace(/[:.]/g, '-')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
   toast('成绩已导出，可用 Excel 打开。');
 }
 function renderHistory() {
   const escapeNickname = value => String(value).replace(/[&<>"\']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","\'":"&#39;"}[c]));
   const items = readHistory().filter(r => r.mode === historyFilter);
   document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === historyFilter));
   $('clearConfirm').hidden = true; $('clearHistoryButton').disabled = !readHistory().length;
   $('historyContent').innerHTML = items.length ? items.map((r, i) => `<div class="history-row"><div><span class="history-index">${String(i + 1).padStart(2, '0')}</span><div><p>${r.nickname ? escapeNickname(r.nickname) + ' · ' : ''}${r.result.median ?? '—'} ms · 正确率 ${r.result.accuracy}%</p><time datetime="${new Date(r.timestamp).toISOString()}">${dateLabel(r.timestamp)}</time></div></div><strong>${r.result.total}<small> 分</small></strong></div>`).join('') : `<div class="empty-state">${icon('chart')}<h3>还没有${modeNames[historyFilter]}飞行记录</h3><p>完成一次正式挑战，就能留下第一份成绩。<br>练习和中途结束的挑战不会保存。</p></div>`;
 }
 function showHistory() { pauseForDialog(); historyFilter = $('inputMode').value; renderHistory(); $('historyDialog').showModal(); }
 function showHelp() { pauseForDialog(); $('infoDialog').showModal(); }
 function pauseForDialog() { if (!['home', 'result', 'paused', 'exitConfirm', 'practiceDone'].includes(state)) pause('查看说明或记录，挑战已暂停'); }
 $('startButton').addEventListener('click', () => begin(false)); $('practiceButton').addEventListener('click', () => begin(true));
 $('inputMode').value = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
 $('inputMode').addEventListener('change', updateHome);
 $('pauseButton').addEventListener('click', () => {
   if (state === 'paused') { hideOverlay(); resumeAction(); } else if (state !== 'exitConfirm') pause();
 });
 $('exitButton').addEventListener('click', askExit);
 $('arena').addEventListener('pointerdown', event => {
   if (event.button !== 0) return;
   const source = event.pointerType === 'touch' || event.pointerType === 'pen' ? 'touch' : 'mouse';
   if (source === mode) { event.preventDefault(); respond(source); }
   else if (['waiting', 'signal'].includes(state)) toast(`本轮使用${modeNames[mode]}操作。`);
 });
 document.addEventListener('keydown', event => {
   if (event.code === 'Escape' && !document.querySelector('dialog[open]')) { pause(); return; }
   if (event.code !== 'Space' || event.repeat || document.querySelector('dialog[open]')) return;
   if (['waiting', 'arming', 'signal', 'feedback', 'countdown'].includes(state)) {
     event.preventDefault(); respond('keyboard');
   }
 });
 document.addEventListener('visibilitychange', () => { if (document.hidden) pause('页面已切换，挑战已暂停'); });
 window.addEventListener('spacecrew:pause', pauseForDialog);
 window.addEventListener('blur', () => { if (['waiting', 'arming', 'signal', 'countdown', 'feedback'].includes(state)) pause('窗口暂时离开，挑战已暂停'); });
 $('historyButton').addEventListener('click', showHistory); $('helpButton').addEventListener('click', showHelp); $('scoreInfoButton').addEventListener('click', showHelp);
 document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
 $('historyFilters').addEventListener('click', event => { const b = event.target.closest('[data-filter]'); if (b) { historyFilter = b.dataset.filter; renderHistory(); } });
 $('clearHistoryButton').addEventListener('click', () => { $('clearConfirm').hidden = false; });
 $('cancelClearButton').addEventListener('click', () => { $('clearConfirm').hidden = true; });
 $('confirmClearButton').addEventListener('click', () => { if (saveHistory([])) { renderHistory(); updateHome(); toast('本机飞行记录已清空。'); } else toast('当前浏览器无法访问记录存储。'); });
 $('soundButton').addEventListener('click', () => {
   soundEnabled = !soundEnabled; $('soundButton').innerHTML = icon(soundEnabled ? 'sound' : 'mute');
   $('soundButton').setAttribute('aria-label', soundEnabled ? '关闭反馈音效' : '开启反馈音效'); $('soundButton').setAttribute('aria-pressed', String(soundEnabled));
   warmAudio(); if (soundEnabled) sound(true); toast(soundEnabled ? '反馈音效已开启，目标出现时不播放提示音。' : '反馈音效已关闭。');
 });
 $('fullscreenButton').addEventListener('click', async () => {
   pauseForDialog();
   try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else toast('当前浏览器不支持全屏，请使用横屏或浏览器全屏功能。'); }
   catch { toast('当前环境未允许全屏，可继续正常游戏。'); }
 });
 document.addEventListener('fullscreenchange', () => $('fullscreenButton').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏'));
 document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); if (state === 'home' || state === 'result' || state === 'practiceDone') home(); else askExit(); });
 updateHome();
 if (!storageAvailable) toast('当前浏览器无法保存成绩，完成挑战后可下载留存。');
})();
