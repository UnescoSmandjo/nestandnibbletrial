/* Nest & Nibble: Cloudflare Pages Functions + D1 client */
(() => {
  "use strict";

  const TOKEN_KEY = "nn_cloud_token_v1";
  const LEGACY_SESSION = "nn_sess_v1";
  let syncBusy = false;
  let syncTimer = null;

  const token = () => localStorage.getItem(TOKEN_KEY) || "";
  const saveToken = value => value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY);

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token()) headers.Authorization = "Bearer " + token();
    const response = await fetch("/api/" + path, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store"
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || ("HTTP " + response.status));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function snapshot(docs) {
    return {
      docs: docs.map(row => ({ id: row.doc_id, data: () => row.payload })),
      metadata: { fromCache: false }
    };
  }

  async function uploadLocalSnapshot() {
    const jobs = [];
    const add = (collection, id, data) => {
      if (data !== undefined && data !== null) jobs.push({ collection, id, data });
    };

    for (const collection of ["orders", "att", "exp"]) {
      for (const item of (S[collection] || [])) {
        if (!item || !item.id) continue;
        const copy = JSON.parse(JSON.stringify(item));
        if (collection === "orders" && !copy.d) copy.d = ymd(copy.ts || Date.now());
        if (!copy.u) copy.u = copy.ts || Date.now();
        add(collection, item.id, copy);
      }
    }

    for (const [id, item] of Object.entries(S.stock || {})) add("stock", id, item);

    const days = new Set([
      ...Object.keys(S.cashOpen || {}),
      ...Object.keys(S.cashCount || {}),
      ...Object.keys(S.dayU || {})
    ]);
    for (const day of days) {
      add("day", day, {
        d: day,
        open: (S.cashOpen || {})[day] || 0,
        count: (S.cashCount || {})[day] == null ? null : S.cashCount[day],
        u: (S.dayU || {})[day] || Date.now()
      });
    }

    add("cfg", "main", cfgObj());
    for (const job of jobs) {
      await api("data/" + job.collection + "/" + encodeURIComponent(job.id), {
        method: "PUT", body: job.data
      });
    }
  }

  async function syncRemote() {
    if (!token() || syncBusy) return null;
    syncBusy = true;
    try {
      let result = await api("sync");
      let rows = result.rows || [];

      /*
       * First-time migration: when D1 has no app data yet, the owner
       * seeds it from this browser's existing local application data.
       * Staff devices never overwrite an empty shared database.
       */
      if (rows.length === 0 && result.user && result.user.role === "owner") {
        await uploadLocalSnapshot();
        result = await api("sync");
        rows = result.rows || [];
      }

      // Do not let an empty remote database erase a device's local data.
      if (rows.length === 0) {
        setSync("ok");
        return result.user;
      }

      const cut = ymd(Date.now() - 62 * 864e5);
      for (const collection of ["orders", "att", "exp"]) {
        const docs = rows.filter(row =>
          row.collection === collection &&
          String((row.payload || {}).d || "") >= cut
        );
        mergeList(snapshot(docs), collection, cut);
      }

      mergeStock(snapshot(rows.filter(row => row.collection === "stock")));
      mergeDay(snapshot(rows.filter(row => row.collection === "day")));
      const cfg = rows.find(row => row.collection === "cfg" && row.doc_id === "main");
      mergeCfg(cfg ? { exists: true, data: () => cfg.payload } : { exists: false, data: () => null });

      setSync("ok");
      return result.user;
    } catch (error) {
      if (error.status === 401) {
        saveToken("");
        setSync("off");
      } else {
        setSync("err");
      }
      throw error;
    } finally {
      syncBusy = false;
    }
  }

  /* Compatible with the existing app's DB.doc(path).set/delete calls. */
  DB = {
    doc(path) {
      const parts = String(path).split("/");
      const collection = parts[0];
      const id = parts.slice(1).join("/");
      if (!["orders", "att", "exp", "stock", "day", "cfg"].includes(collection) || !id) {
        throw new Error("Path database tidak valid: " + path);
      }
      const encodedId = encodeURIComponent(id);
      return {
        set(data) {
          return api("data/" + collection + "/" + encodedId, { method: "PUT", body: data });
        },
        delete() {
          return api("data/" + collection + "/" + encodedId, { method: "DELETE" });
        }
      };
    }
  };

  /* Replace the old cloud SDK bootstrap with D1 sync. */
  initSync = async function () {
    if (!token()) {
      setSync("off");
      return;
    }
    setSync("wait");
    try {
      const user = await syncRemote();
      if (user && !U) enter(user.id, true);
      if (!syncTimer) {
        syncTimer = setInterval(() => {
          if (token() && !document.hidden) {
            syncRemote().then(() => flushAll()).catch(() => {});
          }
        }, 15000);
      }
      flushAll();
    } catch (error) {
      if (error.status === 401) {
        U = null;
        document.body.classList.add("locked");
        lgShow();
      }
    }
  };

  /* Server-side login. PIN is never validated against a client-side hash. */
  tryLogin = async function () {
    const input = document.querySelector("#lid");
    if (!input) return;
    const id = (input.value || "").trim().toLowerCase();
    if (!id) {
      pin = "";
      lgDots();
      lgMsg("Isi ID pengguna dulu", true);
      return;
    }
    if (pin.length !== 4) {
      lgMsg("Masukkan PIN 4 digit", true);
      return;
    }

    try {
      lgMsg("Memeriksa akun…");
      const result = await api("login", { method: "POST", body: { id, pin } });
      saveToken(result.token);
      pin = "";
      lgDots();
      await syncRemote();
      enter(result.user.id);
      initSync();
    } catch (error) {
      pin = "";
      lgDots();
      tries++;
      if (tries >= 5) {
        tries = 0;
        lockUntil = Date.now() + 30000;
        lockTick();
      } else {
        lgMsg(error.message || "Login gagal", true);
      }
    }
  };

  /* Old browser-only session IDs must never authenticate a user. */
  sessSet = function (id) {
    if (!id) saveToken("");
  };
  sessGet = function () { return token() ? "__cloud_session__" : null; };

  /* Remove legacy PIN hashes from the live JS object. */
  try {
    Object.keys(USERS).forEach(id => { delete USERS[id].h; });
  } catch (_) {}

  /* Revoke the server session when the user logs out. */
  if (typeof A !== "undefined") {
    A.logout = async function () {
      try { if (token()) await api("logout", { method: "POST", body: {} }); } catch (_) {}
      saveToken("");
      localStorage.removeItem(LEGACY_SESSION);
      U = null;
      closeM();
      ui.unl = false;
      lgShow();
      setSync("off");
    };
  }

  async function restoreCloudSession() {
    localStorage.removeItem(LEGACY_SESSION);
    U = null;
    document.body.classList.add("locked");
    lgShow();

    if (!token()) {
      setSync("off");
      return;
    }

    try {
      const user = await syncRemote();
      if (user) {
        enter(user.id, true);
        initSync();
      }
    } catch (error) {
      saveToken("");
      setSync("off");
      lgShow();
    }
  }

  /* Replace any old local-only login restored before this file loaded. */
  restoreCloudSession();

  /* Reconnect when the device comes back online. */
  window.addEventListener("online", () => {
    if (token()) initSync();
  });
})();
