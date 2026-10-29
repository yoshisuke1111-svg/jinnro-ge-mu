# Windowsから友達とオンライン対戦する

この版は Node.js のHTTPサーバーと Server-Sent Events (SSE) で同期します。
自分のWindows PCをホストにするテスト方法として、Node.js + ngrokを想定しています。

## 必要なもの

1. Node.js のLTS版
   - https://nodejs.org/en/download
   - このプロジェクトは Node.js 22以上を要求します。
2. ngrok のWindows版
   - https://ngrok.com/download
   - 無料アカウントでauthtokenを設定して使います。
3. Chrome / Edge などのブラウザ

VS Code、Docker、npm install は必須ではありません。

## 初回だけ

ngrokにログインしてauthtokenを取得し、コマンドプロンプトで次を実行します。

```bat
ngrok config add-authtoken YOUR_TOKEN
```

## 毎回の起動

`START-ONLINE-WINDOWS.bat` をダブルクリックします。

1. 別ウィンドウでゲームサーバーが `http://localhost:3000` で起動します。
2. ローカルの `/health` が成功したあと、ngrokが `https://...` の公開URLを表示します。
3. その公開URLをブラウザで開きます。
4. 必要なら「作る部屋のコード」を自分で入力してから「オンラインの部屋を作る」を押します。空欄なら自動生成されます。
5. ゲーム内の「招待URLをコピー」で表示されたURLを友達へ送ります。

ゲーム中はサーバーの黒い画面とngrokの画面を閉じないでください。
PCがスリープすると接続も止まります。

## 注意

- この方式は友達とのテストプレイ向けです。
- 部屋はメモリ保存なので、Node.jsサーバーを止めると消えます。
- インターネットへ公開するため、知らない相手にはURLを配らないでください。
- 固定公開・PCを閉じても動かす運用は、`CLOUD-DEPLOY.md` のようにVPSやクラウドへ載せる方式が向いています。
- CloudflareのQuick Tunnelは公式ドキュメント上SSE非対応なので、この版の手軽な公開方法には使いません。


## v0.6.2 管理画面

サーバー起動時のPowerShellに `Admin password:` が表示されます。`http://localhost:3000/admin` を開き、そのパスワードでログインすると全ての部屋・役職・CPU内部状態を確認できます。パスワードは他人へ共有しないでください。


## CPUだけの試合を管理画面で観戦

1. `http://localhost:3000/admin` を開きます。
2. PowerShellに表示された `Admin password:` でログインします。
3. 「CPU観戦ラボ」でCPU人数（4〜30人）と任意の部屋コードを入力します。
4. 作成した部屋の「CPU観戦」タブを開きます。
5. `CPU早送り ×8` で高速化し、もう一度押すと通常速度へ戻ります。

このCPU観戦部屋には人間プレイヤーは参加せず、管理者だけが全役職・会話・内部状態を確認します。

## サーバー監視

管理画面上部で稼働時間、メモリ、Node.js/PID、HTTP/API回数、SSE接続数、最近のエラーを確認できます。ngrokの公開URLそのものはngrok側の画面で確認してください。
