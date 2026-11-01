"use strict";
/* Mi cartera — PWA. Lee data/cartera.json del repo privado cartera-datos con un token de solo
   lectura guardado en este dispositivo. Guarda la última copia para funcionar sin conexión. */

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin storage: sigue en memoria */ } },
};
const cfg = () => ({ token: LS.get("token", ""), repo: LS.get("repo", "lvignalei-beep/cartera-datos") });

const st = { data: null, origen: null, error: null, tab: "cartera", agrupar: LS.get("agrupar", "funcion") };

// ---------- formato ----------
const nf = (d) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: d, minimumFractionDigits: d });
const ars = (v) => v == null ? "sin dato" : "$ " + nf(0).format(v);
const arsM = (v) => v == null ? "sin dato" : (Math.abs(v) >= 1e6 ? "$ " + nf(1).format(v / 1e6) + " M" : ars(v));
const usd = (v, d = 0) => v == null ? "sin dato" : "US$ " + nf(d).format(v);
const pct = (v, d = 1, signo = true) => v == null ? "sin dato" : (signo && v > 0 ? "+" : "") + nf(d).format(v) + "%";
const cls = (v) => v == null ? "mut" : v >= 0 ? "pos" : "neg";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fechaCorta = (iso) => { if (!iso) return "sin dato"; const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}`; };
const hora = (iso) => (iso && iso.length > 10) ? iso.slice(11, 16) : "";
function cuando(iso) {
  if (!iso) return "sin dato";
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
  const dia = iso.slice(0, 10);
  const dias = Math.round((Date.parse(hoy) - Date.parse(dia)) / 864e5);
  if (dias === 0) return `hoy ${hora(iso)}`.trim();
  if (dias === 1) return `ayer ${hora(iso)}`.trim();
  return `el ${fechaCorta(dia)}`;
}
const diasDesde = (iso) => iso ? Math.round((Date.now() - Date.parse(iso.slice(0, 10) + "T12:00:00-03:00")) / 864e5) : null;

// ---------- datos ----------
async function cargar() {
  const { token, repo } = cfg();
  const cache = LS.get("cartera_cache");
  if (cache && !st.data) { st.data = cache.data; st.origen = { tipo: "cache", cuando: cache.guardado }; render(); }
  if (!token) { st.error = "falta_token"; if (!cache) st.tab = "ajustes"; render(); return; }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/data/cartera.json`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 401 ? "El token no es válido o venció." : r.status === 404 ? "No encuentro el repo o el token no tiene acceso a él." : `GitHub respondió ${r.status}.`);
    const data = await r.json();
    st.data = data; st.error = null; st.origen = { tipo: "red", cuando: new Date().toISOString() };
    LS.set("cartera_cache", { data, guardado: st.origen.cuando });
  } catch (e) {
    st.error = navigator.onLine === false ? "Sin conexión: muestro la última copia guardada." : String(e.message || e);
    if (cache) st.origen = { tipo: "cache", cuando: cache.guardado };
  }
  render();
}

// ---------- señales (las reglas llegan en la etapa 5) ----------
function senal(p) { return { clave: "neutral", nombre: "Neutral", regla: "Reglas de señales: próximamente" }; }

// ---------- vistas ----------
function renderEstado() {
  const el = document.getElementById("estado");
  const d = st.data;
  if (!d) { el.innerHTML = st.error ? `<span class="dot viejo">${esc(st.error === "falta_token" ? "Configurá el acceso en Ajustes" : st.error)}</span>` : "Cargando…"; return; }
  const viejo = diasDesde(d.corrida.fecha) > 3;
  const ultBol = d.brokers?.balanz?.ultimo_boleto;
  el.innerHTML = `
    <span class="dot ${viejo ? "viejo" : "ok"}">Datos ${esc(cuando(d.corrida.fecha))}${viejo ? " · sin actualizar hace " + diasDesde(d.corrida.fecha) + " días" : ""}</span>
    <span>Balanz: ${ultBol ? "último boleto " + fechaCorta(ultBol) : "por historial"}</span>
    <span>PPI: foto fija</span>
    ${st.error && st.error !== "falta_token" ? `<span class="neg">${esc(st.error)}</span>` : ""}`;
}

