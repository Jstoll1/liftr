// NFL, for now: everyone but Jake gets a construction sign instead of the
// app (the login links are not ready). Jake gets in on a device that is
// already his, or once on a new one with ?hardhat=1.
(function () {
  if (!window.LEAGUE || window.LEAGUE.sport !== "nfl") return;
  var ok = false;
  try {
    if (new URLSearchParams(location.search).get("hardhat") === "1") localStorage.setItem("brochiefs_hardhat", "1");
    ok = localStorage.getItem("brochiefs_hardhat") === "1" || localStorage.getItem("brochiefs_me_v1") === "Jake";
  } catch (e) {}
  if (ok) return;
  window.__UNDER_CONSTRUCTION = true;
  document.documentElement.classList.add("uc");
  var css = "html.uc,html.uc body{height:100%;overflow:hidden!important;background:#14100a!important}" +
    "html.uc body>*:not(#uc){display:none!important}" +
    "#uc{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;" +
    "background:radial-gradient(600px 400px at 50% 40%,rgba(255,196,0,.12),transparent 70%),repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 2px,transparent 2px 4px),#14100a;font-family:'Press Start 2P',monospace;color:#1a1300}" +
    "#uc .sign{position:relative;width:min(300px,78vw);aspect-ratio:1;display:flex;align-items:center;justify-content:center}" +
    "#uc .sign::before{content:'';position:absolute;inset:14%;transform:rotate(45deg);background:#ffc400;border:8px solid #1a1300;outline:6px solid #ffc400;box-shadow:0 0 0 14px #1a1300,0 24px 60px rgba(0,0,0,.6)}" +
    "#uc .in{position:relative;text-align:center;line-height:1.5}" +
    "#uc .ic{font-size:44px;line-height:1;display:block;margin-bottom:10px;image-rendering:pixelated}" +
    "#uc .t{font-size:13px;letter-spacing:.06em}" +
    "#uc .wrap{display:flex;flex-direction:column;align-items:center;gap:26px;max-width:420px;text-align:center}" +
    "#uc .tape{width:min(420px,92vw);height:26px;background:repeating-linear-gradient(-45deg,#ffc400 0 18px,#1a1300 18px 36px);border:3px solid #1a1300;box-shadow:0 0 0 3px #ffc400;animation:ucroll 1.2s linear infinite;background-size:51px 26px}" +
    "#uc .msg{color:#ffc400;font-size:12px;line-height:1.9;text-shadow:3px 3px 0 #000}" +
    "#uc .msg b{display:block;font-size:16px;margin-bottom:10px;color:#fff}" +
    "#uc .blink{animation:ucblink 1s steps(1) infinite}" +
    "#uc .post{width:14px;height:40px;margin-top:-30px;background:#9a9a9a;border:3px solid #1a1300}" +
    "@keyframes ucroll{to{background-position:51px 0}}@keyframes ucblink{50%{opacity:0}}" +
    "@media (prefers-reduced-motion:reduce){#uc .tape,#uc .blink{animation:none}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  function put() {
    if (document.getElementById("uc")) return;
    var d = document.createElement("div");
    d.id = "uc"; d.setAttribute("role", "alert");
    d.innerHTML = '<div class="wrap"><div class="tape"></div><div class="sign"><div class="in"><span class="ic">🚧</span><span class="t">UNDER<br>CONSTRUCTION</span></div></div><div class="post"></div>' +
      '<div class="msg"><b>NFL PICK\'EM</b>Login links are being built.<br>Check back soon<span class="blink">_</span></div><div class="tape"></div></div>';
    document.body.appendChild(d);
  }
  if (document.body) put(); else document.addEventListener("DOMContentLoaded", put);
})();
