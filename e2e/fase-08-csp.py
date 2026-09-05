"""A CSP, com o front construído e os cabeçalhos de produção.

O aceite da fase 8 diz "CSP ativa sem nenhuma violação no console". Este roteiro
faz exatamente isso, e do jeito que não envelhece: **lê a política do
`infra/cabecalhos.caddy`** — o mesmo arquivo que o Caddy importa — e serve o
`dist` com ela. Se alguém relaxar a política no arquivo, o teste passa a testar
a política relaxada e o commit mostra isso; se alguém acrescentar um script
inline no código, o teste falha.

    pnpm --filter @trindade/web build
    pnpm dev            # a API precisa estar de pé; o front vem do dist

Uma substituição, e só uma: `connect-src` ganha a origem deste servidor de
teste. Em produção a aplicação e a API dividem o domínio e `'self'` basta.
"""

import http.server
import re
import socketserver
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

RAIZ = Path(__file__).resolve().parent.parent
DIST = RAIZ / 'packages' / 'web' / 'dist'
SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
PORTA = 4179
API = 'http://127.0.0.1:3000'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def cabecalhos_do_caddy():
    """Extrai os cabeçalhos do arquivo que o Caddy importa."""
    texto = (RAIZ / 'infra' / 'cabecalhos.caddy').read_text(encoding='utf-8')
    achados = {}
    for nome in ('Content-Security-Policy', 'Strict-Transport-Security',
                 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy'):
        m = re.search(rf'^\s*{nome}\s+"([^"]+)"', texto, re.M)
        if m:
            achados[nome] = m.group(1)
    return achados


CABECALHOS = cabecalhos_do_caddy()
CSP = (
    CABECALHOS['Content-Security-Policy']
    .replace('{$DOMINIO_MIDIA}', '')
    .replace('wss://{$DOMINIO} https://{$DOMINIO} wss://livekit.{$DOMINIO} '
             'https://livekit.{$DOMINIO}',
             f'http://localhost:{PORTA} ws://localhost:{PORTA}')
)


class Servidor(http.server.SimpleHTTPRequestHandler):
    """Serve o `dist` com os cabeçalhos de produção, e passa `/api` adiante."""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *_):
        pass

    def _com_cabecalhos(self):
        for nome, valor in CABECALHOS.items():
            self.send_header(nome, CSP if nome == 'Content-Security-Policy' else valor)

    def do_POST(self):
        self._proxy('POST')

    def do_GET(self):
        if self.path.startswith('/api/'):
            self._proxy('GET')
            return
        # Rotas do React Router: caminho fundo recarregado devolve o index.
        alvo = DIST / self.path.lstrip('/')
        if not alvo.is_file():
            self.path = '/index.html'
        super().do_GET()

    def end_headers(self):
        self._com_cabecalhos()
        super().end_headers()

    def _proxy(self, metodo):
        corpo = None
        tamanho = int(self.headers.get('content-length') or 0)
        if tamanho:
            corpo = self.rfile.read(tamanho)
        pedido = urllib.request.Request(API + self.path, data=corpo, method=metodo)
        for h in ('content-type', 'authorization', 'cookie'):
            if self.headers.get(h):
                pedido.add_header(h, self.headers[h])
        try:
            with urllib.request.urlopen(pedido) as resposta:
                dados = resposta.read()
                self.send_response(resposta.status)
                for h in ('content-type', 'set-cookie'):
                    if resposta.headers.get(h):
                        self.send_header(h, resposta.headers[h])
                self.send_header('content-length', str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)
        except urllib.error.HTTPError as erro:
            dados = erro.read()
            self.send_response(erro.code)
            self.send_header('content-type', erro.headers.get('content-type', 'application/json'))
            self.send_header('content-length', str(len(dados)))
            self.end_headers()
            self.wfile.write(dados)