function vistaCartera() {
  const d = st.data;
  if (!d) return `<div class="vacio">${st.error === "falta_token" ? "Cargá el token en <b>Ajustes</b> para ver tu cartera." : "Cargando…"}</div>`;
  const T = d.totales;
  const sinValor = T.posiciones_sin_valor || [];
  const alertas = (d.alertas || []).filter((a) => !a.startsWith("Mercado:"));
  const nombres = d.funciones || {};

  const hero = `
  <section class="card hero">
    <div class="mut">Valor total</div>
    <div class="big num">${ars(T.ars)}</div>
    <div class="usd num">${usd(T.usd_mep)} <span class="nota">· MEP ${nf(2).format(d.dolar.mep)} (${fechaCorta(d.dolar.fecha)})</span></div>
    <div class="kpis">
      <div class="kpi"><div class="l">Ganancia en pesos</div><div class="v num ${cls(T.ganancia_ars)}">${ars(T.ganancia_ars)}</div><div class="s">valor − costo en pesos</div></div>
      <div class="kpi"><div class="l">Ganancia real en dólares</div><div class="v num ${cls(T.ganancia_real_usd)}">${usd(T.ganancia_real_usd)}</div>
        <div class="s">${pct(T.ganancia_real_pct)} · cada compra al MEP de su día · cubre ${nf(0).format(T.cobertura_ganancia_real_pct)}%</div></div>
    </div>
    ${sinValor.length ? `<p class="nota">Sin valor de mercado (no suman al total): ${sinValor.map(esc).join(", ")}.</p>` : ""}
  </section>`;

  const ener = d.posiciones.filter((p) => p.clasif?.energia_arg && p.v_actual);
  const porEmisor = {};
  ener.forEach((p) => { const e = p.clasif.emisor; porEmisor[e] = (porEmisor[e] || 0) + p.v_actual; });
  const emis = Object.entries(porEmisor).sort((a, b) => b[1] - a[1]);
  const energia = `
  <section class="card energia">
    <div style="display:flex;justify-content:space-between;gap:8px"><b>Energía argentina</b><b class="num">${pct(T.energia_arg_pct, 1, false)}</b></div>
    <div class="bar"><i style="width:${Math.min(100, T.energia_arg_pct || 0)}%"></i></div>
    <div class="nota" style="margin-top:6px">${emis.map(([e, v]) => `${esc(e)} ${pct(v / T.ars * 100, 1, false)}`).join(" · ")}</div>
    <div class="nota">Suma ONs, acciones y Cedears de empresas de energía argentinas: un problema del sector pega en todo esto a la vez.</div>
  </section>`;

  const al = alertas.length ? `<section class="card alerta"><b>Para tener en cuenta</b><ul>${alertas.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></section>` : "";

  const key = st.agrupar;
  const etiqueta = (p) => key === "funcion" ? (nombres[p.funcion] || p.funcion || "Sin clasificar") : (p.clasif?.[key] || "Sin dato");
  const grupos = {};
  d.posiciones.forEach((p) => { (grupos[etiqueta(p)] ||= []).push(p); });
  const lista = Object.entries(grupos)
    .map(([g, ps]) => ({ g, ps: ps.sort((a, b) => (b.v_actual || 0) - (a.v_actual || 0)), v: ps.reduce((s, p) => s + (p.v_actual || 0), 0) }))
    .sort((a, b) => b.v - a.v);

  const item = (p) => {
    const s = senal(p);
    const g = p.real_usd;
    const prec = p.precio == null ? "precio sin dato" : `${p.precio_unidad === "por_100" ? "c/100 VN " : p.precio_unidad === "vcp_1000" ? "c/1000 cp " : ""}${p.precio_moneda === "USD" ? "US$ " : "$ "}${nf(p.precio < 100 ? 2 : 0).format(p.precio)}`;
    return `<div class="pos-item">
      <span class="sig" style="background:var(--s-${s.clave})" title="${esc(s.nombre + " · " + s.regla)}"></span>
      <div style="min-width:0">
        <div class="t">${esc(p.ticker)}${p.broker !== "balanz" ? `<span class="tag">${esc(p.broker.toUpperCase())}</span>` : ""}${p.clasif?.energia_arg ? '<span class="tag en">energía AR</span>' : ""}</div>
        <div class="d">${esc(p.clasif?.emisor || "")} · ${p.cantidad == null ? "cantidad sin dato" : nf(p.cantidad % 1 ? 2 : 0).format(p.cantidad)} · ${esc(prec)}</div>
      </div>
      <div class="v num">${arsM(p.v_actual)}
        <small class="${cls(g?.ganancia_pct)}">${g ? pct(g.ganancia_pct) + " US$" : "real: sin dato"}</small></div>
    </div>`;
  };
  const posiciones = `
  <div class="seg" role="tablist" aria-label="Agrupar por">
    ${[["funcion", "Función"], ["sector", "Sector"], ["emisor", "Emisor"]].map(([k, l]) => `<button data-agrupar="${k}" class="${key === k ? "on" : ""}">${l}</button>`).join("")}
  </div>
  ${lista.map(({ g, ps, v }) => `
    <details class="card grupo" open>
      <summary><span>${esc(g)} <span class="mut" style="font-weight:400">(${ps.length})</span></span>
        <span class="r num">${arsM(v)} <span class="mut" style="font-weight:400">${pct(v / T.ars * 100, 1, false)}</span></span></summary>
      ${ps.map(item).join("")}
    </details>`).join("")}
  <p class="nota">Ganancia por posición: en dólares reales, con cada compra pasada al MEP de su fecha. Precios: ${esc(d.fuentes?.precios || "")}. La línea de color de cada posición va a mostrar su señal (etapa 5).</p>`;

  return hero + al + energia + posiciones;
}

