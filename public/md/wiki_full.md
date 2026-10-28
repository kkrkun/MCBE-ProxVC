# MCBE ProxVC Wiki Documentation

This document is a compilation of the MCBE ProxVC Wiki.
It contains setup guides, troubleshooting steps, and feature documentation.
Target version: Latest
Generated on: 2026-01-17T11:11:16.692Z



# はじめに

### MCBE ProxVCとは
- minecraft統合版用のソフトウェアです。JAVA版では使用できません。
- 立体音響を使用したMinecraftの近接ボイスチャットが可能になり、より没入感の高いコミュニケーションをする事ができます。
- 設定はWEBで行うことができ非常に簡単で、基本的にはそのまま使えるようになっています。
- 多くのプラットフォームに対応しており、様々な環境で楽しむ事ができます。[(対応プラットフォーム一覧)](../condition/)

### お知らせ
- 制作者: kkr1212
- バージョン: 3.0.9
- [利用規約](../../terms/)
- [プライバシーポリシー](../../policy/)
- [GitHub](https://github.com/kkrkun/MCBE-ProxVC/releases/latest)
- 更新日: 2025/11/20



---

# 前提条件
本ソフトウェアを利用する前に、[利用規約](../../../terms/)および[プライバシーポリシー](../../../policy/)よくをお読みください。
本ソフトウェアを利用することで、[利用規約](../../../terms/)および[プライバシーポリシー](../../../policy/)に同意したものとみなされます。
## 対応プラットフォーム
✅: 対応
⚠️: 可能ではあるものの、知識が必要
❌: 未対応
| **プラットフォーム** | **WEBセットアップ** | **ローカルセットアップ** | **Minecraft 統合版** |
|:----------:|:-----------:|:------------:|:------------:|
| Windows | ✅ | ✅ | ✅ |
| Linux | ✅ | ⚠️ | ❌ |
| macOS | ✅ | ⚠️ | ❌ |
| Android | ✅ | ⚠️| ✅ |
| iOS | ✅ | ⚠️ | ✅ |
| Switch | ⚠️ | ❌ | ✅ |
| PS5 | ✅ | ❌ | ✅ |
| PS4 | ✅ | ❌ | ✅ |
| Xbox | ✅ | ❌ | ✅ |



---


# セットアップガイド（ホストのみ）

### 超簡単！Web版セットアップ
1. <a href="../../../setup/web/" target="_blank" rel="noopener noreferrer">こちらにアクセス</a>
2. お好みの設定にし、起動ボタンを押すだけ！！
[詳細設定はこちら](../advanced/)
設定ファイルをダウンロードしておくことで次回から同じ設定で起動できます
#### ⇒Next: [Minecraftへ接続](../../mc/)
![img](start.png)


---

## Windowsでセットアップ
<details>
<summary>セットアップ手順</summary>

#### ①<a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest"
target="_blank">GitHub</a>からproximity_vc.zipをダウンロードし解凍する

解凍すると画像のようなファイルがあります
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)

#### ②パターン1 webサイト上で編集（おすすめ）
<a href="../../../setup/web/" target="_blank"
rel="noopener noreferrer">こちら</a>のサイトからお好きな設定にし、設定ファイルをダウンロードしてconfig.jsonを上書きする
<a href="../advanced/" target="_blank" rel="noopener noreferrer">詳細設定はこちら</a>
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/3155eaa2-d4ae-47df-a30f-eeb0486319c1.png)

#### ②パターン2 config.jsonを直接編集する
config.jsonを開き、お好きな設定に変更してください。([設定一覧](../../functions/settings))
![image.png](../../config_json.png)

#### ③setup.cmdを起動

setup.cmdを管理者権限で実行
※すぐ閉じますが正しい挙動です
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-90-c877d99b.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-90-c877d99b.png)
#### これにてセットアップは終了です
</details>

<details>
<summary>起動方法</summary>

#### start.cmdを実行
![start.png](./start.png)
#### ⇒Next: [Minecraftへ接続](../../mc/)
</details>


---

