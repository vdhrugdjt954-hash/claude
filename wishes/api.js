// 两个页面共用：调数据库、画小画、拼一封信
(function () {
  const C = window.WISH_CONFIG;

  // config.js 还没填 Supabase 时自动进预览模式：数据只在这个页面里，刷新就没
  const DEMO = !C.SUPABASE_URL || /你的项目|example/.test(C.SUPABASE_URL);

  const MESSAGES = {
    empty_body: "还没写字呢",
    body_too_long: "字有点多，挑最想说的那句",
    name_too_long: "名字太长了，20 个字以内",
    bad_question: "问题太长了",
    bad_strokes: "画的数据格式不对，看看说明里的格式",
    drawing_too_big: "画太复杂了，少几笔或者少一些点",
    too_many: "你刚寄过好几封了，过十分钟再来",
    too_many_global: "这会儿写的人有点多，过几分钟再试",
    bad_password: "口令不对",
  };

  async function rpc(fn, args) {
    if (DEMO) return demoRpc(fn, args || {});
    const headers = { apikey: C.SUPABASE_KEY, "Content-Type": "application/json" };
    // 旧版 anon key 是 JWT，要带在 Authorization 里；新版 publishable key 不用
    if (C.SUPABASE_KEY.startsWith("eyJ")) headers.Authorization = "Bearer " + C.SUPABASE_KEY;

    let res;
    try {
      res = await fetch(C.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers,
        body: JSON.stringify(args || {}),
      });
    } catch (e) {
      throw new Error("网络没连上，再试一次");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      const code = data && data.message;
      throw new Error(MESSAGES[code] || "没成功（" + (code || res.status) + "），再试一次");
    }
    return data;
  }

  // ---------- 预览模式 ----------
  const demo = {
    auto: true,
    rows: [
      { id: 1, nickname: "暮光", question: "", body: "一百天了。谢谢你那天愿意多说一句话，后来的这些天都是从那句开始的。", pinned: true, status: "approved", created_at: "2026-10-20T13:14:00Z", strokes: null },
      { id: 2, nickname: "小章鱼", question: "", body: "祝一百天快乐，往后也慢慢来。", pinned: false, status: "approved", created_at: "2026-10-21T02:30:00Z", strokes: demoHeart() },
      { id: 3, nickname: null, question: "", body: "第一次见她是在群里，说话特别认真，一个标点都不乱。", pinned: false, status: "approved", created_at: "2026-10-21T15:42:00Z", strokes: null },
    ],
  };
  function demoHeart() {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * Math.PI * 2;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([Math.round(500 + x * 22), Math.round(470 - y * 22)]);
    }
    return [
      { color: "#f3b6b9", width: 4, points: pts, fill: true, opacity: 0.85 },
      { color: "#c07a5c", width: 10, points: pts },
      { color: "#ffffff", width: 14, points: [[380, 360], [420, 330]], opacity: 0.8 },
    ];
  }
  function demoRpc(fn, a) {
    const now = new Date().toISOString();
    const shown = () => demo.rows.filter((r) => r.status === "approved");
    const fail = (code) => Promise.reject(new Error(MESSAGES[code] || code));
    switch (fn) {
      case "wish_status":
        return Promise.resolve({ count: shown().length, auto_approve: demo.auto });
      case "public_wishes":
        return Promise.resolve(shown().slice().sort((x, y) => (y.pinned - x.pinned) || (new Date(y.created_at) - new Date(x.created_at))));
      case "submit_wish": {
        const body = (a.p_body || "").trim();
        if (!body) return fail("empty_body");
        if ([...body].length > 150) return fail("body_too_long");
        if (a.p_strokes && !validStrokes(a.p_strokes)) return fail("bad_strokes");
        const row = { id: demo.rows.length + 1, nickname: (a.p_nickname || "").trim() || null, question: a.p_question || "", body,
          strokes: a.p_strokes && a.p_strokes.length ? a.p_strokes : null, pinned: false,
          status: demo.auto ? "approved" : "pending", created_at: now };
        demo.rows.push(row);
        return Promise.resolve({ id: row.id, created_at: now, status: row.status });
      }
      case "admin_list":
        return Promise.resolve(demo.rows.slice().sort((x, y) => (y.pinned - x.pinned) || (new Date(x.created_at) - new Date(y.created_at))));
      case "admin_set_status":
        demo.rows.forEach((r) => { if (r.id === a.p_id) r.status = a.p_status; });
        return Promise.resolve(null);
      case "admin_delete":
        demo.rows = demo.rows.filter((r) => r.id !== a.p_id);
        return Promise.resolve(null);
      case "admin_add_own":
        demo.rows.push({ id: demo.rows.length + 1, nickname: a.p_nickname || null, question: "", body: a.p_body, strokes: null, pinned: true, status: "approved", created_at: now });
        return Promise.resolve({ id: demo.rows.length, created_at: now });
      case "admin_set_auto_approve":
        demo.auto = !!a.p_on;
        return Promise.resolve(null);
    }
    return fail("unknown");
  }

  // ---------- 小画 ----------
  // 画布 1000×1000，左上角 (0,0)。笔画：{color, width, points:[[x,y],...], opacity?, fill?}
  const HEX = /^#[0-9a-fA-F]{3,8}$/;
  const num = (v, lo, hi) => typeof v === "number" && isFinite(v) && v >= lo && v <= hi;
  function validStrokes(s) {
    if (!Array.isArray(s) || s.length > 400) return false;
    let total = 0;
    for (const st of s) {
      if (!st || typeof st !== "object" || !HEX.test(st.color || "") || !num(st.width, 1, 60)) return false;
      if ("opacity" in st && !num(st.opacity, 0.05, 1)) return false;
      if ("fill" in st && typeof st.fill !== "boolean") return false;
      if (!Array.isArray(st.points) || !st.points.length) return false;
      for (const p of st.points) {
        if (!Array.isArray(p) || p.length !== 2 || !num(p[0], 0, 1000) || !num(p[1], 0, 1000)) return false;
        total++;
      }
    }
    return total <= 12000;
  }

  // 接受几种常见写法，统一成标准格式：
  // 数组 / {"strokes":[...]} / 点写成 {"x":..,"y":..}（4399 手作间那种）
  function normalizeStrokes(input) {
    let s = typeof input === "string" ? JSON.parse(input) : input;
    if (s && !Array.isArray(s) && Array.isArray(s.strokes)) s = s.strokes;
    if (!Array.isArray(s)) throw new Error("bad_strokes");
    s = s.map((st) => {
      const out = {
        color: st.color,
        width: typeof st.width === "number" ? st.width : 6,
        points: (st.points || []).map((p) => (Array.isArray(p) ? p : [p.x, p.y]).map((v) => Math.round(Number(v) * 10) / 10)),
      };
      if (typeof st.opacity === "number") out.opacity = st.opacity;
      if (typeof st.fill === "boolean") out.fill = st.fill;
      return out;
    });
    if (!validStrokes(s)) throw new Error("bad_strokes");
    return s;
  }

  const PAPER = "#fffaf3";
  function paint(canvas, strokes, opts) {
    const size = (opts && opts.size) || canvas.clientWidth || 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    const k = (size * dpr) / 1000;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, 1000, 1000);
    (strokes || []).forEach((st) => {
      if (!HEX.test(st.color || "") || !Array.isArray(st.points) || !st.points.length) return;
      const w = Math.max(1, Math.min(60, Number(st.width) || 6));
      const pts = st.points.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))
        .map((p) => [Math.max(0, Math.min(1000, p[0])), Math.max(0, Math.min(1000, p[1]))]);
      if (!pts.length) return;
      ctx.globalAlpha = num(st.opacity, 0.05, 1) ? st.opacity : 1;
      ctx.strokeStyle = ctx.fillStyle = st.color;
      ctx.lineWidth = w;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      if (pts.length === 1) {
        ctx.arc(pts[0][0], pts[0][1], w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        if (st.fill === true) { ctx.closePath(); ctx.fill(); } else ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }

  function fmtTime(iso) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: C.TIMEZONE,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  }

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 一封信的 HTML，来宾页和导出的静态页共用；所有内容都先转义
  // 带画的信：artSrc 有值就放图片（导出用），否则放一个 canvas 等着 paintAll 来画
  function letterHTML(w, i, extra, artSrc) {
    const name = w.nickname || "没署名的人";
    const initial = w.nickname ? [...w.nickname.trim()][0] : "✦";
    const art = w.strokes && w.strokes.length
      ? (artSrc ? `<img class="letter-art" src="${esc(artSrc)}" alt="${esc(name)}画的小画">`
                : `<canvas class="letter-art" data-art="${i}" role="img" aria-label="${esc(name)}画的小画"></canvas>`)
      : "";
    return `<article class="letter t${i % 4}${w.pinned ? " pinned" : ""}${extra ? " " + extra : ""}" style="animation-delay:${Math.min(i, 12) * 40}ms">
  ${w.pinned ? '<span class="pin">第一封</span>' : ""}
  ${w.question ? `<p class="letter-q">${esc(w.question)}</p>` : ""}
  ${art}
  <p class="letter-text">${esc(w.body)}</p>
  <div class="letter-foot"><span class="avatar">${esc(initial)}</span><span class="who">${esc(name)}</span><span class="when">${esc(fmtTime(w.created_at))}</span></div>
</article>`;
  }

  function paintAll(root, list) {
    root.querySelectorAll("canvas[data-art]").forEach((cv) => {
      const w = list[Number(cv.dataset.art)];
      if (w) paint(cv, w.strokes);
    });
  }

  function artDataURL(strokes, size) {
    const cv = document.createElement("canvas");
    cv.style.width = size + "px";
    paint(cv, strokes, { size });
    return cv.toDataURL("image/png");
  }

  window.WishAPI = { rpc, fmtTime, esc, letterHTML, paint, paintAll, artDataURL, normalizeStrokes, validStrokes, DEMO, PAPER };
})();
