/* Storage adapter for the static edition. The game and its scoring stay the same. */
(() => {
 'use strict';
 const storageKey = 'space-crew-browser-board-v1';
 const pageSize = 20;

 function scores() {
  try {
   const entries = JSON.parse(localStorage.getItem(storageKey) || '[]');
   return Array.isArray(entries) ? entries : [];
  } catch { return []; }
 }

 function totals(entries) {
  return { totalPlayers: new Set(entries.map(entry => entry.playerRef)).size, totalGames: entries.length };
 }

 function compare(a, b) {
  return b.score - a.score || b.accuracy - a.accuracy ||
   (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity) ||
   a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
 }

 function ranking(entries, mode) {
  const best = new Map();
  for (const entry of entries.filter(score => score.mode === mode).sort(compare)) {
   if (!best.has(entry.playerRef)) best.set(entry.playerRef, entry);
  }
  return [...best.values()].map((entry, index) => ({ ...entry, rank: index + 1 }));
 }

 function paginate(entries, offset) {
  const items = entries.slice(offset, offset + pageSize);
  return { items, count: entries.length, offset, hasMore: offset + items.length < entries.length };
 }

 async function request(path, options = {}) {
  const url = new URL(path, 'https://space-crew.local');
  const mode = url.searchParams.get('mode') || 'keyboard';
  const offset = Number(url.searchParams.get('offset') || 0);
  const entries = scores();
  switch (url.pathname) {
   case '/api/stats':
    return totals(entries);
   case '/api/leaderboard':
    return { ...totals(entries), ...paginate(ranking(entries, mode), offset) };
   case '/api/history': {
    const playerRef = options.headers?.Authorization?.replace(/^Bearer /, '');
    const history = entries.filter(entry => entry.playerRef === playerRef && entry.mode === mode);
    return paginate(history.sort((a, b) => b.createdAt - a.createdAt), offset);
   }
   case '/api/live-position':
   case '/api/scores': {
    const body = JSON.parse(options.body);
    const preview = url.pathname === '/api/live-position';
    if (!preview && body.records.length !== 30) throw Error('请完成全部 30 题后再保存成绩。');
    const result = preview ? ReactionScore.progress(body.records, 30) : ReactionScore.calculate(body.records);
    const entry = { id: body.id, mode: body.mode, nickname: body.nickname, playerRef: body.playerToken,
     score: result.total, accuracy: result.accuracy, medianMs: result.median, createdAt: Date.now() };
    if (preview) {
     const ranked = ranking([...entries, entry], body.mode);
     const position = ranked.findIndex(row => row.playerRef === entry.playerRef);
     const start = Math.max(0, position - 2);
     const items = ranked.slice(start, start + 5).map(row => ({ ...row, isYou: row.playerRef === entry.playerRef }));
     return { rank: position + 1, score: entry.score, rankedScore: ranked[position].score, completed: body.records.length, items };
    }
    const existing = entries.find(score => score.id === entry.id);
    if (existing) return { saved: existing, ...totals(entries) };
    entries.push(entry);
    try { localStorage.setItem(storageKey, JSON.stringify(entries)); }
    catch { throw Error('浏览器无法继续保存成绩，请下载本次成绩。'); }
    return { saved: entry, ...totals(entries) };
   }
   default:
    throw Error('此版本的积分榜功能暂不可用。');
  }
 }

 window.SpaceCrewBrowserBoard = { request };
})();
