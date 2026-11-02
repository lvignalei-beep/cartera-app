"use strict";
/* Mi cartera — PWA. Lee datos.enc (cifrado) y lo abre con la clave de ingreso del usuario.
   Guarda la última copia para funcionar sin conexión. */

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin storage: sigue en memoria */ } },
};

const st = { data: null, origen: null, error: null, tab: "hoy", periodo: "dia", ticker: LS.get("ticker", null), aporte: LS.get("aporte", 0), agrupar: LS.get("agrupar", "funcion") };

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

// ---------- datos (cifrados con la clave de ingreso) ----------
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const TE = new TextEncoder();
function normalizarClave(c) {
  const s = c.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 16 ? s.match(/.{4}/g).join("-") : c.trim().toUpperCase();
}
async function derivarClave(clave) {
  const l = await (await fetch("llave.json", { cache: "no-store" })).json();
  const base = await crypto.subtle.importKey("raw", TE.encode(normalizarClave(clave)), "PBKDF2", false, ["deriveKey"]);
  const kek = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64d(l.salt), iterations: l.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  try {
    return b64e(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(l.iv), additionalData: TE.encode("llave-v1") }, kek, b64d(l.wk)));
  } catch { throw new Error("La clave no es correcta."); }
}
async function descifrar(kb64) {
  const e = await (await fetch("datos.enc", { cache: "no-store" })).json();
  const k = await crypto.subtle.importKey("raw", b64d(kb64), "AES-GCM", false, ["decrypt"]);
  let gz;
  try { gz = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(e.iv), additionalData: TE.encode("cartera-v1") }, k, b64d(e.ct)); }
  catch { throw new Error("No pude abrir los datos con la clave guardada. Volvé a cargarla en Ajustes."); }
  const txt = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(txt);
}

async function cargar() {
  const kd = LS.get("kd", "");
  const cache = LS.get("cartera_cache");
  if (cache && !st.data) { st.data = cache.data; st.origen = { tipo: "cache", cuando: cache.guardado }; render(); }
  if (!kd) { st.error = "falta_clave"; if (!cache) st.tab = "ajustes"; render(); return; }
  try {
    const data = await descifrar(kd);
    st.data = data; st.error = null; st.origen = { tipo: "red", cuando: new Date().toISOString() };
    LS.set("cartera_cache", { data, guardado: st.origen.cuando });
  } catch (e) {
    st.error = navigator.onLine === false ? "Sin conexión: muestro la última copia guardada." : String(e.message || e);
    if (cache) st.origen = { tipo: "cache", cuando: cache.guardado };
  }
  render();
}

// ---------- señales (las reglas llegan en la etapa 5) ----------
const SENAL = { revisar_tesis: "Revisar tesis", tomar_ganancia: "Tomar ganancia parcial", cara: "Cara", esperar: "Esperar",
  a_mirar: "A mirar / compra escalonada", barata: "Barata vs sector", neutral: "Neutral" };
function senal(p) { return p.senal || { clave: "neutral", nombre: "Neutral", regla: "sin dato" }; }

// Reparto del aporte: igual que collector/calc.py (reparto_aporte)
function reparto(pesos, objetivo, aporte) {
  const fs = Object.keys(objetivo);
  const total = fs.reduce((s, f) => s + (pesos[f] || 0), 0);
  const falta = Object.fromEntries(fs.map((f) => [f, Math.max(0, (total + aporte) * objetivo[f] / 100 - (pesos[f] || 0))]));
  const sf = Object.values(falta).reduce((a, b) => a + b, 0);
  if (aporte <= 0 || sf === 0) return Object.fromEntries(fs.map((f) => [f, 0]));
  return Object.fromEntries(fs.map((f) => [f, aporte * falta[f] / sf]));
}

