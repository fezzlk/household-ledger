import { z } from "zod";
import Papa from "papaparse";

const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(160);
const money = z.number().int().safe().min(0).max(1_000_000_000);
const amount = money.refine((v) => v > 0, "金額は1円以上にしてください");
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, "日付を確認してください");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const openingBalance = z
  .number()
  .int()
  .safe()
  .min(-1_000_000_000)
  .max(1_000_000_000);
export const accountSchema = z.object({
  id,
  name: text,
  type: z.enum(["bank", "cash", "paypay", "card"]),
  // openingBalance is the balance before entries dated on openingDate.
  // Entries dated earlier are history: they count in monthly totals but not in the balance.
  openingBalance,
  openingDate: date.optional(),
});
export const entrySchema = z.object({
  id,
  date,
  description: text,
  kind: z.enum([
    "expense",
    "income",
    "transfer",
    "settlement",
    "fee",
    "pending",
  ]),
  amount,
  accountId: id,
  toAccountId: id.optional(),
  category: z.string().max(40).default("その他"),
  shares: z
    .array(z.object({ id, person: text, amount }))
    .max(30)
    .default([]),
  allocations: z
    .array(z.object({ claimId: id, amount }))
    .max(30)
    .default([]),
  direction: z.enum(["in", "out"]).optional(),
  sourceKey: z.string().max(200).optional(),
  recurringKey: z.string().max(150).optional(),
  billId: id.optional(),
  paymentGroupId: id.optional(),
  voided: z.boolean().optional(),
});
export const billSchema = z.object({
  id,
  cardId: id,
  dueDate: date,
  amount: amount.nullable(),
  fee: money.nullable(),
  status: z.enum(["forecast", "confirmed"]),
  source: text,
  checkedAt: date,
  description: text,
});
export const recurringSchema = z.object({
  id,
  accountId: id,
  name: text,
  amount,
  day: z.number().int().min(1).max(31),
  category: text,
});
export const stateSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().min(0),
  demo: z.boolean(),
  accounts: z.array(accountSchema).max(100),
  entries: z.array(entrySchema).max(10000),
  bills: z.array(billSchema).max(1000),
  recurring: z.array(recurringSchema).max(100),
});
export type Account = z.infer<typeof accountSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Bill = z.infer<typeof billSchema>;
export type Ledger = z.infer<typeof stateSchema>;
export const categories = [
  "食費",
  "日用品",
  "住まい",
  "交通",
  "趣味・チケット",
  "医療",
  "交際費",
  "分割手数料",
  "その他",
];
export const newId = () => crypto.randomUUID();
export function today() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}
export function monthOffset(m: string, n: number) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7);
}
export function dueInMonth(m: string, day: number) {
  const [y, mm] = m.split("-").map(Number);
  return `${m}-${String(Math.min(day, new Date(Date.UTC(y, mm, 0)).getUTCDate())).padStart(2, "0")}`;
}
export function emptyState(): Ledger {
  return {
    version: 1,
    revision: 0,
    demo: false,
    accounts: [],
    entries: [],
    bills: [],
    recurring: [],
  };
}

