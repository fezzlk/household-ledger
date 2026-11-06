import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  balance,
  claims,
  emptyState,
  entrySchema,
  monthly,
  validateState,
  dueInMonth,
  demoState,
  today,
} from "../shared/domain.js";

function fixture() {
  const s = emptyState();
  s.accounts = [
    { id: "bank", name: "銀行", type: "bank", openingBalance: 100000 },
    { id: "card", name: "カード", type: "card", openingBalance: 0 },
    { id: "paypay", name: "PayPay", type: "paypay", openingBalance: 0 },
  ];
  s.entries = [
    entrySchema.parse({
      id: "ticket",
      date: "2026-01-01",
      description: "2人のチケット",
      kind: "expense",
      amount: 18000,
      accountId: "card",
      shares: [{ id: "friend", person: "友人", amount: 9000 }],
    }),
  ];
  return s;
}
const recovery = (id: string, amount: number) => ({
  type: "entry",
  entry: entrySchema.parse({
    id,
    date: "2026-01-02",
    description: "チケット代の回収",
    kind: "settlement",
    amount,
    accountId: "paypay",
    allocations: [{ claimId: "friend", amount }],
  }),
});
test("立替元本を本人支出から除外し、カード残債は購入総額になる", () => {
  const s = fixture();
  assert.equal(monthly(s, "2026-01").expense, 9000);
  assert.equal(balance(s, s.accounts[1]), -18000);
  assert.equal(claims(s)[0].remaining, 9000);
});
test("PayPayによる一部・全額回収は収入とカード残債を変えない", () => {
  let s = applyCommand(fixture(), recovery("r1", 4000));
  assert.equal(claims(s)[0].remaining, 5000);
  assert.equal(monthly(s, "2026-01").income, 0);
  assert.equal(balance(s, s.accounts[1]), -18000);
  s = applyCommand(s, recovery("r2", 5000));
  assert.equal(claims(s)[0].remaining, 0);
  assert.equal(balance(s, s.accounts[2]), 9000);
  assert.equal(balance(s, s.accounts[1]), -18000);
});
test("立替の過剰回収を拒否し、元データを変更しない", () => {
  const original = fixture();
  assert.throws(() => applyCommand(original, recovery("r", 9001)), /超え/);
  assert.equal(original.entries.length, 1);
});
test("複数立替に対する一括回収の割当を正しく集計する", () => {
  const s = fixture();
  s.entries[0].shares = [
    { id: "a", person: "A", amount: 4000 },
    { id: "b", person: "B", amount: 5000 },
  ];
  const next = applyCommand(s, {
    type: "entry",
    entry: entrySchema.parse({
      id: "r",
      date: "2026-01-02",
      description: "まとめて回収",
      kind: "settlement",
      amount: 9000,
      accountId: "paypay",
      allocations: [
        { claimId: "a", amount: 4000 },
        { claimId: "b", amount: 5000 },
      ],
    }),
  });
  assert.deepEqual(
    claims(next).map((c) => c.remaining),
    [0, 0],
  );
});
test("本人負担・立替配分の合計が支払額を超える入力を拒否", () => {
  const s = fixture();
  s.entries[0].shares[0].amount = 18001;
  assert.throws(() => validateState(s), /総額以下/);
});
test("銀行からPayPayへのチャージは支出に数えず残高を移動する", () => {
  const s = applyCommand(fixture(), {
    type: "entry",
    entry: entrySchema.parse({
      id: "charge",
      date: "2026-01-02",
      description: "チャージ",
      kind: "transfer",
      amount: 5000,
      accountId: "bank",
      toAccountId: "paypay",
    }),
  });
  assert.equal(balance(s, s.accounts[0]), 95000);
  assert.equal(balance(s, s.accounts[2]), 5000);
  assert.equal(monthly(s, "2026-01").expense, 9000);
});
test("カード支払いは元金と本人負担手数料を分け、購入支出を重複させない", () => {
  const s = fixture();
  s.bills = [
    {
      id: "bill",
      cardId: "card",
      dueDate: "2026-01-27",
      amount: 3300,
      fee: 300,
      status: "confirmed",
      source: "テスト",
      checkedAt: "2026-01-20",
      description: "請求",
    },
  ];
  const next = applyCommand(s, {
    type: "pay-bill",
    billId: "bill",
    fromAccountId: "bank",
    date: "2026-01-27",
  });
  assert.equal(balance(next, next.accounts[0]), 96700);
  assert.equal(balance(next, next.accounts[1]), -15000);
  assert.equal(monthly(next, "2026-01").expense, 9300);
  assert.equal(claims(next)[0].amount, 9000);
  assert.throws(
    () =>
      applyCommand(next, {
        type: "pay-bill",
        billId: "bill",
        fromAccountId: "bank",
        date: "2026-01-27",
      }),
    /記録済み/,
  );
});
test("手数料が未確認の請求や予測請求の支払い配分は拒否", () => {
  const s = fixture();
  s.bills = [
    {
      id: "bill",
      cardId: "card",
      dueDate: "2026-01-27",
      amount: 3300,
      fee: null,
      status: "confirmed",
      source: "テスト",
      checkedAt: "2026-01-20",
      description: "請求",
    },
  ];
  assert.throws(
    () =>
      applyCommand(s, {
        type: "pay-bill",
        billId: "bill",
        fromAccountId: "bank",
        date: "2026-01-27",
      }),
    /未確認/,
  );
  s.bills[0].fee = 0;
  s.bills[0].status = "forecast";
  assert.throws(
    () =>
      applyCommand(s, {
        type: "pay-bill",
        billId: "bill",
        fromAccountId: "bank",
        date: "2026-01-27",
      }),
    /確定/,
  );
});
test("予定の家賃は支出を増やさず、実績登録後に一度だけ計上する", () => {
  const s = fixture();
  s.recurring = [
    {
      id: "rent",
      accountId: "bank",
      name: "家賃",
      amount: 70000,
      day: 31,
      category: "住まい",
    },
  ];
  assert.equal(monthly(s, "2026-02").expense, 0);
  const next = applyCommand(s, {
    type: "pay-recurring",
    recurringId: "rent",
    month: "2026-02",
  });
  assert.equal(next.entries.at(-1)?.date, "2026-02-28");
  assert.equal(monthly(next, "2026-02").expense, 70000);
  assert.throws(
    () =>
      applyCommand(next, {
        type: "pay-recurring",
        recurringId: "rent",
        month: "2026-02",
      }),
    /重複/,
  );
});
const csv = (incoming = "4000", outgoing = "-", number = "123") =>
  `取引日,出金金額（円）,入金金額（円）,取引内容,取引先,取引番号\n2026/01/02 10:00,${outgoing},${incoming},受け取り,友人,${number}`;