let chart = null;
function vistaGrafico() {
  const d = st.data;
  if (!d) return vistaCartera();
  const tks = [...new Set(d.posiciones.map((p) => p.ticker))].sort();
  const t = tks.includes(st.ticker) ? st.ticker : tks[0];
  const p = d.posiciones.find((x) => x.ticker === t);
  const g = d.graficos?.[t];
  const i = p.ind || {};
  const f = p.fund;
  const sel = `<select id="sel-ticker">${tks.map((x) => `<option ${x === t ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const dg = p.diag || {};
  const MOM = { oportunidad: ["💡 Buen momento de precio", "pos"], caro: ["⏸️ Caro para sumar ahora", "neg"], mixto: ["↔️ Señales mixtas", "mut"], normal: ["Precio normal", "mut"], sin_dato: ["Momento: sin datos suficientes", "mut"] };
  const RES = { bien: ["✅ Te está yendo bien", "pos"], mal: ["⚠️ Te está yendo mal", "neg"], neutro: ["Resultado parejo", "mut"], sin_dato: ["Resultado: sin dato", "mut"] };
  const n = (x, dd = 1) => x == null ? "sin dato" : nf(dd).format(x);
  const fila = (l, v) => `<div class="kv"><span>${l}</span><b class="num">${v}</b></div>`;
  const pocos = !g || (g.velas || []).length < 5;
  return `
  <section class="card">${sel}
    <div class="dos" style="margin-top:10px">
      <div><div class="${RES[dg.resultado]?.[1]}">${RES[dg.resultado]?.[0] || ""}</div><div class="nota">${pct(p.real_usd?.ganancia_pct)} en USD · ${ars(p.ganancia_ars)}</div></div>
      <div><div class="${MOM[dg.momento]?.[1]}">${MOM[dg.momento]?.[0] || ""}</div><div class="nota">Señal: ${esc(p.senal?.nombre || "")}</div></div>
    </div>
    ${(dg.a_favor || []).map((x) => `<div class="nota pos">+ ${esc(x)}</div>`).join("")}${(dg.en_contra || []).map((x) => `<div class="nota neg">− ${esc(x)}</div>`).join("")}
  </section>
  <section class="card">
    <b>${esc(g?.titulo || t)}</b>
    ${pocos ? `<p class="vacio">Todavía no hay historia de precios suficiente para graficar ${esc(t)}. Se junta un punto por día hábil desde el 01/11.</p>` : `<div class="graf"><canvas id="cv"></canvas></div>
    <p class="nota">▲ compras · línea punteada: ${esc(g.ppc_nota)} · verde/rojo: desde tu primera compra, arriba o abajo de esa línea · gris: media de 200 ruedas. Fuente: ${esc(g.fuente)}.</p>`}
  </section>
  <section class="card">
    ${fila("Variación hoy / mes / 3 meses", `${pct(i.d1)} · ${pct(i.m1)} · ${pct(i.m3)}`)}
    ${fila("En el año / 12 meses", `${pct(i.ytd)} · ${pct(i.m12)}`)}
    ${fila("RSI (14)", n(i.rsi14, 0) + (i.rsi14 > 70 ? " · subió rápido" : i.rsi14 < 30 ? " · muy castigado" : ""))}
    ${fila("vs. media de 200 ruedas", pct(i.dist_ma200))}
    ${fila("vs. máximo de 52 semanas", pct(i.dist_max52))}
    ${f ? fila("P/E (veces sus ganancias)", `${n(f.pe)} · sector ${n(f.pe_sector)}${f.pe && f.pe_sector ? " (" + nf(2).format(f.pe / f.pe_sector) + "×)" : ""}`) : fila("P/E", "no aplica (ETF, bono o fondo)")}
    <p class="nota">Variaciones en dólares. ${esc(i.fuente || "")}.</p>
  </section>
  <section class="card"><b>Tus operaciones</b>
    ${(g?.compras || []).map((c) => `<div class="kv"><span>${fechaCorta(c.fecha)}/${c.fecha.slice(2, 4)} · ${c.tipo} ${nf(c.cantidad % 1 ? 2 : 0).format(c.cantidad)}</span><b class="num">${c.precio_pagado == null ? "sin dato" : (c.moneda_pagada === "USD" ? "US$ " : "$ ") + nf(c.precio_pagado < 100 ? 2 : 0).format(c.precio_pagado)}</b></div>`).join("") || '<p class="nota">Sin operaciones registradas.</p>'}
  </section>`;
}

function dibujarGrafico() {
  const cv = document.getElementById("cv");
  if (chart) { chart.destroy(); chart = null; }
  if (!cv || typeof Chart === "undefined") return;
  const d = st.data;
  const tks = [...new Set(d.posiciones.map((p) => p.ticker))].sort();
  const t = tks.includes(st.ticker) ? st.ticker : tks[0];
  const g = d.graficos[t];
  const labels = g.velas.map((v) => v[0]);
  const precios = g.velas.map((v) => v[1]);
  const ma = precios.map((_, k) => k >= 199 ? precios.slice(k - 199, k + 1).reduce((a, b) => a + b, 0) / 200 : null);
  const marcas = labels.map(() => null);
  const info = labels.map(() => null);
  g.compras.forEach((c) => {
    let k = labels.findIndex((l) => l >= c.fecha); if (k < 0) k = labels.length - 1;
    if (c.y != null) { marcas[k] = c.y; info[k] = c; }
  });
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const primera = g.compras.filter((c) => c.tipo === "compra").map((c) => c.fecha).sort()[0];
  const desde = precios.map((v, k) => (primera && labels[k] >= primera ? v : null));
  const ds = [{ label: "Precio", data: precios, borderColor: col("--tx"), borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
    { label: "desde", data: desde, borderWidth: 0, pointRadius: 0, tension: 0.1,
      fill: g.ppc ? { target: { value: g.ppc }, above: "rgba(22,163,74,.18)", below: "rgba(220,38,38,.18)" } : false },
    { label: "Media 200", data: ma, borderColor: col("--mut"), borderWidth: 1, pointRadius: 0, borderDash: [2, 3] },
    { label: "Compras", data: marcas, showLine: false, pointStyle: "triangle", pointRadius: 7, pointBackgroundColor: col("--acc"), pointBorderColor: col("--card") }];
  if (g.ppc) ds.push({ label: "Tu promedio", data: labels.map(() => g.ppc), borderColor: col("--acc"), borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0 });
  const mon = g.moneda === "USD" ? "US$ " : "$ ";
  chart = new Chart(cv, { type: "line", data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: (it) => it[0].label.split("-").reverse().join("/"),
        label: (it) => { if (it.dataset.label === "Compras") { const c = info[it.dataIndex]; return c ? `${c.tipo} ${c.cantidad} · pagaste ${c.moneda_pagada === "USD" ? "US$ " : "$ "}${nf(2).format(c.precio_pagado)}` : null; }
          return it.raw == null || it.dataset.label === "desde" ? null : `${it.dataset.label}: ${mon}${nf(2).format(it.raw)}`; } } } },
      scales: { x: { ticks: { maxTicksLimit: 5, color: col("--mut"), callback: function (v) { const l = this.getLabelForValue(v); return l.slice(5, 7) + "/" + l.slice(2, 4); } }, grid: { display: false } },
        y: { ticks: { color: col("--mut"), maxTicksLimit: 5 }, grid: { color: col("--line") } } } } });
}

