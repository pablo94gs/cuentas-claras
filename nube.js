/* Cuenta (correo + clave) y sincronización entre equipos con Firebase.
 * Cada persona tiene un único documento usuarios/{uid} con { json, rev }.
 * Sin configuración o sin internet, la app sigue funcionando solo en este equipo. */
const V = 'https://www.gstatic.com/firebasejs/12.19.0/';
const $ = s => document.querySelector(s);
const app = window.app;

const K_REV = 'cuentasclaras.rev';        // revisión de la cuenta que tiene este equipo
const K_SUCIO = 'cuentasclaras.sucio';    // cambios de este equipo aún sin subir
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
};
let base = Number(ls.get(K_REV)) || 0;
let sucio = ls.get(K_SUCIO) === '1';
const marcarSucio = v => { sucio = v; ls.set(K_SUCIO, v ? '1' : '0'); };
const fijarBase = r => { base = r; ls.set(K_REV, String(r)); };

let fb, auth, db, usuario = null, ref = null, desuscribir = null;
let listo = false, tSubida = null, cola = Promise.resolve(), modo = 'entrar';

async function iniciar() {
  let config;
  try { ({ default: config } = await import('./firebase-config.js')); } catch (e) { return; }
  if (!config || !config.apiKey) return;
  try {
    const [a, au, fs] = await Promise.all([
      import(V + 'firebase-app.js'), import(V + 'firebase-auth.js'), import(V + 'firebase-firestore.js')]);
    fb = { ...a, ...au, ...fs };
  } catch (e) { return; }                       // sin internet: solo local
  const inst = fb.initializeApp(config);
  auth = fb.getAuth(inst);
  try { db = fb.initializeFirestore(inst, { localCache: fb.persistentLocalCache() }); }
  catch (e) { db = fb.getFirestore(inst); }
  $('#btnCuenta').hidden = false;
  fb.onAuthStateChanged(auth, cambioDeSesion);
}

// ── Estado visible ─────────────────────────────────────────────────────────
const hora = () => new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
function estado(t) {
  const el = $('#estadoNube'); el.hidden = !t; el.textContent = t || '';
  $('#cuentaSync').textContent = t ? 'Estado: ' + t.replace(/^☁\s*/, '') : '';
}

// ── Subida: una escritura a la vez, siempre con lo último ──────────────────
function subir() {
  cola = cola.then(async () => {
    if (!usuario || !sucio) return;
    const json = JSON.stringify(app.obtener());
    const rev = Date.now();
    try {
      await fb.setDoc(ref, { json, rev, actualizado: fb.serverTimestamp() });
      fijarBase(rev);
      if (JSON.stringify(app.obtener()) === json) marcarSucio(false);
      estado('☁ Guardado ' + hora());
    } catch (e) { estado('☁ Sin conexión: se guardará al volver'); }
  });
  return cola;
}
window.alGuardar = () => {
  marcarSucio(true);
  if (!usuario || !listo) return;
  estado('☁ Guardando…');
  clearTimeout(tSubida);
  tSubida = setTimeout(subir, 600);
};

// ── Al entrar: decidir entre la cuenta y este equipo ───────────────────────
function preguntar(remoto) {
  return new Promise(res => {
    const local = app.obtener();
    $('#elegirTexto').textContent =
      `En tu cuenta hay ${remoto.deudas.length} deuda(s) y ${remoto.pagos.length} pago(s); ` +
      `este equipo tiene ${local.deudas.length} deuda(s) y ${local.pagos.length} pago(s) distintos. ` +
      'Elige cuáles conservar: los otros se reemplazan.';
    const dlg = $('#dlgElegir');
    $('#btnUsarNube').onclick = () => { dlg.close(); res(true); };
    $('#btnUsarLocal').onclick = () => { dlg.close(); res(false); };
    dlg.addEventListener('cancel', e => e.preventDefault(), { once: true });
    dlg.showModal();
  });
}

async function arrancar(snap) {
  const d = snap.exists() ? snap.data() : null;
  let remoto = null;
  try { remoto = d && typeof d.json === 'string' ? JSON.parse(d.json) : null; } catch (e) { remoto = null; }
  const rev = d ? Number(d.rev) || 0 : 0;
  const hayLocal = app.tieneDatos() && !app.esEjemplo();
  const igual = remoto && JSON.stringify(remoto) === JSON.stringify(app.obtener());
  if (!remoto) {
    if (hayLocal) { marcarSucio(true); await subir(); }          // cuenta nueva: sube lo de aquí
  } else if (igual) {
    marcarSucio(false); fijarBase(rev);
  } else if (!hayLocal || !sucio && base > 0) {
    app.reemplazar(remoto); marcarSucio(false); fijarBase(rev);   // lo de la cuenta manda
    app.avisar('Tus datos se cargaron desde tu cuenta');
  } else if (sucio && rev === base) {
    await subir();                                                // cambios propios sobre la última versión
  } else if (await preguntar(remoto)) {
    app.reemplazar(remoto); marcarSucio(false); fijarBase(rev);
  } else {
    marcarSucio(true); await subir();
  }
  listo = true;
  estado('☁ Sincronizado ' + hora());
}

