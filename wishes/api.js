// 调数据库函数的小工具，两个页面共用
(function () {
  const C = window.WISH_CONFIG;

  const MESSAGES = {
    empty_body: "还没写字呢",
    body_too_long: "字有点多，挑最想说的那句",
    name_too_long: "名字太长了，20 个字以内",
    bad_question: "先挑一个问题",
    too_many: "你刚寄过好几封了，过十分钟再来",
    too_many_global: "这会儿写的人有点多，过几分钟再试",
    bad_password: "口令不对",
  };

  async function rpc(fn, args) {
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
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const code = data && data.message;
      throw new Error(MESSAGES[code] || "没成功（" + (code || res.status) + "），再试一次");
    }
    return data;
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
  function letterHTML(w, i, extra) {
    const name = w.nickname || "没署名的人";
    const initial = w.nickname ? [...w.nickname.trim()][0] : "✦";
    return `<article class="letter t${i % 4}${w.pinned ? " pinned" : ""}${extra ? " " + extra : ""}" style="animation-delay:${Math.min(i, 12) * 40}ms">
  ${w.pinned ? '<span class="pin">第一封</span>' : ""}
  <p class="letter-q">${esc(w.question)}</p>
  <p class="letter-text">${esc(w.body)}</p>
  <div class="letter-foot"><span class="avatar">${esc(initial)}</span><span class="who">${esc(name)}</span><span class="when">${esc(fmtTime(w.created_at))}</span></div>
</article>`;
  }

  window.WishAPI = { rpc, fmtTime, esc, letterHTML };
})();