function vistaFalta() {
  const d = st.data;
  if (!d) return vistaCartera();
  const nombres = d.funciones || {};
  const umbral = 10;
  const pesos = {};
  d.posiciones.forEach((p) => { if (p.v_actual != null) pesos[p.funcion] = (pesos[p.funcion] || 0) + p.v_actual; });
  const total = Object.values(pesos).reduce((a, b) => a + b, 0);
  const sumaObj = Math.round(Object.values(d.objetivo).reduce((a, b) => a + b, 0) * 10) / 10;
  const rep = reparto(pesos, d.objetivo, st.aporte || 0);
  const filas = Object.keys(d.objetivo).map((f) => {
    const tengo = pesos[f] || 0, tp = total ? tengo / total * 100 : 0, obj = d.objetivo[f];
    return { f, tengo, tp, obj, dif: tp - obj, fs: total * obj / 100 - tengo, ap: rep[f] || 0 };
  }).sort((a, b) => a.dif - b.dif);
  const escala = Math.max(...filas.map((x) => Math.max(x.tp, x.obj)), 1);

  const fila = (x) => {
    const sobra = x.dif > 0, vender = x.dif > umbral;
    const cands = d.candidatos_aporte?.[x.f] || [];
    return `<div class="fx">
      <div class="fx-h"><b>${esc(nombres[x.f] || x.f)}</b>
        <span class="num ${Math.abs(x.dif) < 2 ? "mut" : sobra ? "neg" : "pos"}">${x.dif > 0 ? "+" : ""}${nf(1).format(x.dif)} pp</span></div>
      <div class="fx-bar" aria-hidden="true"><i style="width:${x.tp / escala * 100}%"></i><b style="left:${x.obj / escala * 100}%"></b></div>
      <div class="fx-n nota num">Tenés ${pct(x.tp, 1, false)} (${arsM(x.tengo)}) · objetivo ${x.obj}% ·
        ${x.fs >= 0 ? `<span class="pos">falta ${arsM(x.fs)}</span>` : `<span class="neg">sobra ${arsM(-x.fs)}</span>`}</div>
      ${x.ap > 0 ? `<div class="fx-a">Del aporte: <b class="num">${ars(x.ap)}</b>${cands.length ? " → " + cands.slice(0, 3).map((c) => `${esc(c.ticker)}${c.senal !== "neutral" ? " (" + esc(SENAL[c.senal]) + ")" : ""}`).join(", ") : " → no tenés instrumentos de esta función: hay que elegir uno"}</div>` : ""}
      ${vender ? `<div class="fx-v">Supera el objetivo por más de ${umbral} puntos: evaluar una venta parcial de ~${arsM(-x.fs)} o, más simple, dejar de aportarle hasta que el resto crezca.</div>` : ""}
    </div>`;
  };

  return `
  <section class="card">
    <h2 class="h">Tu cartera contra el objetivo</h2>
    <p class="nota">Barra = lo que tenés · marca = objetivo. Ordenado de lo que más falta a lo que más sobra. Sin liquidez: tu reserva está en la caja de ahorro.</p>
    ${sumaObj !== 100 ? `<p class="fx-v">Tu objetivo suma ${sumaObj}%, no 100%: los "falta/sobra" no cierran a cero. Definí a qué función van los ${100 - sumaObj} puntos que faltan (archivo config/objetivo.json, o pedímelo).</p>` : ""}
    <label for="in-aporte">Próximo aporte en pesos</label>
    <input id="in-aporte" inputmode="numeric" placeholder="4.000.000" value="${st.aporte ? nf(0).format(st.aporte) : ""}">
    ${filas.map(fila).join("")}
    <p class="nota">Cálculo: falta/sobra = total × objetivo − lo que tenés. Aporte: a cada función le toca aporte × (lo que le falta después de sumar el aporte) ÷ (suma de faltantes); lo que sobra no recibe nada. Total considerado: ${ars(total)}${(d.totales.posiciones_sin_valor || []).length ? " (sin " + d.totales.posiciones_sin_valor.map(esc).join(", ") + ")" : ""}.</p>
  </section>`;
}