## Androidでセットアップ
<details>
<summary>セットアップ手順</summary>

### 1. 事前準備と設定ファイルの編集
1.[GooglePlay](https://play.google.com/store/apps/details?id=com.termux&hl=ja)からTermuxというアプリをインストールしてください
2.<a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest"
target="_blank">GitHub</a>からproximity_vc.zipをダウンロードし、解凍してください
解凍すると画像のようなファイルがあります
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)
3. **config.jsonの編集**（以下のどちらかの方法で行ってください）
* **方法A：Webサイト上で編集（おすすめ）**
<a href="../../../setup/web/" target="_blank"
rel="noopener noreferrer">こちら</a>のサイトからお好きな設定にし、設定ファイルをダウンロードしてconfig.jsonを上書きする
<a href="../advanced/" target="_blank" rel="noopener noreferrer">詳細設定はこちら</a>
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/3155eaa2-d4ae-47df-a30f-eeb0486319c1.png)
* **方法B：直接編集する**
config.jsonを開き、お好きな設定に変更してください。([設定一覧](../../functions/settings))
![image.png](../../config_json.png)

### 2. Termuxでの環境構築とインストール
4. **Termuxの初期設定**
Termuxを起動し、以下のコマンドを順番に入力してください。
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/803557a6-7904-537e-0815-9760c0a1cea4.png)
```bash
pkg update
pkg upgrade
pkg i openssh
```
`Continue? [Y/n]`と聞かれた場合は、`y`を入力してエンターをタップしてください。
次にNode.jsをインストールします。
```bash
pkg i nodejs-lts
```
`node -v` と入力してバージョンが表示されればOKです。

5. **権限と設定の変更**
ストレージへのアクセス権限を与えます。
```bash
termux-setup-storage
```
![Screenshot](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/7ec9ea0a-08c5-6554-5e43-4ab329286c29.jpeg)

**バックグラウンド実行の許可**:
設定→アプリリスト→Termux→バッテリー使用量→バッググラウンドアビリティを許可をオンにしてください（※端末によって場所が異なります）。
![IMG](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/20ee8a2e-163e-83c8-2ed2-1c6e1e6d0dbd.png)

6. **ファイルの移動とインストール**
ダウンロードフォルダにあるファイルをTermux内部へ移動し、セットアップを完了させます。
```bash
# ファイルを移動（[解凍したフォルダー名]は実際の名前に変えてください）
cp -r /storage/emulated/0/Download/[解凍したフォルダー名] ~/proximity_vc

# フォルダへ移動してインストール
cd proximity_vc
npm i
```
これでセットアップは終了です。

</details>
<details>
<summary>起動方法</summary>

### ①以下のコマンドを実行
```bash
cd proximity_vc
node index.js
```
![start.png](./start.png)
#### ⇒Next: [Minecraftへ接続](../../mc/)
</details>



---

# 詳細設定
## TCP Exposer設定
Minecraftの/connectやVC接続でルームIDを固定する時に設定します
<details>
<summary>やり方</summary>

1. <a href="https://www.tcpexposer.com/register/" target="_blank">TCPExposer</a>のサイトに登録してログインしてください（パスワードは後で使うので必ず覚えておいてください）
2. マイページ→サブドメインを開いてください
3. New Sub Domainからお好きなサブドメイン取得してください
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/2294c811-6c7a-965b-51f7-2673d5777dd9.png)
4. TCP Exposerの情報をそれぞれ入力
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/4182cbb0-48c5-4780-8616-2fc1b3945c4a.png)
</details>
---
## SkyWay設定
SkyWayノイズキャンセリング等を使用する事ができます
<details>
<summary>やり方</summary>

1. <a href="https://console.skyway.ntt.com" target="_blank">SkyWay</a>に登録してログインしてください
2. ログインをし、出てくるガイド通りにアプリケーションを作成してください
3. そうすると画面のようなページが出てきます
![c0152789-90b0-2190-cc64-9a8dc961509c.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/fa46524e-6c1c-4a0c-bcfa-cea0b757c4fe.png)
4. アプリケーションIDとシークレットキーをそれぞれ入力
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/e098584a-281e-4a6e-8c1a-2a660c3db67a.png)
</details>



