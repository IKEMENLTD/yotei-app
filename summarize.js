'use strict';

/**
 * メモの要約。
 * API キーはブラウザに持たず、同じサーバの /api/summarize に中継してもらう。
 *
 * 送るのは日付とメモ本文だけ。講師名・教室名は送らない（扱う個人情報を最小限にする）。
 */
var Summarize = (function () {

  /**
   * @param {Array<{date: string, note: string}>} notes
   * @returns {Promise<{summary: string|null, count: number}>}
   */
  async function run(notes) {
    var response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes })
    });

    var data = await response.json().catch(function () { return {}; });

    if (!response.ok) {
      throw new Error(data.error || '要約に失敗しました（' + response.status + '）。');
    }
    return data;
  }

  return { run: run };
})();
