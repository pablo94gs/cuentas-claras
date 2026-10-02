/* Cuentas Claras — control de deudas, ingresos y pagos mes a mes.
 * Todo vive en localStorage de este navegador: no hay servidor. */
'use strict';

const CLAVE = 'cuentasclaras.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ── Estado ─────────────────────────────────────────────────────────────────
const VACIO = () => ({ deudas: [], pagos: [], ingresos: [], gastos: [], extras: [] });
let datos = cargar();
let pestana = 'resumen';
let mesExtras = mesDe(new Date());
const abiertos = new Set();          // deudas con la lista de pagos desplegada

function cargar() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE));
    if (d && Array.isArray(d.deudas)) return Object.assign(VACIO(), d);
  } catch (e) { /* almacenamiento bloqueado o dañado */ }
  return VACIO();
}
function guardar(desdeNube = false) {
  try { localStorage.setItem(CLAVE, JSON.stringify(datos)); }
  catch (e) { avisar('No se pudo guardar en este navegador'); }
  // Con la sesión iniciada, cada cambio se sube a la cuenta (nube.js).
  if (!desdeNube && window.alGuardar) window.alGuardar(datos);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ── Formatos y fechas ──────────────────────────────────────────────────────
const fmtD = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dinero = v => fmtD.format(Math.round((+v || 0) * 100) / 100);
const dineroCorto = v => {
  const a = Math.abs(v);
  if (a >= 10000) return '$' + Math.round(v / 1000) + ' mil';
  if (a >= 1000) return '$' + (v / 1000).toFixed(1).replace('.', ',') + ' mil';
  return '$' + Math.round(v);
};
const pct = v => (isFinite(v) ? Math.round(v * 100) : 0) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = v => Math.round(v * 100) / 100;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function mesDe(fecha) { return fecha.getFullYear() + '-' + String(fecha.getMonth() + 1).padStart(2, '0'); }
function hoyISO() { const h = new Date(); return mesDe(h) + '-' + String(h.getDate()).padStart(2, '0'); }
function sumarMes(mk, n) { const [a, m] = mk.split('-').map(Number); return mesDe(new Date(a, m - 1 + n, 1)); }
function nombreMes(mk, corto = false) {
  const [a, m] = mk.split('-').map(Number);
  return corto ? MESES[m - 1].slice(0, 3) + ' ' + String(a).slice(2) : MESES[m - 1] + ' ' + a;
}
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
const mesActual = () => mesDe(new Date());
const diasDelMes = mk => { const [a, m] = mk.split('-').map(Number); return new Date(a, m, 0).getDate(); };

const TIPOS = { banco: 'Banco', tarjeta: 'Tarjeta', local: 'Local comercial', persona: 'Persona', otro: 'Otro' };

// ── Cálculos ───────────────────────────────────────────────────────────────
const pagosDe = id => datos.pagos.filter(p => p.deudaId === id);
const pagadoEnApp = (d, hastaMes) => pagosDe(d.id)
  .filter(p => !hastaMes || p.fecha.slice(0, 7) <= hastaMes)
  .reduce((s, p) => s + p.monto, 0);
const saldo = (d, hastaMes) => Math.max(0, r2(d.total - (d.pagadoAntes || 0) - pagadoEnApp(d, hastaMes)));
const pagadoTotal = d => Math.min(d.total, (d.pagadoAntes || 0) + pagadoEnApp(d));
const activas = () => datos.deudas.filter(d => saldo(d) > 0);
const pagosMes = (mk, id) => datos.pagos
  .filter(p => p.fecha.slice(0, 7) === mk && (!id || p.deudaId === id))
  .reduce((s, p) => s + p.monto, 0);

function ingresosMes(mk) {
  return datos.ingresos.filter(i => !i.desde || i.desde <= mk).reduce((s, i) => s + i.monto, 0)
    + datos.extras.filter(e => e.clase === 'ingreso' && e.mes === mk).reduce((s, e) => s + e.monto, 0);
}
function gastosMes(mk, soloEsenciales = false) {
  return datos.gastos.filter(g => (!g.desde || g.desde <= mk) && (!soloEsenciales || g.esencial))
    .reduce((s, g) => s + g.monto, 0)
    + datos.extras.filter(e => e.clase === 'gasto' && e.mes === mk && (!soloEsenciales || e.esencial))
      .reduce((s, e) => s + e.monto, 0);
}

/* Estado de la cuota de este mes para una deuda. */
function estadoMes(d) {
  const mk = mesActual();
  const s = saldo(d);
  if (s <= 0) return { clase: 'bien', texto: 'Deuda pagada por completo', falta: 0 };
  if (!d.cuota) return { clase: 'atencion', texto: 'Sin cuota mensual definida', falta: 0 };
  const pagado = pagosMes(mk, d.id);
  // La cuota de este mes ya incluye lo que se pagó este mes, así que el saldo
  // a comparar es el de antes de esos pagos.
  const exigible = Math.min(d.cuota, s + pagado);
  const falta = r2(Math.max(0, exigible - pagado));
  if (falta <= 0) return { clase: 'bien', texto: 'Cuota de ' + nombreMes(mk) + ' pagada', falta: 0 };
  const hoy = new Date().getDate();
  const dia = Math.min(d.diaPago || 1, diasDelMes(mk));
  if (hoy > dia) return { clase: 'alerta', texto: `Atrasada: faltan ${dinero(falta)} (vencía el día ${dia})`, falta };
  if (dia - hoy <= 5) return { clase: 'atencion', texto: `Vence ${dia === hoy ? 'hoy' : 'el día ' + dia}: faltan ${dinero(falta)}`, falta };
  return { clase: 'idea', texto: `Pendiente ${dinero(falta)} hasta el día ${dia}`, falta };
}

/* Simula mes a mes cuánto falta para terminar de pagar.
 * rodar=true: lo que se libera al terminar una deuda (y el extra) se suma a la
 * siguiente en 'orden' — el método bola de nieve / avalancha. */
function simular(deudas, { extra = 0, orden = null, rodar = false } = {}) {
  const ds = deudas.map(d => ({ id: d.id, s: saldo(d), c: d.cuota || 0 })).filter(d => d.s > 0);
  const serie = [];
  const fin = {};
  if (!ds.length) return { meses: 0, serie, fin };
  const presupuesto = ds.reduce((t, d) => t + d.c, 0) + extra;
  if (presupuesto <= 0) return { meses: null, serie, fin };
  const ord = orden ? orden.map(id => ds.find(d => d.id === id)).filter(Boolean) : ds;
  let mes = 0;
  while (ds.some(d => d.s > 0.005) && mes < 600) {
    mes++;
    let gastado = 0;
    for (const d of ds) {
      if (d.s <= 0) continue;
      const p = Math.min(d.c, d.s); d.s -= p; gastado += p;
    }
    if (rodar) {
      let resto = presupuesto - gastado;
      for (const d of ord) {
        if (resto <= 0) break;
        if (d.s <= 0) continue;
        const p = Math.min(resto, d.s); d.s -= p; resto -= p;
      }
    }
    for (const d of ds) if (d.s <= 0.005 && !fin[d.id]) { d.s = 0; fin[d.id] = mes; }
    serie.push(ds.reduce((t, d) => t + d.s, 0));
    if (!rodar && gastado <= 0) return { meses: null, serie, fin };
  }
  return { meses: mes >= 600 ? null : mes, serie, fin };
}

/* Abono extra sugerido: la mitad de lo que queda libre, redondeado a $10. */
const extraSugerido = libre => (libre > 0 ? Math.max(10, Math.round(libre * 0.5 / 10) * 10) : 0);

/* Orden sugerido: avalancha (mayor interés primero) si se conocen las tasas;
 * si no, bola de nieve (saldo más chico primero). */
function estrategia() {
  const act = activas();
  const conTasa = act.filter(d => d.tasa > 0).length;
  if (act.length > 1 && conTasa >= Math.ceil(act.length / 2)) {
    const t = d => (d.tasa > 0 ? d.tasa : (d.tipo === 'tarjeta' || d.tipo === 'local' ? 30 : 15));
    return { nombre: 'avalancha', orden: [...act].sort((a, b) => t(b) - t(a) || saldo(a) - saldo(b)) };
  }
  return { nombre: 'bola de nieve', orden: [...act].sort((a, b) => saldo(a) - saldo(b)) };
}

function resumenMes(mk = mesActual()) {
  const ingresos = ingresosMes(mk);
  const gastos = gastosMes(mk);
  // Cuota del mes de cada deuda: lo que corresponde pagar este mes (contando
  // lo ya pagado, para que no baje al registrar el pago).
  const cuotas = datos.deudas.reduce((s, d) => {
    const pagado = pagosMes(mk, d.id);
    return s + Math.max(pagado, Math.min(d.cuota || 0, saldo(d) + pagado));
  }, 0);
  const deudaTotal = datos.deudas.reduce((s, d) => s + d.total, 0);
  const pendiente = datos.deudas.reduce((s, d) => s + saldo(d), 0);
  return { ingresos, gastos, cuotas, libre: ingresos - gastos - cuotas, deudaTotal, pendiente, pagado: deudaTotal - pendiente };
}

/* Un registro por mes, desde el primer dato hasta hoy (máximo 24 meses). */
function historial() {
  const hoy = mesActual();
  const fechas = [
    ...datos.deudas.map(d => d.inicio), ...datos.pagos.map(p => p.fecha.slice(0, 7)),
    ...datos.extras.map(e => e.mes), ...datos.ingresos.map(i => i.desde), ...datos.gastos.map(g => g.desde),
  ].filter(Boolean).filter(m => m <= hoy).sort();
  let desde = fechas[0] || hoy;
  if (desde < sumarMes(hoy, -23)) desde = sumarMes(hoy, -23);
  const filas = [];
  for (let mk = desde; mk <= hoy; mk = sumarMes(mk, 1)) {
    const existentes = datos.deudas.filter(d => (d.inicio || hoy) <= mk);
    filas.push({
      mes: mk,
      ingresos: ingresosMes(mk),
      gastos: gastosMes(mk),
      pagos: pagosMes(mk),
      saldo: existentes.reduce((s, d) => s + saldo(d, mk), 0),
    });
  }
  return filas;
}

// ── Consejos ───────────────────────────────────────────────────────────────
function consejos() {
  const out = [];
  const add = (nivel, titulo, texto) => out.push({ nivel, titulo, texto });
  const mk = mesActual();
  const r = resumenMes(mk);
  const act = activas();

  if (!datos.deudas.length && !datos.ingresos.length) {
    add('idea', 'Empieza registrando tus datos',
      'Agrega tus ingresos mensuales en «Ingresos y gastos» y cada deuda en «Deudas». Con eso te indico cómo vas mes a mes.');
    return out;
  }
  if (datos.deudas.length && !r.ingresos) {
    add('atencion', 'Registra tus ingresos',
      'Sin ingresos no puedo medir cuánto de tu sueldo se va en deudas ni cuánto te queda libre.');
  }

  // Pagos atrasados o por vencer: lo más urgente.
  for (const d of act) {
    const e = estadoMes(d);
    if (e.clase === 'alerta') {
      add('alerta', `Pago atrasado con ${d.acreedor}`,
        `${e.texto}. Págalo cuanto antes: el atraso genera interés de mora y baja tu calificación en el buró de crédito. Si no puedes, llama a ${d.acreedor} antes de que pase más tiempo y pide un acuerdo de pago.`);
    } else if (e.clase === 'atencion' && e.falta > 0) {
      add('atencion', `Se acerca el pago a ${d.acreedor}`, `${e.texto}. Separa ese dinero ahora para no gastarlo.`);
    }
  }

  // Flujo del mes.
  if (r.ingresos > 0) {
    if (r.libre < 0) {
      const noEsenc = datos.gastos.filter(g => !g.esencial).sort((a, b) => b.monto - a.monto).slice(0, 3);
      add('alerta', `Este mes te faltan ${dinero(-r.libre)}`,
        `Tus ingresos (${dinero(r.ingresos)}) no alcanzan para gastos (${dinero(r.gastos)}) y cuotas (${dinero(r.cuotas)}). ` +
        (noEsenc.length ? `Revisa primero los gastos no esenciales: ${noEsenc.map(g => `${g.nombre} (${dinero(g.monto)})`).join(', ')}. ` : '') +
        'No pidas un préstamo nuevo para pagar otro: pide a tu acreedor ampliar el plazo para bajar la cuota.');
    } else if (r.libre > 0) {
      const abono = Math.min(extraSugerido(r.libre), r.libre);
      add('bien', `Te quedan ${dinero(r.libre)} libres este mes`,
        act.length
          ? `Una buena regla: usa ${dinero(abono)} como abono extra a ${estrategia().orden[0].acreedor} y aparta ${dinero(r.libre - abono)} para un fondo de emergencia.`
          : `No tienes deudas pendientes: ahorra al menos el 20% de tus ingresos (${dinero(r.ingresos * 0.2)}) cada mes.`);
    }

    // Carga de deuda sobre el ingreso.
    if (act.length) {
      const carga = r.cuotas / r.ingresos;
      const tope = r.ingresos * 0.35;
      if (carga > 0.4) {
        add('alerta', `Tus deudas se llevan el ${pct(carga)} de tus ingresos`,
          `Lo sano es no pasar del 30%–35% (unos ${dinero(tope)} al mes en tu caso). Hoy pagas ${dinero(r.cuotas)}. No adquieras deudas nuevas hasta bajar de ese límite.`);
      } else if (carga > 0.3) {
        add('atencion', `Tus deudas se llevan el ${pct(carga)} de tus ingresos`,
          `Estás cerca del límite recomendado (30%–35%). Evita compras a crédito nuevas hasta terminar alguna de tus deudas actuales.`);
      } else {
        add('bien', `Carga de deuda saludable: ${pct(carga)} de tus ingresos`,
          `Estás por debajo del 30% recomendado. Mantén ese margen: te da espacio ante imprevistos.`);
      }
    }
  }

  // Progreso.
  if (r.deudaTotal > 0) {
    const avance = r.pagado / r.deudaTotal;
    const anterior = sumarMes(mk, -1);
    const pagadoAhora = pagosMes(mk), pagadoAntes = pagosMes(anterior);
    let texto = `Llevas pagado ${dinero(r.pagado)} de ${dinero(r.deudaTotal)}: te falta ${dinero(r.pendiente)}.`;
    if (pagadoAntes > 0 || pagadoAhora > 0) {
      texto += ` Este mes van ${dinero(pagadoAhora)} en pagos; en ${nombreMes(anterior)} fueron ${dinero(pagadoAntes)}.`;
    }
    add(avance >= 0.5 ? 'bien' : 'idea', `Has pagado el ${pct(avance)} de tus deudas`, texto);
  }

  for (const d of datos.deudas.filter(d => saldo(d) <= 0)) {
    const pagadaEn = pagosDe(d.id).map(p => p.fecha).sort().pop();
    if (pagadaEn && pagadaEn.slice(0, 7) >= sumarMes(mk, -2) && act.length) {
      add('bien', `¡Terminaste de pagar a ${d.acreedor}!`,
        `No gastes esa cuota de ${dinero(d.cuota)}: súmala al pago de ${estrategia().orden[0].acreedor} y terminarás antes.`);
    }
  }

  // Deudas caras o mal definidas.
  for (const d of act) {
    if (!d.cuota) add('atencion', `Define la cuota de ${d.acreedor}`, 'Sin cuota mensual no puedo calcular cuándo terminas de pagarla.');
    if (d.tasa >= 20) {
      add('alerta', `${d.acreedor} cobra un interés alto (${String(d.tasa).replace('.', ',')}% anual)`,
        'Dale prioridad a esta deuda con cualquier abono extra. Si tienes otra opción con menor interés (cooperativa, préstamo de nómina), puede convenirte pasarla allí.');
    }
  }
  if (act.some(d => d.tipo === 'tarjeta')) {
    add('idea', 'Con la tarjeta, paga más que el mínimo',
      'El pago mínimo casi solo cubre intereses. Paga el total si puedes y evita diferir compras nuevas «con intereses» mientras estés pagando deudas.');
  }
  if (act.some(d => d.tipo === 'local')) {
    add('idea', 'Créditos de almacén: pregunta por el pago anticipado',
      'Los créditos directos de locales comerciales suelen tener intereses altos. Pregunta cuánto te descuentan si pagas por adelantado: a veces conviene abonar al capital.');
  }

  // Fondo de emergencia y regla 50/30/20.
  if (r.ingresos > 0) {
    const esenciales = gastosMes(mk, true) + r.cuotas;
    add('idea', 'Construye un fondo de emergencia',
      `La meta son 3 meses de gastos esenciales y cuotas: unos ${dinero(esenciales * 3)}. Empieza por una meta corta de ${dinero(Math.min(500, esenciales))} para no endeudarte más ante un imprevisto.`);
    const necesidades = (gastosMes(mk, true) + r.cuotas) / r.ingresos;
    if (necesidades > 0.5) {
      add('idea', 'Regla 50/30/20',
        `Lo ideal es que necesidades y deudas no pasen del 50% de tus ingresos, 30% para gustos y 20% para ahorro. Hoy tus necesidades y deudas son el ${pct(necesidades)}.`);
    }
  }

  const peso = { alerta: 0, atencion: 1, bien: 2, idea: 3 };
  return out.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
}

/* Plan para salir de deudas: cuánto falta al ritmo actual y con un extra. */
function plan() {
  const act = activas();
  if (!act.length) return null;
  const r = resumenMes();
  const est = estrategia();
  const base = simular(act);
  const extra = extraSugerido(r.libre);
  const mejor = simular(act, { extra, orden: est.orden.map(d => d.id), rodar: true });
  return { est, base, mejor, extra };
}

// ── Iconos ─────────────────────────────────────────────────────────────────
const ICO = {
  bien: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  atencion: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
  idea: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3A7 7 0 0 0 12 2z"/></svg>',
};
const NIVEL = { bien: 'Bien', atencion: 'Atención', alerta: 'Urgente', idea: 'Consejo' };
const COLOR_ESTADO = { bien: 'var(--bien)', atencion: 'var(--atencion)', alerta: 'var(--alerta)', idea: 'var(--idea)' };

function htmlConsejo(c) {
  return `<div class="consejo ${c.nivel}"><div class="ico">${ICO[c.nivel]}</div><div>
    <div class="nivel">${NIVEL[c.nivel]}</div><h3>${esc(c.titulo)}</h3><p>${esc(c.texto)}</p></div></div>`;
}
function htmlEstado(e) {
  return `<div class="estado-mes" style="color:${COLOR_ESTADO[e.clase]}">${ICO[e.clase]}<span>${esc(e.texto)}</span></div>`;
}
function textoFin(meses) {
  if (meses === null) return 'sin fecha (no hay cuota)';
  if (meses === 0) return 'ya no tienes deudas';
  const mk = sumarMes(mesActual(), meses);
  return `${capital(nombreMes(mk))} · ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
}

// ── Vistas ─────────────────────────────────────────────────────────────────
function vistaResumen() {
  const r = resumenMes();
  const act = activas();
  if (!datos.deudas.length && !datos.ingresos.length) {
    return `<div class="tarjeta vacio">
      <h2>Bienvenido a Cuentas Claras</h2>
      <p>Registra tus ingresos, tus gastos fijos y tus deudas. Te diré cuánto debes, cuándo terminas de pagar y qué te conviene hacer cada mes.</p>
      <div class="acciones" style="justify-content:center">
        <button class="btn" data-accion="nueva-deuda">Agregar una deuda</button>
        <button class="btn sec" data-accion="nuevo-ingreso-fijo">Agregar un ingreso</button>
      </div>
      <p style="margin-top:14px"><button class="btn-texto" data-accion="ejemplo">o mira primero un ejemplo con datos ficticios</button></p>
    </div>`;
  }
  const avance = r.deudaTotal ? r.pagado / r.deudaTotal : 0;
  const fin = simular(act);
  const libreTxt = r.libre >= 0 ? 'Te queda libre' : 'Te falta';
  const libreColor = r.libre >= 0 ? 'var(--bien)' : 'var(--alerta)';
  const top = consejos().slice(0, 3);

  let html = `<div class="cifras">
    <div class="cifra grande">
      <div class="etq">Deuda pendiente total</div>
      <div class="val num">${dinero(r.pendiente)}</div>
      <div class="barra" role="img" aria-label="Pagado ${pct(avance)}"><span style="width:${(avance * 100).toFixed(1)}%"></span></div>
      <div class="det">Pagado ${dinero(r.pagado)} de ${dinero(r.deudaTotal)} (${pct(avance)}) ·
        ${act.length ? 'Libre de deudas: <b>' + textoFin(fin.meses) + '</b> al ritmo actual' : '¡Sin deudas pendientes!'}</div>
    </div>
    <div class="cifra"><div class="etq">Ingresos de ${MESES[new Date().getMonth()]}</div><div class="val num">${dinero(r.ingresos)}</div></div>
    <div class="cifra"><div class="etq">Gastos fijos y extras</div><div class="val num">${dinero(r.gastos)}</div></div>
    <div class="cifra"><div class="etq">Cuotas de deudas</div><div class="val num">${dinero(r.cuotas)}</div>
      <div class="det">${r.ingresos ? pct(r.cuotas / r.ingresos) + ' de tus ingresos' : '&nbsp;'}</div></div>
    <div class="cifra"><div class="etq">${libreTxt}</div><div class="val num" style="color:${libreColor}">${dinero(Math.abs(r.libre))}</div>
      <div class="det">ingresos − gastos − cuotas</div></div>
  </div>`;

  if (act.length) {
    html += `<div class="tarjeta"><h2>Pagos de ${nombreMes(mesActual())}</h2><p class="sub">Toca «Pagar» cuando hagas el pago para llevar la cuenta.</p>
      <ul class="lista">${act.map(d => {
        const e = estadoMes(d);
        return `<li><div><b>${esc(d.acreedor)}</b> <span class="num" style="color:var(--tinta-3)">· cuota ${dinero(d.cuota)}</span>${htmlEstado(e).replace('margin:2px 0 10px', '')}</div>
          <div class="lado">${e.falta > 0 ? `<button class="btn chico" data-accion="pagar" data-id="${d.id}">Pagar</button>` : ''}</div></li>`;
      }).join('')}</ul></div>`;
  }

  if (top.length) {
    html += `<div class="seccion-tit"><h2>Lo más importante ahora</h2><button class="btn-texto" data-ir="consejos">Ver todos los consejos →</button></div>
      ${top.map(htmlConsejo).join('')}`;
  }

  if (datos.deudas.length) {
    html += `<div class="tarjeta" style="margin-top:14px"><h2>Cómo baja tu deuda</h2>
      <p class="sub">Saldo pendiente al cierre de cada mes y, en línea punteada, cómo seguiría si pagas tus cuotas a tiempo.</p>
      <div class="leyenda"><span><i class="linea" style="border-color:var(--serie-1)"></i>Saldo real</span>
        <span><i class="linea punteada" style="border-color:var(--serie-1)"></i>Proyección</span></div>
      <div class="grafico" id="gSaldo"></div></div>`;
  }
  return html;
}

function vistaDeudas() {
  const orden = [...datos.deudas].sort((a, b) => (saldo(a) <= 0) - (saldo(b) <= 0) || saldo(b) - saldo(a));
  let html = `<div class="seccion-tit" style="margin-top:4px"><h2>Tus deudas</h2>
    <button class="btn" data-accion="nueva-deuda">+ Nueva deuda</button></div>`;
  if (!orden.length) {
    return html + `<div class="tarjeta vacio"><p>Aún no registras deudas. Agrega cada préstamo, tarjeta o crédito de almacén por separado.</p>
      <button class="btn" data-accion="nueva-deuda">Agregar la primera</button></div>`;
  }
  html += '<div class="deudas">';
  for (const d of orden) {
    const s = saldo(d);
    const pagado = pagadoTotal(d);
    const av = d.total ? pagado / d.total : 0;
    const meses = d.cuota ? Math.ceil(s / d.cuota) : null;
    const pagos = pagosDe(d.id).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const abierto = abiertos.has(d.id);
    html += `<article class="tarjeta deuda ${s <= 0 ? 'pagada' : ''}">
      <div class="deuda-cab"><div><h3>${esc(d.acreedor)}</h3><span class="chip">${TIPOS[d.tipo] || 'Otro'}</span></div>
        <div class="lado"><button class="btn-texto" data-accion="editar-deuda" data-id="${d.id}">Editar</button></div></div>
      <div class="saldo num">${dinero(s)} <small>por pagar</small></div>
      <div class="barra fina"><span style="width:${(av * 100).toFixed(1)}%"></span></div>
      <div style="font-size:.82rem;color:var(--tinta-2)">Pagado ${dinero(pagado)} de ${dinero(d.total)} (${pct(av)})</div>
      <dl class="datos">
        <dt>Cuota mensual</dt><dd class="num">${d.cuota ? dinero(d.cuota) : '—'}</dd>
        <dt>Día de pago</dt><dd>${d.diaPago || '—'}</dd>
        <dt>Interés anual</dt><dd>${d.tasa ? String(d.tasa).replace('.', ',') + '%' : 'No indicado'}</dd>
        <dt>Terminas en</dt><dd>${s <= 0 ? '¡Pagada!' : meses ? capital(nombreMes(sumarMes(mesActual(), meses), true)) + ` (${meses} m)` : '—'}</dd>
      </dl>
      ${htmlEstado(estadoMes(d))}
      <div class="pie">
        ${s > 0 ? `<button class="btn chico" data-accion="pagar" data-id="${d.id}">Registrar pago</button>` : ''}
        <button class="btn chico sec" data-accion="ver-pagos" data-id="${d.id}">${abierto ? 'Ocultar' : 'Ver'} pagos (${pagos.length})</button>
        <button class="btn-texto" data-accion="borrar-deuda" data-id="${d.id}" style="margin-left:auto">Eliminar</button>
      </div>
      ${abierto ? (pagos.length ? `<ul class="pagos-lista">${pagos.map(p => `<li>
          <div><span class="num">${p.fecha.split('-').reverse().join('/')}</span>${p.nota ? `<div class="nota">${esc(p.nota)}</div>` : ''}</div>
          <div class="lado"><b class="num">${dinero(p.monto)}</b><button class="btn-texto" data-accion="borrar-pago" data-id="${p.id}" aria-label="Eliminar pago">✕</button></div></li>`).join('')}</ul>`
        : '<p class="sub" style="margin:10px 0 0">Todavía no hay pagos registrados.</p>') : ''}
    </article>`;
  }
  return html + '</div>';
}

function vistaDinero() {
  const lista = (items, tipo) => items.length
    ? `<ul class="lista">${items.map(i => `<li><div>${esc(i.nombre)}${tipo === 'gasto' && !i.esencial ? ' <span class="chip">No esencial</span>' : ''}</div>
        <div class="lado"><span class="monto num">${dinero(i.monto)}</span>
        <button class="btn-texto" data-accion="borrar-${tipo}" data-id="${i.id}" aria-label="Eliminar">✕</button></div></li>`).join('')}</ul>`
    : '<p class="sub">Nada registrado todavía.</p>';
  const totI = datos.ingresos.reduce((s, i) => s + i.monto, 0);
  const totG = datos.gastos.reduce((s, i) => s + i.monto, 0);
  const extras = datos.extras.filter(e => e.mes === mesExtras);
  return `<div class="dos-col" style="margin-top:4px">
    <div class="tarjeta"><div class="seccion-tit" style="margin-top:0"><h2>Ingresos mensuales</h2>
      <button class="btn chico" data-accion="nuevo-ingreso-fijo">+ Agregar</button></div>
      <p class="sub">Lo que recibes todos los meses: sueldo, arriendos, negocio…</p>
      ${lista(datos.ingresos, 'ingreso')}
      ${datos.ingresos.length ? `<div class="total-fila"><span>Total al mes</span><span class="num">${dinero(totI)}</span></div>` : ''}
    </div>
    <div class="tarjeta"><div class="seccion-tit" style="margin-top:0"><h2>Gastos fijos mensuales</h2>
      <button class="btn chico" data-accion="nuevo-gasto-fijo">+ Agregar</button></div>
      <p class="sub">Sin contar las cuotas de deudas, que ya se suman solas.</p>
      ${lista(datos.gastos, 'gasto')}
      ${datos.gastos.length ? `<div class="total-fila"><span>Total al mes</span><span class="num">${dinero(totG)}</span></div>` : ''}
    </div>
  </div>
  <div class="tarjeta" style="margin-top:14px">
    <div class="seccion-tit" style="margin-top:0"><h2>Ingresos y gastos extra del mes</h2>
      <input type="month" id="mesExtras" value="${mesExtras}" style="width:auto;min-height:38px"></div>
    <p class="sub">Lo que no se repite: un bono, décimo tercero, una reparación, un viaje…</p>
    ${extras.length ? `<ul class="lista">${extras.map(e => `<li><div>${esc(e.nombre)} <span class="chip">${e.clase === 'ingreso' ? 'Ingreso' : 'Gasto'}</span></div>
      <div class="lado"><span class="monto num" style="color:${e.clase === 'ingreso' ? 'var(--bien)' : 'var(--tinta)'}">${e.clase === 'ingreso' ? '+' : '−'}${dinero(e.monto)}</span>
      <button class="btn-texto" data-accion="borrar-extra" data-id="${e.id}" aria-label="Eliminar">✕</button></div></li>`).join('')}</ul>`
      : '<p class="sub">Sin movimientos extra en ' + nombreMes(mesExtras) + '.</p>'}
    <div class="acciones" style="justify-content:flex-start">
      <button class="btn chico" data-accion="nuevo-ingreso-extra">+ Ingreso extra</button>
      <button class="btn chico sec" data-accion="nuevo-gasto-extra">+ Gasto extra</button>
    </div>
  </div>`;
}

function vistaHistorial() {
  const filas = historial();
  if (!datos.deudas.length && !datos.ingresos.length) {
    return '<div class="tarjeta vacio"><p>Cuando registres ingresos, deudas y pagos, aquí verás tu evolución mes a mes.</p></div>';
  }
  const hoy = mesActual();
  return `<div class="tarjeta" style="margin-top:4px"><h2>Ingresos y pagos de deudas por mes</h2>
    <p class="sub">Toca una barra para ver el detalle del mes.</p>
    <div class="leyenda"><span><i style="background:var(--serie-1)"></i>Ingresos</span>
      <span><i style="background:var(--serie-2)"></i>Pagos de deudas</span></div>
    <div class="grafico" id="gMeses"></div></div>
  <div class="tarjeta"><h2>Detalle mes a mes</h2>
    <div class="tabla-envoltura"><table>
      <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Pagos deudas</th><th>% del ingreso</th><th>Debes al cierre</th></tr></thead>
      <tbody>${[...filas].reverse().map(f => `<tr class="${f.mes === hoy ? 'actual' : ''}">
        <td>${capital(nombreMes(f.mes))}${f.mes === hoy ? ' (en curso)' : ''}</td>
        <td class="num">${dinero(f.ingresos)}</td><td class="num">${dinero(f.gastos)}</td>
        <td class="num">${dinero(f.pagos)}</td><td class="num">${f.ingresos ? pct(f.pagos / f.ingresos) : '—'}</td>
        <td class="num">${dinero(f.saldo)}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
}

function vistaConsejos() {
  const cs = consejos();
  const p = plan();
  let html = '';
  if (p) {
    const nom = p.est.nombre;
    html += `<div class="tarjeta" style="margin-top:4px"><h2>Tu plan para salir de deudas</h2>
      <p class="sub">Método <b>${nom}</b>: ${nom === 'avalancha'
        ? 'primero la deuda con el interés más alto, porque es la que más te cuesta.'
        : 'primero la deuda más pequeña; terminarla pronto libera su cuota y da impulso.'}
        ${nom === 'bola de nieve' ? 'Si registras el interés de cada deuda, te recomiendo el orden que más ahorra.' : ''}</p>
      <ol class="plan">
        <li>Paga <b>todas</b> las cuotas mínimas a tiempo, siempre.</li>
        ${p.extra > 0 ? `<li>Cada mes abona <b>${dinero(p.extra)}</b> extra a <b>${esc(p.est.orden[0].acreedor)}</b> (la mitad de lo que te queda libre).</li>` :
          '<li>Busca liberar aunque sea $20–$50 al mes recortando gastos no esenciales para abonar extra.</li>'}
        <li>Cuando termines una deuda, suma su cuota al pago de la siguiente: ${p.est.orden.map(d => esc(d.acreedor)).join(' → ')}.</li>
        <li>No abras deudas nuevas hasta terminar este plan.</li>
      </ol>
      <div class="comparar">
        <div><div class="etq">Si sigues igual</div><div class="val">${textoFin(p.base.meses)}</div></div>
        <div class="${p.extra > 0 && p.mejor.meses !== null && p.base.meses !== null && p.mejor.meses < p.base.meses ? 'mejor' : ''}">
          <div class="etq">${p.extra > 0 ? 'Con el plan y ' + dinero(p.extra) + ' extra' : 'Con el plan (sin extra)'}</div>
          <div class="val">${textoFin(p.mejor.meses)}</div>
          ${p.base.meses && p.mejor.meses && p.mejor.meses < p.base.meses ? `<div class="etq">${p.base.meses - p.mejor.meses} ${p.base.meses - p.mejor.meses === 1 ? 'mes' : 'meses'} antes</div>` : ''}
        </div>
      </div></div>`;
  }
  html += `<div class="seccion-tit"><h2>Consejos para ${nombreMes(mesActual())}</h2></div>${cs.map(htmlConsejo).join('')}
    <p class="descargo">Los cálculos son orientativos: restan tus pagos del valor total que registraste y no recalculan intereses.
      Para decisiones grandes (refinanciar, consolidar deudas) confirma los valores exactos con tu banco o acreedor.</p>`;
  return html;
}

// ── Gráficos (SVG a mano) ──────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
function escalaY(max) {
  if (max <= 0) return { tope: 100, paso: 25 };
  const crudo = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(crudo)));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * mag).find(p => p >= crudo);
  return { tope: paso * Math.ceil(max / paso), paso };
}
const tooltip = $('#tooltip');
function mostrarTooltip(x, y, titulo, filas) {
  tooltip.replaceChildren();
  const t = document.createElement('div'); t.className = 't-tit'; t.textContent = titulo; tooltip.append(t);
  for (const [color, nombre, valor, punteada] of filas) {
    const f = document.createElement('div'); f.className = 't-fila';
    const s = document.createElement('span'); const i = document.createElement('i');
    i.style.borderColor = color; if (punteada) i.style.borderTopStyle = 'dashed';
    s.append(i, document.createTextNode(nombre));
    const b = document.createElement('b'); b.textContent = valor;
    f.append(s, b); tooltip.append(f);
  }
  tooltip.hidden = false;
  const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
  let left = x + 14, top = y - h - 10;
  if (left + w > innerWidth - 8) left = x - w - 14;
  if (top < 8) top = y + 14;
  tooltip.style.left = Math.max(8, left) + 'px'; tooltip.style.top = top + 'px';
}
const ocultarTooltip = () => { tooltip.hidden = true; };

function graficoSaldo(cont) {
  const hist = historial().slice(-12);
  const act = activas();
  const proy = simular(act).serie.slice(0, 18);
  const puntos = hist.map(f => ({ mes: f.mes, v: f.saldo, real: true }));
  let mk = mesActual();
  for (const v of proy) { mk = sumarMes(mk, 1); puntos.push({ mes: mk, v, real: false }); }
  if (puntos.length < 2) { cont.innerHTML = '<p class="sub">Necesito al menos dos meses de datos o una cuota para dibujar la tendencia.</p>'; return; }

  const W = Math.max(300, cont.clientWidth), H = 230, ml = 52, mr = 14, mt = 12, mb = 28;
  const iw = W - ml - mr, ih = H - mt - mb;
  const { tope, paso } = escalaY(Math.max(...puntos.map(p => p.v)));
  const X = i => ml + (puntos.length === 1 ? iw / 2 : i * iw / (puntos.length - 1));
  const Y = v => mt + ih - v / tope * ih;
  const nReal = hist.length;
  const ruta = arr => arr.map((p, k) => (k ? 'L' : 'M') + X(p.i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join('');
  const conIdx = puntos.map((p, i) => ({ ...p, i }));
  const real = conIdx.slice(0, nReal), futura = conIdx.slice(nReal - 1);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo pendiente por mes" tabindex="0">`;
  s += '<g class="rejilla">';
  for (let v = 0; v <= tope + 0.001; v += paso) s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}"/>`;
  s += '</g><g class="eje">';
  for (let v = 0; v <= tope + 0.001; v += paso) s += `<text x="${ml - 8}" y="${Y(v) + 4}" text-anchor="end">${dineroCorto(v)}</text>`;
  const cada = Math.ceil(puntos.length / Math.max(2, Math.floor(iw / 62)));
  const sep = iw / (puntos.length - 1);
  conIdx.forEach(p => {
    const esHoy = p.i === nReal - 1;
    if (!esHoy && (p.i % cada !== 0 || Math.abs(p.i - (nReal - 1)) * sep < 46)) return;
    s += `<text x="${X(p.i)}" y="${H - 8}" text-anchor="middle"${esHoy ? ' style="font-weight:700;fill:var(--tinta-2)"' : ''}>${nombreMes(p.mes, true)}</text>`;
  });
  s += `</g><line class="base" x1="${ml}" x2="${W - mr}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  s += `<path d="${ruta(real)}L${X(nReal - 1)} ${Y(0)}L${X(0)} ${Y(0)}Z" fill="var(--serie-1)" opacity=".08"/>`;
  if (futura.length > 1) s += `<path d="${ruta(futura)}" fill="none" stroke="var(--serie-1)" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round"/>`;
  s += `<path d="${ruta(real)}" fill="none" stroke="var(--serie-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  // Etiqueta directa solo en el punto de hoy.
  const hoyP = conIdx[nReal - 1];
  s += `<circle cx="${X(hoyP.i)}" cy="${Y(hoyP.v)}" r="4.5" fill="var(--serie-1)" stroke="var(--superficie)" stroke-width="2"/>`;
  const alFinal = X(hoyP.i) > W - mr - 110;
  s += `<text x="${X(hoyP.i) + (alFinal ? -10 : 10)}" y="${Y(hoyP.v) - 12}" text-anchor="${alFinal ? 'end' : 'start'}" style="font-size:12px;font-weight:700;fill:var(--tinta)">Hoy ${dineroCorto(hoyP.v)}</text>`;
  s += `<line id="gsCruz" y1="${mt}" y2="${mt + ih}" stroke="var(--tinta-3)" stroke-width="1" visibility="hidden"/>`;
  s += `<circle id="gsPunto" r="5" fill="var(--serie-1)" stroke="var(--superficie)" stroke-width="2" visibility="hidden"/>`;
  s += `<rect id="gsCapa" x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  cont.innerHTML = s;

  const svg = cont.querySelector('svg'), cruz = $('#gsCruz', svg), punto = $('#gsPunto', svg);
  let actual = nReal - 1;
  const marcar = (i, cx, cy) => {
    actual = i; const p = conIdx[i];
    cruz.setAttribute('x1', X(i)); cruz.setAttribute('x2', X(i)); cruz.setAttribute('visibility', 'visible');
    punto.setAttribute('cx', X(i)); punto.setAttribute('cy', Y(p.v)); punto.setAttribute('visibility', 'visible');
    const rect = svg.getBoundingClientRect(), k = rect.width / W;
    mostrarTooltip(cx ?? rect.left + X(i) * k, cy ?? rect.top + Y(p.v) * k, capital(nombreMes(p.mes)),
      [['var(--serie-1)', p.real ? 'Saldo pendiente' : 'Proyección', dinero(p.v), !p.real]]);
  };
  const salir = () => { cruz.setAttribute('visibility', 'hidden'); punto.setAttribute('visibility', 'hidden'); ocultarTooltip(); };
  svg.addEventListener('pointermove', e => {
    const rect = svg.getBoundingClientRect(), x = (e.clientX - rect.left) * W / rect.width;
    const i = Math.max(0, Math.min(puntos.length - 1, Math.round((x - ml) / iw * (puntos.length - 1))));
    marcar(i, e.clientX, e.clientY);
  });
  svg.addEventListener('pointerleave', salir);
  svg.addEventListener('focus', () => marcar(actual));
  svg.addEventListener('blur', salir);
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { marcar(Math.min(puntos.length - 1, actual + 1)); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { marcar(Math.max(0, actual - 1)); e.preventDefault(); }
  });
}

function graficoMeses(cont) {
  const filas = historial().slice(-12);
  const W = Math.max(300, cont.clientWidth), H = 240, ml = 52, mr = 10, mt = 12, mb = 28;
  const iw = W - ml - mr, ih = H - mt - mb;
  const { tope, paso } = escalaY(Math.max(1, ...filas.flatMap(f => [f.ingresos, f.pagos])));
  const Y = v => mt + ih - v / tope * ih;
  const banda = iw / filas.length;
  const bw = Math.max(4, Math.min(28, (banda - 14) / 2));
  const barra = (x, v, color) => {
    const h = Math.max(0, Y(0) - Y(v)); if (h <= 0) return '';
    const r = Math.min(4, h, bw / 2), y = Y(v);
    return `<path d="M${x} ${Y(0)}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${Y(0)}Z" fill="${color}"/>`;
  };
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y pagos de deudas por mes">`;
  s += '<g class="rejilla">';
  for (let v = 0; v <= tope + 0.001; v += paso) s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}"/>`;
  s += '</g><g class="eje">';
  for (let v = 0; v <= tope + 0.001; v += paso) s += `<text x="${ml - 8}" y="${Y(v) + 4}" text-anchor="end">${dineroCorto(v)}</text>`;
  const cada = Math.ceil(filas.length / Math.max(2, Math.floor(iw / 52)));
  filas.forEach((f, i) => { if (i % cada === 0 || i === filas.length - 1) s += `<text x="${ml + banda * i + banda / 2}" y="${H - 8}" text-anchor="middle">${nombreMes(f.mes, true)}</text>`; });
  s += '</g>';
  filas.forEach((f, i) => {
    const x0 = ml + banda * i + banda / 2 - bw - 1;
    s += `<g class="grupo" data-i="${i}" tabindex="0">
      <rect x="${ml + banda * i}" y="${mt}" width="${banda}" height="${ih}" fill="transparent" class="fondo-g"/>
      ${barra(x0, f.ingresos, 'var(--serie-1)')}${barra(x0 + bw + 2, f.pagos, 'var(--serie-2)')}</g>`;
  });
  s += `<line class="base" x1="${ml}" x2="${W - mr}" y1="${Y(0)}" y2="${Y(0)}"/></svg>`;
  cont.innerHTML = s;
  const mostrar = (g, cx, cy) => {
    const f = filas[+g.dataset.i];
    $$('.fondo-g', cont).forEach(r => r.setAttribute('fill', 'transparent'));
    g.querySelector('.fondo-g').setAttribute('fill', 'rgba(0,0,0,.04)');
    const rect = g.getBoundingClientRect();
    mostrarTooltip(cx ?? rect.left + rect.width / 2, cy ?? rect.top + 30, capital(nombreMes(f.mes)), [
      ['var(--serie-1)', 'Ingresos', dinero(f.ingresos)],
      ['var(--serie-2)', 'Pagos de deudas', dinero(f.pagos)],
      ['transparent', '% del ingreso', f.ingresos ? pct(f.pagos / f.ingresos) : '—'],
    ]);
  };
  $$('.grupo', cont).forEach(g => {
    g.addEventListener('pointermove', e => mostrar(g, e.clientX, e.clientY));
    g.addEventListener('focus', () => mostrar(g));
    g.addEventListener('pointerleave', () => { g.querySelector('.fondo-g').setAttribute('fill', 'transparent'); ocultarTooltip(); });
    g.addEventListener('blur', ocultarTooltip);
  });
}

