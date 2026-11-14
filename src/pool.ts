import { Account } from "./account";

export interface PoolStats {
  total: number;
  valid: number;
  expired: number;
  noToken: number;
}

export class TokenPool {
  accounts: Account[];

  constructor(accounts: Account[]) {
    this.accounts = accounts;
  }

  stats(): PoolStats {
    let valid = 0, expired = 0, noToken = 0;
    for (const a of this.accounts) {
      if (!a.token) noToken++;
      else if (a.isExpired()) expired++;
      else valid++;
    }
    return { total: this.accounts.length, valid, expired, noToken };
  }

  async pickValid(n: number): Promise<Account[]> {
    const toRefresh = this.accounts.filter(a => a.isExpired() && a.token?.refresh_token);
    if (toRefresh.length > 0) {
      await Promise.allSettled(toRefresh.map(a => a.refresh()));
    }
    const valid = this.accounts.filter(a => !a.isExpired() && a.bearer);
    if (valid.length === 0) throw new Error("no valid token in pool");
    const shuffled = [...valid].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, shuffled.length));
  }

  toJSON() {
    return {
      updated_at: Math.floor(Date.now() / 1000),
      accounts: this.accounts.map(a => a.toJSON()),
    };
  }

  static fromJSON(o: any): TokenPool {
    const arr = Array.isArray(o) ? o : o?.accounts ?? [];
    return new TokenPool(arr.map(Account.fromJSON));
  }
}
