// 页面特效：背景飘落 + 寄出时的爱心烟花 + 点空白处冒星星
// 在 config.js 里用 EFFECT 选："petals" 花瓣 / "stars" 星光 / "snow" 雪 / "none" 关掉
(function () {
  const C = window.WISH_CONFIG || {};
  const mode = C.EFFECT || "petals";
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dark = () => window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;

  // 两层画布：飘落的在内容后面，烟花在内容前面
  function layer(z) {
    const cv = document.createElement("canvas");
    cv.setAttribute("aria-hidden", "true");
    cv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:" + z;
    document.body.appendChild(cv);
    return cv;
  }
  const bgCv = layer(0), fxCv = layer(50);
  const bgCtx = bgCv.getContext("2d"), fxCtx = fxCv.getContext("2d");
  let ctx = bgCtx;
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    for (const [cv, c] of [[bgCv, bgCtx], [fxCv, fxCtx]]) {
      cv.width = W * dpr; cv.height = H * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }
  resize();
  addEventListener("resize", resize);

  const rand = (a, b) => a + Math.random() * (b - a);
  const PETAL = ["#f7c6c7", "#f9d5c2", "#f3b6b9", "#fbe0d0"];
  const WARM = ["#e8a487", "#f2b8a0", "#f6cf8e", "#f0a6b3", "#e48fa3"];

  // ---------- 飘落 ----------
  const fall = [];
  function spawn(top) {
    return {
      x: rand(0, W), y: top ? rand(-H, 0) : rand(0, H),
      r: mode === "snow" ? rand(1.5, 3.5) : mode === "stars" ? rand(.8, 2.2) : rand(5, 9),
      vy: mode === "stars" ? rand(.05, .2) : rand(.3, .8),
      sway: rand(.4, 1.2), phase: rand(0, Math.PI * 2),
      rot: rand(0, Math.PI * 2), vr: rand(-.02, .02),
      c: PETAL[(Math.random() * PETAL.length) | 0],
    };
  }
  if (mode !== "none" && !reduce) {
    const n = Math.round(Math.min(26, Math.max(12, W / 22)));
    for (let i = 0; i < n; i++) fall.push(spawn(false));
  }
  function drawFall(p, t) {
    if (mode === "petals") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = dark() ? .45 : .75;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * .6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (mode === "snow") {
      ctx.globalAlpha = dark() ? .7 : .9;
      ctx.fillStyle = dark() ? "#e9e2da" : "#ffffff";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.globalAlpha = (.35 + .65 * Math.abs(Math.sin(t / 900 + p.phase))) * (dark() ? 1 : .8);
      ctx.fillStyle = dark() ? "#ffe6b8" : "#e3a77f";
      star(p.x, p.y, p.r * 2.2);
    }
    ctx.globalAlpha = 1;
  }
  function star(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.lineTo(x + Math.cos(a + Math.PI / 4) * r * .32, y + Math.sin(a + Math.PI / 4) * r * .32);
    }
    ctx.closePath();
    ctx.fill();
  }
  function heart(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * .3);
    ctx.bezierCurveTo(x, y, x - s * .5, y, x - s * .5, y + s * .3);
    ctx.bezierCurveTo(x - s * .5, y + s * .6, x, y + s * .8, x, y + s);
    ctx.bezierCurveTo(x, y + s * .8, x + s * .5, y + s * .6, x + s * .5, y + s * .3);
    ctx.bezierCurveTo(x + s * .5, y, x, y, x, y + s * .3);
    ctx.fill();
  }

  // ---------- 烟花 / 星星 ----------
  const bits = [];
  function burst(x, y, n, big) {
    for (let i = 0; i < n; i++) {
      const a = big ? rand(-Math.PI * .95, -Math.PI * .05) : rand(0, Math.PI * 2);
      const sp = big ? rand(3, 8) : rand(1, 2.6);
      bits.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: big ? .14 : .03, life: 1, decay: big ? rand(.008, .014) : rand(.025, .04),
        s: big ? rand(8, 15) : rand(4, 7),
        kind: big && Math.random() < .55 ? "heart" : "star",
        c: WARM[(Math.random() * WARM.length) | 0],
        rot: rand(-.4, .4),
      });
    }
    kick();
  }

  // ---------- 循环 ----------
  let running = false;
  function frame(t) {
    bgCtx.clearRect(0, 0, W, H);
    fxCtx.clearRect(0, 0, W, H);
    ctx = bgCtx;
    for (const p of fall) {
      p.y += p.vy;
      p.x += Math.sin(t / 1600 + p.phase) * p.sway * .4;
      p.rot += p.vr;
      if (p.y > H + 12) Object.assign(p, spawn(true), { y: -12 });
      if (p.x < -12) p.x = W + 12; else if (p.x > W + 12) p.x = -12;
      drawFall(p, t);
    }
    ctx = fxCtx;
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.vx *= .985; b.vy = b.vy * .985 + b.g;
      b.x += b.vx; b.y += b.vy; b.life -= b.decay;
      if (b.life <= 0) { bits.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, b.life * 1.4);
      ctx.fillStyle = b.c;
      if (b.kind === "heart") {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot); heart(0, -b.s / 2, b.s); ctx.restore();
      } else star(b.x, b.y, b.s);
    }
    ctx.globalAlpha = 1;
    if ((fall.length || bits.length) && !document.hidden) requestAnimationFrame(frame);
    else { running = false; bgCtx.clearRect(0, 0, W, H); fxCtx.clearRect(0, 0, W, H); }
  }
  function kick() {
    if (!running && !document.hidden) { running = true; requestAnimationFrame(frame); }
  }
  document.addEventListener("visibilitychange", kick);
  kick();

  // 点空白处冒几颗小星星（点到按钮、输入框、文字上不冒）
  if (!reduce && mode !== "none") {
    addEventListener("pointerdown", (e) => {
      if (e.target.closest("input, textarea, button, label, select, a, .letter, .card")) return;
      burst(e.clientX, e.clientY, 7, false);
    });
  }

  window.WishFX = {
    // 从某个元素的位置炸一把爱心和星星
    celebrate(el) {
      const r = el ? el.getBoundingClientRect() : { left: W / 2, top: H / 2, width: 0, height: 0 };
      burst(r.left + r.width / 2, r.top + r.height / 2, reduce ? 0 : 38, true);
    },
  };
})();
