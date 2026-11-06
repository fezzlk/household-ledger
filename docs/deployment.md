# Cloud Runへのデプロイ

アプリは本人用パスワードで保護し、家計データとログイン情報はFirestoreのデフォルトDBへ保存します。ブラウザからFirestoreを直接操作する構成ではありません。

## 事前構成

- Cloud Run・Firestore・Artifact Registry・Cloud Build・Secret Managerを同じプロジェクトへ配置する。
- Firestore Standard / NativeのデフォルトDBをアプリと同じリージョンに作成する。削除保護を有効にする。ローカルではSQLiteを使用し、Firestoreエミュレータは使わない。
- 実行SAは `${SERVICE}-run`。Firestoreを操作する権限と、初回設定コードのSecretバージョン参照権限を付ける。
- ビルドSAは `${SERVICE}-build`。Artifact Registryへの書き込み、Cloud Runへのデプロイ、Cloud Loggingへの書き込み、実行SAの利用を許可する。
- 初回設定コードは十分長いランダム値をSecret Managerへ直接登録する。値をソースやシェル引数へ書かない。

## デプロイ経路

`cloudbuild.yaml` は project-generator のテンプレートを基にしています。GitHubのmainとこのファイルを使うトリガーを1件だけ作成し、そのトリガーからデプロイします。Consoleのソース接続や `gcloud run deploy --source` は使いません。

トリガーの実行SAは専用のビルドSAに設定します。イメージはCOMMIT_SHAで識別し、`deploy/artifact-cleanup.json` により7日超の古いイメージを削除対象、直近3世代を保持対象にします。

Cloud Runの設定は1リージョン、最小0・最大1インスタンス、1 CPU / 512 MiB、CPUスロットリングあり、CPUブーストなし、セッション固定なし、タイムアウト300秒です。ログインページと静的ファイルには匿名アクセスを許可しますが、家計APIには本人のセッションが必須です。初期設定APIはSecret Managerの確認コードが一致した場合だけ一度実行できます。

## 初回だけ行う設定

デプロイされたURLを開き、表示名・12文字以上のパスワード・初回設定コードを入力します。本人以外が先に初期設定できないよう、コードなしの設定は拒否します。本番はサンプルデータを作成しません。

コードは権限のある端末から次のコマンドで確認できます。`YOUR_PROJECT_ID` をデプロイ先へ置き換えてください。コードはチャットやリポジトリへ貼り付けないでください。

```sh
gcloud secrets versions access latest \
  --secret=household-ledger-bootstrap \
  --project=YOUR_PROJECT_ID
```

初回設定後、コードだけで既存のパスワードを変更したり所有者を上書きしたりすることはできません。ログイン済み端末でのセッションは7日間です。パスワードのリセットUIは未実装です。

Safariで本番URLを開き、「共有」から「ホーム画面に追加」を選びます。Web App Manifestは用意していますが、iPhone実機の動作は個別に確認してください。

## データと運用

保存はFirestoreトランザクションとrevisionで競合を確認します。初期版では1件の家計簿JSONを保持し、安全な保存上限を800,000 UTF-8 bytesに設定しています。上限を超える更新は拒否し、既存データは維持します。定期的なバックアップ書き出しを利用できます。

ローカルのデータは自動では本番へ移行しません。移行する場合は本人がログインしてバックアップを取り込み、開始残高と過去明細の重複を確認します。

デプロイ前後にBudget通知、Cloud Run設定、トリガー数、Artifact Registry容量を確認します。Budgetは通知用で自動的な課金停止ではありません。FirestoreのPITR・スケジュールバックアップ・TTLは既定で有効にしません。実費と無料枠の残量は別途確認が必要です。
