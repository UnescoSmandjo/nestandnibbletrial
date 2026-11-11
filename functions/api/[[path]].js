const COLLECTIONS = new Set(["orders", "att", "exp", "stock", "day", "cfg"]);

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function fail(message, status = 400) {
  return reply({ ok: false, error: message }, status);
}

function cy(s, seed = 7) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, c; i < s.length; i++) {
    c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function readUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.name, u.role, u.emp_id
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
    LIMIT 1
  `).bind(tokenHash, Date.now()).first();

  return row || null;
}

async function audit(env, user, action, collection = null, docId = null) {
  await env.DB.prepare(
    "INSERT INTO app_audit (user_id, action, collection, doc_id) VALUES (?, ?, ?, ?)"
  ).bind(user.id, action, collection, docId).run();
}

export async function onRequest({ request, env }) {
  if (!env.DB) return fail("Binding D1 'DB' belum terpasang.", 500);

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  try {
    if (request.method === "POST" && path === "login") {
      let body;
      try { body = await request.json(); } catch { return fail("Body JSON tidak valid."); }
      const id = String(body.id || "").trim().toLowerCase();
      const pin = String(body.pin || "");
      if (!/^[a-z0-9_-]{3,24}$/.test(id) || !/^\d{4}$/.test(pin)) {
        return fail("ID atau PIN tidak valid.", 401);
      }

      const user = await env.DB.prepare(
        "SELECT id, name, role, emp_id, pin_hash FROM app_users WHERE id = ? AND active = 1 LIMIT 1"
      ).bind(id).first();

      if (!user || cy("nn|" + id + "|" + pin) !== user.pin_hash) {
        return fail("ID atau PIN salah.", 401);
      }

      const token = crypto.randomUUID() + crypto.randomUUID();
      const tokenHash = await sha256(token);
      const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
      await env.DB.prepare(
        "INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
      ).bind(tokenHash, user.id, expiresAt).run();

      await env.DB.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").bind(Date.now()).run();
      return reply({
        ok: true,
        token,
        expires_at: expiresAt,
        user: { id: user.id, name: user.name, role: user.role, emp_id: user.emp_id }
      });
    }

    if (request.method === "POST" && path === "logout") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (token) {
        await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?")
          .bind(await sha256(token)).run();
      }
      return reply({ ok: true });
    }

    const user = await readUser(request, env);
    if (!user) return fail("Sesi tidak valid atau sudah kedaluwarsa. Silakan login kembali.", 401);

    if (request.method === "GET" && path === "sync") {
      const result = await env.DB.prepare(
        "SELECT collection, doc_id, payload, updated_at FROM app_data ORDER BY collection, doc_id"
      ).all();

      const rows = (result.results || []).map(row => ({
        collection: row.collection,
        doc_id: row.doc_id,
        updated_at: row.updated_at,
        payload: JSON.parse(row.payload)
      }));

      return reply({
        ok: true,
        user: { id: user.id, name: user.name, role: user.role, emp_id: user.emp_id },
        rows
      });
    }

    const match = path.match(/^data\/(orders|att|exp|stock|day|cfg)\/([^/]+)$/);
    if (match && request.method === "PUT") {
      const collection = match[1];
      const docId = decodeURIComponent(match[2]);
      if (!docId || docId.length > 180) return fail("ID dokumen tidak valid.");
      if (collection === "cfg" && user.role !== "owner") return fail("Hanya owner yang boleh mengubah konfigurasi.", 403);

      let payload;
      try { payload = await request.json(); } catch { return fail("Payload JSON tidak valid."); }
      const encoded = JSON.stringify(payload);
      if (encoded.length > 900000) return fail("Ukuran data terlalu besar.", 413);

      const now = Date.now();
      await env.DB.prepare(`
        INSERT INTO app_data (collection, doc_id, payload, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(collection, doc_id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(collection, docId, encoded, now, user.id).run();

      await audit(env, user, "upsert", collection, docId);
      return reply({ ok: true, updated_at: now });
    }

    if (match && request.method === "DELETE") {
      if (user.role !== "owner") return fail("Hanya owner yang boleh menghapus data.", 403);
      const collection = match[1];
      const docId = decodeURIComponent(match[2]);
      await env.DB.prepare("DELETE FROM app_data WHERE collection = ? AND doc_id = ?")
        .bind(collection, docId).run();
      await audit(env, user, "delete", collection, docId);
      return reply({ ok: true });
    }

    return fail("Endpoint tidak ditemukan.", 404);
  } catch (error) {
    return fail("Kesalahan server: " + (error && error.message ? error.message : "unknown"), 500);
  }
}
