import type { db } from "./storage";
import { and, eq, inArray } from "drizzle-orm";
import { items, accounts, transactions, accountPreferences, rewardProfiles, syncIssues, transactionRewardContext, type Item } from "@shared/schema";
import { decryptAccessToken } from "./token-vault";

export class DisconnectError extends Error {
  constructor() {
    super("Bank access could not be revoked. Its local records were kept. Please retry disconnection.");
    this.name = "DisconnectError";
  }
}

/** Keep the token available for retry unless upstream revocation succeeds. */
export async function disconnectItem(
  database: Pick<typeof db, "transaction" | "update">,
  item: Pick<Item, "id" | "isDemo" | "accessToken">,
  revoke: (accessToken: string) => Promise<unknown>,
) {
  let expectedToken = item.accessToken;
  if (!item.isDemo && !item.accessToken.startsWith("revoked:")) {
    if (!item.accessToken) throw new DisconnectError();
    try {
      await revoke(decryptAccessToken(item.accessToken));
    } catch {
      throw new DisconnectError();
    }
    // Persist acknowledgment separately, so a failed local cleanup can be retried
    // without asking Plaid to revoke an already-removed Item again.
    expectedToken = `revoked:${item.accessToken}`;
    await database.update(items).set({ accessToken: expectedToken })
      .where(and(eq(items.id, item.id), eq(items.accessToken, item.accessToken)));
  }

  // A failed local delete must not leave partially deleted financial records.
  await database.transaction(async (tx) => {
    const current = (await tx.select().from(items).where(eq(items.id, item.id)))[0];
    if (!current) return;
    if (current.accessToken !== expectedToken) throw new DisconnectError();
    const accountIds = (await tx.select({ id: accounts.id }).from(accounts)
      .where(eq(accounts.itemId, item.id))).map(a => a.id);
    if (accountIds.length) {
      await tx.delete(accountPreferences).where(inArray(accountPreferences.accountId, accountIds));
      await tx.delete(rewardProfiles).where(inArray(rewardProfiles.accountId, accountIds));
    }
    await tx.delete(syncIssues).where(eq(syncIssues.itemId, item.id));
    await tx.delete(transactionRewardContext).where(eq(transactionRewardContext.itemId, item.id));
    await tx.delete(transactions).where(eq(transactions.itemId, item.id));
    await tx.delete(accounts).where(eq(accounts.itemId, item.id));
    await tx.delete(items).where(eq(items.id, item.id));
  });
}
