(() => {
  "use strict";

  const LOGOS = [
    ["classic","Classic","assets/merch/logo-classic.svg"],
    ["vice","Vice Circle","assets/merch/logo-vice.svg"],
    ["script","Script","assets/merch/logo-script.svg"],
    ["badge","League Badge","assets/merch/logo-badge.svg"],
    ["monogram","Monogram B","assets/merch/logo-monogram.svg"],
    ["stripes","Retro Stripes","assets/merch/logo-stripes.svg"],
    ["helmet","Helmet B","assets/merch/logo-helmet.svg"]
  ].map(x => ({id:x[0],name:x[1],file:x[2]}));

  const RAW = [
    ["All In Hoodie","Hoodies",59.99,0,"ALL IN","Heavyweight fleece for cold takes."],
    ["Circle B Baby Bib","Baby",12.99,1,"NEW","Protects against milk and bad trades."],
    ["Better Bros Hoodie","Hoodies",59.99,2,"MOTTO","Good players. Better bros."],
    ["Brocchiefs Can Cooler","Drinkware",9.99,3,"ESSENTIAL","Cold can. Warm friendship."],
    ["Ceramic Coffee Mug","Drinkware",16.99,4,"MORNING","Waiver-wire fuel vessel."],
    ["Circle B Dad Hat","Hats",24.99,5,"NEW","Low-profile, high-confidence."],
    ["Classic Logo Hoodie","Hoodies",57.99,6,"BEST SELLER","The Sunday-night uniform."],
    ["Classic Logo Tee","Shirts",27.99,7,"BEST SELLER","The one that started the dynasty."],
    ["Classic Black Tee","Shirts",27.99,8,"CORE","Another black tee because you need another black tee."],
    ["Brocchiefs Dad Hat","Hats",31.99,9,"CLEAN","Country-club energy. Fantasy-football motives."],
    ["Pocket B Tee","Shirts",27.99,10,"CLEAN","Tiny logo. Massive confidence."],
    ["Future Brochief Onesie","Baby",19.99,11,"BEST SELLER","Born into the league. No opt-out."],
    ["Insulated Tumbler 20oz","Drinkware",29.99,12,"BEST SELLER","Keeps coffee hot and takes hotter."],
    ["Brocchiefs 00 Jersey Tee","Shirts",31.99,13,"GAMEDAY","Roster number: all of us."],
    ["Kids Plate Set","Game Day",24.99,14,"NEW","Dinnerware for tiny tailgaters."],
    ["Brocchiefs Pint Glass","Drinkware",14.99,15,"BAR","For sophisticated roster construction."],
    ["Retro Stripes Tee","Shirts",28.99,16,"NEW","Old-school broadcast-booth vibes."],
    ["Script Night Cap","Hats",28.99,17,"NEW","Black-on-black with Vice script."],
    ["Script Snapback","Hats",27.99,18,"ALL IN","Flat bill. Loud opinions."],
    ["Script Brochiefs Tee","Shirts",28.99,19,"ALL IN","Soft shirt. Aggressive lineup takes."],
    ["Commissioner Hoodie","Hoodies",64.99,0,"COMMISH","Authority sold separately."],
    ["Sunday Snack Bib","Baby",12.99,1,"SUNDAY","For the 1 PM feeding window."],
    ["League Night Hoodie","Hoodies",61.99,2,"NIGHT","For the late window and later group chat."],
    ["Tailgate Can Cooler 2-Pack","Drinkware",15.99,3,"2-PACK","Two cans. One bad trade."],
    ["Monday Recovery Mug","Drinkware",18.99,4,"MONDAY","For processing what happened Sunday."],
    ["Draft Day Dad Hat","Hats",29.99,5,"DRAFT","Made for staring at the board."],
    ["Midnight Logo Hoodie","Hoodies",62.99,6,"LIMITED","Pretend limited edition. Still elite."],
    ["Draft Night Tee","Shirts",29.99,7,"DRAFT","Year after year. Lessons not learned."],
    ["Defending Champ Tee","Shirts",31.99,8,"CHAMP","Wear until mathematically eliminated."],
    ["Commissioner Cap","Hats",32.99,9,"COMMISH","For rulings nobody asked for."],
    ["Monogram Pocket Tee","Shirts",26.99,10,"B","Small mark. Huge ego."],
    ["Rookie Season Onesie","Baby",19.99,11,"ROOKIE","Already better waiver discipline."],
    ["Sunday Tumbler","Drinkware",34.99,12,"SUNDAY","Built for the entire early slate."],
    ["League Jersey Tee","Shirts",32.99,13,"00","No individual stats. Team effort."],
    ["Tailgate Plate Set","Game Day",29.99,14,"TAILGATE","Burgers deserve branding too."],
    ["Draft Night Pint Set","Drinkware",24.99,15,"2-PACK","For trades that require a beverage."],
    ["Vice Broadcast Tee","Shirts",29.99,16,"RETRO","Neon stripes, questionable decisions."],
    ["Script Saturday Hat","Hats",29.99,17,"SATURDAY","Works before noon kickoffs too."],
    ["Script Draft Cap","Hats",31.99,18,"DRAFT","For pretending the mock draft mattered."],
    ["Script Sunday Tee","Shirts",29.99,19,"SUNDAY","Clean script. Messy matchup."],
    ["All In Zip Hoodie","Hoodies",66.99,0,"PREMIUM","Maximum commitment, fictional zipper."],
    ["Future GM Bib","Baby",13.99,1,"GM","Small human. Big front-office upside."],
    ["Better Bros Crew","Hoodies",56.99,2,"BROS","The official unofficial league motto."],
    ["Neon Koozie 4-Pack","Game Day",24.99,3,"4-PACK","Protect the drink. Not the friendship."],
    ["Commissioner Coffee Set","Drinkware",31.99,4,"COMMISH","Two fake mugs. One real rivalry."],
    ["Circle B Sunday Cap","Hats",27.99,5,"SUNDAY","Good for wins, losses and excuses."],
    ["Classic Travel Hoodie","Hoodies",64.99,6,"TRAVEL","Airport-ready league apparel."],
    ["Core Brochiefs Tee","Shirts",26.99,7,"CORE","The default uniform."],
    ["Championship Black Tee","Shirts",32.99,8,"CHAMP","For the trophy-photo rotation."],
    ["White League Cap","Hats",30.99,9,"CLEAN","Clean hat. Dirty waiver tactics."]
  ];

  const PRODUCTS = RAW.map((p,i)=>({id:i+1,name:p[0],category:p[1],price:p[2],photo:p[3],tag:p[4],sub:p[5]}));
  const ACCENTS=["#ff2079","#05d9e8","#39ff88","#ffe45e","#c13cff"];
  const FILTERS=["All","Hats","Shirts","Hoodies","Baby","Drinkware","Game Day"];
  let active="All";
  let cart=Number(sessionStorage.getItem("brochiefs_fake_cart")||0);
  let toastTimer=null;

  const filtersEl=document.getElementById("merch-filters");
  const gridEl=document.getElementById("merch-grid");
  const vaultEl=document.getElementById("logo-vault");
  const countEl=document.getElementById("catalog-count");
  const titleEl=document.getElementById("catalog-title");
  const cartEl=document.getElementById("cart-count");
  const toastEl=document.getElementById("merch-toast");
  const heroEl=document.querySelector(".merch-hero-art");

  const imgs=window.MERCH_IMAGES||{};
  const rows=(Array.isArray(imgs.rows)?imgs.rows:[]).slice(0,2);
  if(heroEl && imgs.hero) heroEl.src=imgs.hero;

  function renderFilters(){
    filtersEl.innerHTML=FILTERS.map(f=>`<button class="merch-filter ${f===active?'active':''}" type="button" data-filter="${f}">${f}</button>`).join("");
    filtersEl.querySelectorAll("button").forEach(b=>b.onclick=()=>{active=b.dataset.filter;renderFilters();renderProducts();});
  }

  function renderVault(){
    vaultEl.innerHTML=LOGOS.map(l=>`<article class="logo-card"><img src="${l.file}" alt="${l.name} Brochiefs logo" loading="lazy"><span>${l.name}</span></article>`).join("");
  }

  function photoStyle(index){
    if(!rows.length) return "";
    const capacity=rows.length*4;
    const slot=index%capacity;
    const row=Math.floor(slot/4);
    const col=slot%4;
    const x=(col/3)*100;
    return `background-image:url(${rows[row]});--photo-x:${x}%`;
  }

  function renderProducts(){
    const list=active==="All"?PRODUCTS:PRODUCTS.filter(p=>p.category===active);
    titleEl.textContent=active==="All"?"All Gear":active;
    countEl.textContent=`${list.length} fake products`;
    gridEl.innerHTML=list.map(p=>{
      const accent=ACCENTS[p.id%ACCENTS.length];
      const style=photoStyle(p.photo);
      return `<article class="merch-card" style="--card-accent:${accent}">
        <span class="merch-tag">${p.tag}</span>
        <div class="product-art">${style?`<div class="product-photo" style="${style}" role="img" aria-label="${p.name}"></div>`:`<div class="merch-photo-fallback">BROCHIEFS</div>`}</div>
        <div class="product-info">
          <span class="product-name">${p.name}</span>
          <span class="product-sub">${p.sub}</span>
          <div class="product-bottom"><span class="product-price">$${p.price.toFixed(2)}</span><button class="product-add" type="button" data-id="${p.id}">ADD</button></div>
        </div>
      </article>`;
    }).join("");
    gridEl.querySelectorAll(".product-add").forEach(b=>b.onclick=()=>add(Number(b.dataset.id)));
  }

  function showToast(msg){clearTimeout(toastTimer);toastEl.textContent=msg;toastEl.classList.add("show");toastTimer=setTimeout(()=>toastEl.classList.remove("show"),1700);}
  function add(id){const p=PRODUCTS.find(x=>x.id===id);if(!p)return;cart++;sessionStorage.setItem("brochiefs_fake_cart",String(cart));cartEl.textContent=cart;showToast(`${p.name} added to the pretend cart ✓`);}

  document.getElementById("merch-cart").onclick=()=>showToast(cart?`${cart} fake item${cart===1?'':'s'} in cart. Checkout remains gloriously unavailable.`:"Your pretend cart is empty. Fix that.");
  cartEl.textContent=cart;
  renderFilters();renderVault();renderProducts();
})();