const proximamente = (n, t) => `<div class="card vacio"><b>${t}</b><br>Llega en la etapa ${n}.</div>`;

function vistaAjustes() {
  const { token, repo } = cfg();
  return `
  <section class="card">
    <h2 style="margin-top:0;font-size:17px">Acceso a tus datos</h2>
    <p class="nota">La app lee <code>data/cartera.json</code> de tu repo privado con un token de GitHub de <b>solo lectura</b>. El token queda guardado solo en este dispositivo. No es tu clave de Balanz ni de ningún banco.</p>
    <label for="in-token">Token de GitHub</label>
    <input id="in-token" type="password" autocomplete="off" placeholder="github_pat_…" value="${esc(token)}">
    <label for="in-repo">Repositorio</label>
    <input id="in-repo" value="${esc(repo)}">
    <div class="row" style="margin-top:12px">
      ${token ? '<button id="btn-borrar" class="ghost">Borrar token</button>' : ""}
      <button id="btn-guardar">Guardar y probar</button>
    </div>
    <p id="msg-ajustes" class="nota"></p>
  </section>
  <section class="card">
    <b>Cómo crear el token (una sola vez)</b>
    <ol class="nota" style="padding-left:18px">
      <li>En github.com: tu foto → <i>Settings</i> → <i>Developer settings</i> → <i>Personal access tokens</i> → <i>Fine-grained tokens</i> → <i>Generate new token</i>.</li>
      <li>Nombre: "app cartera". Vencimiento: 1 año.</li>
      <li><i>Repository access</i>: <b>Only select repositories</b> → <b>cartera-datos</b>.</li>
      <li><i>Permissions</i> → <i>Repository permissions</i> → <b>Contents: Read-only</b>. Nada más.</li>
      <li>Generalo, copialo y pegalo arriba.</li>
    </ol>
  </section>`;
}

function render() {
  renderEstado();
  const v = document.getElementById("vista");
  v.innerHTML = st.tab === "cartera" ? vistaCartera()
    : st.tab === "grafico" ? proximamente(3, "Gráfico por instrumento")
    : st.tab === "falta" ? proximamente(4, "Qué me falta")
    : st.tab === "radar" ? proximamente(5, "Radar de oportunidades y señales")
    : vistaAjustes();
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === st.tab));
}

// ---------- eventos ----------
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) { st.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }
  else if (b.dataset.agrupar) { st.agrupar = b.dataset.agrupar; LS.set("agrupar", st.agrupar); render(); }
  else if (b.id === "btn-guardar") {
    LS.set("token", document.getElementById("in-token").value.trim());
    LS.set("repo", document.getElementById("in-repo").value.trim() || "lvignalei-beep/cartera-datos");
    document.getElementById("msg-ajustes").textContent = "Probando…";
    st.error = null; await cargar();
    if (st.tab === "ajustes") document.getElementById("msg-ajustes").textContent = st.error ? "No funcionó: " + st.error : "Listo, los datos cargaron.";
  }
  else if (b.id === "btn-borrar") { LS.set("token", ""); render(); }
  else if (b.id === "btn-actualizar") {
    const d = st.data;
    document.getElementById("dlg-ultima").innerHTML = d
      ? `<b>Última corrida:</b> ${esc(cuando(d.corrida.fecha))}<br><span class="nota">Copia en este dispositivo: ${esc(st.origen?.tipo === "red" ? "recién bajada" : "guardada " + cuando(st.origen?.cuando))}</span>${d.cambios?.length ? `<br><span class="nota">Cambios: ${esc(d.cambios.join("; "))}</span>` : ""}`
      : "Todavía no hay datos.";
    document.getElementById("dlg-actualizar").showModal();
  }
  else if (b.id === "btn-recargar") { document.getElementById("dlg-actualizar").close(); await cargar(); }
  else if (b.id === "btn-cerrar") document.getElementById("dlg-actualizar").close();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") cargar(); });
cargar();
