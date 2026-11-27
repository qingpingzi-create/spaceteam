/* Pure scoring functions shared by the browser and the verification script. */
(function (root) {
  'use strict';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = value => Math.round(value * 10) / 10;
  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function calculate(records) {
    const hits = records.filter(r => r.outcome === 'hit' && Number.isFinite(r.rt) && r.rt >= 100).map(r => r.rt);
    const correct = records.filter(r => r.outcome === 'hit' || r.outcome === 'correctReject').length;
    const accuracy = records.length ? correct / records.length : 0;
    const typical = median(hits);
    const deviation = typical === null ? null : median(hits.map(rt => Math.abs(rt - typical)));
    const speed = typical === null ? 0 : 50 * clamp((900 - typical) / 650, 0, 1) * accuracy;
    const precision = 35 * accuracy;
    const stability = hits.length < 3 ? 0 : 15 * clamp(1 - deviation / 250, 0, 1) * accuracy;
    return {
      total: Math.round(speed + precision + stability), speed: round(speed), precision: round(precision), stability: round(stability),
      accuracy: Math.round(accuracy * 100), correct, trials: records.length, validHits: hits.length,
      median: typical === null ? null : Math.round(typical), deviation: deviation === null ? null : Math.round(deviation),
      early: records.filter(r => r.outcome === 'early' || r.outcome === 'anticipation').length,
      falseAlarms: records.filter(r => r.outcome === 'falseAlarm').length,
      misses: records.filter(r => r.outcome === 'miss').length,
      stageOneMedian: median(records.filter(r => r.round === 1 && r.outcome === 'hit').map(r => r.rt))
    };
  }
  function progress(records, planned = 30) {
    const result = calculate(records);
    const completion = Math.min(records.length / Math.max(1, planned), 1);
    return { ...result, performanceTotal: result.total, total: Math.round(result.total * completion), completion };
  }
  const api = { median, calculate, progress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReactionScore = api;
})(typeof window === 'undefined' ? globalThis : window);
