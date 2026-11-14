const BASE = "https://api.ctfile.com";

const H = {
  "x-client-type": "native",
  "x-client-version": "5.1.28",
  "x-client-platform": "android",
  "x-client-build": "158",
  "Content-Type": "application/json",
};

export interface AccountToken {
  email: string;
  userid: number;
  token: string;
  refresh_token: string;
  expires_at: number;
}

export class Account {
  email: string;
  token: AccountToken | null;

  constructor(email: string, token?: AccountToken) {
    this.email = email;
    this.token = token ?? null;
  }

  get bearer(): string | null {
    return this.token?.token ?? null;
  }

  isExpired(bufferSec = 60): boolean {
    if (!this.token) return true;
    return this.token.expires_at <= Math.floor(Date.now() / 1000) + bufferSec;
  }

  async refresh(): Promise<boolean> {
    if (!this.token?.refresh_token) return false;
    try {
      const r = await fetch(`${BASE}/v4/user/auth/refresh-token`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ refresh_token: this.token.refresh_token }),
      });
      const d: any = await r.json();
      if (d.code !== 200 || !d.data?.token) return false;
      this.token = {
        email: this.email,
        userid: this.token.userid,
        token: d.data.token,
        refresh_token: d.data.refresh_token ?? this.token.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (d.data.expires_in ?? 900),
      };
      return true;
    } catch {
      return false;
    }
  }

  toJSON() {
    return { email: this.email, token: this.token };
  }

  static fromJSON(o: any): Account {
    return new Account(o.email, o.token ?? undefined);
  }
}