---


# Minecraftへ接続（ホストのみ）

## 通常のワールドへ接続
※1.21.60以降で仕様する場合ワールド主は「WebSocketが有効」をオンにしてください
※「暗号化されたWebSocketの要求」はオフにしてください
![image.png](../websocket.png)
表示されたコマンドをマイクラで実行
![image.png](../command.png)
以下のようなチャットが出たら成功です
![image.png](../success.png)


---

## サーバーへ接続
サーバーファイル内にある`server.properties`を開き`op-permission-level=4`してください
※op持ちはサーバーのストップなどもコマンドでできるようになります
![image.png](./op.png)
※1.21.60以降で仕様する場合ワールド主は「WebSocketが有効」をオンにしてください
※「暗号化されたWebSocketの要求」はオフにしてください
![image.png](../websocket.png)
表示されたコマンドをマイクラで実行
![image.png](../command.png)
以下のようなチャットが出たら成功です
![image.png](../success.png)


---

## 常時接続する方法
近接VCを常時接続しておくことができます
また、functionやコマンドブロックから近接VCの設定を変更する事ができます
### 初めに
- こちらはMinecraft Bedrock Serverでのみ使用可能です。ご自身でサーバーを立ててください。サーバーを立てるサポートは行っておりません
- <a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest"
target="_blank">GitHub</a>からproximity_vc.zipとServer_Proximity_Voice_Chat.mcpackをダウンロードしてください
<details>
<summary>セットアップ</summary>

#### ①proximity_vc.zipを解凍

そうすると画像のようなファイルがあります
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)

#### ②SkyWayに登録する＆プロジェクトとアプリケーションを作成

<a href="https://console.skyway.ntt.com" target="_blank">SkyWayに登録</a>
登録が終わったらログインをし、出てくるガイド通りにアプリケーションを作成してください
そうすると画面のようなページが出てきます
※アプリケーションIDとシークレットキーを後で使います
![c0152789-90b0-2190-cc64-9a8dc961509c.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/fa46524e-6c1c-4a0c-bcfa-cea0b757c4fe.png)

#### ③localhostを公開する為の準備

1. <a href="https://www.tcpexposer.com/register/"
target="_blank">TCPExposer</a>のサイトに登録してログインしてください（パスワードは後で使うので必ず覚えておいてください）
2.マイページ→サブドメインを開いてください
3.New Sub Domainからお好きなサブドメインを取得してください
※近接VCとマイクラサーバーが同端末の場合は1つでも大丈夫です
[![](https://minecraft-mcworld.com/wp-content/uploads/TCP_Exposer-74e42f74.png)](https://minecraft-mcworld.com/wp-content/uploads/TCP_Exposer-74e42f74.png)

#### ④パターン1 webサイト上で編集（おすすめ）
<a href="../../../setup/web/" target="_blank"
rel="noopener noreferrer">こちら</a>のサイトからお好きな設定にし、設定ファイルをダウンロードしてconfig.jsonを上書きする
※詳細設定もきちんと入力
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/3155eaa2-d4ae-47df-a30f-eeb0486319c1.png)

#### ④パターン2 config.jsonを編集する
config.jsonを開いてください
2～3行目にSkywayの2つを入れます
5～8行目にTCP Exposerのユーザー名とサブドメインを入れます
※近接VCとマイクラサーバーが同端末の場合sub_domain2は使わないので記入しなくていいです
また、この時にお好きな設定に変更してください。([設定一覧](../../functions/settings))
![image.png](../../config_json.png)

#### ⑤setup.cmdを起動

setup.cmdを管理者権限で実行
※すぐ閉じますが正しい挙動です
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-90-c877d99b.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-90-c877d99b.png)

#### ⑥Server_Proximity_Voice_Chatを使用したい`サーバー内のワールド`に適応
※ベータAPIをオンにしてください
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/91df0092-4b36-4509-94e8-dc1d190b9473.png)

