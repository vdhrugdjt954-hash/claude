// 只改这个文件就行
window.WISH_CONFIG = {
  // Supabase 控制台 → Project Settings → API 里抄这两个
  // key 用 anon / publishable 那个，千万别填 service_role / secret
  SUPABASE_URL: "https://你的项目.supabase.co",
  SUPABASE_KEY: "你的 anon 或 publishable key",

  // 页面上的字
  TITLE: "一百天",
  SUBTITLE: "我在替她攒一百天的祝福，愿意的话留一句就好",
  RECIPIENT: "她",                 // 页面里怎么称呼收信的人
  HERO_IMAGE: "",                  // 比如 "hero.webp"，放同一个文件夹；空着就不显示

  // 来宾挑一个来答，最后一个是"随便说一句"
  QUESTIONS: [
    "你第一次注意到她是因为什么",
    "这一百天里，你见过她最好看的一刻",
    "想对一百天后的她说一句什么",
  ],
  FREE_QUESTION: "随便说一句",

  MAX_LEN: 120,                    // 正文字数上限（数据库那边最多放 150）
  TIMEZONE: "Asia/Bangkok",        // 每封信上"几点几分"按哪个时区显示
};