function vistaHoy() {
  const d = st.data;
  if (!d) return vistaCartera();
  const leyenda = d.reglas?.leyenda || "Filtro numérico, no es recomendación de inversión";
  const prio = d.reglas?.prioridad || Object.keys(SENAL);
  const vistos = new Set();
  const conSenal = d.posiciones.filter((p) => p.senal && p.senal.clave !== "neutral" && !vistos.has(p.ticker) && vistos.add(p.ticker));
  const porClave = {};
  conSenal.forEach((p) => (porClave[p.senal.clave] ||= []).push(p));
  const cuenta = {}; d.posiciones.forEach((p) => { if (p.ind?.fecha) cuenta[p.ind.fecha] = (cuenta[p.ind.fecha] || 0) + 1; });
  const fechaInd = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0];

  const senales = prio.filter((k) => porClave[k]).map((k) => `
    <div class="sen" style="--c:var(--s-${k})">
      <div class="sen-h"><i></i>${esc(SENAL[k])} <span class="mut">(${porClave[k].length})</span></div>
      ${porClave[k].map((p) => `<div class="sen-i"><b>${esc(p.ticker)}</b> <span class="mut">${esc(p.clasif?.emisor || "")}</span>
        ${p.senal.todas.map((t) => `<div class="nota">${t.clave !== k ? esc(t.nombre) + ": " : ""}${esc(t.regla)}</div>`).join("")}</div>`).join("")}
    </div>`).join("") || `<p class="mut">Hoy ninguna regla se dispara en tus posiciones. Eso también es información: no hay nada que hacer fuera de tu aporte normal.</p>`;

  const P = { dia: ["dia", "Día"], semana: ["semana", "Semana"], mes: ["mes", "Mes"], tres_meses: ["tres_meses", "3 meses"] };
  const mv = d.movimientos?.[st.periodo] || { suben: [], bajan: [] };
  const fila = (x) => `<div class="mv"><b>${esc(x.ticker)}</b><span class="num ${cls(x.var)}">${pct(x.var)}</span></div>`;
  const movs = `
    <div class="seg">${Object.entries(P).map(([k, [, l]]) => `<button data-periodo="${k}" class="${st.periodo === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="dos"><div><div class="nota">Más subieron</div>${mv.suben.map(fila).join("") || '<p class="nota">ninguna</p>'}</div>
    <div><div class="nota">Más bajaron</div>${mv.bajan.map(fila).join("") || '<p class="nota">ninguna</p>'}</div></div>
    <p class="nota">En dólares. Cedears: precio del activo en EE.UU. Resto: precio local ÷ MEP. Bonos, ONs y FCI van a tener variaciones a medida que se junte historia diaria.</p>`;

  const pesos = {};
  d.posiciones.forEach((p) => { if (p.v_actual != null) pesos[p.funcion] = (pesos[p.funcion] || 0) + p.v_actual; });
  const rep = reparto(pesos, d.objetivo, st.aporte || 0);
  const nombres = d.funciones || {};
  const filasAporte = Object.entries(rep).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([f, v]) => {
    const cands = (d.candidatos_aporte?.[f] || []);
    const verdes = cands.filter((c) => c.senal === "a_mirar" || c.senal === "barata");
    const txt = !cands.length ? "No tenés instrumentos de esta función: hay que elegir uno."
      : verdes.length ? "Prioridad: " + verdes.map((c) => `<b>${esc(c.ticker)}</b> (${esc(SENAL[c.senal])})`).join(", ") + (cands.length > verdes.length ? ` · o ${cands.filter((c) => !verdes.includes(c)).slice(0, 3).map((c) => esc(c.ticker)).join(", ")}` : "")
      : "Sin señal verde. Opciones neutrales: " + cands.slice(0, 4).map((c) => esc(c.ticker)).join(", ");
    return `<div class="ap"><div><b>${esc(nombres[f] || f)}</b><div class="nota">${txt}</div></div><b class="num">${ars(v)}</b></div>`;
  }).join("");
  const sumaObj = Math.round(Object.values(d.objetivo).reduce((a, b) => a + b, 0) * 10) / 10;

  // --- con cuánto partí y cuánto tengo (mismas posiciones en las dos puntas) ---
  const comp = d.posiciones.filter((p) => p.real_usd && p.v_actual != null && p.v_inicial != null);
  const puseUsd = comp.reduce((s, p) => s + p.real_usd.costo_usd - p.real_usd.ventas_usd, 0);
  const tengoUsd = comp.reduce((s, p) => s + p.real_usd.valor_usd, 0);
  const puseArs = comp.reduce((s, p) => s + p.v_inicial, 0);
  const tengoArs = comp.reduce((s, p) => s + p.v_actual, 0);
  const desde = d.operaciones.map((o) => o.fecha).filter(Boolean).sort()[0];
  const excl = d.posiciones.filter((p) => !comp.includes(p)).map((p) => p.ticker);
  const meses = desde ? Math.max(1, Math.round((Date.parse(d.corrida.id) - Date.parse(desde)) / (30.44 * 864e5))) : null;
  const balance = `
  <section class="card hero">
    <div class="mut">Desde que empezaste (${fechaCorta(desde)}/${desde?.slice(0, 4)}${meses ? `, hace ${meses} meses` : ""})</div>
    <div class="dos" style="margin-top:8px">
      <div><div class="nota">Pusiste</div><div class="v num" style="font-size:20px;font-weight:700">${usd(puseUsd)}</div><div class="nota num">${ars(puseArs)}</div></div>
      <div><div class="nota">Hoy tenés</div><div class="v num" style="font-size:20px;font-weight:700">${usd(tengoUsd)}</div><div class="nota num">${ars(tengoArs)}</div></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="l">Ganaste en dólares</div><div class="v num ${cls(tengoUsd - puseUsd)}">${usd(tengoUsd - puseUsd)}</div><div class="s">${pct((tengoUsd / puseUsd - 1) * 100)}</div></div>
      <div class="kpi"><div class="l">Ganaste en pesos</div><div class="v num ${cls(tengoArs - puseArs)}">${ars(tengoArs - puseArs)}</div><div class="s">${pct((tengoArs / puseArs - 1) * 100)}</div></div>
    </div>
    <p class="nota">"Pusiste" en dólares = cada compra pasada al MEP del día en que la hiciste (lo que realmente te costó en dólares). En pesos la ganancia se ve más grande porque incluye la suba del dólar.${excl.length ? ` No incluye ${excl.map(esc).join(", ")} (sin precio o sin historial).` : ""}</p>
  </section>`;

  // --- cómo está cada cosa ---
  const uniq = []; const vis = new Set();
  d.posiciones.forEach((p) => { if (!vis.has(p.ticker) && p.diag) { vis.add(p.ticker); uniq.push(p); } });
  const gpct = (p) => p.real_usd?.ganancia_pct;
  const li = (p, txt, extra = "") => `<button class="li" data-ver="${esc(p.ticker)}"><span><b>${esc(p.ticker)}</b> <span class="mut">${esc(p.clasif?.emisor || "")}</span>${extra}<br><span class="nota">${txt}</span></span><span class="chev">›</span></button>`;
  const oport = uniq.filter((p) => p.diag.momento === "oportunidad");
  const caros = uniq.filter((p) => p.diag.momento === "caro");
  const bien = uniq.filter((p) => p.diag.resultado === "bien").sort((a, b) => gpct(b) - gpct(a));
  const mal = uniq.filter((p) => p.diag.resultado === "mal").sort((a, b) => gpct(a) - gpct(b));
  const bloque = (titulo, icono, color, items, render) => items.length ? `
    <div class="bl" style="--c:${color}"><div class="bl-h">${icono} ${titulo} <span class="mut">(${items.length})</span></div>${items.map(render).join("")}</div>` : "";
  const lectura = `
  <section class="card"><h2 class="h">Cómo está cada cosa</h2>
    <p class="nota">Tocá cualquiera para ver su gráfico. ${esc(d.reglas?.leyenda || "")}.</p>
    ${bloque("Para sumar: buen momento de precio", "💡", "var(--s-a_mirar)", oport, (p) => li(p, esc(p.diag.a_favor.join(" · "))))}
    ${bloque("Caro para sumar ahora", "⏸️", "var(--s-esperar)", caros, (p) => li(p, esc(p.diag.en_contra.join(" · "))))}
    ${bloque("Te está yendo bien", "✅", "var(--pos)", bien, (p) => li(p, `${pct(gpct(p))} en dólares desde que compraste`))}
    ${bloque("Te está yendo mal", "⚠️", "var(--neg)", mal, (p) => li(p, `${pct(gpct(p))} en dólares desde que compraste${p.diag.momento === "oportunidad" ? " · pero hoy es buen momento de precio" : ""}`))}
    <p class="nota">Bien/mal: ganancia real en USD de ±${d.reglas?.diagnostico?.va_bien_min ?? 5}% o más. Buen momento: señal verde, o RSI bajo ${d.reglas?.diagnostico?.rsi_bajo ?? 35} con precio bajo su media de 200 ruedas, o P/E ≤ ${String(d.reglas?.diagnostico?.pe_barato_vs_sector ?? 0.75).replace(".", ",")}× su sector. Caro: RSI arriba de ${d.reglas?.diagnostico?.rsi_alto ?? 70}, más de ${d.reglas?.diagnostico?.lejos_media_max ?? 15}% sobre su media, o señal Esperar/Cara/Tomar ganancia. ONs, bonos y FCI se suman cuando junten historia.</p>
  </section>`;

  return balance + lectura + `
  <section class="card"><h2 class="h">Señales en tus posiciones</h2>
    <p class="nota">Datos al cierre del ${fechaCorta(fechaInd)}. ${esc(leyenda)}.</p>${senales}</section>
  <section class="card"><h2 class="h">Qué se movió</h2>${movs}</section>
  <section class="card"><h2 class="h">Con tu próximo aporte</h2>
    <label for="in-aporte">Monto en pesos</label>
    <input id="in-aporte" inputmode="numeric" placeholder="4.000.000" value="${st.aporte ? nf(0).format(st.aporte) : ""}">
    <div id="aporte-out">${st.aporte ? filasAporte : '<p class="nota">Escribí un monto y te muestro cómo repartirlo.</p>'}</div>
    <p class="nota">Va primero a lo que está más lejos de tu objetivo y nada a lo que ya sobra. Dentro de cada función prioriza lo que tiene señal verde.${sumaObj !== 100 ? ` Ojo: tu objetivo suma ${sumaObj}%, no 100%.` : ""}</p>
  </section>`;
}

// ---------- vistas ----------
function renderEstado() {
  const el = document.getElementById("estado");
  const d = st.data;
  if (!d) { el.innerHTML = st.error ? `<span class="dot viejo">${esc(st.error === "falta_clave" ? "Cargá tu clave en Ajustes" : st.error)}</span>` : "Cargando…"; return; }
  const viejo = diasDesde(d.corrida.fecha) > 3;
  const ultBol = d.brokers?.balanz?.ultimo_boleto;
  el.innerHTML = `
    <span class="dot ${viejo ? "viejo" : "ok"}">Datos ${esc(cuando(d.corrida.fecha))}${viejo ? " · sin actualizar hace " + diasDesde(d.corrida.fecha) + " días" : ""}</span>
    <span>Balanz: ${ultBol ? "último boleto " + fechaCorta(ultBol) : "por historial"}</span>
    ${st.error && st.error !== "falta_clave" ? `<span class="neg">${esc(st.error)}</span>` : ""}`;
}

function vistaCartera() {
  const d = st.data;
  if (!d) return `<div class="vacio">${st.error === "falta_clave" ? "Cargá tu clave de ingreso en <b>Ajustes</b> para ver tu cartera." : "Cargando…"}</div>`;
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
    ${d.liquidez ? `<p class="nota">Más ${ars(d.liquidez.total_ars)} sin invertir en Balanz → <b>${ars(T.ars + d.liquidez.total_ars)}</b>. Balanz mostraba ${ars(d.liquidez.total_balanz_ars)} el ${fechaCorta(d.liquidez.fecha)}: la diferencia chica es porque acá se valúa con precios de cierre y el MEP de ArgentinaDatos.</p>` : ""}
    ${d.posiciones.filter((p) => (p.precio_fuente || "").startsWith("observado")).map((p) => `<p class="nota">${esc(p.ticker)}: ${esc(p.precio_fuente)}.</p>`).join("")}
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
    return `<div class="pos-item" data-ver-item="${esc(p.ticker)}">
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
  <p class="nota">Ganancia por posición: en dólares reales, con cada compra pasada al MEP de su fecha. Precios: ${esc(d.fuentes?.precios || "")}. La línea de color es la señal de cada posición (detalle en la pestaña Hoy).</p>`;

  return hero + al + energia + posiciones;
}

const proximamente = (n, t) => `<div class="card vacio"><b>${t}</b><br>Llega en la etapa ${n}.</div>`;

function vistaAjustes() {
  const tiene = !!LS.get("kd", "");
  return `
  <section class="card">
    <h2 class="h">Clave de ingreso</h2>
    <p class="nota">Tus datos se publican cifrados. Con tu clave la app los abre en este dispositivo. La clave no viaja a ningún lado: se usa acá para descifrar y queda guardada en este celular.</p>
    ${tiene ? '<p class="pos">✓ Este dispositivo ya tiene la clave cargada.</p>' : ""}
    <label for="in-clave">Clave (formato XXXX-XXXX-XXXX-XXXX)</label>
    <input id="in-clave" type="password" autocomplete="current-password" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">
    <div class="row" style="margin-top:12px">
      ${tiene ? '<button id="btn-borrar" class="ghost">Olvidar la clave en este dispositivo</button>' : ""}
      <button id="btn-guardar">Entrar</button>
    </div>
    <p id="msg-ajustes" class="nota"></p>
  </section>
  <section class="card"><b>Si perdés la clave</b><p class="nota">Pedile a Claude una nueva: genera otra y la anterior deja de funcionar.</p></section>`;
}

function render() {
  renderEstado();
  const v = document.getElementById("vista");
  v.innerHTML = st.tab === "hoy" ? vistaHoy()
    : st.tab === "cartera" ? vistaCartera()
    : st.tab === "grafico" ? vistaGrafico()
    : st.tab === "falta" ? vistaFalta()
    : vistaAjustes();
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === st.tab));
  if (st.tab === "grafico") dibujarGrafico();
}

// ---------- eventos ----------
document.addEventListener("click", async (e) => {
  const it = e.target.closest("[data-ver-item]");
  if (it) { st.ticker = it.dataset.verItem; LS.set("ticker", st.ticker); st.tab = "grafico"; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) { st.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }
  else if (b.dataset.ver) { st.ticker = b.dataset.ver; LS.set("ticker", st.ticker); st.tab = "grafico"; render(); window.scrollTo(0, 0); }
  else if (b.dataset.periodo) { st.periodo = b.dataset.periodo; render(); }
  else if (b.dataset.agrupar) { st.agrupar = b.dataset.agrupar; LS.set("agrupar", st.agrupar); render(); }
  else if (b.id === "btn-guardar") {
    const msg = document.getElementById("msg-ajustes");
    msg.textContent = "Verificando…";
    try {
      LS.set("kd", await derivarClave(document.getElementById("in-clave").value));
      st.error = null; await cargar();
      if (!st.error) { st.tab = "hoy"; render(); }
      else msg.textContent = st.error;
    } catch (err) { msg.textContent = String(err.message || err); }
  }
  else if (b.id === "btn-borrar") { LS.set("kd", ""); localStorage.removeItem("cartera_cache"); st.data = null; render(); }
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

document.addEventListener("change", (e) => {
  if (e.target.id === "sel-ticker") { st.ticker = e.target.value; LS.set("ticker", st.ticker); render(); return; }
  if (e.target.id === "in-aporte") {
    st.aporte = Number(e.target.value.replace(/[^0-9]/g, "")) || 0; LS.set("aporte", st.aporte); render();
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") cargar(); });
cargar();