// ── Render ─────────────────────────────────────────────────────────────────
const VISTAS = { resumen: vistaResumen, deudas: vistaDeudas, dinero: vistaDinero, historial: vistaHistorial, consejos: vistaConsejos };
function render() {
  ocultarTooltip();
  $('#mesActual').textContent = capital(nombreMes(mesActual()));
  $$('.pestanas button').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.tab === pestana));
    if (b.dataset.tab === pestana) b.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
  $('#vista').innerHTML = VISTAS[pestana]();
  const gs = $('#gSaldo'); if (gs) graficoSaldo(gs);
  const gm = $('#gMeses'); if (gm) graficoMeses(gm);
}
function irA(tab) {
  pestana = tab;
  try { history.replaceState(null, '', '#' + tab); } catch (e) { /* sin historial */ }
  render(); scrollTo({ top: 0 });
}
let tRes; addEventListener('resize', () => { clearTimeout(tRes); tRes = setTimeout(render, 150); });

// ── Avisos y confirmación ──────────────────────────────────────────────────
let tAviso;
function avisar(texto) {
  const a = $('#aviso'); a.textContent = texto; a.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, 2600);
}
function confirmar(titulo, texto, accion) {
  const dlg = $('#dlgConfirmar');
  $('#confTitulo').textContent = titulo; $('#confTexto').textContent = texto;
  $('#confSi').onclick = () => { dlg.close(); accion(); };
  dlg.showModal();
}

