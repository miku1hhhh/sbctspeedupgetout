const BASE = "https://api.ctfile.com";

const H = {
  "x-client-type": "native",
  "x-client-version": "5.1.28",
  "x-client-platform": "android",
  "x-client-build": "158",
  "Content-Type": "application/json",
};

export async function v4Post(path: string, body: any, token: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...H, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<any>;
}

export async function getDirectUrl(token: string, xtlink: string, fileId: string) {
  try {
    const a = await v4Post("/v4/public/browser/create-download-auth",
      { xtlink, ids: fileId }, token);
    if (a.code !== 200) return { ok: false as const, err: a.message };

    const d = await v4Post("/v4/file/browse/download-list", {
      userid: a.data.userid, downuid: a.data.downuid,
      ids: a.data.ids, workspace_id: a.data.workspace_id,
      download_signature: a.data.download_signature,
      expires_at: a.data.expires_at, limit: 500,
    }, token);
    if (d.code !== 200) return { ok: false as const, err: d.message };

    const u = await v4Post("/v4/file/browse/fetch-url-direct",
      { download_sign: d.data.results[0].download_sign }, token);
    if (u.code !== 200) return { ok: false as const, err: u.message };

    return { ok: true as const, url: u.data.download_url };
  } catch (e: any) {
    return { ok: false as const, err: e.message };
  }
}

export async function listFiles(token: string, xtlink: string, folderId = 0) {
  return v4Post("/v4/public/browser/list", {
    xtlink, folder_id: folderId, start: 0, pagesize: 50, orderby: "new",
  }, token);
}
