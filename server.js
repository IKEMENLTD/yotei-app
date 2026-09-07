'use strict';

/**
 * 画面の配信と、メモ要約の中継を行う小さなサーバ。
 *
 * API キーをブラウザに渡さないために置いている。
 * キーはこのプロセスの環境変数から読み、応答に含めない。
 *
 * 起動:
 *   node --env-file=.env server.js
 *   → http://localhost:3000
 *
 * 追加パッケージは不要（Node 標準機能のみ）。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const ROOT = __dirname;
const MAX_BODY_BYTES = 100 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

// ------------------------------------------------------------
// 静的ファイルの配信
// ------------------------------------------------------------

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(ROOT, relative);

  // ルートの外に出る要求は拒否する
  if (!filePath.startsWith(ROOT + path.sep)) {
    return sendJson(res, 403, { error: '許可されていないパスです。' });
  }

  const ext = path.extname(filePath);
  if (!MIME[ext]) {
    return sendJson(res, 404, { error: '見つかりません。' });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: '見つかりません。' });
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(data);
  });
}

// ------------------------------------------------------------
// メモの要約
// ------------------------------------------------------------

function buildPrompt(notes) {
  const lines = notes.map((n) => `- ${n.date}: ${n.note}`).join('\n');
  return [
    '次は、教室の予定に付けられたメモの一覧です。',
    '教室運営の担当者が把握しておくべきことを、日本語の箇条書き3〜5点にまとめてください。',
    '',
    '条件:',
    '- 件数の多い事柄や繰り返し起きている事柄を優先する',
    '- メモに書かれていないことは推測して書かない',
    '- 前置きや結びの文は不要。箇条書きだけを返す',
    '',
    'メモ:',
    lines
  ].join('\n');
}

async function callClaude(notes) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: 'あなたは教室運営の事務担当者を助けるアシスタントです。簡潔で事実に忠実な要約を書きます。',
      messages: [{ role: 'user', content: buildPrompt(notes) }]
    })
  });

  if (!response.ok) {
    // 応答本文に鍵は含まれないが、そのまま画面へ流さず状況だけを返す
    const detail = await response.text().catch(() => '');
    console.error('Anthropic API エラー:', response.status, detail.slice(0, 500));

    if (response.status === 401) {
      throw new HttpError(502, 'APIキーが正しくないようです。.env の ANTHROPIC_API_KEY を確認してください。');
    }
    if (response.status === 429) {
      throw new HttpError(502, '利用制限に達しました。しばらく待って試してください。');
    }
    throw new HttpError(502, `要約サービスからエラーが返りました（${response.status}）。`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return text || '要約を取得できませんでした。';
}

async function handleSummarize(req, res) {
  if (!API_KEY) {
    return sendJson(res, 503, {
      error: 'APIキーが設定されていません。.env に ANTHROPIC_API_KEY を設定し、' +
             'node --env-file=.env server.js で起動してください。'
    });
  }

  const body = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { error: '送信内容を読み取れませんでした。' });
  }

  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  const cleaned = notes
    .filter((n) => n && typeof n.note === 'string' && n.note.trim() !== '')
    .map((n) => ({ date: String(n.date || ''), note: n.note.trim().slice(0, 200) }))
    .slice(0, 200);

  // メモが無ければ API を呼ばない（無駄な料金を避ける）
  if (cleaned.length === 0) {
    return sendJson(res, 200, { summary: null, count: 0 });
  }

  const summary = await callClaude(cleaned);
  return sendJson(res, 200, { summary, count: cleaned.length, model: MODEL });
}

// ------------------------------------------------------------
// 土台
// ------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, '送信内容が大きすぎます。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/summarize') {
      return await handleSummarize(req, res);
    }
    if (req.method === 'GET') {
      return serveStatic(req, res);
    }
    return sendJson(res, 405, { error: '許可されていない操作です。' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : 'サーバ側で問題が起きました。';
    if (status === 500) console.error(err);
    return sendJson(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`起動しました: http://localhost:${PORT}`);
  console.log(`使用モデル: ${MODEL}`);
  console.log(API_KEY
    ? 'APIキー: 読み込み済み'
    : 'APIキー: 未設定（要約は使えません。node --env-file=.env server.js で起動してください）');
});
