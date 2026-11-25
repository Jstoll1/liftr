// NFL family pick'em: members only. Until this phone is signed in, the
// whole app sits behind a gate with two ways in: ask to join, or sign in
// with the PIN picked when joining. A phone with a pending request sees
// that it is waiting. Invite links (?claim=) go straight through, since
// they sign the phone in by themselves.
(function () {
  if (!window.LEAGUE || window.LEAGUE.sport !== "nfl") return;
  var q = new URLSearchParams(location.search);
  var has = function () { try { var a = JSON.parse(localStorage.getItem("brochiefs_token_v1") || "null"); return !!(a && a.token); } catch (e) { return false; } };
  var pass = (has() || q.get("claim") || q.get("hardhat") === "1" || /[?&]admin(=|&|$)/.test(location.search) || location.hash === "#admin");
  var pending = null;
  try { var j = JSON.parse(localStorage.getItem("brochiefs_join_v1") || "null"); if (j && j.status === "pending") pending = j; } catch (e) {}
  var esc = function (s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var css = "html.gated body>*:not(#gate):not(#join-modal){display:none!important}" +
    "#gate{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;padding:20px 16px;box-sizing:border-box;background:radial-gradient(120% 80% at 50% 0%,#1d0b33,#07020f 70%);overflow-y:auto}" +
    "#gate .g{width:min(100%,380px);text-align:center;padding:26px 20px 22px;border-radius:16px;border:2px solid #c13cff;background:#14061f;box-shadow:0 0 28px rgba(193,60,255,.35)}" +
    "#gate h1{margin:0 0 10px;font:16px/1.5 'Press Start 2P',monospace;color:#05d9e8;text-shadow:0 0 12px rgba(5,217,232,.6)}" +
    "#gate p{margin:0 0 18px;font-size:15px;line-height:1.5;color:#c9b8e0}" +
    "#gate button{display:block;width:100%;margin:10px 0 0;padding:15px;border-radius:12px;border:0;font:13px 'Press Start 2P',monospace;cursor:pointer}" +
    "#gate .go{background:#05d9e8;color:#07020f}#gate .alt{background:transparent;color:#05d9e8;border:2px solid #3a1a55}" +
    "#gate .lnk{display:block;width:auto;margin:14px auto 0;padding:6px;background:none;border:0;color:#9d8bb8;font:14px system-ui,sans-serif;text-decoration:underline;cursor:pointer}" +
    "#gate textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:13px;border-radius:10px;border:1px solid #3a1a55;background:#0b0312;color:#fff;font:16px system-ui,sans-serif;resize:none}" +
    "#gate form{display:none;margin-top:14px;text-align:left}#gate form.on{display:block}" +
    "#gate label{display:block;margin:10px 0 0;font-size:13px;color:#c9b8e0}#gate input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:13px;border-radius:10px;border:1px solid #3a1a55;background:#0b0312;color:#fff;font-size:17px}" +
    "#gate .err{min-height:18px;margin:8px 0 0;font-size:13px;color:#ff4f8b;text-align:center}" +
    "#join-modal{z-index:1000!important}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  var show = function () {
    if (document.getElementById("gate")) return;
    var g = document.createElement("div");
    g.id = "gate";
    g.innerHTML = '<div class="g"><h1>🦃 THANKSGIVING NFL PICK\'EM</h1>' +
      (pending ? "<p>Request sent for <b>" + esc(pending.name) + "</b>! Jake will let you in soon. Open this page again once he does and you're in.</p>"
               : "<p>A private pick'em. Join to see the games and make your picks.</p><button type=\"button\" class=\"go\" data-g=\"join\">JOIN THE PICK'EM</button>") +
      '<button type="button" class="alt" data-g="pin">I ALREADY JOINED</button>' +
      '<form id="gate-f"><label>Your name<input id="gate-n" autocomplete="name" required></label><label>Your PIN<input id="gate-p" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" required></label><p class="err" id="gate-e"></p><button type="submit" class="go">SIGN IN</button></form>' +
      '<button type="button" class="lnk" data-g="msg">Can\'t get in? Message Jake</button>' +
      '<form id="gate-m"><label>Your name<input id="gate-mn" autocomplete="name" required></label><label>Message<textarea id="gate-mt" rows="3" maxlength="500" required placeholder="Forgot my PIN, new phone…"></textarea></label><p class="err" id="gate-me"></p><button type="submit" class="go">SEND</button></form></div>';
    document.body.appendChild(g);
    g.addEventListener("click", function (e) {
      var b = e.target.closest("[data-g]"); if (!b) return;
      if (b.dataset.g === "join") { var jm = document.getElementById("join-modal"); if (jm && jm.parentElement !== document.body) document.body.appendChild(jm); if (window.openJoin) window.openJoin(); }
      else if (b.dataset.g === "msg") { document.getElementById("gate-m").classList.add("on"); document.getElementById("gate-mn").focus(); }
      else { document.getElementById("gate-f").classList.add("on"); document.getElementById("gate-n").focus(); }
    });
    document.getElementById("gate-f").addEventListener("submit", async function (e) {
      e.preventDefault();
      var name = document.getElementById("gate-n").value.trim(), pin = document.getElementById("gate-p").value.trim(), er = document.getElementById("gate-e");
      er.textContent = "Checking…";
      try {
        var W = window.LEAGUE.worker;
        var names = ((await (await fetch(W + "/roster?t=" + Date.now(), { cache: "no-store" })).json()).names) || [];
        var who = names.find(function (n) { return n.toLowerCase() === name.toLowerCase(); });
        if (!who) { er.textContent = "No member called " + name + ". Check the spelling, or join first."; return; }
        var r = await fetch(W + "/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", manager: who, code: pin }) });
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok || !d.token) { er.textContent = d.error || "That didn't work."; return; }
        localStorage.setItem("brochiefs_token_v1", JSON.stringify({ manager: who, token: d.token }));
        localStorage.setItem("brochiefs_me_v1", who);
        location.reload();
      } catch (x) { er.textContent = "No connection. Try again."; }
    });
  };
  document.addEventListener("submit", async function (e) {
    if (e.target.id !== "gate-m") return;
    e.preventDefault();
    var er = document.getElementById("gate-me"), name = document.getElementById("gate-mn").value.trim(), text = document.getElementById("gate-mt").value.trim();
    er.style.color = ""; er.textContent = "Sending…";
    try {
      var r = await fetch(window.LEAGUE.worker + "/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, text: text }) });
      var d = await r.json().catch(function () { return {}; });
      if (r.ok) { er.style.color = "#39ff88"; er.textContent = "Sent! Jake will get back to you."; document.getElementById("gate-mt").value = ""; }
      else er.textContent = d.error || "That didn't send.";
    } catch (x) { er.textContent = "No connection. Try again."; }
  });
  window.__gateOn = function () { document.documentElement.classList.add("gated"); start(); };
  var start = function () { var jm = document.getElementById("join-modal"); if (jm && jm.parentElement !== document.body) document.body.appendChild(jm); show(); };
  if (!pass) { document.documentElement.classList.add("gated"); if (document.readyState !== "loading") start(); else document.addEventListener("DOMContentLoaded", start); }
  // The app calls this once the phone signs itself in (an approved request).
  window.__gateRefresh = function () { try { var j = JSON.parse(localStorage.getItem("brochiefs_join_v1") || "null"); pending = j && j.status === "pending" ? j : null; } catch (e) {} var g = document.getElementById("gate"); if (g) { g.remove(); show(); } };
  window.__gateOff = function () { document.documentElement.classList.remove("gated"); var g = document.getElementById("gate"); if (g) g.remove(); };
})();
