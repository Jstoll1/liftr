(() => {
  "use strict";

  const IMAGES = window.MERCH_IMAGES || {};
  const ROWS = Array.isArray(IMAGES.rows) ? IMAGES.rows : [];
  const LOGOS = [
    ["classic","Classic","assets/merch/logo-classic.svg"],
    ["vice","Vice Circle","assets/merch/logo-vice.svg"],
    ["script","Script","assets/merch/logo-script.svg"],
    ["badge","League Badge","assets/merch/logo-badge.svg"],
    ["monogram","Monogram B","assets/merch/logo-monogram.svg"],
    ["stripes","Retro Stripes","assets/merch/logo-stripes.svg"],
    ["helmet","Helmet B","assets/merch/logo-helmet.svg"]
  ].map(x => ({ id:x[0], name:x[1], file:x[2] }));

  const PHOTO = {
    allin:[0,0], bib:[0,1], betterbros:[0,2], cooler:[0,3],
    mug:[1,0], hat:[1,1], hoodie:[1,2], tee:[1,3]
  };

  const RAW = [
    ["Vice Trucker Hat","Hats",29.99,"hat","BEST SELLER","Mesh-back tailgate authority."],
    ["Circle B Dad Hat","Hats",24.99,"hat","NEW","Low-profile. High-confidence."],
    ["Script Snapback","Hats",27.99,"hat","ALL IN","Flat bill. Loud opinions."],
    ["Classic Dad Hat","Hats",31.99,"hat","CLEAN","Country-club energy. Fantasy-football motives."],
    ["Sunday Trucker Hat","Hats",29.99,"hat","GAMEDAY","The official parking-lot uniform."],
    ["Vice Night Cap","Hats",28.99,"hat","NEW","Black-on-black Brochiefs energy."],
    ["Commissioner Cap","Hats",32.99,"hat","COMMISH","For ruling with questionable judgment."],
    ["Draft Day Snapback","Hats",30.99,"hat","LIMITED","Looks better after your third bad pick."],

    ["Classic Logo Tee","Shirts",27.99,"tee","BEST SELLER","The one that started the dynasty."],
    ["Vice Circle Tee","Shirts",28.99,"tee","NEW","Miami-night energy without the palm tree."],
    ["Script Brochiefs Tee","Shirts",28.99,"tee","ALL IN","Soft shirt. Aggressive lineup takes."],
    ["Retro Stripes Tee","Shirts",28.99,"tee","NEW","Old-school broadcast booth vibes."],
    ["Sunday Hits Different Tee","Shirts",29.99,"tee","SUNDAY","Because Sundays absolutely do."],
    ["Pocket B Tee","Shirts",27.99,"tee","CLEAN","Tiny logo. Massive confidence."],
    ["Brocchiefs 00 Jersey Tee","Shirts",31.99,"tee","GAMEDAY","Roster number: all of us."],
    ["Draft Night 13 Tee","Shirts",29.99,"tee","LIMITED","Year 13. Zero lessons learned."],
    ["Defending Champ Tee","Shirts",31.99,"tee","CHAMP","Wear until mathematically eliminated."],
    ["Good Players. Better Bros. Tee","Shirts",29.99,"tee","BROS","The official unofficial league motto."],

    ["All In Hoodie","Hoodies",59.99,"allin","ALL IN","Heavyweight fleece for cold takes."],
    ["Classic Logo Hoodie","Hoodies",57.99,"hoodie","BEST SELLER","The Sunday-night uniform."],
    ["Better Bros Hoodie","Hoodies",59.99,"betterbros","MOTTO","Good players. Better bros."],
    ["Zip Monogram Hoodie","Hoodies",62.99,"hoodie","NEW","Full zip. Full send."],
    ["League Champ Hoodie","Hoodies",69.99,"allin","CHAMP","Embarrass the group chat all winter."],
    ["Sunday Night Hoodie","Hoodies",61.99,"hoodie","NIGHT","Made for the late window."],
    ["Commissioner Hoodie","Hoodies",64.99,"betterbros","COMMISH","Authority sold separately."],
    ["Draft Room Hoodie","Hoodies",66.99,"allin","DRAFT","Built for eight rounds of regret."],

    ["Future Brochief Onesie","Baby",19.99,"bib","BEST SELLER","Born into the league. No opt-out."],
    ["Rookie Season Onesie","Baby",19.99,"bib","ROOKIE","First season. Already better waiver discipline."],
    ["Circle B Baby Bib","Baby",12.99,"bib","NEW","Protects against milk and bad trades."],
    ["All In Baby Bib","Baby",12.99,"bib","ALL IN","Snack time has no half measures."],
    ["Tiny Commissioner Tee","Baby",18.99,"tee","COMMISH","Small human. Absolute authority."],
    ["Sunday Nap Club Onesie","Baby",22.99,"bib","NAP","For sleeping through the late window."],
    ["Future GM Bundle","Baby",29.99,"bib","BUNDLE","Bib, onesie, front-office upside."],
    ["Baby Draft Day Set","Baby",26.99,"bib","DRAFT","Tiny fit. Huge draft capital."],

    ["Insulated Tumbler 20oz","Drinkware",29.99,"mug","BEST SELLER","Keeps coffee hot and takes hotter."],
    ["Stadium Cup 4-Pack","Drinkware",18.99,"cooler","TAILGATE","Reusable until somebody loses one."],
    ["Ceramic Coffee Mug","Drinkware",16.99,"mug","MORNING","Waiver wire fuel vessel."],
    ["Travel Mug 16oz","Drinkware",24.99,"mug","ALL IN","Commute-ready commissioner juice."],
    ["Can Cooler 2-Pack","Drinkware",9.99,"cooler","ESSENTIAL","Cold can. Warm friendship."],
    ["Pint Glass 2-Pack","Drinkware",19.99,"mug","BAR","For sophisticated roster construction."],
    ["Draft Room Tumbler","Drinkware",34.99,"mug","PREMIUM","Built for the entire draft."],
    ["Commissioner Coffee Set","Drinkware",31.99,"mug","COMMISH","Two fake mugs. One real rivalry."],
    ["Sunday Pint Set","Drinkware",24.99,"mug","SUNDAY","For the early and late windows."],
    ["Sideline Can Cooler","Drinkware",12.99,"cooler","NEW","Cold beverage, hot take."],

    ["Kids Plate Set 3-Piece","Game Day",24.99,"cooler","NEW","Plate, bowl and cup for tiny tailgaters."],
    ["Tailgate Plate Set","Game Day",26.99,"cooler","TAILGATE","Burgers deserve branding too."],
    ["Draft Night Pint Set","Game Day",39.99,"mug","DRAFT","For trades that require a beverage."],
    ["Commissioner Drink Set","Game Day",44.99,"mug","COMMISH","Authority sold separately."],
    ["Sunday Snack Set","Game Day",21.99,"cooler","SUNDAY","Sized for chips and emotional support."],
    ["Parking Lot Party Pack","Game Day",34.99,"cooler","BUNDLE","Pretend cups. Very real tailgate energy."]
  ];

  const PRODUCTS = RAW.map((p,i) => ({id:i+1,name:p[0],category:p[1],price:p[2],photo:p[3],tag:p[4],sub:p[5]}));
  const ACCENTS = ["#ff2079","#05d9e8","#39ff88","#ffe45e","#c13cff"];
  const FILTERS = ["All","Hats","Shirts","Hoodies","Baby","Drinkware","Game Day"];
  const X = [0,33.333,66.667,100];
  let active = "All";
  let cart = Number(sessionStorage.getItem("brochiefs_fake_cart") || 0);
  let timer = null;

  const filtersEl = document.getElementById("merch-filters");
  const gridEl = document.getElementById("merch-grid");
  const vaultEl = document.getElementById("logo-vault");
  const countEl = document.getElementById("catalog-count");
  const titleEl = document.getElementById("catalog-title");
  const cartCountEl = document.getElementById("cart-count");
  const toastEl = document.getElementById("merch-toast");

  function renderFilters(){
    filtersEl.innerHTML = FILTERS.map(f => `<button class="merch-filter ${f===active?"active":""}" type="button" data-filter="${f}">${f}</button>`).join("");
    filtersEl.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
      active = btn.dataset.filter;
      renderFilters();
      renderProducts();
    }));
  }

  function renderVault(){
    vaultEl.innerHTML = LOGOS.map(l => `<article class="logo-card"><img src="${l.file}" alt="${l.name} Brochiefs logo" loading="lazy"><span>${l.name}</span></article>`).join("");
  }

  function photoMarkup(key){
    const pos = PHOTO[key] || PHOTO.tee;
    const row = ROWS[pos[0]];
    if (!row) return `<div class="merch-photo-fallback"><img src="assets/merch/logo-classic.svg" alt="Brocchiefs Football"></div>`;
    return `<div class="product-photo" style="--photo-x:${X[pos[1]]}%;background-image:url('${row}')"></div>`;
  }

  function renderProducts(){
    const list = active === "All" ? PRODUCTS : PRODUCTS.filter(p => p.category === active);
    titleEl.textContent = active === "All" ? "All Gear" : active;
    countEl.textContent = `${list.length} fake products`;
    gridEl.innerHTML = list.map(p => `
      <article class="merch-card" style="--card-accent:${ACCENTS[p.id % ACCENTS.length]}">
        <span class="merch-tag">${p.tag}</span>
        <div class="product-art">${photoMarkup(p.photo)}</div>
        <div class="product-info">
          <span class="product-name">${p.name}</span>
          <span class="product-sub">${p.sub}</span>
          <div class="product-bottom"><span class="product-price">$${p.price.toFixed(2)}</span><button class="product-add" type="button" data-id="${p.id}">ADD</button></div>
        </div>
      </article>`).join("");
    gridEl.querySelectorAll(".product-add").forEach(btn => btn.addEventListener("click", () => add(Number(btn.dataset.id))));
  }

  function msg(text){
    clearTimeout(timer);
    toastEl.textContent = text;
    toastEl.classList.add("show");
    timer = setTimeout(() => toastEl.classList.remove("show"), 1700);
  }

  function add(id){
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;
    cart += 1;
    sessionStorage.setItem("brochiefs_fake_cart", String(cart));
    cartCountEl.textContent = cart;
    msg(`${p.name} added to the pretend cart ✓`);
  }

  document.getElementById("merch-cart").addEventListener("click", () => msg(cart ? `${cart} fake item${cart===1?"":"s"} in cart. Checkout remains gloriously unavailable.` : "Your pretend cart is empty. Fix that."));
  cartCountEl.textContent = cart;
  renderFilters();
  renderVault();
  renderProducts();
})();