test("PayPay受取CSVは未分類で残高へ反映し、収入と断定しない", () => {
  const s = applyCommand(fixture(), {
    type: "paypay-csv",
    accountId: "paypay",
    csv: csv(),
  });
  assert.equal(balance(s, s.accounts[2]), 4000);
  assert.equal(monthly(s, "2026-01").income, 0);
  assert.equal(claims(s)[0].remaining, 9000);
  const classified = applyCommand(s, {
    type: "classify",
    entryId: s.entries.at(-1)!.id,
    kind: "settlement",
    category: "その他",
    claimId: "friend",
  });
  assert.equal(claims(classified)[0].remaining, 5000);
  assert.equal(balance(classified, classified.accounts[2]), 4000);
  assert.equal(monthly(classified, "2026-01").income, 0);
});
test("同じ取引番号のCSV再読込は分類後でも重複せず、変更は拒否する", () => {
  let s = applyCommand(fixture(), {
    type: "paypay-csv",
    accountId: "paypay",
    csv: csv(),
  });
  s = applyCommand(s, {
    type: "classify",
    entryId: s.entries.at(-1)!.id,
    kind: "settlement",
    category: "その他",
    claimId: "friend",
  });
  const next = applyCommand(s, {
    type: "paypay-csv",
    accountId: "paypay",
    csv: csv(),
  });
  assert.equal(next.entries.length, 2);
  assert.throws(
    () =>
      applyCommand(s, {
        type: "paypay-csv",
        accountId: "paypay",
        csv: csv("5000"),
      }),
    /変わっています/,
  );
  assert.throws(
    () =>
      applyCommand(s, {
        type: "paypay-csv",
        accountId: "paypay",
        csv: csv("-", "4000"),
      }),
    /方向/,
  );
});
test("同日同額でも取引番号が違えば両方残す", () => {
  let s = applyCommand(fixture(), {
    type: "paypay-csv",
    accountId: "paypay",
    csv: csv(),
  });
  s = applyCommand(s, {
    type: "paypay-csv",
    accountId: "paypay",
    csv: csv("4000", "-", "456"),
  });
  assert.equal(s.entries.length, 3);
});
test("不正CSVを途中まで取り込まず、元の状態を保持する", () => {
  const s = fixture();
  assert.throws(() =>
    applyCommand(s, {
      type: "paypay-csv",
      accountId: "paypay",
      csv: csv() + "\ninvalid,-,100,受け取り,友人,999",
    }),
  );
  assert.equal(s.entries.length, 1);
});
test("異なる方向の未分類を分類できない", () => {
  const s = applyCommand(fixture(), {
    type: "paypay-csv",
    accountId: "paypay",
    csv: csv(),
  });
  assert.throws(
    () =>
      applyCommand(s, {
        type: "classify",
        entryId: s.entries.at(-1)!.id,
        kind: "expense",
        category: "食費",
      }),
    /方向/,
  );
});
test("バックアップの追加読み込みは重複せず、異なる内容を上書きしない", () => {
  const s = fixture();
  assert.equal(
    applyCommand(s, { type: "merge-backup", data: s }).entries.length,
    1,
  );
  const changed = structuredClone(s);
  changed.entries[0].amount = 20000;
  assert.throws(
    () => applyCommand(s, { type: "merge-backup", data: changed }),
    /上書きしません/,
  );
  const demo = structuredClone(s);
  demo.demo = true;
  assert.throws(
    () => applyCommand(s, { type: "merge-backup", data: demo }),
    /混在/,
  );
});
test("無効な日付と未来の実績を拒否する", () => {
  const s = fixture();
  s.entries[0].date = "2026-02-30";
  assert.throws(() => validateState(s));
  s.entries[0].date = "2099-01-01";
  assert.throws(() => validateState(s), /未来日/);
});
test("元の取引識別子・口座参照・回収先の不整合を拒否", () => {
  const s = fixture();
  s.entries.push({ ...s.entries[0] });
  assert.throws(() => validateState(s), /識別子/);
  s.entries.pop();
  s.entries[0].accountId = "missing";
  assert.throws(() => validateState(s), /口座/);
});
test("月末日付の補正とサンプルの整合性", () => {
  assert.equal(dueInMonth("2028-02", 31), "2028-02-29");
  assert.equal(dueInMonth("2026-04", 31), "2026-04-30");
  assert.equal(validateState(demoState()).demo, true);
  assert.equal(today().length, 10);
});
test("回収記録を取り消して戻せる。回収済みの購入だけの取消は拒否", () => {
  const s = applyCommand(fixture(), recovery("received", 4000));
  assert.throws(
    () => applyCommand(s, { type: "void-entry", entryId: "ticket" }),
    /回収記録/,
  );
  const cancelled = applyCommand(s, {
    type: "void-entry",
    entryId: "received",
  });
  assert.equal(claims(cancelled)[0].remaining, 9000);
  assert.equal(balance(cancelled, cancelled.accounts[2]), 0);
  assert.equal(cancelled.entries.length, 2);
  assert.equal(cancelled.entries[1].voided, true);
  const restored = applyCommand(cancelled, {
    type: "restore-entry",
    entryId: "received",
  });
  assert.equal(claims(restored)[0].remaining, 5000);
  assert.equal(balance(restored, restored.accounts[2]), 4000);
});
test("カード支払の取消は手数料も同時に戻し、復元時の二重払いを拒否", () => {
  const s = fixture();
  s.bills = [
    {
      id: "bill",
      cardId: "card",
      dueDate: "2026-01-27",
      amount: 3300,
      fee: 300,
      status: "confirmed",
      source: "テスト",
      checkedAt: "2026-01-20",
      description: "請求",
    },
  ];
  const paid = applyCommand(s, {
    type: "pay-bill",
    billId: "bill",
    fromAccountId: "bank",
    date: "2026-01-27",
  });
  const paymentId = paid.entries.find((e) => e.kind === "transfer")!.id;
  const cancelled = applyCommand(paid, {
    type: "void-entry",
    entryId: paymentId,
  });
  assert.equal(monthly(cancelled, "2026-01").expense, 9000);
  assert.equal(balance(cancelled, cancelled.accounts[1]), -18000);
  assert.equal(balance(cancelled, cancelled.accounts[0]), 100000);
  const restored = applyCommand(cancelled, {
    type: "restore-entry",
    entryId: paymentId,
  });
  assert.equal(monthly(restored, "2026-01").expense, 9300);
  const repaid = applyCommand(cancelled, {
    type: "pay-bill",
    billId: "bill",
    fromAccountId: "bank",
    date: "2026-01-27",
  });
  assert.throws(
    () => applyCommand(repaid, { type: "restore-entry", entryId: paymentId }),
    /支払い記録済み/,
  );
});