# Com fila de um, uma requisição pendurada trava as seguintes — e o navegador
# tem sempre alguma pendurada (a tentativa de WebSocket, por exemplo). Foi o que
# deixou o pedaço do quadro esperando para sempre, sem erro nenhum na tela.
class ServidorEmParalelo(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


servidor = ServidorEmParalelo(('127.0.0.1', PORTA), Servidor)
threading.Thread(target=servidor.serve_forever, daemon=True).start()

violacoes = []

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark')
    pg = ctx.new_page()

    # O evento nativo diz a diretiva e o recurso; a mensagem de console diria
    # menos e em texto livre.
    pg.add_init_script("""
      window.__violacoes = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__violacoes.push({
          diretiva: e.effectiveDirective,
          alvo: (e.blockedURI || '').slice(0, 120),
          linha: e.lineNumber,
        });
      });
    """)
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))

    pg.goto(f'http://localhost:{PORTA}/entrar', wait_until='networkidle')
    pg.wait_for_timeout(800)

    recebidos = pg.evaluate("""async () => {
        const r = await fetch('/entrar');
        const h = {};
        for (const [k, v] of r.headers.entries()) h[k] = v;
        return h;
    }""")

    check('a CSP chega no cabeçalho', 'content-security-policy' in recebidos)
    check('sem unsafe-inline em script-src',
          "script-src 'self';" in recebidos.get('content-security-policy', ''),
          recebidos.get('content-security-policy', '')[:80])
    check('frame-ancestors none', "frame-ancestors 'none'" in recebidos.get('content-security-policy', ''))
    check('nosniff e no-referrer chegam',
          recebidos.get('x-content-type-options') == 'nosniff'
          and recebidos.get('referrer-policy') == 'no-referrer',
          str({k: v[:40] for k, v in recebidos.items()
               if k in ('x-content-type-options', 'referrer-policy')}))

    # HSTS o navegador descarta em origem HTTP — nem expõe o cabeçalho. Este
    # roteiro roda sem TLS, então a verificação é no arquivo, como a do coturn.
    hsts = CABECALHOS.get('Strict-Transport-Security', '')
    check('HSTS de dois anos, com subdomínios e preload',
          'max-age=63072000' in hsts and 'includeSubDomains' in hsts and 'preload' in hsts,
          hsts)
    check('geolocation fechada na Permissions-Policy',
          'geolocation=()' in recebidos.get('permissions-policy', ''),
          recebidos.get('permissions-policy', '')[:60])

    # --- a tela de entrada, sob a política -----------------------------------
    check('a tela de entrada monta', pg.locator('input[autocomplete="username"]').count() == 1)
    # O carimbo do tema roda antes da pintura, e agora vem de /tema.js.
    check('o tema foi carimbado pelo script externo',
          pg.evaluate("""() => document.documentElement.dataset.theme"""), 'dark/light')

    pg.fill('input[autocomplete="username"]', 'carla')
    pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(2000)

    check('e a aplicação inteira carrega com a política ativa',
          pg.locator('nav[aria-label="Canais"]').count() == 1)
    pg.screenshot(path=str(SHOTS / '99-csp.png'))

    # O quadro **não** entra aqui, e a razão é do roteiro e não do produto: este
    # servidor de teste não faz o upgrade para WebSocket, e sem gateway o quadro
    # nunca recebe o `BOARD_STATE` que o faz montar. Quem confere o quadro sob
    # as mesmas origens é `fase-10-quadro.py`, que roda com a API de verdade.

    # O aceite da fase 10: `navigator.geolocation` é recusado **pela política**,
    # e não por não estar no código. É a diferença entre "não usamos" e "não
    # podemos usar" — e é o que impede alguém de escrever isso por engano
    # amanhã.
    geo = pg.evaluate("""async () => {
        if (!navigator.geolocation) return 'sem api';
        return await new Promise((resolver) => {
            let respondeu = false;
            const terminar = (r) => { if (!respondeu) { respondeu = true; resolver(r); } };
            setTimeout(() => terminar('sem resposta'), 3000);
            try {
                navigator.geolocation.getCurrentPosition(
                    () => terminar('permitido'),
                    (erro) => terminar(erro.code === 1 ? 'recusado' : `erro ${erro.code}`),
                    { timeout: 2000 },
                );
            } catch (erro) {
                terminar('lançou');
            }
        });
    }""")
    check('a Permissions-Policy recusa a geolocalização de verdade',
          geo in ('recusado', 'lançou', 'sem api'), str(geo))

    violacoes = pg.evaluate('() => window.__violacoes')
    check('nenhuma violação de CSP', not violacoes,
          '; '.join(f"{v['diretiva']} <- {v['alvo']}" for v in violacoes[:3]))

    # Um erro de página sob CSP costuma ser justamente o script bloqueado.
    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    b.close()

servidor.shutdown()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
