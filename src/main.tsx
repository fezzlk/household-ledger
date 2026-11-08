import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Download,
  Home,
  Landmark,
  Leaf,
  List,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  balance,
  categories,
  claims,
  dueInMonth,
  monthly,
  monthOffset,
  newId,
  today,
  type Account,
  type Bill,
  type Command,
  type Entry,
  type Ledger,
} from "../shared/domain";
import "./style.css";

const yen = (n: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
const shortDate = (d: string) =>
  `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const accountLabels = {
  bank: "銀行口座",
  cash: "現金",
  paypay: "PayPay残高",
  card: "クレジットカード",
};
const entryLabels = {
  expense: "支出",
  income: "収入",
  transfer: "資金移動",
  settlement: "立替の回収",
  fee: "手数料",
  pending: "未分類",
};
type Tab = "home" | "entries" | "schedule" | "claims" | "settings";
type Modal =
  | "entry"
  | "account"
  | "bill"
  | "recurring"
  | "settlement"
  | "csv"
  | "paybill"
  | null;
async function api(path: string, body?: unknown) {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Ledger-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "接続できませんでした");
  return result;
}
function AccountIcon({
  type,
  size = 22,
}: {
  type: Account["type"];
  size?: number;
}) {
  return type === "card" ? (
    <CreditCard size={size} />
  ) : type === "bank" ? (
    <Landmark size={size} />
  ) : type === "paypay" ? (
    <Smartphone size={size} />
  ) : (
    <Wallet size={size} />
  );
}
function App() {
  const [session, setSession] = useState<{
    setup: boolean;
    authenticated: boolean;
    name?: string;
    cloud?: boolean;
    bootstrapRequired?: boolean;
  } | null>(null);
  const [state, setState] = useState<Ledger | null>(null),
    [tab, setTab] = useState<Tab>("home");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>(null),
    [selectedClaim, setSelectedClaim] = useState(""),
    [selectedBill, setSelectedBill] = useState("");
  const [entryKind, setEntryKind] = useState("expense"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  async function refresh() {
    try {
      const user = await api("session");
      setSession(user);
      if (user.authenticated) setState(await api("state"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function mutate(command: Command) {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    try {
      setState(await api("command", { revision: state.revision, command }));
      setModal(null);
      setToast("記録しました");
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.includes("別の画面")) await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function auth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(
        session?.setup ? "setup" : "login",
        session?.setup
          ? {
              name: form.get("name"),
              password: form.get("password"),
              bootstrapToken: form.get("bootstrapToken") || undefined,
              demo: form.get("demo") === "on",
            }
          : { password: form.get("password") },
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(type: Modal) {
    setError("");
    setModal(type);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      v = (k: string) => String(form.get(k) ?? ""),
      n = (k: string) => Number(form.get(k));
    const d = today();
    if (modal === "account")
      return mutate({
        type: "account",
        account: {
          id: newId(),
          name: v("name"),
          type: v("accountType") as Account["type"],
          openingBalance: n("openingBalance"),
        },
      });
    if (modal === "recurring")
      return mutate({
        type: "recurring",
        recurring: {
          id: newId(),
          name: v("name"),
          amount: n("amount"),
          day: n("day"),
          accountId: v("accountId"),
          category: v("category"),
        },
      });
    if (modal === "bill")
      return mutate({
        type: "bill",
        bill: {
          id: newId(),
          cardId: v("accountId"),
          description: v("description"),
          dueDate: v("date"),
          amount: v("amount") === "" ? null : n("amount"),
          fee: v("fee") === "" ? null : n("fee"),
          checkedAt: d,
          status: v("status") as Bill["status"],
          source: "本人による確認・入力",
        },
      });
    if (modal === "paybill")
      return mutate({
        type: "pay-bill",
        billId: selectedBill,
        fromAccountId: v("accountId"),
        date: v("date"),
      });
    if (modal === "csv") {
      const file = form.get("file") as File;
      if (!file?.size) return setError("CSVファイルを選択してください");
      if (file.size > 1_000_000)
        return setError("1MB以下のCSVを選択してください");
      return mutate({
        type: "paypay-csv",
        accountId: v("accountId"),
        csv: await file.text(),
      });
    }
    const kind =
      modal === "settlement" ? "settlement" : (entryKind as Entry["kind"]);
    const other = n("shareAmount");
    const entry: Entry = {
      id: newId(),
      date: v("date"),
      description: v("description"),
      kind,
      amount: n("amount"),
      accountId: v("accountId"),
      category: v("category") || "その他",
      shares:
        kind === "expense" && other > 0
          ? [{ id: newId(), person: v("person"), amount: other }]
          : [],
      allocations:
        kind === "settlement"
          ? [{ claimId: v("claimId"), amount: n("amount") }]
          : [],
    };
    if (kind === "transfer") entry.toAccountId = v("toAccountId");
    await mutate({ type: "entry", entry });
  }
  if (!session)
    return (
      <main className="auth-shell">
        <div className="brand">
          <Leaf />
          くらし通帳
        </div>
        <p>{error || "読み込んでいます…"}</p>
        {error && (
          <button onClick={() => void refresh()}>もう一度読み込む</button>
        )}
      </main>
    );
  if (!session.authenticated)
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div className="brand">
            <span className="brand-icon">
              <Leaf />
            </span>
            くらし通帳
          </div>
          <p className="eyebrow">YOUR MONEY, IN ONE PLACE</p>
          <h1>
            お金の流れを、
            <br />
            ひとつに。
          </h1>
          <p className="muted">
            日々の支出も、これからの支払いも。
            <br />
            自分のペースで整える、暮らしの家計簿。
          </p>
          <form onSubmit={auth}>
            {session.setup && (
              <label>
                表示名
                <input
                  name="name"
                  placeholder="あなたの名前"
                  autoComplete="nickname"
                  required
                  maxLength={40}
                />
              </label>
            )}
            <label>
              {session.setup
                ? "パスワードを決める（12文字以上）"
                : "パスワード"}
              <input
                name="password"
                type="password"
                minLength={session.setup ? 12 : 1}
                maxLength={128}
                required
                autoComplete={
                  session.setup ? "new-password" : "current-password"
                }
              />
            </label>
            {session.setup && !session.cloud && (
              <label className="checkbox">
                <input type="checkbox" name="demo" />
                <span>
                  サンプルデータで操作を試す
                  <small>架空の金額です。実データとは混在させません。</small>
                </span>
              </label>
            )}
            {session.setup && session.bootstrapRequired && <label>初回設定コード<input name="bootstrapToken" type="password" autoComplete="off" required maxLength={128}/><small>デプロイ時に発行されたコードです。初回だけ必要です。</small></label>}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy
                ? "処理中…"
                : session.setup
                  ? "自分の家計簿をはじめる"
                  : "ログイン"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-note">
            <ShieldCheck size={14} />
            本人専用 · {session.cloud ? "クラウドに保存" : "ローカル保存"} · 自動連携は未接続
          </p>
        </div>
      </main>
    );
  if (!state)
    return <main className="auth-shell">家計簿を読み込んでいます…</main>;
  const summary = monthly(state, month),
    allClaims = claims(state),
    outstanding = allClaims.filter((c) => c.remaining > 0),
    pending = state.entries.filter((e) => !e.voided && e.kind === "pending");
  const wallets = state.accounts.filter((a) => a.type !== "card"),
    cards = state.accounts.filter((a) => a.type === "card");
  const paid = (b: Bill) =>
    state.entries.some(
      (e) => !e.voided && e.billId === b.id && e.kind === "transfer",
    );
  const monthlyBills = state.bills.filter((b) => b.dueDate.startsWith(month));
  const unpaidBills = monthlyBills.filter((b) => !paid(b));
  const confirmed = unpaidBills
    .filter((b) => b.status === "confirmed")
    .reduce((n, b) => n + (b.amount ?? 0), 0);
  const unknown =
    cards.some((a) => !monthlyBills.some((b) => b.cardId === a.id)) ||
    unpaidBills.some((b) => b.amount === null);
  const visibleEntries = state.entries
    .filter(
      (e) =>
        (filter === "voided" ? e.voided : !e.voided) &&
        e.date.startsWith(month) &&
        e.description.toLowerCase().includes(search.toLowerCase()) &&
        (filter === "all" || filter === "voided" || e.kind === filter),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  function accountSelect(name: string, list: Account[], label: string) {
    return (
      <label>
        {label}
        <select name={name} required defaultValue={list[0]?.id ?? ""}>
          {list.length === 0 && (
            <option value="">先に口座を追加してください</option>
          )}
          {list.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function monthControl() {
    return (
      <div className="month-control">
        <button
          aria-label="前の月"
          onClick={() => setMonth(monthOffset(month, -1))}
        >
          <ChevronLeft size={17} />
        </button>
        <input
          type="month"
          aria-label="表示月"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
        <button
          aria-label="次の月"
          onClick={() => setMonth(monthOffset(month, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    );
  }
  function billRow(b: Bill) {
    return (
      <div className="bill-row" key={b.id}>
        <span className="tile-icon">
          <CreditCard size={21} />
        </span>
        <div className="grow">
          <strong>
            {state?.accounts.find((a) => a.id === b.cardId)?.name}
          </strong>
          <small>
            {shortDate(b.dueDate)} 引き落とし · {b.source}
          </small>
        </div>
        <div className="align-right">
          <strong>{b.amount === null ? "未取得" : yen(b.amount)}</strong>
          <span
            className={
              "badge " +
              (paid(b) ? "gray" : b.status === "confirmed" ? "green" : "amber")
            }
          >
            {paid(b)
              ? "支払記録済み"
              : b.status === "confirmed"
                ? "確定"
                : "予測"}
          </span>
        </div>
        {!paid(b) && b.status === "confirmed" && (
          <button
            className="icon-button"
            title="引き落としを記録"
            aria-label={`${b.description}の引き落としを記録`}
            onClick={() => {
              setSelectedBill(b.id);
              open("paybill");
            }}
          >
            <Check size={19} />
          </button>
        )}
      </div>
    );
  }
  const navItems = [
    { id: "home", label: "ホーム", icon: Home },
    { id: "entries", label: "明細", icon: List },
    { id: "schedule", label: "支払予定", icon: CreditCard },
    { id: "claims", label: "立替・精算", icon: Users },
    { id: "settings", label: "設定", icon: Settings },
  ] as const;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Leaf size={22} />
          </span>
          くらし通帳
        </div>
        <p className="sidebar-sub">暮らしのお金を、見通しよく。</p>
        <nav>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={20} />
              {label}
              {id === "entries" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{session.name?.slice(0, 1)}</span>
          <div>
            <strong>{session.name}</strong>
            <small>自分だけの家計簿</small>
          </div>
          <ShieldCheck size={18} />
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <Leaf size={20} />
            くらし通帳
          </div>
          <span className="desktop-note">
            <span className="status-dot" />
            自分だけの家計簿
          </span>
          <div className="topbar-actions">
            <span className="local-tag">
              {state.demo ? "サンプルモード" : session.cloud ? "クラウド版" : "ローカル版"}
            </span>
            <button
              className="primary compact"
              onClick={() => {
                setEntryKind("expense");
                open("entry");
              }}
            >
              <Plus size={18} />
              記録する
            </button>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {tab === "home"
                  ? "MY MONEY OVERVIEW"
                  : tab === "entries"
                    ? "TRANSACTIONS"
                    : tab === "schedule"
                      ? "UPCOMING PAYMENTS"
                      : tab === "claims"
                        ? "SHARED EXPENSES"
                        : "PREFERENCES"}
              </p>
              <h1>
                {navItems.find((n) => n.id === tab)?.label === "ホーム"
                  ? "暮らしのお金"
                  : navItems.find((n) => n.id === tab)?.label}
              </h1>
              <p className="muted">
                {tab === "home"
                  ? "いまあるお金と、これからのお金。"
                  : tab === "entries"
                    ? "自分の支出と、お金の移動を分けて記録。"
                    : tab === "schedule"
                      ? "確定した請求と、これからの予定を確認。"
                      : tab === "claims"
                        ? "誰から、いくら返ってくるか。"
                        : "口座とデータを、自分で管理。"}
              </p>
            </div>
            {tab !== "settings" && monthControl()}
          </div>
          {state.demo && (
            <div className="notice demo-notice">
              <Leaf size={17} />
              <span>
                操作確認用のサンプルデータです。楽天・銀行・PayPayからは取得していません。
              </span>
            </div>
          )}
          {error && !modal && (
            <div role="alert" className="error notice">
              {error}
              <button className="icon-button" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {tab === "home" && (
            <>
              <section className="summary-grid">
                <div className="spend-card">
                  <div className="card-top">
                    <span>今月の自分の支出</span>
                    <ReceiptText size={20} />
                  </div>
                  <div className="hero-amount">{yen(summary.expense)}</div>
                  <p>立替分と資金移動を除いた金額</p>
                  <div className="income-line">
                    <span>
                      収入 <b>{yen(summary.income)}</b>
                    </span>
                    <span>
                      収支 <b>{yen(summary.difference)}</b>
                    </span>
                  </div>
                </div>
                <div className="metric-card">
                  <span className="metric-icon">
                    <Landmark size={20} />
                  </span>
                  <p>銀行・現金・PayPay</p>
                  <h2>
                    {yen(wallets.reduce((n, a) => n + balance(state, a), 0))}
                  </h2>
                  <small>登録した明細に基づく残高</small>
                </div>
                <div className="metric-card">
                  <span className="metric-icon amber-bg">
                    <Users size={20} />
                  </span>
                  <p>まだ返ってきていないお金</p>
                  <h2>
                    {yen(outstanding.reduce((n, c) => n + c.remaining, 0))}
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => setTab("claims")}
                  >
                    {outstanding.length}件の立替を確認 <ArrowRight size={14} />
                  </button>
                </div>
              </section>
              {!state.accounts.length && (
                <div className="onboarding">
                  <div>
                    <h2>最初に、お金の置き場所を登録しましょう。</h2>
                    <p>銀行、PayPay、お財布、カードを分けて管理します。</p>
                  </div>
                  <button className="primary" onClick={() => open("account")}>
                    <Plus size={18} />
                    口座を追加
                  </button>
                </div>
              )}
              <div className="two-column">
                <section className="panel">
                  <div className="section-heading">
                    <h2>これからの支払い</h2>
                    <button
                      className="text-button"
                      onClick={() => setTab("schedule")}
                    >
                      すべて見る <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="payment-summary">
                    <span>未払いの確定請求</span>
                    <strong>{unknown && confirmed === 0 ? "未取得" : yen(confirmed)}</strong>
                    {unknown && <small>未取得のカード請求があります</small>}
                  </div>
                  {unpaidBills.slice(0, 3).map(billRow)}
                  {state.recurring.map((r) => (
                    <div key={r.id} className="bill-row">
                      <span className="tile-icon beige">
                        <Home size={20} />
                      </span>
                      <div className="grow">
                        <strong>{r.name}</strong>
                        <small>
                          {shortDate(dueInMonth(month, r.day))} · 定期支払い
                        </small>
                      </div>
                      <div className="align-right">
                        <strong>{yen(r.amount)}</strong>
                        <span className="badge gray">
                          {state.entries.some(
                            (e) =>
                              !e.voided &&
                              e.recurringKey === `${r.id}:${month}`,
                          )
                            ? "支払記録済み"
                            : "予定"}
                        </span>
                      </div>
                    </div>
                  ))}
                  {!unpaidBills.length && !state.recurring.length && (
                    <Empty text="支払予定はまだ登録されていません" />
                  )}
                  <p className="panel-footnote">
                    <CircleHelp size={14} />
                    PayPayの残高・未回収の立替は、銀行の引き落とし資金に含めません。
                  </p>
                </section>
                <section className="panel">
                  <div className="section-heading">
                    <h2>お金の置き場所</h2>
                    <button
                      className="icon-button"
                      aria-label="口座を追加"
                      onClick={() => open("account")}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {state.accounts.map((a) => (
                    <div className="account-row" key={a.id}>
                      <span
                        className={
                          "tile-icon " +
                          (a.type === "paypay" ? "paypay-bg" : "")
                        }
                      >
                        <AccountIcon type={a.type} />
                      </span>
                      <div className="grow">
                        <strong>{a.name}</strong>
                        <small>
                          {a.type === "card"
                            ? "カードの未払い元金・記録済み手数料"
                            : accountLabels[a.type]}
                        </small>
                      </div>
                      <strong>
                        {yen(
                          a.type === "card"
                            ? -balance(state, a)
                            : balance(state, a),
                        )}
                      </strong>
                    </div>
                  ))}
                  {!state.accounts.length && (
                    <Empty text="口座を追加すると残高を確認できます" />
                  )}
                  <div className="connection-note">
                    <span className="status-dot amber-dot" />
                    外部サービスの自動連携は未接続
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="section-heading">
                  <h2>最近の明細</h2>
                  <button
                    className="text-button"
                    onClick={() => setTab("entries")}
                  >
                    すべて見る <ArrowRight size={15} />
                  </button>
                </div>
                {visibleEntries.slice(0, 4).map((e) => (
                  <EntryRow key={e.id} entry={e} state={state} />
                ))}
                {!visibleEntries.length && (
                  <Empty text="この月の明細はまだありません" />
                )}
              </section>
            </>
          )}
          {tab === "entries" && (
            <section className="panel">
              <div className="list-toolbar">
                <input
                  aria-label="明細を検索"
                  placeholder="お店・内容で検索"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="明細の種類"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">すべての種類</option>
                  <option value="voided">取消済み</option>
                  {Object.entries(entryLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              {pending.length > 0 && (
                <p className="notice">
                  未分類の入出金は、残高に反映し、収入・支出の集計には含めていません。
                </p>
              )}
              {visibleEntries.map((e) => (
                <div key={e.id}>
                  <EntryRow entry={e} state={state} />
                  {!e.sourceKey && (
                    <div className="classify-row">
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            e.voided ||
                            window.confirm(
                              "この明細を取り消しますか？ 履歴は残り、取消済み一覧から戻せます。カードの引き落としは手数料もまとめて取り消します。",
                            )
                          )
                            void mutate({
                              type: e.voided ? "restore-entry" : "void-entry",
                              entryId: e.id,
                            });
                        }}
                      >
                        {e.voided ? "取消を戻す" : "記録を取り消す"}
                      </button>
                    </div>
                  )}
                  {!e.voided && e.kind === "pending" && (
                    <div className="classify-row">
                      {e.direction === "out" ? (
                        <button
                          onClick={() =>
                            void mutate({
                              type: "classify",
                              entryId: e.id,
                              kind: "expense",
                              category: "その他",
                            })
                          }
                        >
                          本人の支出にする
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() =>
                              void mutate({
                                type: "classify",
                                entryId: e.id,
                                kind: "income",
                                category: "その他",
                              })
                            }
                          >
                            本人の収入にする
                          </button>
                          <select
                            aria-label="回収する立替"
                            defaultValue=""
                            onChange={(ev) =>
                              ev.target.value &&
                              void mutate({
                                type: "classify",
                                entryId: e.id,
                                kind: "settlement",
                                category: "その他",
                                claimId: ev.target.value,
                              })
                            }
                          >
                            <option value="">立替回収として紐付け</option>
                            {outstanding
                              .filter((c) => c.remaining >= e.amount)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.person} · {c.description}
                                </option>
                              ))}
                          </select>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!visibleEntries.length && (
                <Empty text="条件に合う明細はありません" />
              )}
            </section>
          )}
          {tab === "schedule" && (
            <>
              <div className="section-actions">
                <button onClick={() => open("bill")}>
                  <Plus size={16} />
                  カード請求を確認・追加
                </button>
                <button onClick={() => open("recurring")}>
                  <Plus size={16} />
                  定期支払いを追加
                </button>
              </div>
              <div className="forecast-grid">
                {[0, 1, 2].map((offset) => {
                  const m = monthOffset(month, offset),
                    bills = state.bills.filter((b) => b.dueDate.startsWith(m));
                  const missing =
                    cards.some((a) => !bills.some((b) => b.cardId === a.id)) ||
                    bills.some((b) => b.amount === null);
                  const knownAmount = bills.reduce((n, b) => n + (b.amount ?? 0), 0) +
                    state.recurring.reduce((n, r) => n + r.amount, 0);
                  return (
                    <div className="panel forecast" key={m}>
                      <span>{Number(m.slice(5))}月の支払予定</span>
                      <h2>
                        {missing && knownAmount === 0 ? "未取得" : yen(knownAmount)}
                      </h2>
                      <small>
                        {missing
                          ? "確認できた分のみ · 未取得の請求あり"
                          : "登録されている請求・定期予定の合計"}
                      </small>
                      <div className="mini-bar">
                        <span style={{ width: "100%" }} />
                      </div>
                      <span className="badge gray">
                        {bills.some((b) => b.status === "forecast")
                          ? "予測を含む"
                          : "登録分"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <section className="panel">
                <div className="section-heading">
                  <h2>カードの請求</h2>
                  <span className="muted">{month}</span>
                </div>
                {monthlyBills.map(billRow)}
                {!monthlyBills.length && (
                  <Empty text="カード請求は未取得です。購入総額から引き落とし額は推定しません。" />
                )}
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h2>定期支払い</h2>
                </div>
                {state.recurring.map((r) => {
                  const recorded = state.entries.some(
                    (e) => !e.voided && e.recurringKey === `${r.id}:${month}`,
                  );
                  return (
                    <div className="bill-row" key={r.id}>
                      <span className="tile-icon beige">
                        <Home size={20} />
                      </span>
                      <div className="grow">
                        <strong>{r.name}</strong>
                        <small>
                          {
                            state.accounts.find((a) => a.id === r.accountId)
                              ?.name
                          }{" "}
                          · 毎月{r.day}日
                        </small>
                      </div>
                      <strong>{yen(r.amount)}</strong>
                      <button
                        disabled={
                          recorded || dueInMonth(month, r.day) > today() || busy
                        }
                        onClick={() =>
                          void mutate({
                            type: "pay-recurring",
                            recurringId: r.id,
                            month,
                          })
                        }
                      >
                        {recorded ? "記録済み" : "支払いを記録"}
                      </button>
                    </div>
                  );
                })}
                {!state.recurring.length && (
                  <Empty text="家賃などの毎月の予定を登録できます" />
                )}
              </section>
            </>
          )}
          {tab === "claims" && (
            <>
              <div className="claim-hero">
                <div>
                  <p>未回収の立替金</p>
                  <h2>
                    {yen(outstanding.reduce((n, c) => n + c.remaining, 0))}
                  </h2>
                  <small>回収しても、カードへの支払いは別に残ります。</small>
                </div>
                <Users size={48} />
              </div>
              <section className="claims-grid">
                {allClaims.map((c) => (
                  <article className="panel claim-card" key={c.id}>
                    <div className="section-heading">
                      <span className="person-avatar">
                        {c.person.slice(0, 1)}
                      </span>
                      <span
                        className={"badge " + (c.remaining ? "amber" : "green")}
                      >
                        {c.remaining ? "未精算" : "回収済み"}
                      </span>
                    </div>
                    <h2>{c.person}</h2>
                    <p>{c.description}</p>
                    <div className="claim-amount">
                      <span>あと</span>
                      <strong>{yen(c.remaining)}</strong>
                    </div>
                    <div className="progress">
                      <span
                        style={{ width: `${(c.received / c.amount) * 100}%` }}
                      />
                    </div>
                    <small>
                      {yen(c.amount)}のうち {yen(c.received)}を回収
                    </small>
                    {c.remaining > 0 && (
                      <button
                        className="secondary wide"
                        onClick={() => {
                          setSelectedClaim(c.id);
                          open("settlement");
                        }}
                      >
                        <ArrowDownLeft size={17} />
                        受け取りを記録
                      </button>
                    )}
                  </article>
                ))}
              </section>
              {!allClaims.length && (
                <section className="panel">
                  <Empty text="支出を記録するときに、相手と立替額を指定できます" />
                </section>
              )}
              <div className="notice">
                <CircleHelp size={17} />
                <span>
                  分割手数料は全額自分の支出です。相手への立替額には加算しません。
                </span>
              </div>
            </>
          )}
          {tab === "settings" && (
            <>
              <section className="panel">
                <div className="section-heading">
                  <h2>口座</h2>
                  <button onClick={() => open("account")}>
                    <Plus size={16} />
                    追加
                  </button>
                </div>
                {state.accounts.map((a) => (
                  <div key={a.id} className="account-row">
                    <span className="tile-icon">
                      <AccountIcon type={a.type} />
                    </span>
                    <div className="grow">
                      <strong>{a.name}</strong>
                      <small>
                        {accountLabels[a.type]} · 開始残高{" "}
                        {yen(a.openingBalance)}
                      </small>
                    </div>
                    <strong>{yen(balance(state, a))}</strong>
                  </div>
                ))}
                {!state.accounts.length && (
                  <Empty text="最初の口座を追加してください" />
                )}
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h2>連携とデータ</h2>
                  <span className="badge amber">自動連携は未接続</span>
                </div>
                <p className="muted">
                  楽天の分割変更・銀行・PayPayの自動取得は調査中です。更新ボタンで取得できる状態にはなっていません。
                </p>
                <div className="data-actions">
                  <a className="button" href="/api/export" download>
                    <Download size={17} />
                    バックアップを書き出す
                  </a>
                  <label className="button file-label">
                    <RefreshCw size={17} />
                    バックアップを追加読込
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            if (file.size > 1_500_000)
                              throw new Error(
                                "1.5MB以下のファイルを選択してください",
                              );
                            await mutate({
                              type: "merge-backup",
                              data: JSON.parse(await file.text()),
                            });
                          } catch (err) {
                            setError((err as Error).message);
                          }
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                  <button onClick={() => open("csv")}>
                    <ReceiptText size={17} />
                    PayPay CSVを補助取込
                  </button>
                </div>
                <small className="muted">
                  追加読込は既存データを上書きしません。PayPayの開始残高は、取り込む最初の取引より前の残高を指定してください。
                </small>
              </section>
              <section className="panel">
                <h2>このアプリについて</h2>
                <p className="muted">
                  くらし通帳 · {session.cloud ? "クラウド版" : "ローカル版"} 0.1.0
                  <br />
                  データは{session.cloud ? "クラウドのFirestore" : "このMacのSQLite"}に保存されます。初期設定のサンプル選択は、実データと混在しないため変更できません。外部サービスの自動取得は未接続です。
                </p>
                <p className="muted">
                  iPhoneのホーム画面への追加は、本番HTTPSで公開した後に確認します。
                </p>
                <button
                  onClick={async () => {
                    await api("logout", {});
                    setState(null);
                    await refresh();
                  }}
                >
                  <LogOut size={16} />
                  ログアウト
                </button>
              </section>
            </>
          )}
          <footer className="page-footer">
            <Leaf size={14} />
            くらし通帳<span>お金の流れを、ひとつに。</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div role="status" className="toast">
          <Check size={18} />
          {toast}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="section-heading">
              <h2 id="modal-title">
                {
                  {
                    entry: "お金の動きを記録",
                    account: "口座を追加",
                    bill: "カード請求を確認・追加",
                    recurring: "定期支払いを追加",
                    settlement: "立替金の受け取り",
                    csv: "PayPay CSVの補助取込",
                    paybill: "カード引き落としの記録",
                  }[modal]
                }
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="閉じる"
                onClick={() => !busy && setModal(null)}
              >
                <X size={21} />
              </button>
            </div>
            <form onSubmit={submit}>
              {modal === "account" ? (
                <>
                  <label>
                    口座名
                    <input
                      name="name"
                      required
                      maxLength={160}
                      placeholder="生活用口座 / PayPay など"
                    />
                  </label>
                  <label>
                    種類
                    <select name="accountType">
                      {Object.entries(accountLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    開始残高（円）
                    <input
                      name="openingBalance"
                      type="number"
                      step="1"
                      defaultValue="0"
                      required
                      min="-1000000000"
                      max="1000000000"
                    />
                  </label>
                  <p className="field-note">
                    カードの未払い額はマイナスで入力します。明細を取り込む場合は、その期間より前の残高を指定してください。
                  </p>
                </>
              ) : modal === "recurring" ? (
                <>
                  <label>
                    名前
                    <input name="name" required placeholder="家賃" />
                  </label>
                  <label>
                    金額（円）
                    <input
                      name="amount"
                      type="number"
                      min="1"
                      max="1000000000"
                      step="1"
                      required
                    />
                  </label>
                  <label>
                    毎月の支払日
                    <input
                      name="day"
                      type="number"
                      min="1"
                      max="31"
                      required
                      defaultValue="28"
                    />
                  </label>
                  {accountSelect("accountId", wallets, "支払い元")}
                  <CategorySelect />
                  <p className="field-note">
                    予定の登録だけでは、支出や残高に反映しません。
                  </p>
                </>
              ) : modal === "bill" ? (
                <>
                  <p className="field-note">
                    任意の手動確認です。楽天の分割変更を二重入力する日常運用は想定していません。
                  </p>
                  {accountSelect("accountId", cards, "カード")}
                  <label>
                    請求の名前
                    <input
                      name="description"
                      required
                      placeholder="楽天カード 11月分"
                    />
                  </label>
                  <label>
                    引落日
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={dueInMonth(month, 27)}
                    />
                  </label>
                  <label>
                    請求総額（円）
                    <input
                      name="amount"
                      type="number"
                      min="1"
                      max="1000000000"
                      step="1"
                      placeholder="不明なら空欄"
                    />
                  </label>
                  <label>
                    うち手数料（円）
                    <input
                      name="fee"
                      type="number"
                      min="0"
                      max="1000000000"
                      step="1"
                      placeholder="なしは0、不明は空欄"
                    />
                  </label>
                  <label>
                    確認状態
                    <select name="status">
                      <option value="forecast">予定・予測</option>
                      <option value="confirmed">
                        楽天等で確定を確認した額
                      </option>
                    </select>
                  </label>
                </>
              ) : modal === "csv" ? (
                <>
                  <p className="field-note">
                    公式CSVを手動で取り込む補助手段です。自動連携ではありません。入金を収入と断定せず、すべて未分類で追加します。
                  </p>
                  {accountSelect(
                    "accountId",
                    state.accounts.filter((a) => a.type === "paypay"),
                    "取り込み先",
                  )}
                  <label>
                    PayPay公式CSV
                    <input
                      type="file"
                      name="file"
                      accept=".csv,text/csv"
                      required
                    />
                  </label>
                  <p className="field-note">
                    取引番号が一致する再取り込みは重複追加しません。
                  </p>
                </>
              ) : modal === "paybill" ? (
                <>
                  <p className="field-note">
                    実際に引き落とされたことを確認してから記録してください。手数料は本人の費用として別記録します。
                  </p>
                  {accountSelect(
                    "accountId",
                    state.accounts.filter((a) => a.type === "bank"),
                    "引き落とし元の銀行",
                  )}
                  <label>
                    実際の引落日
                    <input
                      name="date"
                      type="date"
                      defaultValue={today()}
                      max={today()}
                      required
                    />
                  </label>
                  <div className="notice">
                    {
                      state.bills.find((b) => b.id === selectedBill)
                        ?.description
                    }{" "}
                    ·{" "}
                    {yen(
                      state.bills.find((b) => b.id === selectedBill)?.amount ??
                        0,
                    )}
                  </div>
                </>
              ) : (
                <>
                  {modal === "entry" && (
                    <label>
                      記録の種類
                      <select
                        value={entryKind}
                        onChange={(e) => setEntryKind(e.target.value)}
                      >
                        <option value="expense">支出・立替</option>
                        <option value="income">収入</option>
                        <option value="transfer">
                          チャージ・口座間移動・カード支払い
                        </option>
                      </select>
                    </label>
                  )}
                  <label>
                    内容
                    <input
                      name="description"
                      required
                      maxLength={160}
                      placeholder={
                        modal === "settlement"
                          ? "チケット代の受け取り"
                          : "スーパー、チケット代 など"
                      }
                    />
                  </label>
                  <div className="form-pair">
                    <label>
                      金額（円）
                      <input
                        name="amount"
                        type="number"
                        min="1"
                        max="1000000000"
                        step="1"
                        required
                        defaultValue={
                          modal === "settlement"
                            ? outstanding.find((c) => c.id === selectedClaim)
                                ?.remaining
                            : undefined
                        }
                      />
                    </label>
                    <label>
                      日付
                      <input
                        name="date"
                        type="date"
                        required
                        max={today()}
                        defaultValue={today()}
                      />
                    </label>
                  </div>
                  {accountSelect(
                    "accountId",
                    modal === "settlement" ||
                      entryKind === "income" ||
                      entryKind === "transfer"
                      ? wallets
                      : state.accounts,
                    modal === "settlement" || entryKind === "income"
                      ? "受け取り先"
                      : "支払い元",
                  )}
                  {modal === "settlement" ? (
                    <>
                      <label>
                        精算する立替
                        <select
                          name="claimId"
                          required
                          defaultValue={selectedClaim}
                        >
                          {outstanding.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.person} · 残り{yen(c.remaining)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="field-note">
                        一部だけの回収もできます。給与等の収入には含めません。
                      </p>
                    </>
                  ) : entryKind === "transfer" ? (
                    <>
                      {accountSelect("toAccountId", state.accounts, "移動先")}
                      <p className="field-note">
                        カードへの支払い・PayPayチャージは、本人の支出として重複計上しません。
                      </p>
                    </>
                  ) : entryKind === "expense" ? (
                    <>
                      <CategorySelect />
                      <details className="share-details">
                        <summary>他の人の分を立て替えた</summary>
                        <label>
                          相手の名前
                          <input
                            name="person"
                            maxLength={160}
                            placeholder="あやさん"
                          />
                        </label>
                        <label>
                          支払い総額のうち、相手の負担額
                          <input
                            name="shareAmount"
                            type="number"
                            min="0"
                            max="1000000000"
                            step="1"
                            placeholder="例：9000"
                          />
                        </label>
                        <p className="field-note">
                          総額から立替分を除いた金額が、自分の支出です。分割手数料は立替に含めません。
                        </p>
                      </details>
                    </>
                  ) : (
                    <label>
                      分類
                      <input name="category" defaultValue="給与" />
                    </label>
                  )}
                </>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="primary wide" disabled={busy}>
                {busy ? "記録中…" : "記録する"}
                <Check size={18} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function CategorySelect() {
  return (
    <label>
      カテゴリー
      <select name="category">
        {categories.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ReceiptText size={26} />
      <p>{text}</p>
    </div>
  );
}
function EntryRow({ entry: e, state }: { entry: Entry; state: Ledger }) {
  const incoming =
    e.kind === "income" ||
    e.kind === "settlement" ||
    (e.kind === "pending" && e.direction === "in");
  const own = e.amount - e.shares.reduce((n, p) => n + p.amount, 0);
  return (
    <div className="entry-row">
      <span
        className={
          "tile-icon " +
          (e.kind === "settlement" ? "beige" : incoming ? "mint" : "")
        }
      >
        {e.kind === "transfer" ? (
          <ArrowLeftRight size={20} />
        ) : e.kind === "settlement" ? (
          <Users size={20} />
        ) : incoming ? (
          <ArrowDownLeft size={20} />
        ) : (
          <ArrowUpRight size={20} />
        )}
      </span>
      <div className="grow">
        <strong>{e.description}</strong>
        <small>
          {shortDate(e.date)} ·{" "}
          {state.accounts.find((a) => a.id === e.accountId)?.name} ·{" "}
          {entryLabels[e.kind]}
          {e.kind === "expense" && ` · ${e.category}`}
        </small>
        {e.shares.length > 0 && (
          <small className="share-hint">
            自分 {yen(own)} / 立替 {yen(e.amount - own)}
          </small>
        )}
      </div>
      <div className="align-right">
        <strong className={incoming ? "positive" : ""}>
          {e.kind === "transfer" ? "" : incoming ? "+" : "−"}
          {yen(e.amount)}
        </strong>
        {e.voided ? (
          <span className="badge gray">取消済み</span>
        ) : (
          e.kind === "pending" && <span className="badge amber">要確認</span>
        )}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