#### ⑦サーバー設定を変更
`config/default/permissions.json`を開き`"@minecraft/server-net"`を追加
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/d9d66a8b-7f64-4ab2-802f-92b6e0a80aba.png)
#### これにてセットアップは終了です
</details>
<details>
<summary>始め方</summary>

#### ①start.cmdを実行
![スクリーンショット 2025-10-14
175541.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/d5534c44-b0e2-429b-a2e1-bf328bc1041b.png)
#### ②マイクラで/pvc:から始まるコマンドを実行
このようなチャットが出ると接続完了です
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/5654fae5-9fbe-425a-8155-fd13b3b9d4f7.png)

</details>



---


# ボイスチャット（参加者全員）

## VCへ接続
1. <a href="../../../connect/" target="_blank" rel="noopener noreferrer">こちらにアクセス</a>
[<a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest"
target="_blank">※Androidアプリ版はこちら</a>]
セットアップ時に表示されるURLにアクセスすると自動でルームIDが入力されています
![img.png](./web_url.png)
2. ルームIDとゲーマータグを入力し、接続する
**ルームID**
セットアップ時に表示されているルームIDを入力
![img.png](./web_roomid.png)**ゲーマータグ**
基本ゲーマータグだが、一部変わっている場合がある
例：日本語→ローマ字、空白→_
※どちらもマイクラ内で!nameと打つとで確認できる
#### このような画面になっていれば接続完了
![img.png](./web_success.png)


---

# バックグラウンド通話
<details>
<summary class="summary-h2">androidの場合</summary>

#### <a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest"
target="_blank">Androidアプリ</a>を使用してください
※必ず通知を許可してください
参考動画
<video src="./android.mp4" controls="true"></video>
</details>
<details>
<summary class="summary-h2">iphoneの場合</summary>

#### ①マイクラを開く
#### ②マイクラを一度バックグラウンドへ移動させブラウザからVCに接続
#### ③もう一度マイクラを開きワールドへ
参考動画
<video src="./iphone.mp4" controls="true"></video>
</details>



---


# 機能・設定

## 設定
|設定名|説明|型|デフォルト|必須/任意|
| --- | --- | --- | --- | --- |
|app_id|SkyWayのアプリケーションID|string|""|任意|
|secret_key|SkyWayのシークレットキー|string|""|任意|
|username|TCP Exposerのユーザー名|string|""|任意|
|sub_domain|TCP Exposerのサブドメイン|string|""|任意|
|sub_domain2|TCP Exposerのサブドメイン|string|""|任意|
|ssh_password|TCP Exposerのパスワード|string|""|任意|
|port|minecraftとの連携に使用するポート番号|number|19132|必須|
|web_port|Webサイトとの連携に使用するポート番号|number|8000|必須|
|proximity|近接VCを有効にするか|boolean|true|必須|
|spectator|スペクテイターモードのプレイヤーはVCを分けるか|boolean|true|必須|
|specListen|スペクテイターが他モードプレイヤーの会話を聞けるようにするか|boolean|true|必須|
|specDim|スペクテイター同士の会話をディメンションごとに分けるか|boolean|false|必須|
|verify|近接VC接続時に認証コードを要求するか|boolean|false|必須|
|distance|ゲーム内で声が届く最大ブロック数|number|10|必須|
|lang|表示言語の設定|"en"/"ja"|"en"|必須|


---

# ゲーム内コマンド
<details>
<summary class="summary-h2">/connectの通常接続時</summary>

|コマンド|説明|型|権限|
| --- | --- | --- | --- |
|!help|ヘルプを表示する|なし|全員|
|!name|VCで使うゲーマータグを確認できます|なし|全員|
|!pvc|近接VCを有効にするか|boolean|ホストのみ|
|!verify|近接VC接続時に認証コードを要求するか|boolean|ホストのみ|
|!dis|ゲーム内で声が届く最大ブロック数|number|ホストのみ|
|!spectator|スペクテイターモードのプレイヤーはVCを分けるか|boolean|ホストのみ|
|!specListen|スペクテイターが他モードプレイヤーの会話を聞けるようにするか|boolean|ホストのみ|
|!specDim|スペクテイター同士の会話をディメンションごとに分けるか|boolean|ホストのみ|
|!lang|表示言語の設定|"en"/"ja"|ホストのみ|
</details>

