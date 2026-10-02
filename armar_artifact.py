#!/usr/bin/env python3
"""Arma dist/cuentas-claras.html: la misma app en un solo archivo para publicarla
como artifact de Claude (CSS, JS e ícono embebidos; sin manifest ni service worker)."""
import base64, pathlib, re

raiz = pathlib.Path(__file__).parent
html = (raiz / 'index.html').read_text(encoding='utf-8')
css = (raiz / 'app.css').read_text(encoding='utf-8')
icono = 'data:image/svg+xml;base64,' + base64.b64encode((raiz / 'icono.svg').read_bytes()).decode()

cuerpo = html.split('<body>', 1)[1].split('<script src="app.js">', 1)[0]
cuerpo = cuerpo.replace('src="icono.svg"', f'src="{icono}"')
js = '\n'.join((raiz / f).read_text(encoding='utf-8') for f in ('app.js', 'sincronizar.js'))
assert '</script' not in js and '</style' not in css

# Dentro de Claude la plataforma ya separa la página de las barras del teléfono.
extra = '.cabecera { padding-top: 14px; }'

salida = f"""<title>Cuentas Claras</title>
<meta name="description" content="Control de deudas, ingresos y pagos mes a mes, con consejos financieros.">
<style>
{css}
{extra}
</style>
{cuerpo}
<script>
{js}
</script>
"""
(raiz / 'dist').mkdir(exist_ok=True)
(raiz / 'dist' / 'cuentas-claras.html').write_text(salida, encoding='utf-8')
print('dist/cuentas-claras.html', len(salida.encode()), 'bytes')
