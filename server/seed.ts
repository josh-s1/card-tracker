/**
 * Demo data — mirrors the original prototype's sample cards, with dates
 * computed relative to "today" so the app always looks fresh.
 */
import { db } from "./storage";
import { eq } from "drizzle-orm";
import { items, accounts, transactions } from "@shared/schema";

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface DemoTxn {
  off: number;
  m: string;
  c: string;
  a: number; // dollars, positive = charge
  p?: boolean;
}

interface DemoCard {
  id: string;
  name: string;
  network: string;
  last4: string;
  color: string;
  limit: number;
  balance: number;
  apr: string;
  dueOff: number; // days from today
  closesOff: number;
  minDue: number;
  statementBalance: number;
  lastPayment: { amt: number; off: number };
  txns: DemoTxn[];
}

const DEMO_CARDS: DemoCard[] = [
  {
    id: "demo-harbor",
    name: "Harbor Rewards",
    network: "Visa",
    last4: "4821",
    color: "#1F3A5F",
    limit: 12000,
    balance: 1847.32,
    apr: "21.99",
    dueOff: 8,
    closesOff: 17,
    minDue: 35,
    statementBalance: 1243.1,
    lastPayment: { amt: 500, off: -6 },
    txns: [
      { off: -1, m: "Whole Basket Market", c: "Groceries", a: 84.12 },
      { off: -1, m: "Ridgeline Gas", c: "Transport", a: 52.4, p: true },
      { off: -2, m: "Copperpot Bistro", c: "Dining", a: 63.8 },
      { off: -3, m: "Streamly", c: "Subscriptions", a: 15.99 },
      { off: -4, m: "Whole Basket Market", c: "Groceries", a: 112.45 },
      { off: -6, m: "Payment, thank you", c: "Payment", a: -500 },
      { off: -7, m: "Linden Pharmacy", c: "Health", a: 24.15 },
      { off: -9, m: "Copperpot Bistro", c: "Dining", a: 41.2 },
      { off: -10, m: "Ridgeline Gas", c: "Transport", a: 48.95 },
      { off: -12, m: "Northwind Hardware", c: "Shopping", a: 137.6 },
      { off: -17, m: "Whole Basket Market", c: "Groceries", a: 96.33 },
      { off: -20, m: "Cloudbox Storage", c: "Subscriptions", a: 9.99 },
      { off: -25, m: "Copperpot Bistro", c: "Dining", a: 72.5 },
      { off: -29, m: "Ridgeline Gas", c: "Transport", a: 50.1 },
      { off: -35, m: "Whole Basket Market", c: "Groceries", a: 104.87 },
      { off: -42, m: "Linden Pharmacy", c: "Health", a: 38.0 },
    ],
  },
  {
    id: "demo-juniper",
    name: "Juniper Cash",
    network: "Mastercard",
    last4: "0937",
    color: "#1E4D3F",
    limit: 5000,
    balance: 412.77,
    apr: "24.49",
    dueOff: 12,
    closesOff: 21,
    minDue: 25,
    statementBalance: 298.4,
    lastPayment: { amt: 300, off: -21 },
    txns: [
      { off: -1, m: "Parcel & Co", c: "Shopping", a: 76.3 },
      { off: -2, m: "Tunebox", c: "Subscriptions", a: 10.99 },
      { off: -3, m: "Metro Transit", c: "Transport", a: 33.0 },
      { off: -5, m: "Noodle House", c: "Dining", a: 28.45 },
      { off: -8, m: "Fitwell Gym", c: "Health", a: 45.0 },
      { off: -11, m: "Parcel & Co", c: "Shopping", a: 129.99 },
      { off: -13, m: "Noodle House", c: "Dining", a: 31.2 },
      { off: -18, m: "Metro Transit", c: "Transport", a: 33.0 },
      { off: -22, m: "Parcel & Co", c: "Shopping", a: 58.74 },
      { off: -27, m: "Noodle House", c: "Dining", a: 44.1 },
      { off: -33, m: "Fitwell Gym", c: "Health", a: 45.0 },
      { off: -38, m: "Tunebox", c: "Subscriptions", a: 10.99 },
    ],
  },
  {
    id: "demo-summit",
    name: "Summit Travel",
    network: "Amex",
    last4: "1006",
    color: "#4A2C4F",
    limit: 15000,
    balance: 3642.5,
    apr: "22.74",
    dueOff: 5,
    closesOff: 15,
    minDue: 59,
    statementBalance: 2941.88,
    lastPayment: { amt: 800, off: -17 },
    txns: [
      { off: -2, m: "Skyline Air", c: "Travel", a: 412.6 },
      { off: -4, m: "Hotel Alder", c: "Travel", a: 286.0 },
      { off: -5, m: "Saltmarsh Grill", c: "Dining", a: 94.3 },
      { off: -7, m: "Rental Rocket", c: "Travel", a: 148.22, p: true },
      { off: -14, m: "Saltmarsh Grill", c: "Dining", a: 57.8 },
      { off: -17, m: "Payment, thank you", c: "Payment", a: -800 },
      { off: -19, m: "Skyline Air", c: "Travel", a: 233.4 },
      { off: -26, m: "Saltmarsh Grill", c: "Dining", a: 88.15 },
    ],
  },
];

export async function seedDemoData() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Sample mutations are disabled in production.");
  }

  await db.transaction(async (tx) => {
    // Never reset real connections, including their stored revocation tokens.
    const demoItems = await tx.select().from(items).where(eq(items.isDemo, true));
    for (const item of demoItems) {
      await tx.delete(transactions).where(eq(transactions.itemId, item.id));
      await tx.delete(accounts).where(eq(accounts.itemId, item.id));
      await tx.delete(items).where(eq(items.id, item.id));
    }

    await tx.insert(items).values({
      id: "demo",
      institutionId: "demo",
      institutionName: "Demo Bank (sample data)",
      accessToken: "",
      isDemo: true,
      createdAt: new Date().toISOString(),
    });

    for (const card of DEMO_CARDS) {
      await tx.insert(accounts).values({
        id: card.id,
        itemId: "demo",
        name: card.name,
        officialName: `${card.name} ${card.network} ${card.last4}`,
        mask: card.last4,
        type: "credit",
        subtype: "credit card",
        network: card.network,
        color: card.color,
        currency: "USD",
        balanceCents: Math.round(card.balance * 100),
        limitCents: Math.round(card.limit * 100),
        apr: card.apr,
        dueDate: iso(card.dueOff),
        minDueCents: Math.round(card.minDue * 100),
        statementBalanceCents: Math.round(card.statementBalance * 100),
        statementCloseDate: iso(card.closesOff),
        lastPaymentCents: Math.round(card.lastPayment.amt * 100),
        lastPaymentDate: iso(card.lastPayment.off),
      });

      for (const t of card.txns) {
        await tx.insert(transactions).values({
          id: `${card.id}-${t.off}-${t.m.replace(/\W+/g, "")}`,
          accountId: card.id,
          itemId: "demo",
          date: iso(t.off),
          name: t.m,
          merchantName: t.m,
          amountCents: Math.round(t.a * 100),
          category: t.c,
          pending: Boolean(t.p),
        });
      }
    }
  });
}

/** Seed demo data on first boot when the DB is empty. */
export async function seedIfEmpty() {
  if (process.env.NODE_ENV === "production") return;
  const existing = await db.select().from(items);
  if (existing.length === 0) await seedDemoData();
}