// ── Formularios ────────────────────────────────────────────────────────────
let deudaEditando = null, deudaPagando = null, modoMov = null;
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

function abrirDeuda(id) {
  const f = $('#formDeuda'); f.reset();
  deudaEditando = id || null;
  const d = datos.deudas.find(x => x.id === id);
  $('#tituloDeuda').textContent = d ? 'Editar deuda' : 'Nueva deuda';
  f.inicio.value = d?.inicio || mesActual();
  if (d) {
    f.acreedor.value = d.acreedor; f.tipo.value = d.tipo; f.total.value = d.total;
    f.pagadoAntes.value = d.pagadoAntes || 0; f.cuota.value = d.cuota || '';
    f.diaPago.value = d.diaPago || 15; f.tasa.value = d.tasa || '';
  }
  $('#dlgDeuda').showModal();
}
$('#formDeuda').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const d = {
    acreedor: f.acreedor.value.trim(), tipo: f.tipo.value, total: r2(num(f.total.value)),
    pagadoAntes: r2(num(f.pagadoAntes.value)), cuota: r2(num(f.cuota.value)),
    diaPago: Math.min(31, Math.max(1, parseInt(f.diaPago.value, 10) || 15)),
    tasa: f.tasa.value === '' ? null : num(f.tasa.value), inicio: f.inicio.value || mesActual(),
  };
  if (!d.acreedor || d.total <= 0) return;
  if (d.pagadoAntes > d.total) { avisar('Lo ya pagado no puede ser mayor que el total'); return; }
  if (deudaEditando) Object.assign(datos.deudas.find(x => x.id === deudaEditando), d);
  else datos.deudas.push({ id: uid(), creada: hoyISO(), ...d });
  guardar(); $('#dlgDeuda').close();
  avisar(deudaEditando ? 'Deuda actualizada' : 'Deuda agregada');
  render();
});

