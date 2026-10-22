// 只改这个文件就行
window.WISH_CONFIG = {
  // Supabase 控制台 → Project Settings → API 里抄这两个
  // key 用 anon / publishable 那个，千万别填 service_role / secret
  SUPABASE_URL: "https://mxfnpfptpjldtbcoigie.supabase.co",
  SUPABASE_KEY: "sb_publishable_fmzK9dYK5AVhsjLgI0Jd1A_aNRAKKsf",

  // 页面上的字
  BADGE: "DAY 100",                // 标题上面那个小标签，空着就不显示
  TITLE: "一百天",
  SUBTITLE: "她跟人认识满一百天了，愿意的话留一句就好",
  RECIPIENT: "她",                 // 页面里怎么称呼收信的人
  HERO_IMAGE: "",                  // 比如 "hero.webp"，放同一个文件夹；空着就不显示

  EFFECT: "petals",                // 背景特效："petals" 花瓣 / "stars" 星光 / "snow" 雪 / "none" 关掉

  MAX_LEN: 120,                    // 正文字数上限（数据库那边最多放 150）
  TIMEZONE: "Asia/Bangkok",        // 每封信上"几点几分"按哪个时区显示
};
