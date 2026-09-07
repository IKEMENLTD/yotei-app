# 土台の起動と接続確認の手順

Supabase につながっているかを、段階を分けて確かめる。
各段階でどこまで成功したかが分かるので、失敗したときに原因を絞り込める。

## 0. 前提

- Node.js: **v24.20.0 を確認済み**（npm は未確認だが Node に同梱される）
- `.env` は作成済み。**値は空**なので、先に Supabase の値を貼る
- ビルドツールは **Vite** を想定（`.env` の `VITE_` 接頭辞はこれに対応）

## 1. 土台を作る

**カレントディレクトリ（`.`）に作ること。** 別名のフォルダを作ると、既存の `.env` が
Vite のプロジェクト直下から外れ、環境変数が読めなくなる。

```bash
cd /home/user123/my-app
npm create vite@latest . -- --template vanilla
npm install
npm install @supabase/supabase-js
```

`.env` `.env.example` `.gitignore` `*.md` は残したまま進める。
`.gitignore` を上書きするか聞かれたら、**上書きしない**（`.env` の除外設定が消える）。

## 2. 値を貼る

Supabase の Project Settings > API から取得し、`.env` に貼る。

```
VITE_SUPABASE_URL=https://<プロジェクトID>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public キー>
```

- 貼り付け時に**改行や前後の空白が混ざらない**ようにする
- `service_role` キーではなく **anon public** の方を使う

## 3. 接続確認のコードを置く

`main.js` の中身を、いったん次に差し替える（確認が終わったら消す）。

```js
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// --- 段階1: 環境変数が読めているか ---
// 鍵そのものは表示しない（画面撮影・共有時の漏れを防ぐ）
console.log('段階1 URL:', url ?? '未設定')
console.log('段階1 KEY:', key ? `${key.slice(0, 8)}…(${key.length}文字)` : '未設定')

if (!url || !key) {
  console.error('段階1で失敗。環境変数が読めていない。')
} else {
  // --- 段階2: Supabase に届いているか（テーブル不要） ---
  try {
    const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: key } })
    console.log('段階2 HTTPステータス:', res.status)
  } catch (e) {
    console.error('段階2で失敗（ネットワークかURL）:', e.message)
  }

  // --- 段階3: テーブルに触れるか ---
  const supabase = createClient(url, key)
  const { data, error } = await supabase.from('rooms').select('*')
  console.log('段階3 data:', data)
  console.log('段階3 error:', error)
}
```

## 4. 起動する

```bash
npm run dev
```

表示された `http://localhost:5173/` をブラウザで開き、**開発者ツールのコンソール**を見る。

## 5. 成功したときの見え方

```
段階1 URL: https://xxxx.supabase.co
段階1 KEY: eyJhbGci…(208文字)
段階2 HTTPステータス: 200
段階3 data: []
段階3 error: null
```

**段階2 が 200 なら、接続そのものは成功している。**
段階3 の `data` が `[]` でも接続失敗ではない（下の表の5番を参照）。

## 6. うまくいかないときの見分け方

上から順に、先に失敗した段階だけを見る。

| # | 症状 | 段階 | 原因 | 対処 |
| --- | --- | --- | --- | --- |
| 1 | `URL: 未設定` `KEY: 未設定` | 1 | 環境変数が読めていない。**開発サーバを再起動していない**のが最も多い。次に `.env` の置き場所が Vite のプロジェクト直下でない、接頭辞が `VITE_` でない | `npm run dev` を Ctrl+C で止めて再起動。`.env` が `package.json` と同じ階層にあるか確認 |
| 2 | `Failed to fetch` / CORS エラー | 2 | URL の綴り違い、末尾の余分なスラッシュ、HTMLを `file://` で直接開いている | URL を貼り直す。必ず `npm run dev` 経由の `localhost` で開く |
| 3 | ステータス **401**、`Invalid API key` | 2 | キーの貼り間違い、改行や空白の混入、`service_role` との取り違え | anon public キーを貼り直す。前後に余分な文字がないか確認 |
| 4 | ステータス200だが段階3で `relation "rooms" does not exist` | 3 | **接続は成功。** テーブルが未作成なだけ | Supabase 側で `rooms` テーブルを作る |
| 5 | **エラーなしで `data: []`、`error: null`** | 3 | **接続は成功。** RLS が有効でポリシーが1つも無いと、拒否ではなく**空で返る**。行を入れたのに空、が典型 | 意図どおり。`sotsugyo.md` 11.2 の手順でポリシーを設計する |
| 6 | `permission denied` / JWT 関連のエラー | 3 | 認証を前提にしたポリシーが設定済みで、未ログイン状態で叩いている | ログインを実装するか、確認用に一時的なポリシーを置く（**消し忘れに注意**） |
| 7 | `Port 5173 is in use` | 4 | 別の開発サーバが動いている | 表示される別ポートで開くか、既存のプロセスを止める |
| 8 | `npm install` が途中で止まる | 1 | ネットワークまたはプロキシ | 接続を確認して再実行 |

### 特に間違えやすい2つ

- **5番**が最重要。RLS でブロックされたとき**エラーは出ず、空の配列が返る**。「つながっていない」と誤解して URL やキーを何度も貼り直す原因になる。段階2 が 200 なら接続は成功しているので、疑うべきは接続ではなくポリシー
- **1番**の再起動忘れも頻出。`.env` を編集しても、動いている開発サーバには反映されない

## 7. 確認できたら

1. `main.js` の確認用コードを消す
2. 確認のために一時的に置いたポリシーがあれば、**必ず消す**
3. `sotsugyo.md` 11.2 のチェックリストを上から進める。段階3 が成功する＝誰でも読める状態なので、**つながった直後こそアクセス制御が未設定**という点に注意する