<details>
<summary class="summary-h2">/pvc:connectの常時接続時</summary>

|コマンド|説明|引数|権限|
| --- | --- | --- | --- |
|/pvc:help|ヘルプを表示する|なし|全員|
|/pvc:name|VCで使うゲーマータグを確認できます|なし|全員|
|/pvc:connect|接続を開始する|string|opのみ|
|/pvc:disconnect|接続を切断する|なし|opのみ|
|/pvc:proximity|近接VCを有効にするか|boolean|opのみ|
|/pvc:verify|近接VC接続時に認証コードを要求するか|boolean|opのみ|
|/pvc:distance|ゲーム内で声が届く最大ブロック数|number|opのみ|
|/pvc:spectator|スペクテイターモードのプレイヤーはVCを分けるか|boolean|opのみ|
|/pvc:specListen|スペクテイターが他モードプレイヤーの会話を聞けるようにするか|boolean|opのみ|
|/pvc:specDim|スペクテイター同士の会話をディメンションごとに分けるか|boolean|opのみ|
|/pvc:lang|表示言語の設定|"en"/"ja"|opのみ|
</details>


---


# 困ったときは

## セットアップ関連

<details>
<summary class="summary-h4">ios、Linuxでセットアップできないのか</summary>

LinuxはTerminalを使用することで可能です。iosは不明です。
説明等はありませんので知識がある方は頑張ってください
一応大雑把な方法は書いて起きます
1. Node.jsをインストールする（v18以上）
2. モジュールをインストール
3. 起動
以下のコマンドを実行
```
node index.js
```
</details>

<details>
<summary class="summary-h4">TCPExposerとは違うurlになってる</summary>

サブドメイン、ユーザー名、パスワードを間違えています
[こちら](../../setup/advanced/)のやり方を確認してください
</details>

<details>
<summary class="summary-h4">npm installでエラーが発生する</summary>

#### よくある原因と対処法

**1. Node.jsのバージョンが古い**
- Node.js v18以上がインストールされているか確認してください
- `node --version` でバージョンを確認

**2. ネットワークエラー**
- インターネット接続を確認してください
- 企業ネットワークやファイアウォールが原因の場合があります

**3. 権限エラー（Windows）**
- コマンドプロンプトを管理者として実行してみてください

**4. キャッシュの問題**
- 以下のコマンドでnpmキャッシュをクリア:
```
npm cache clean --force
```
その後、再度`npm install`を実行

</details>

<details>
<summary class="summary-h4">ファイアウォール/セキュリティソフトでブロックされる</summary>

#### Windowsファイアウォールの設定

1. Windowsセキュリティを開く
2. 「ファイアウォールとネットワーク保護」を選択
3. 「ファイアウォールによるアプリケーションの許可」をクリック
4. Node.jsまたは該当するプログラムを許可リストに追加

#### セキュリティソフト（ウイルス対策ソフト）

- セキュリティソフトの設定で、プログラムのフォルダやNode.jsを除外リストに追加してください
- 一時的に無効化して動作確認することも有効です（確認後は必ず有効に戻してください）
</details>

<details>
<summary class="summary-h4">エラーがでて終了した</summary>

再起動してください
大体なんとかなります
![error.png](./error.png)

#### それでも解決しない場合
1. Node.jsを再インストール
2. プログラムファイルを再ダウンロード
3. `npm install`を再実行
</details>

<details>
<summary class="summary-h4">config.jsonの読み込みエラー</summary>

JSONフォーマットが正しいか確認してください

- カンマの忘れ、余分なカンマがないか
- 全角文字が含まれていないか
</details>


---

## マイクラ接続関連

<details>
<summary class="summary-h4">Realmsで使用できますか?</summary>
不可能です
</details>

<details>
<summary class="summary-h4">コマンドが反応しない</summary>

