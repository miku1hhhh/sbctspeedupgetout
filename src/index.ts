import { TokenPool } from "./pool";
import { getDirectUrl, listFiles } from "./v4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function loadPool(env: any): Promise<TokenPool | null> {
  const raw = await env.TOKENS_KV.get("tokens", "json");
  return raw ? TokenPool.fromJSON(raw) : null;
}

async function savePool(env: any, pool: TokenPool) {
  await env.TOKENS_KV.put("tokens", JSON.stringify(pool.toJSON()));
}

async function handleStatus(env: any) {
  const pool = await loadPool(env);
  const lastRefresh = await env.TOKENS_KV.get("last_refresh");
  if (!pool) return json({ error: "pool empty" }, 503);
  return json({
    ok: true,
    pool: pool.stats(),
    last_refresh_ago_sec: lastRefresh
      ? Math.floor(Date.now() / 1000) - parseInt(lastRefresh) : null,
    accounts: pool.accounts.map(a => ({
      email: a.email,
      has_token: !!a.token,
      expires_in: a.token ? a.token.expires_at - Math.floor(Date.now() / 1000) : null,
    })),
  });
}

async function handleDownload(request: Request, env: any) {
  const params = new URL(request.url).searchParams;
  const xtlink = params.get("xtlink");
  const fileId = params.get("file_id");
  const threads = Math.min(parseInt(params.get("threads") || "8"), 12);
  if (!xtlink) return json({ error: "missing xtlink" }, 400);

  const pool = await loadPool(env);
  if (!pool) return json({ error: "pool empty" }, 503);

  let picked;
  try {
    picked = await pool.pickValid(threads);
  } catch (e: any) {
    return json({ error: e.message, pool: pool.stats() }, 503);
  }
  await savePool(env, pool);

  let targetId = fileId;
  let fileMeta: any = null;
  if (!targetId) {
    const d = await listFiles(picked[0].bearer!, xtlink);
    const files = d?.data?.results || [];
    if (!files.length) return json({ error: "no files" }, 404);
    targetId = files[0].key;
    fileMeta = files[0];
  }

  const results = await Promise.all(
    picked.map(a => getDirectUrl(a.bearer!, xtlink, targetId!))
  );
  const urls = results.filter(r => r.ok).map(r => r.url!);
  const errors = results.filter(r => !r.ok).map(r => r.err);

  if (!urls.length) return json({ error: "all failed", errors }, 502);

  const aria2c = `aria2c -x ${urls.length * 2} -s ${urls.length * 2} ` +
    `--max-connection-per-server=16 --min-split-size=4M ` +
    urls.map(u => `"${u}"`).join(" ");

  return json({
    ok: true, file_id: targetId, file_meta: fileMeta,
    pool: pool.stats(), requested: threads,
    success: urls.length, failed: errors.length,
    urls, aria2c,
    token_expires_in: Math.min(...picked.map(a =>
      a.token!.expires_at - Math.floor(Date.now() / 1000))),
  });
}

export default {
  async fetch(request: Request, env: any) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/api/status":   return await handleStatus(env);
        case "/api/download": return await handleDownload(request, env);
        default:              return json({ error: "not found" }, 404);
      }
    } catch (e: any) {
      return json({ error: e.message }, 500);
    }
  },
};
