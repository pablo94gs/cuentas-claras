# Cuentas Claras

Control de deudas personales, ingresos y pagos mes a mes, con consejos financieros.

**Abrir la app:** https://pablo94gs.github.io/cuentas-claras/

- Registra cada deuda (banco, tarjeta, almacén, persona) con su valor total, cuota, día de pago e interés.
- Registra tus ingresos y gastos fijos, y los extra de cada mes.
- Marca los pagos: la app calcula cuánto debes, cuándo terminas y si vas al día.
- Consejos según tu situación: carga de deuda, atrasos, plan de pago (avalancha o bola de nieve), fondo de emergencia.

Los datos se guardan en el navegador del dispositivo. La misma app publicada como artifact de Claude
(`python3 armar_artifact.py` genera `dist/cuentas-claras.html`) los guarda además en el espacio privado de la
cuenta de Claude, así se ven iguales en todos los equipos (`sincronizar.js`; fuera de Claude no hace nada).
Desde el botón de respaldo se puede descargar una copia y cargarla en otro equipo.

Se puede instalar en el celular: en el navegador, menú → «Agregar a pantalla de inicio».
