# 自作人狼AI

このフォルダは、外部AIに頼らずに人狼専用AIを育てるための場所です。

## 役割

- `features.js`
  - 盤面をAIが読める「数値」に変換する。
  - 本人に見えていた情報だけを使う。
  - 本当の役職などの `truth_json` は入力に使わない。

- `action-model.js`
  - 最初の自作AI本体。
  - JavaScriptだけで多クラス・ロジスティック回帰を学習する。
  - 文章はまだ作らず、次の行動を確率で予測する。

- `train.js`
  - Tursoの `training_examples` を読み、
    `ai/models/action-model.json` を作る。

## 最初に予測するもの

- `speak` : 発言する
- `silence` : 黙る
- `vote` : 投票する
- `night_action` : 夜能力を使う
- `special_action` : 特殊能力を使う

## 学習

Renderなど、次の環境変数が入った場所で実行します。

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

実行コマンド:

```bash
npm run ai:train
```

データがまだ少ない場合は学習せず、件数だけ表示して終了します。

## 大事な考え方

`context_json` は「その人から見えた世界」です。
AIがゲーム中に見るのはこれだけです。

`truth_json` は「本当の世界」です。
これは学習結果の評価や、将来の推理AIの答え合わせに使います。
ゲーム中の入力に混ぜるとチートになるので使いません。

## 今後

1. 人間対局をTursoに貯める
2. 行動予測AIを学習
3. 誰を疑う・誰に投票するかを学習
4. 人間の文章から会話生成AIを作る
5. 自己対戦で改善する