export function claims(s: Ledger) {
  return s.entries
    .filter((e) => !e.voided)
    .flatMap((e) =>
      e.shares.map((p) => {
        const received = s.entries
          .filter((e) => !e.voided)
          .flatMap((t) => t.allocations)
          .filter((a) => a.claimId === p.id)
          .reduce((a, b) => a + b.amount, 0);
        return {
          ...p,
          description: e.description,
          date: e.date,
          purchaseId: e.id,
          received,
          remaining: p.amount - received,
        };
      }),
    );
}
export function balance(s: Ledger, a: Account) {
  return s.entries.reduce((total, e) => {
    if (e.voided) return total;
    if (a.openingDate && e.date < a.openingDate) return total;
    if (e.accountId === a.id)
      total +=
        e.kind === "income" ||
        e.kind === "settlement" ||
        (e.kind === "pending" && e.direction === "in")
          ? e.amount
          : -e.amount;
    if (e.kind === "transfer" && e.toAccountId === a.id) total += e.amount;
    return total;
  }, a.openingBalance);
}
export function monthly(s: Ledger, m: string) {
  const entries = s.entries.filter((e) => !e.voided && e.date.startsWith(m));
  const expense = entries
    .filter((e) => e.kind === "expense" || e.kind === "fee")
    .reduce(
      (t, e) => t + e.amount - e.shares.reduce((a, p) => a + p.amount, 0),
      0,
    );
  const income = entries
    .filter((e) => e.kind === "income")
    .reduce((t, e) => t + e.amount, 0);
  return { expense, income, difference: income - expense };
}
export function validateState(input: unknown): Ledger {
  const s = stateSchema.parse(input);
  for (const group of [s.accounts, s.entries, s.bills, s.recurring])
    if (new Set(group.map((x) => x.id)).size !== group.length)
      throw new Error("識別子が重複しています");
  const accounts = new Map(s.accounts.map((a) => [a.id, a]));
  if (s.accounts.some((a) => a.openingDate && a.openingDate > today()))
    throw new Error("開始日に未来日は指定できません");
  const allClaims = s.entries.flatMap((e) => e.shares);
  if (new Set(allClaims.map((c) => c.id)).size !== allClaims.length)
    throw new Error("立替の識別子が重複しています");
  const keys = s.entries.flatMap((e) => (e.sourceKey ? [e.sourceKey] : []));
  if (new Set(keys).size !== keys.length)
    throw new Error("取得元の明細が重複しています");
  const recurringKeys = s.entries.flatMap((e) =>
    !e.voided && e.recurringKey ? [e.recurringKey] : [],
  );
  if (new Set(recurringKeys).size !== recurringKeys.length)
    throw new Error("定期支払いが重複しています");
  for (const e of s.entries) {
    if (e.date > today()) throw new Error("実績の日付に未来日は指定できません");
    const account = accounts.get(e.accountId);
    if (!account) throw new Error("口座が見つかりません");
    if (
      (e.kind === "income" ||
        e.kind === "settlement" ||
        e.kind === "pending") &&
      account.type === "card"
    )
      throw new Error("カード口座には購入・支払いを記録してください");
    if (
      e.kind === "transfer" &&
      (!e.toAccountId ||
        !accounts.has(e.toAccountId) ||
        e.accountId === e.toAccountId ||
        account.type === "card")
    )
      throw new Error("移動元と移動先の口座を確認してください");
    if (e.kind !== "transfer" && e.toAccountId)
      throw new Error("資金移動以外には移動先を指定できません");
    if (e.kind !== "expense" && e.shares.length)
      throw new Error("立替を配分できるのは購入のみです");
    if (e.shares.reduce((a, p) => a + p.amount, 0) > e.amount)
      throw new Error("立替額は支払い総額以下にしてください");
    if (e.kind === "pending" && !e.direction)
      throw new Error("入出金の方向が必要です");
    if (e.kind !== "pending" && e.direction)
      throw new Error("未分類以外に方向は指定できません");
    if (e.kind !== "settlement" && e.allocations.length)
      throw new Error("回収以外には立替の割当はできません");
    if (
      e.kind === "settlement" &&
      (e.allocations.length === 0 ||
        e.allocations.reduce((a, p) => a + p.amount, 0) !== e.amount)
    )
      throw new Error("回収額と割当額が一致しません");
    if (
      new Set(e.allocations.map((a) => a.claimId)).size !== e.allocations.length
    )
      throw new Error("回収の割当が重複しています");
    if (
      !e.voided &&
      e.allocations.some((a) => !claims(s).some((c) => c.id === a.claimId))
    )
      throw new Error("回収記録がある立替は先に回収記録を取り消してください");
    if (e.billId && !s.bills.some((b) => b.id === e.billId))
      throw new Error("請求が見つかりません");
  }
  if (claims(s).some((c) => c.remaining < 0))
    throw new Error("回収額が立替残額を超えています");
  for (const b of s.bills) {
    if (accounts.get(b.cardId)?.type !== "card")
      throw new Error("請求先のカードが見つかりません");
    if (b.amount !== null && b.fee !== null && b.fee > b.amount)
      throw new Error("手数料が請求額を超えています");
    if (b.status === "confirmed" && b.amount === null)
      throw new Error("確定請求には金額が必要です");
    const payments = s.entries.filter(
      (e) => !e.voided && e.billId === b.id && e.kind === "transfer",
    );
    if (payments.length > 1) throw new Error("この請求は支払い記録済みです");
    if (
      payments.some((e) => e.toAccountId !== b.cardId || e.amount !== b.amount)
    )
      throw new Error("請求と支払額が一致しません");
  }
  if (
    s.recurring.some(
      (r) =>
        !accounts.has(r.accountId) ||
        accounts.get(r.accountId)?.type === "card",
    )
  )
    throw new Error("定期支払いの口座を確認してください");
  return s;
}

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account"), account: accountSchema }),
  z.object({
    type: z.literal("update-account"),
    accountId: id,
    name: text,
    openingBalance,
    openingDate: date.optional(),
  }),
  z.object({ type: z.literal("entry"), entry: entrySchema }),
  z.object({ type: z.literal("void-entry"), entryId: id }),
  z.object({ type: z.literal("restore-entry"), entryId: id }),
  z.object({ type: z.literal("bill"), bill: billSchema }),
  z.object({ type: z.literal("recurring"), recurring: recurringSchema }),
  z.object({
    type: z.literal("pay-bill"),
    billId: id,
    fromAccountId: id,
    date,
  }),
  z.object({ type: z.literal("pay-recurring"), recurringId: id, month }),
  z.object({
    type: z.literal("classify"),
    entryId: id,
    kind: z.enum(["expense", "income", "settlement"]),
    category: z.string().max(40),
    claimId: id.optional(),
  }),
  z.object({
    type: z.literal("paypay-csv"),
    accountId: id,
    csv: z.string().min(1).max(1_000_000),
  }),
  z.object({ type: z.literal("merge-backup"), data: stateSchema }),
]);
export type Command = z.infer<typeof commandSchema>;