function abrirPago(id) {
  const d = datos.deudas.find(x => x.id === id); if (!d) return;
  deudaPagando = id;
  const f = $('#formPago'); f.reset();
  const e = estadoMes(d);
  f.monto.value = (e.falta > 0 ? e.falta : Math.min(d.cuota || saldo(d), saldo(d))).toFixed(2);
  f.fecha.value = hoyISO();
  $('#pagoA').textContent = `${d.acreedor} · saldo ${dinero(saldo(d))}`;
  $('#dlgPago').showModal();
}
$('#formPago').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, d = datos.deudas.find(x => x.id === deudaPagando); if (!d) return;
  const monto = r2(num(f.monto.value));
  if (monto <= 0 || !f.fecha.value) return;
  const s = saldo(d);
  if (monto > s + 0.005) { avisar(`El pago supera el saldo (${dinero(s)})`); return; }
  datos.pagos.push({ id: uid(), deudaId: d.id, monto, fecha: f.fecha.value, nota: f.nota.value.trim() });
  guardar(); $('#dlgPago').close();
  avisar(saldo(d) <= 0 ? `¡Terminaste de pagar a ${d.acreedor}!` : 'Pago registrado');
  render();
});

function abrirMov(modo) {
  modoMov = modo;
  const f = $('#formMov'); f.reset();
  const [clase, frec] = modo.split('-');
  $('#tituloMov').textContent = (clase === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo gasto') + (frec === 'fijo' ? ' mensual' : ' extra');
  $('#lblFechaMov').firstChild.textContent = frec === 'fijo' ? 'Desde (mes)' : 'Mes';
  f.mes.value = frec === 'fijo' ? mesActual() : mesExtras;
  $('#lblEsencial').hidden = clase !== 'gasto';
  f.nombre.placeholder = clase === 'ingreso' ? (frec === 'fijo' ? 'Ej.: Sueldo' : 'Ej.: Bono, décimo tercero') : (frec === 'fijo' ? 'Ej.: Arriendo, comida, internet' : 'Ej.: Reparación del carro');
  $('#dlgMov').showModal();
}
$('#formMov').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, [clase, frec] = modoMov.split('-');
  const item = { id: uid(), nombre: f.nombre.value.trim(), monto: r2(num(f.monto.value)) };
  if (!item.nombre || item.monto <= 0) return;
  const mes = f.mes.value || mesActual();
  if (clase === 'gasto') item.esencial = f.esencial.checked;
  if (frec === 'fijo') { item.desde = mes; (clase === 'ingreso' ? datos.ingresos : datos.gastos).push(item); }
  else { datos.extras.push({ ...item, clase, mes }); mesExtras = mes; }
  guardar(); $('#dlgMov').close(); avisar('Guardado'); render();
});

