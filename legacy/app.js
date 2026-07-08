// ---------- Iconos (SVG inline, sin dependencias) ----------
const ICONS = {
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h5a4 4 0 0 0 4-4V8"/>',
  map: '<circle cx="12" cy="12" r="2"/><circle cx="5" cy="6" r="1.6"/><circle cx="19" cy="7" r="1.6"/><circle cx="18" cy="18" r="1.6"/><path d="M6.4 7.2 10.6 11M13.6 11l3.8-3M13.2 13.4l3.8 3.4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  scale: '<path d="M12 3v18M7 7l-4 7h8zM17 7l-4 7h8zM7 7h10M6 21h12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
};
function renderIcons() {
  document.querySelectorAll(".ic").forEach((el) => {
    const name = el.textContent.trim();
    if (ICONS[name]) {
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
    }
  });
}

// ---------- Navegación entre vistas ----------
function showView(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const target = document.getElementById("view-" + view);
  if (target) target.classList.add("active");
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-view]");
  if (nav) {
    let v = nav.dataset.view;
    if (v === "diagnosticos-cud") { showView("diagnosticos"); openCondition("tea"); return; }
    showView(v);
  }
});

// ---------- Chat guionado ----------
const chatLog = document.getElementById("chatLog");
const chatChips = document.getElementById("chatChips");

function addMessage(html, who) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + who;
  wrap.innerHTML =
    (who === "bot" ? '<div class="msg-avatar">S</div>' : "") +
    '<div class="msg-bubble">' + html + "</div>";
  chatLog.appendChild(wrap);
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return wrap;
}

function addTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  wrap.innerHTML = '<div class="msg-avatar">S</div><div class="msg-bubble typing"><span></span><span></span><span></span></div>';
  chatLog.appendChild(wrap);
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return wrap;
}

function answer(key) {
  const script = CHAT_SCRIPTS[key];
  if (!script) return;
  chatChips.style.display = "none";
  addMessage(script.pregunta, "user");
  const typing = addTyping();
  setTimeout(() => {
    typing.remove();
    let html = script.respuesta;
    html += '<div class="msg-source"><i class="ic" style="width:15px">book</i>Fuente: ' + script.fuente + "</div>";
    const bubble = addMessage(html, "bot");
    if (script.cta) {
      const btn = document.createElement("button");
      btn.className = "msg-cta";
      btn.textContent = script.cta.label;
      btn.addEventListener("click", () => showView(script.cta.view));
      bubble.querySelector(".msg-bubble").appendChild(btn);
    }
    renderIcons();
    setTimeout(() => {
      chatChips.style.display = "flex";
      chatLog.parentElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 400);
  }, 1100);
}

document.querySelectorAll(".chip").forEach((c) => {
  c.addEventListener("click", () => answer(c.dataset.q));
});

// ---------- Mi ruta: marcar paso ----------
document.querySelector(".step-check")?.addEventListener("click", (e) => {
  const step = e.target.closest(".step");
  step.classList.remove("current");
  step.classList.add("done");
  step.querySelector(".step-dot").innerHTML = '<i class="ic">check</i>';
  const next = step.nextElementSibling;
  if (next && next.classList.contains("step")) {
    next.classList.add("current");
    next.querySelector(".step-dot").textContent = next.querySelector(".step-dot").textContent;
  }
  renderIcons();
});

// ---------- Diagnósticos ----------
const dxGrid = document.getElementById("dxGrid");
const dxCats = document.getElementById("dxCats");
const dxSearch = document.getElementById("dxSearch");
let activeCat = "todas";

function catColor(catId) {
  const c = CATEGORIES.find((x) => x.id === catId);
  return c ? c.color : "#178a7f";
}
function catLabel(catId) {
  const c = CATEGORIES.find((x) => x.id === catId);
  return c ? c.label : "";
}

function renderCats() {
  dxCats.innerHTML = "";
  CATEGORIES.forEach((c) => {
    const b = document.createElement("button");
    b.className = "dx-cat" + (c.id === activeCat ? " active" : "");
    b.textContent = c.label;
    b.addEventListener("click", () => { activeCat = c.id; dxSearch.value = ""; renderCats(); renderGrid(); });
    dxCats.appendChild(b);
  });
}

function renderGrid() {
  const q = dxSearch.value.trim().toLowerCase();
  dxGrid.innerHTML = "";
  const list = CONDITIONS.filter((c) => {
    const matchCat = activeCat === "todas" || c.cat === activeCat;
    const matchQ = !q || c.nombre.toLowerCase().includes(q);
    return matchCat && matchQ;
  });
  if (!list.length) {
    dxGrid.innerHTML = '<p style="color:var(--text-soft);grid-column:1/-1">No encontramos ese diagnóstico. En el producto real, tu búsqueda nos indica qué ficha crear.</p>';
    return;
  }
  list.forEach((c) => {
    const card = document.createElement("button");
    card.className = "dx-card";
    card.style.setProperty("--dx-color", catColor(c.cat));
    card.innerHTML = '<h4>' + c.nombre + '</h4><span class="dx-catlabel">' + catLabel(c.cat) + "</span>";
    card.addEventListener("click", () => openCondition(c.id));
    dxGrid.appendChild(card);
  });
}

dxSearch.addEventListener("input", renderGrid);

// Drawer de detalle
const overlay = document.createElement("div");
overlay.className = "dx-overlay";
overlay.innerHTML = '<div class="dx-detail" id="dxDetail"></div>';
document.body.appendChild(overlay);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDetail(); });

function openCondition(id) {
  const c = CONDITIONS.find((x) => x.id === id);
  if (!c) return;
  const color = catColor(c.cat);
  const d = document.getElementById("dxDetail");
  d.innerHTML =
    '<div class="dx-detail-head"><h2>' + c.nombre + '</h2>' +
    '<button class="dx-close" aria-label="Cerrar"><i class="ic">x</i></button></div>' +
    '<span class="dx-badge" style="background:' + color + '22;color:' + color + '">' + catLabel(c.cat) + "</span>" +
    '<div class="dx-section"><div class="dx-section-title"><i class="ic">book</i>Qué es</div><p>' + c.que + "</p></div>" +
    '<div class="dx-section"><div class="dx-section-title"><i class="ic">heart</i>Apoyos frecuentes</div><p>' + c.apoyos + "</p></div>" +
    '<div class="dx-section"><div class="dx-section-title"><i class="ic">scale</i>Derechos que activa</div><p>' + c.derechos + "</p></div>" +
    '<button class="btn-primary full" id="dxAsk">Preguntarle a Simón sobre esto</button>' +
    '<p class="dx-disclaimer">Información orientativa de ejemplo. No reemplaza la consulta con profesionales. En el producto real, cada ficha lleva la firma de un profesional que la revisó.</p>';
  d.scrollTop = 0;
  overlay.classList.add("open");
  d.querySelector(".dx-close").addEventListener("click", closeDetail);
  d.querySelector("#dxAsk").addEventListener("click", () => { closeDetail(); showView("inicio"); });
  renderIcons();
}
function closeDetail() { overlay.classList.remove("open"); }

// ---------- Conectar: formulario ----------
document.getElementById("connectSubmit")?.addEventListener("click", () => {
  document.getElementById("connectDone").classList.add("show");
});

// ---------- Init ----------
renderIcons();
renderCats();
renderGrid();
