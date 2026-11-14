import { chromium } from "playwright";
import { Account } from "../src/account";
import { TokenPool } from "../src/pool";

const BASE = "https://api.ctfile.com";

// ===== 你的 12 个账号 =====
const ACCOUNTS: [string, string][] = [
  ["email1@mailinator.com", "pwd1"],
  // ... 12 个
];

async function solveAltcha(browser: any): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(`
    window.__altcha_msgs = [];
    window.ReactNativeWebView = {postMessage: m => {try{window.__altcha_msgs.push(JSON.parse(m))}catch(e){}}};
  `);
  await page.goto(
    `https://h5.ctfile.com/captcha/altcha.html?source=v4&action=login&lang=zh-hans&theme=light&api=${BASE}`,
    { waitUntil: "networkidle" }
  );
  await page.waitForFunction(
    "() => window.__altcha_msgs.some(m => m.event === 'success')",
    { timeout: 120_000 }
  );
  const t = await page.evaluate(
    "() => window.__altcha_msgs.find(m => m.event === 'success')?.token"
  );
  await ctx.close();
  return t;
}

async function v4Login(email: string, pwd: string, altcha: string) {
  const r = await fetch(`${BASE}/v4/user/auth/login`, {
    method: "POST",
    headers: {
      "x-client-type": "native", "x-client-version": "5.1.28",
      "x-client-platform": "android", "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: pwd, altcha_token: altcha, create_session: true }),
  });
  return (await r.json() as any).data;
}

async function getKV(key: string): Promise<any> {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}/values/${key}`,
    { headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}` } }
  );
  return r.ok ? await r.json() : null;
}

async function putKV(key: string, value: string) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}/values/${key}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}` },
      body: value,
    }
  );
  console.log(`  KV [${key}]: ${r.status}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // 读旧池，复用未过期 Token
  const oldRaw = await getKV("tokens");
  const oldPool = oldRaw ? TokenPool.fromJSON(oldRaw) : null;
  if (oldPool) console.log(`旧 Token 可用: ${oldPool.stats().valid}/${oldPool.accounts.length}`);

  const accounts = ACCOUNTS.map(([email]) => {
    const old = oldPool?.accounts.find(a => a.email === email);
    if (old?.token && !old.isExpired(120)) return new Account(email, old.token);
    return new Account(email);
  });

  const pool = new TokenPool(accounts);

  // 只登录过期的
  let success = 0, failed = 0;
  for (const acc of accounts) {
    if (!acc.isExpired(120)) continue;
    const [email, pwd] = ACCOUNTS.find(([e]) => e === acc.email)!;
    try {
      const altcha = await solveAltcha(browser);
      const data = await v4Login(email, pwd, altcha);
      if (data?.token) {
        acc.token = {
          email, userid: data.user?.userid || 0,
          token: data.token, refresh_token: data.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 900),
        };
        success++;
        console.log(`  ✅ ${email}`);
      } else {
        failed++;
        console.log(`  ❌ ${email}: login failed`);
      }
    } catch (e: any) {
      failed++;
      console.log(`  ❌ ${email}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();
  console.log(`\n结果: ${pool.stats().valid}/${accounts.length} 有效, 新增 ${success}, 失败 ${failed}`);

  await putKV("tokens", JSON.stringify(pool.toJSON()));
  await putKV("last_refresh", String(Math.floor(Date.now() / 1000)));
}

main().catch(e => { console.error(e); process.exit(1); });