export function applyCommand(input: Ledger, raw: unknown): Ledger {
  const command = commandSchema.parse(raw);
  const s = structuredClone(input);
  switch (command.type) {
    case "account":
      s.accounts.push(command.account);
      break;
    case "update-account": {
      // The account type stays fixed: changing it would break existing entries and card bills.
      const a = s.accounts.find((a) => a.id === command.accountId);
      if (!a) throw new Error("口座が見つかりません");
      a.name = command.name;
      a.openingBalance = command.openingBalance;
      if (command.openingDate) a.openingDate = command.openingDate;
      else delete a.openingDate;
      break;
    }
    case "entry": {
      if (
        command.entry.voided ||
        command.entry.billId ||
        command.entry.paymentGroupId ||
        command.entry.sourceKey ||
        command.entry.recurringKey ||
        command.entry.kind === "pending"
      )
        throw new Error(
          "取得元・請求・定期予定の明細は専用の操作で記録してください",
        );
      s.entries.push(command.entry);
      break;
    }
    case "void-entry":
    case "restore-entry": {
      const entry = s.entries.find((e) => e.id === command.entryId);
      if (!entry) throw new Error("明細が見つかりません");
      if (entry.sourceKey)
        throw new Error("取得元のある明細は元データを確認して訂正してください");
      const group = entry.paymentGroupId
        ? s.entries.filter((e) => e.paymentGroupId === entry.paymentGroupId)
        : [entry];
      for (const e of group) e.voided = command.type === "void-entry";
      break;
    }
    case "bill":
      s.bills.push(command.bill);
      break;
    case "recurring":
      s.recurring.push(command.recurring);
      break;
    case "pay-bill": {
      const b = s.bills.find((b) => b.id === command.billId);
      const from = s.accounts.find((a) => a.id === command.fromAccountId);
      if (!b || b.amount === null || b.status !== "confirmed")
        throw new Error("金額が確定した請求だけ支払いを記録できます");
      if (!from || from.type !== "bank")
        throw new Error("引き落とし元の銀行口座を選択してください");
      if (b.fee === null)
        throw new Error(
          "手数料内訳が未確認のため、支払いの自動配分はできません",
        );
      if (s.entries.some((e) => !e.voided && e.billId === b.id))
        throw new Error("この請求は支払い記録済みです");
      const paymentGroupId = newId();
      if (b.fee > 0)
        s.entries.push(
          entrySchema.parse({
            id: newId(),
            date: command.date,
            description: "分割手数料",
            kind: "fee",
            amount: b.fee,
            accountId: b.cardId,
            category: "分割手数料",
            billId: b.id,
            paymentGroupId,
          }),
        );
      s.entries.push(
        entrySchema.parse({
          id: newId(),
          date: command.date,
          description: b.description + " の引き落とし",
          kind: "transfer",
          amount: b.amount,
          accountId: from.id,
          toAccountId: b.cardId,
          billId: b.id,
          paymentGroupId,
        }),
      );
      break;
    }
    case "pay-recurring": {
      const r = s.recurring.find((r) => r.id === command.recurringId);
      if (!r) throw new Error("定期支払いが見つかりません");
      const paidDate = dueInMonth(command.month, r.day);
      if (paidDate > today())
        throw new Error("未来の定期支払いは支払済みにできません");
      s.entries.push(
        entrySchema.parse({
          id: newId(),
          date: paidDate,
          description: r.name,
          kind: "expense",
          amount: r.amount,
          accountId: r.accountId,
          category: r.category,
          recurringKey: `${r.id}:${command.month}`,
        }),
      );
      break;
    }
    case "classify": {
      const e = s.entries.find((e) => e.id === command.entryId);
      if (!e || e.kind !== "pending")
        throw new Error("未分類の明細が見つかりません");
      if (
        (e.direction === "in" && command.kind === "expense") ||
        (e.direction === "out" && command.kind !== "expense")
      )
        throw new Error("入出金の方向と分類が一致しません");
      e.kind = command.kind;
      e.category = command.category;
      delete e.direction;
      if (command.kind === "settlement") {
        if (!command.claimId) throw new Error("精算する立替を選んでください");
        e.allocations = [{ claimId: command.claimId, amount: e.amount }];
      }
      break;
    }
    case "paypay-csv": {
      if (s.accounts.find((a) => a.id === command.accountId)?.type !== "paypay")
        throw new Error("PayPay口座を選択してください");
      const parsed = Papa.parse<Record<string, string>>(
        command.csv.replace(/^\uFEFF/, ""),
        {
          header: true,
          skipEmptyLines: "greedy",
          transformHeader: (h) => h.trim(),
        },
      );
      if (parsed.errors.length) throw new Error("CSVの形式を確認してください");
      if (
        ![
          "取引日",
          "出金金額（円）",
          "入金金額（円）",
          "取引内容",
          "取引番号",
        ].every((k) => parsed.meta.fields?.includes(k))
      )
        throw new Error("PayPay公式CSVの必須列が見つかりません");
      const parseYen = (value: string | undefined) => {
        const v = (value ?? "").replaceAll(",", "").trim();
        if (v === "" || v === "-") return 0;
        if (!/^\d+$/.test(v)) throw new Error("CSVの金額に不明な値があります");
        return money.parse(Number(v));
      };
      for (const row of parsed.data) {
        const sourceKey = `paypay:${command.accountId}:${row["取引番号"]?.trim()}`;
        if (!row["取引番号"]?.trim())
          throw new Error("取引番号がない行があります");
        const withdrawal = parseYen(row["出金金額（円）"]),
          deposit = parseYen(row["入金金額（円）"]);
        if (withdrawal && deposit)
          throw new Error("同じ行に入金と出金があります");
        if (!withdrawal && !deposit) continue;
        const d = row["取引日"]
          .trim()
          .split(/[ T]/)[0]
          .replaceAll("/", "-")
          .split("-")
          .map((v, i) => (i ? v.padStart(2, "0") : v))
          .join("-");
        const entry = entrySchema.parse({
          id: newId(),
          date: d,
          description: [row["取引内容"], row["取引先"]]
            .filter(Boolean)
            .join(" · "),
          kind: "pending",
          direction: deposit ? "in" : "out",
          amount: withdrawal || deposit,
          accountId: command.accountId,
          sourceKey,
        });
        const existing = s.entries.find((e) => e.sourceKey === sourceKey);
        if (existing) {
          const existingIncoming =
            existing.kind === "income" ||
            existing.kind === "settlement" ||
            (existing.kind === "pending" && existing.direction === "in");
          if (
            existing.date !== entry.date ||
            existing.amount !== entry.amount ||
            existingIncoming !== Boolean(deposit)
          )
            throw new Error(
              "同じ取引番号の金額・日付・方向が変わっています。確認が必要です",
            );
          continue;
        }
        s.entries.push(entry);
      }
      break;
    }
    case "merge-backup": {
      const other = validateState(command.data);
      if (other.demo !== s.demo)
        throw new Error("サンプルと実データのバックアップは混在できません");
      for (const key of [
        "accounts",
        "entries",
        "bills",
        "recurring",
      ] as const) {
        const target = s[key] as Array<{ id: string }>;
        for (const item of other[key]) {
          const existing = target.find((e) => e.id === item.id);
          if (existing && JSON.stringify(existing) !== JSON.stringify(item))
            throw new Error(
              "現在のデータと異なる同じIDがあります。既存データは上書きしません",
            );
          if (!existing) target.push(item);
        }
      }
      break;
    }
  }
  s.revision++;
  return validateState(s);
}