設定 > 一般 > 「WebSocketが有効」が**オン**になっているか確認してください

- サーバーの場合
`server.properties`内に `op-permission-level=4` があるか確認してください

- 常時接続の場合
`config/default/permissions.json`内に `"@minecraft/server-net"` があるか確認してください
</details>

<details>
<summary class="summary-h4">接続できない</summary>
#### チェックリスト
1. 起動して5分以内か
起動して5分以内に接続が無いとメモリ削減のために自動で落ちる仕組みになっています。
再度起動してください
2. インターネット接続
インターネット接続が不安定な場合は接続が不安定になる可能性があります。
#### ローカル環境の場合

1. **IPアドレスとポート番号**
入力したIPアドレスとポート番号が正しいか確認してください

2. **ネットワーク接続**
同じWi-Fiネットワークに接続しているか確認してください

</details>

<details>
<summary class="summary-h4">/connect実行後にクラッシュする</summary>

設定 > 一般 > 「暗号化されたWebSocketの要求」が**オフ**になっているか確認してください
</details>

<details>
<summary class="summary-h4">「接続が切断されました」と突然出る</summary>

原因を調査中です。Webセットアップではなく、Windowsなどでセットアップを行ってください
</details>


---

## VC接続関連

### 機能が正常に動かない
<details>
<summary class="summary-h4">接続できない</summary>

ゲーマータグが正しいかコマンドで確認してください([コマンド一覧](../../functions/commands/))
</details>

<details>
<summary class="summary-h4">距離減衰・立体音響が効かない</summary>
**iOSなど一部端末の制限**
イヤホンなどを使用中、音声の入力・出力両方が同じイヤホンの場合、距離減衰や立体音響は適用されません（距離によって声が聞こえなくなる機能自体は動作します）
</details>

### マイク権限の問題

<details>
<summary class="summary-h4">ブラウザでマイク権限が求められない</summary>

#### Chrome/Edge

1. アドレスバー左側の🔒（鍵アイコン）またはℹ️をクリック
2. 「サイトの設定」を選択
3. マイクの設定を「許可」に変更
4. ページを再読み込み

#### Firefox

1. アドレスバー左側のℹ️アイコンをクリック
2. 「接続の安全性」の右側にある「>」をクリック
3. 「詳細を表示」をクリック
4. 「許可設定」タブでマイクを「許可」に設定
5. ページを再読み込み

#### Safari（Mac）

1. Safari > 環境設定 > Webサイト
2. 左側のメニューから「マイク」を選択
3. 該当のサイトを「許可」に設定
</details>

<details>
<summary class="summary-h4">Windows OSレベルでマイクが拒否されている</summary>

1. Windowsの設定を開く
2. 「プライバシーとセキュリティ」→「マイク」を選択
3. 「マイクへのアクセス」がオンになっているか確認
4. 「デスクトップアプリがマイクにアクセスできるようにする」をオンにする
5. ブラウザがリストに表示されていることを確認
</details>

---

### オーディオデバイスの問題

<details>
<summary class="summary-h4">マイクが認識されない</summary>

#### チェックリスト

1. **物理的な接続確認**
- マイクが正しく接続されているか確認
- USB接続の場合は他のUSBポートを試す

2. **Windowsサウンド設定**
- タスクバーのスピーカーアイコンを右クリック
- 「サウンドの設定」を開く
- 「入力デバイス」で正しいマイクが選択されているか確認
- マイクのテストで音声が検出されるか確認

3. **デバイスマネージャー確認**
- デバイスマネージャーを開く
- 「オーディオの入力および出力」セクションを確認
- !マークや×マークがないか確認
- ドライバーの更新を試す
</details>

<details>
<summary class="summary-h4">間違ったマイクが選択されている</summary>

ブラウザまたは設定画面で正しいマイクを選択してください。

#### 一般的なマイクデバイス名
- ヘッドセット: "ヘッドセット マイク" や製品名
- ノートPCの内蔵マイク: "内蔵マイク" "Internal Microphone"
- USB マイク: 製品名が表示される
- Bluetooth: デバイス名が表示される

