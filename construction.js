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
  // A 1998 home page: tiled background, Times, a marquee, blinking text,
  // rainbow rules, a hit counter and "best viewed in" badges. Nothing on
  // it leads anywhere.
  var css = "html.uc,html.uc body{height:100%;overflow:hidden!important}" +
    "html.uc body>*:not(#uc){display:none!important}" +
    "#uc{position:fixed;inset:0;z-index:2147483647;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 12px 40px;box-sizing:border-box;" +
    "font-family:'Times New Roman',Times,serif;color:#000;text-align:center;" +
    "background-color:#c0c0c0;background-image:linear-gradient(45deg,#b0b0b0 25%,transparent 25%,transparent 75%,#b0b0b0 75%),linear-gradient(45deg,#b0b0b0 25%,transparent 25%,transparent 75%,#b0b0b0 75%);background-size:24px 24px;background-position:0 0,12px 12px}" +
    "#uc .pg{max-width:560px;margin:0 auto;background:#fff;border:3px outset #dcdcdc;padding:12px 12px 16px}" +
    "#uc h1{margin:6px 0;font-size:30px;color:#ff0000;font-family:'Comic Sans MS','Comic Sans',cursive;text-shadow:2px 2px 0 #ffff00}" +
    "#uc .mq{overflow:hidden;white-space:nowrap;background:#000080;color:#ffff00;font:bold 15px 'Courier New',monospace;padding:4px 0;border:2px inset #dcdcdc}" +
    "#uc .mq span{display:inline-block;padding-left:100%;animation:ucmq 14s linear infinite}" +
    "#uc .rb{height:6px;margin:12px 0;border:0;background:linear-gradient(90deg,red,orange,yellow,lime,cyan,blue,magenta,red)}" +
    "#uc .dig{font-size:44px;line-height:1.1;margin:8px 0}" +
    "#uc .dig .w{display:inline-block;animation:ucdig .6s steps(2) infinite}" +
    "#uc .stripe{height:20px;margin:8px auto;max-width:420px;background:repeating-linear-gradient(-45deg,#ffcc00 0 14px,#000 14px 28px);border:2px solid #000}" +
    "#uc .bl{animation:ucbl 1s steps(1) infinite;color:#ff0000;font-weight:bold;font-size:20px}" +
    "#uc p{margin:10px 0;font-size:17px;line-height:1.4}" +
    "#uc a{color:#0000ee;text-decoration:underline;cursor:pointer}" +
    "#uc .ctr{display:inline-flex;gap:1px;background:#000;padding:3px;border:2px inset #888;vertical-align:middle}" +
    "#uc .ctr i{font:bold 18px 'Courier New',monospace;font-style:normal;color:#00ff00;background:#111;padding:0 3px}" +
    "#uc .bd{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:12px}" +
    "#uc .bd span{display:inline-flex;align-items:center;justify-content:center;width:92px;min-height:34px;box-sizing:border-box;border:2px outset #ddd;font:bold 8.5px/1.1 Verdana,Arial,sans-serif;padding:3px 2px;color:#fff}" +
    "#uc .sm{font-size:12px;color:#555;margin-top:12px}" +
    "@keyframes ucmq{to{transform:translateX(-100%)}}@keyframes ucbl{50%{visibility:hidden}}@keyframes ucdig{50%{transform:rotate(-14deg) translateY(2px)}}" +
    "@media (prefers-reduced-motion:reduce){#uc .mq span,#uc .bl,#uc .dig .w{animation:none}#uc .mq span{padding-left:0}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  // A hit counter that only ever goes up on this device.
  var hits = 13370;
  try { hits = (Number(localStorage.getItem("brochiefs_uc_hits")) || 13370) + 1; localStorage.setItem("brochiefs_uc_hits", String(hits)); } catch (e) {}
  function put() {
    if (document.getElementById("uc")) return;
    var d = document.createElement("div");
    d.id = "uc"; d.setAttribute("role", "alert");
    var digits = String(hits).padStart(6, "0").split("").map(function (n) { return "<i>" + n + "</i>"; }).join("");
    d.innerHTML = '<div class="pg">' +
      '<div class="mq"><span>*** WELCOME TO THE BROCHIEFS NFL PICK\'EM HOME PAGE *** NFL LOGIN LINKS ARE BEING WORKED ON *** PLEASE SIGN MY GUESTBOOK ***</span></div>' +
      '<h1>🚧 UNDER CONSTRUCTION 🚧</h1>' +
      '<div class="stripe"></div>' +
      '<div class="dig"><span class="w">👷</span>⛏️<span class="w">🚜</span></div>' +
      '<p class="bl">!!! PARDON OUR DUST !!!</p>' +
      '<hr class="rb">' +
      '<p>This page is <b>under construction</b>.<br><b>NFL login links are being worked on.</b></p>' +
      '<p>Please check back soon!!!</p>' +
      '<p><a onclick="return false">Sign my Guestbook</a> &nbsp;|&nbsp; <a onclick="return false">E-mail the Webmaster</a></p>' +
      '<hr class="rb">' +
      '<p>You are visitor number<br><span class="ctr">' + digits + '</span></p>' +
      '<div class="stripe"></div>' +
      '<div class="bd"><span style="background:#008080">Best viewed in<br>Netscape<br>Navigator 4.0</span><span style="background:#000080">Best viewed<br>at 800 x 600</span><span style="background:#800080">Member of the<br>Brochiefs<br>Web Ring</span></div>' +
      '<p class="sm">Last updated: ' + new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + ' &nbsp;·&nbsp; &copy; Brochiefs Football</p>' +
      '</div>';
    document.body.appendChild(d);
  }
  if (document.body) put(); else document.addEventListener("DOMContentLoaded", put);
  // Tell the league's Worker who reached this page (for Jake's Live page).
  try {
    var q = new URLSearchParams(location.search), dev = localStorage.getItem("brochiefs_device_v1");
    if (!dev) { dev = String(Math.random()).slice(2, 14) + Date.now().toString(36); localStorage.setItem("brochiefs_device_v1", dev); }
    var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    fetch(window.LEAGUE.worker + "/uc-hit", { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ device: dev, name: localStorage.getItem("brochiefs_me_v1") || "", invite: q.get("n") || "", via: q.get("join") === "1" ? "join" : q.get("claim") ? "invite" : standalone ? "app" : "home" }) }).catch(function () {});
  } catch (e) {}
})();