$$('[data-cerrar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

// ── Acciones de la vista ───────────────────────────────────────────────────
document.addEventListener('click', e => {
  const tab = e.target.closest('.pestanas button'); if (tab) return irA(tab.dataset.tab);
  const ir = e.target.closest('[data-ir]'); if (ir) return irA(ir.dataset.ir);
  const b = e.target.closest('[data-accion]'); if (!b) return;
  const id = b.dataset.id;
  const acc = b.dataset.accion;
  if (acc === 'nueva-deuda') abrirDeuda();
  else if (acc === 'editar-deuda') abrirDeuda(id);
  else if (acc === 'pagar') abrirPago(id);
  else if (acc === 'ver-pagos') { abiertos.has(id) ? abiertos.delete(id) : abiertos.add(id); render(); }
  else if (acc.startsWith('nuevo-')) abrirMov(acc.slice(6));
  else if (acc === 'ejemplo') cargarEjemplo();
  else if (acc === 'borrar-deuda') {
    const d = datos.deudas.find(x => x.id === id);
    confirmar('Eliminar deuda', `Se eliminará «${d.acreedor}» con sus ${pagosDe(id).length} pagos registrados.`, () => {
      datos.deudas = datos.deudas.filter(x => x.id !== id);
      datos.pagos = datos.pagos.filter(p => p.deudaId !== id);
      guardar(); render(); avisar('Deuda eliminada');
    });
  } else if (acc === 'borrar-pago') {
    const p = datos.pagos.find(x => x.id === id);
    confirmar('Eliminar pago', `Pago de ${dinero(p.monto)} del ${p.fecha.split('-').reverse().join('/')}.`, () => {
      datos.pagos = datos.pagos.filter(x => x.id !== id); guardar(); render();
    });
  } else if (acc.startsWith('borrar-')) {
    const col = { ingreso: 'ingresos', gasto: 'gastos', extra: 'extras' }[acc.slice(7)];
    datos[col] = datos[col].filter(x => x.id !== id); guardar(); render();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'mesExtras' && e.target.value) { mesExtras = e.target.value; render(); }
});

// ── Respaldo ───────────────────────────────────────────────────────────────
$('#btnRespaldo').addEventListener('click', () => $('#dlgRespaldo').showModal());
$('#btnExportar').addEventListener('click', async () => {
  const nombre = `cuentas-claras-${hoyISO()}.json`;
  // Dentro de Claude la página no puede descargar sola: lo ofrece la plataforma.
  const dl = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
  if (dl) {
    try { await dl.save({ filename: nombre, data: JSON.stringify(datos, null, 2) }); avisar('Respaldo descargado'); }
    catch (e) { if (e && e.code !== 'declined') avisar('No se pudo descargar el respaldo'); }
    return;
  }
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#inpImportar').addEventListener('change', async e => {
  const arch = e.target.files[0]; if (!arch) return;
  try {
    const d = JSON.parse(await arch.text());
    if (!d || !Array.isArray(d.deudas) || !Array.isArray(d.pagos)) throw new Error('formato');
    confirmar('Cargar respaldo', `Se reemplazarán tus datos actuales por los del archivo (${d.deudas.length} deudas, ${d.pagos.length} pagos).`, () => {
      datos = Object.assign(VACIO(), d); guardar(); $('#dlgRespaldo').close(); render(); avisar('Respaldo cargado');
    });
  } catch (err) { avisar('El archivo no es un respaldo válido'); }
  e.target.value = '';
});
$('#btnEjemplo').addEventListener('click', () => { $('#dlgRespaldo').close(); cargarEjemplo(); });
$('#btnBorrarTodo').addEventListener('click', () => {
  confirmar('Borrar todos los datos', 'Se eliminarán todas tus deudas, pagos, ingresos y gastos de este equipo (y de tu cuenta, si iniciaste sesión). Descarga un respaldo antes si lo necesitas.', () => {
    datos = VACIO(); guardar(); $('#dlgRespaldo').close(); irA('resumen'); avisar('Datos borrados');
  });
});

function cargarEjemplo() {
  const accion = () => {
    const m = n => sumarMes(mesActual(), n);
    const d1 = uid(), d2 = uid(), d3 = uid();
    datos = VACIO();
    datos.ingresos.push({ id: uid(), nombre: 'Sueldo', monto: 1200, desde: m(-5) });
    datos.gastos.push(
      { id: uid(), nombre: 'Arriendo', monto: 350, esencial: true, desde: m(-5) },
      { id: uid(), nombre: 'Comida y supermercado', monto: 260, esencial: true, desde: m(-5) },
      { id: uid(), nombre: 'Servicios básicos e internet', monto: 70, esencial: true, desde: m(-5) },
      { id: uid(), nombre: 'Salidas y streaming', monto: 60, esencial: false, desde: m(-5) });
    datos.deudas.push(
      { id: d1, acreedor: 'Banco (ejemplo)', tipo: 'banco', total: 4800, pagadoAntes: 0, cuota: 200, diaPago: 10, tasa: 15.6, inicio: m(-5), creada: hoyISO() },
      { id: d2, acreedor: 'Almacén de electrodomésticos (ejemplo)', tipo: 'local', total: 900, pagadoAntes: 0, cuota: 75, diaPago: 20, tasa: 28, inicio: m(-5), creada: hoyISO() },
      { id: d3, acreedor: 'Tarjeta de crédito (ejemplo)', tipo: 'tarjeta', total: 650, pagadoAntes: 0, cuota: 60, diaPago: 25, tasa: 16.5, inicio: m(-3), creada: hoyISO() });
    for (let k = -5; k <= -1; k++) {
      datos.pagos.push({ id: uid(), deudaId: d1, monto: 200, fecha: m(k) + '-09', nota: '' });
      datos.pagos.push({ id: uid(), deudaId: d2, monto: 75, fecha: m(k) + '-19', nota: '' });
      if (k >= -3) datos.pagos.push({ id: uid(), deudaId: d3, monto: 60, fecha: m(k) + '-24', nota: '' });
    }
    datos.extras.push({ id: uid(), clase: 'ingreso', nombre: 'Bono', monto: 300, mes: m(-2) });
    datos.ejemplo = true;
    guardar(); irA('resumen'); avisar('Datos de ejemplo cargados: bórralos desde el botón de respaldo');
  };
  if (datos.deudas.length || datos.ingresos.length) {
    confirmar('Cargar ejemplo', 'Esto reemplaza tus datos actuales por datos ficticios. Descarga un respaldo antes si los necesitas.', accion);
  } else accion();
}

// Puente para nube.js: la sincronización lee y reemplaza los datos por aquí.
window.app = {
  obtener: () => datos,
  tieneDatos: () => !!(datos.deudas.length || datos.ingresos.length || datos.gastos.length || datos.pagos.length),
  esEjemplo: () => !!datos.ejemplo,
  reemplazar(d) { datos = Object.assign(VACIO(), d); guardar(true); render(); },
  avisar,
};

// ── Inicio ─────────────────────────────────────────────────────────────────
const inicial = location.hash.slice(1);
if (VISTAS[inicial]) pestana = inicial;
render();
// Pide al navegador que no borre los datos al liberar espacio: así lo que se
// registra queda guardado y no hay que volver a ingresarlo.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