複数のマイクがある場合は、それぞれ試してみてください。
</details>

---

### 音声の問題

<details>
<summary class="summary-h4">自分の声が相手に届かない</summary>

#### チェックリスト

1. **マイクのミュート確認**
- アプリケーション内でミュートになっていないか確認
- 物理的なミュートスイッチがオフになっているか確認

2. **入力レベルの確認**
- Windowsサウンド設定でマイクの入力レベルを確認
- レベルが低すぎる場合は、ボリュームを上げる（50-100%推奨）

3. **マイクブースト**
- サウンド設定 > 入力デバイス > デバイスのプロパティ
- 「追加のデバイスのプロパティ」をクリック
- 「レベル」タブでマイクブーストを調整（+10dB〜+20dB程度）

4. **一度vcを退出して再接続**
- 退出ボタンを押す
- ルームIDとゲーマータグを入力して再度参加

5. **ブラウザの再起動**
- ブラウザを完全に閉じて再起動
- ページに再度アクセス
</details>

<details>
<summary class="summary-h4">相手の声が聞こえない</summary>

#### チェックリスト

1. **システムボリュームの確認**
- Windows のボリュームが適切なレベルか確認
- ミュートになっていないか確認

2. **出力デバイスの確認**
- 正しいスピーカー/ヘッドフォンが選択されているか確認
- 他のアプリケーション（YouTube等）で音が出るか確認

3. **ブラウザのサイト音量**
- ブラウザのタブアイコンにスピーカーマークがあればクリック
- サイトがミュートされていないか確認

4. **一度vcを退出して再接続**
- 退出ボタンを押す
- ルームIDとゲーマータグを入力して再度参加

5. **相手側の問題の可能性**
- 相手のマイクが正常に動作しているか確認してもらう
</details>

<details>
<summary class="summary-h4">相手の声がずっと聞こえる</summary>

1. **自分だけが聞こえる場合**
- VCを退出して再度参加

2. **特定の人の声が全員に聞こえる場合**
- その人がVCを退出して再度参加

3. **全員の声がずっと聞こえる場合**
- MCBE ProxVC自体を再起動
- minecraftに再度接続
- 全員がVCを退出して再度参加
</details>

<details>
<summary class="summary-h4">エコー/ハウリングが発生する</summary>

#### 対処法

1. **ヘッドフォン/イヤホンを使用**
- スピーカーではなくヘッドフォンやイヤホンを使用する
- これが最も効果的な解決方法です

2. **スピーカーとマイクの距離を離す**
- スピーカー使用時はマイクから離れた位置に配置

3. **ボリュームを下げる**
- スピーカーやマイクの音量を下げる

4. **エコーキャンセレーション機能**
- Windowsサウンド設定でエコーキャンセレーション機能があれば有効にする
</details>

<details>
<summary class="summary-h4">音声が途切れる・ロボットのような声になる</summary>

#### 原因と対処法

**1. ネットワーク帯域幅の問題**
- 他のダウンロードやストリーミングを停止
- Wi-Fi接続の場合、有線LANへの切り替えを検討
- ルーターの近くに移動

**2. CPU/メモリの高負荷**
- 不要なアプリケーションを閉じる
- ブラウザのタブを減らす
- タスクマネージャーでCPU/メモリ使用率を確認

**3. マイク/スピーカーの設定**
- サンプルレートを調整（通常は 44.1kHz または 48kHz）
- サウンド設定 > デバイスのプロパティ > 詳細設定

**4. Bluetooth接続の遅延**
- Bluetoothデバイスの場合、有線デバイスへの切り替えを検討
</details>

---

### ブラウザの互換性

<details>
<summary class="summary-h4">推奨ブラウザ</summary>

このシステムは以下のブラウザで動作確認されています：

#### 推奨
- **Google Chrome**（最新版）
- **Microsoft Edge**（最新版）
- **Firefox**（最新版）
- **Safari**（最新版）

#### 非推奨/動作保証外
- Internet Explorer
- 古いバージョンのブラウザ
</details>


---