export function demoState(): Ledger {
  const s = emptyState(),
    t = today(),
    m = t.slice(0, 7),
    previous = monthOffset(m, -1);
  s.demo = true;
  s.accounts = [
    { id: "bank", name: "生活用口座", type: "bank", openingBalance: 185000 },
    { id: "paypay", name: "PayPay", type: "paypay", openingBalance: 6500 },
    { id: "cash", name: "お財布", type: "cash", openingBalance: 12000 },
    { id: "rakuten", name: "楽天カード", type: "card", openingBalance: -32000 },
  ];
  const make = (v: unknown) => entrySchema.parse(v);
  s.entries = [
    make({
      id: "salary",
      date: previous + "-25",
      description: "給与",
      kind: "income",
      amount: 280000,
      accountId: "bank",
      category: "給与",
    }),
    make({
      id: "ticket",
      date: m + "-02",
      description: "ライブのチケット · 2人分",
      kind: "expense",
      amount: 18000,
      accountId: "rakuten",
      category: "趣味・チケット",
      shares: [{ id: "claim-aya", person: "あやさん（例）", amount: 9000 }],
    }),
    make({
      id: "grocery",
      date: m + "-03",
      description: "いつものスーパー",
      kind: "expense",
      amount: 3860,
      accountId: "rakuten",
      category: "食費",
    }),
    make({
      id: "recovery",
      date: m + "-04",
      description: "チケット代の一部を回収",
      kind: "settlement",
      amount: 4000,
      accountId: "paypay",
      allocations: [{ claimId: "claim-aya", amount: 4000 }],
    }),
    make({
      id: "coffee",
      date: m + "-04",
      description: "カフェ",
      kind: "expense",
      amount: 580,
      accountId: "paypay",
      category: "食費",
    }),
  ].filter((e) => e.date <= t);
  s.bills = [
    {
      id: "bill-current",
      cardId: "rakuten",
      dueDate: dueInMonth(m, 27),
      amount: 12900,
      fee: 900,
      status: "confirmed",
      source: "サンプル（楽天から未取得）",
      checkedAt: t,
      description: "楽天カード " + m + "月分",
    },
    {
      id: "bill-next",
      cardId: "rakuten",
      dueDate: dueInMonth(monthOffset(m, 1), 27),
      amount: 11400,
      fee: 900,
      status: "forecast",
      source: "サンプルの支払予定",
      checkedAt: t,
      description: "楽天カード 翌月分",
    },
  ];
  s.recurring = [
    {
      id: "rent",
      name: "家賃",
      accountId: "bank",
      amount: 78000,
      day: 28,
      category: "住まい",
    },
  ];
  return validateState(s);
}
