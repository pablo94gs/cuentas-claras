/* Sincronización con la cuenta de Claude.
 *
 * Publicada como artifact en claude.ai, la app guarda una copia de los datos en
 * el espacio privado de quien la abre (data/users/<su id>/cuentas). Así los
 * mismos datos aparecen en el iPad, el celular y la computadora, con solo tener
 * la sesión de Claude abierta. Fuera de Claude (GitHub Pages) no hace nada y la
 * app sigue guardando solo en el equipo. */
(async () => {
  const app = window.app;
  if (!app || !window.claude || typeof window.claude.use !== 'function') return;
  const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
  if (!db || !user) return;
  const uid = await user.id();
  if (!uid) return;

  const $ = s => document.querySelector(s);
  const K_REV = 'cuentasclaras.rev';       // revisión de la nube que tiene este equipo
  const K_SUCIO = 'cuentasclaras.sucio';   // hay cambios locales sin subir
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
  };
  let base = Number(ls.get(K_REV)) || 0;
  let sucio = ls.get(K_SUCIO) === '1';
  let listo = false, tSubida = null, cola = Promise.resolve();
  const ref = db.doc('data/users/' + uid + '/cuentas');

  const hora = () => new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
  function estado(t) { const el = $('#estadoNube'); el.hidden = !t; el.textContent = t || ''; }
  function marcarSucio(v) { sucio = v; ls.set(K_SUCIO, v ? '1' : '0'); }

  // Una escritura a la vez sobre el documento, siempre con lo último.
  function subir() {
    cola = cola.then(async () => {
      if (!sucio) return;
      const rev = Date.now();
      const json = JSON.stringify(app.obtener());
      try {
        await ref.set({ json, rev });
        base = rev; ls.set(K_REV, String(rev));
        if (JSON.stringify(app.obtener()) === json) marcarSucio(false);
        estado('☁ Guardado ' + hora());
      } catch (e) {
        estado(e && e.code === 'quota_exceeded' ? '☁ La nube está llena' : '☁ Sin conexión: se guardará al volver');
      }
    });
    return cola;
  }

  window.alGuardar = () => {
    marcarSucio(true);
    if (!listo) return;
    estado('☁ Guardando…');
    clearTimeout(tSubida);
    tSubida = setTimeout(subir, 600);
  };

  function preguntar(remoto) {
    return new Promise(res => {
      const local = app.obtener();
      $('#elegirTexto').textContent =
        `En tu cuenta hay ${remoto.deudas.length} deuda(s) y ${remoto.pagos.length} pago(s); ` +
        `en este equipo, cambios sin guardar con ${local.deudas.length} deuda(s) y ${local.pagos.length} pago(s). ` +
        'Elige cuáles conservar: los otros se reemplazan.';
      const dlg = $('#dlgElegir');
      $('#btnUsarNube').onclick = () => { dlg.close(); res(true); };
      $('#btnUsarLocal').onclick = () => { dlg.close(); res(false); };
      dlg.addEventListener('cancel', e => e.preventDefault(), { once: true });
      dlg.showModal();
    });
  }

  /* Al abrir: decide entre lo guardado en la cuenta y lo que hay en el equipo. */
  async function arrancar(snap) {
    const d = snap.exists ? snap.data() : null;
    let remoto = null;
    try { remoto = d && typeof d.json === 'string' ? JSON.parse(d.json) : null; } catch (e) { remoto = null; }
    const rev = d ? Number(d.rev) || 0 : 0;
    const hayLocal = app.tieneDatos() && !app.esEjemplo();
    if (!remoto) {
      if (hayLocal || sucio) { marcarSucio(true); await subir(); }
    } else if (!sucio || !hayLocal || rev === base) {
      // Sin cambios propios pendientes (o los pendientes parten de la última
      // versión de la cuenta): lo de la cuenta manda, salvo que lo nuestro sea más nuevo.
      if (sucio && hayLocal && rev === base) await subir();
      else if (JSON.stringify(remoto) !== JSON.stringify(app.obtener())) {
        app.reemplazar(remoto, true);
        marcarSucio(false);
      }
      base = rev; ls.set(K_REV, String(rev));
    } else if (await preguntar(remoto)) {
      app.reemplazar(remoto, true); marcarSucio(false);
      base = rev; ls.set(K_REV, String(rev));
    } else {
      await subir();
    }
    listo = true;
    estado('☁ Sincronizado ' + hora());
  }

  estado('☁ Conectando…');
  let primero = true;
  ref.onSnapshot(async snap => {
    if (primero) {
      if (snap.metadata.fromCache) return;          // esperar la versión real del servidor
      primero = false;
      await arrancar(snap);
      return;
    }
    if (!listo || !snap.exists || snap.metadata.hasPendingWrites) return;
    const d = snap.data();
    const rev = Number(d.rev) || 0;
    if (rev <= base || sucio) return;                 // ya la tengo, o la mía va en camino
    try {
      app.reemplazar(JSON.parse(d.json), true);
      base = rev; ls.set(K_REV, String(rev));
      app.avisar('Datos actualizados desde otro equipo');
      estado('☁ Sincronizado ' + hora());
    } catch (e) { /* documento dañado: se ignora */ }
  }, () => estado('☁ Sin conexión con la cuenta'));

  // Si en 8 s no llegó la versión del servidor, seguir con lo local.
  setTimeout(() => {
    if (primero) { primero = false; ref.get().then(arrancar).catch(() => { listo = true; estado('☁ Sin conexión'); }); }
  }, 8000);
})();