// ── Sesión ─────────────────────────────────────────────────────────────────
function cambioDeSesion(u) {
  if (desuscribir) { desuscribir(); desuscribir = null; }
  usuario = u; listo = false;
  $('#cuentaFuera').hidden = !!u; $('#cuentaDentro').hidden = !u;
  $('#cuentaTitulo').textContent = u ? 'Tu cuenta' : 'Entrar a tu cuenta';
  if (!u) { estado(''); return; }
  $('#cuentaCorreo').textContent = u.email;
  ref = fb.doc(db, 'usuarios', u.uid);
  estado('☁ Conectando…');
  let primero = true;
  desuscribir = fb.onSnapshot(ref, { includeMetadataChanges: true }, async snap => {
    if (primero) {
      if (snap.metadata.fromCache && navigator.onLine) return;   // esperar la versión del servidor
      primero = false;
      await arrancar(snap);
      return;
    }
    if (!listo) return;
    if (snap.metadata.hasPendingWrites) { estado('☁ Guardando…'); return; }
    if (snap.exists()) {
      const d = snap.data(), rev = Number(d.rev) || 0;
      if (rev > base && !sucio) {
        try { app.reemplazar(JSON.parse(d.json)); fijarBase(rev); app.avisar('Datos actualizados desde otro equipo'); }
        catch (e) { /* documento dañado: se ignora */ }
      }
    }
    estado(snap.metadata.fromCache ? '☁ Sin conexión (se guardará al volver)' : '☁ Sincronizado ' + hora());
  }, () => estado('☁ Sin conexión con tu cuenta'));
}

// ── Formulario de cuenta ───────────────────────────────────────────────────
const MENSAJES = {
  'auth/invalid-credential': 'Correo o clave incorrectos.',
  'auth/wrong-password': 'Correo o clave incorrectos.',
  'auth/user-not-found': 'No hay una cuenta con ese correo. Elige «Crear cuenta».',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Elige «Entrar».',
  'auth/weak-password': 'La clave debe tener al menos 6 caracteres.',
  'auth/invalid-email': 'Ese correo no es válido.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
  'auth/network-request-failed': 'Sin conexión a internet.',
  'auth/operation-not-allowed': 'El acceso con correo no está activado en Firebase.',
};
const error = t => { const e = $('#cuentaError'); e.hidden = !t; e.textContent = t || ''; };

$('#btnCuenta').addEventListener('click', () => { error(''); $('#dlgCuenta').showModal(); });
document.querySelectorAll('.segmento button').forEach(b => b.addEventListener('click', () => {
  modo = b.dataset.modo;
  document.querySelectorAll('.segmento button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  $('#btnEntrar').textContent = modo === 'crear' ? 'Crear cuenta' : 'Entrar';
  $('#cuentaClaveInp').autocomplete = modo === 'crear' ? 'new-password' : 'current-password';
  error('');
}));
$('#formCuenta').addEventListener('submit', async e => {
  e.preventDefault();
  if (usuario || !auth) return;
  const correo = $('#cuentaCorreoInp').value.trim(), clave = $('#cuentaClaveInp').value;
  if (!correo || clave.length < 6) { error('Escribe tu correo y una clave de al menos 6 caracteres.'); return; }
  const btn = $('#btnEntrar'); btn.disabled = true; error('');
  try {
    if (modo === 'crear') await fb.createUserWithEmailAndPassword(auth, correo, clave);
    else await fb.signInWithEmailAndPassword(auth, correo, clave);
    $('#cuentaClaveInp').value = '';
    $('#dlgCuenta').close();
    app.avisar(modo === 'crear' ? 'Cuenta creada: tus datos ya se guardan en tu cuenta' : 'Sesión iniciada');
  } catch (err) {
    error(MENSAJES[err.code] || 'No se pudo: ' + (err.code || err.message));
  } finally { btn.disabled = false; }
});
$('#btnOlvide').addEventListener('click', async () => {
  const correo = $('#cuentaCorreoInp').value.trim();
  if (!correo) { error('Escribe tu correo y vuelve a tocar «Olvidé mi clave».'); return; }
  if (!auth) return;
  try {
    await fb.sendPasswordResetEmail(auth, correo);
    error(''); app.avisar('Te enviamos un correo para cambiar la clave');
  } catch (err) { error(MENSAJES[err.code] || 'No se pudo enviar el correo.'); }
});
$('#btnSalir').addEventListener('click', async () => {
  await fb.signOut(auth);
  fijarBase(0);
  $('#dlgCuenta').close();
  app.avisar('Sesión cerrada. Los datos siguen en este equipo.');
});

iniciar();
