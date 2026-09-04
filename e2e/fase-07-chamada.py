"""Entrar numa chamada de verdade, duas pessoas, com o LiveKit e o coturn de pé.

A verificação que dá nome à fase está aqui: **só candidatos `relay`**. É o
`chrome://webrtc-internals` do aceite, lido por programa em vez de à mão — se
aparecer um candidato `host` ou `srflx`, o endereço de casa de alguém foi para
o outro lado na negociação e o requisito de privacidade caiu.

    docker compose up -d
    pnpm dev
    pnpm dev:seed
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

# O relay em desenvolvimento fica no endereço da máquina na rede local — em
# 127.0.0.1 o Chrome não aloca nada depois que há permissão de microfone. Ver
# .env.example.
ENDERECO_DO_RELAY = next(
    (l.split('=', 1)[1].strip()
     for l in Path('.env').read_text(encoding='utf-8').splitlines()
     if l.startswith('TURN_EXTERNAL_IP=')),
    '127.0.0.1',
)

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def aparece(pg, funcao, tentativas=40, intervalo=250):
    """Espera uma condição em JavaScript, sem cravar um tempo fixo."""
    for _ in range(tentativas):
        if pg.evaluate(funcao):
            return True
        pg.wait_for_timeout(intervalo)
    return False


# Toda RTCPeerConnection criada pela página fica registrada, com a configuração
# que recebeu. É a única forma de ler isso sem depender do interior do SDK.
ESPIAO = """
(() => {
  const Original = window.RTCPeerConnection;
  window.__conexoes = [];
  window.__configs = [];
  class Espiao extends Original {
    constructor(config, ...resto) {
      super(config, ...resto);
      window.__configs.push(config || {});
      window.__conexoes.push(this);
    }
  }
  window.RTCPeerConnection = Espiao;
})()
"""

CANDIDATOS = """
async () => {
  const tipos = { local: [], remoto: [], pares: [], enderecos: [] };
  for (const pc of window.__conexoes || []) {
    const stats = await pc.getStats();
    stats.forEach((s) => {
      if (s.type === 'local-candidate') {
        tipos.local.push(s.candidateType);
        tipos.enderecos.push(s.address || s.ip || '');
      }
      if (s.type === 'remote-candidate') tipos.remoto.push(s.candidateType);
      if (s.type === 'candidate-pair' && s.state === 'succeeded') tipos.pares.push(s.state);
    });
  }
  return tipos;
}
"""


def entrar(pg, usuario, senha='cavalo-bateria-grampo-9'):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor', timeout=15000)


with sync_playwright() as p:
    b = p.chromium.launch(
        channel='chrome',
        headless=True,
        args=['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    )

    def abrir(nome):
        ctx = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark',
                            permissions=['microphone'])
        ctx.add_init_script(ESPIAO)
        pg = ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        entrar(pg, nome)
        return ctx, pg, erros

    ctxA, pgA, errosA = abrir('alex')
    ctxB, pgB, errosB = abrir('bruno')
    marca = str(int(time.time()))[-5:]

    # --- entrar --------------------------------------------------------------
    #
    # Clicar no canal conecta direto — não há antessala — e abre a conversa
    # dele: a chamada e o que se escreve durante ela são a mesma sala.
    pgA.locator('button', has_text='sala').first.click()
    conectou = aparece(
        pgA,
        """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
                 ?.textContent || '').includes('Conectado')""",
    )
    check('clicar no canal de voz conecta, sem antessala', conectou,
          pgA.inner_text('section[aria-label="Chamada em andamento"]')[:80] if conectou else 'sem barra')
    check('e abre a conversa do canal de voz', pgA.url.endswith('/c/sala'), pgA.url)
    check('que tem compositor como qualquer outro canal',
          pgA.locator('#compositor').count() == 1)

    barra = pgA.locator('section[aria-label="Chamada em andamento"]')

    # A borda superior de 2px em --live é o sinal principal da interface: é a
    # única borda saturada, e é o que torna impossível esquecer o microfone
    # aberto. Se ela sumir num refactor de CSS, ninguém percebe olhando.
    borda = pgA.evaluate(
        """() => {
            const el = document.querySelector('section[aria-label="Chamada em andamento"]');
            const s = getComputedStyle(el);
            return { largura: s.borderTopWidth, cor: s.borderTopColor,
                     fundo: s.backgroundColor, altura: el.getBoundingClientRect().height };
        }"""
    )
    check('a barra tem a borda superior de 2px', borda['largura'] == '2px', str(borda))
    check('e ela é a cor de presença ao vivo, não a do resto da interface',
          borda['cor'] not in ('rgb(34, 211, 238)', 'rgba(0, 0, 0, 0)'), borda['cor'])
    check('a barra tem ao menos 56px', borda['altura'] >= 56, str(borda['altura']))
    pgA.screenshot(path=str(SHOTS / '81-barra-de-chamada.png'))

    # --- a verificação da fase ----------------------------------------------
    pgA.wait_for_timeout(2500)
    cand = pgA.evaluate(CANDIDATOS)
    configs = pgA.evaluate('() => window.__configs')

    check('a conexão foi criada com iceTransportPolicy relay',
          len(configs) > 0 and all(c.get('iceTransportPolicy') == 'relay' for c in configs),
          str([c.get('iceTransportPolicy') for c in configs]))

    locais = set(cand['local'])
    # `prflx` não é endereço local: é o endereço **como o outro lado o viu**, e
    # com a política de relay o outro lado só vê o relay. O que não pode
    # aparecer é `host` (o endereço da máquina) ou `srflx` (o endereço público
    # de casa, descoberto por STUN).
    check('e nenhum candidato local é host ou srflx',
          len(locais) > 0 and not (locais & {'host', 'srflx'}), str(sorted(locais)))

    # A prova em endereço, e não em rótulo: todo candidato local carrega um
    # endereço **do relay**, e nenhum da máquina de quem está na chamada. As
    # duas faces do relay são a publicada (o que o navegador enxerga) e a
    # interna do Docker (o que o SFU enxerga, e que vira o `prflx`); em
    # produção as duas são do servidor de TURN.
    doRelay = {ENDERECO_DO_RELAY, '172.30.0.11'}
    enderecos = {e for e in cand['enderecos'] if e}
    check('e todo endereço é do relay, nenhum da máquina',
          len(enderecos) > 0 and enderecos <= doRelay,
          f'{sorted(enderecos)} vs {sorted(doRelay)}')
    check('a chamada de fato fechou um par de candidatos', len(cand['pares']) > 0,
          str(len(cand['pares'])))

    # --- a segunda pessoa ----------------------------------------------------
    pgB.locator('button', has_text='sala').first.click()
    check('a segunda pessoa também conecta',
          aparece(pgB, """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
                          ?.textContent || '').includes('Conectado')"""))

    # O estado de voz vem do webhook do LiveKit, então isto também prova que o
    # SFU alcançou a API e que a assinatura passou.
    check('e aparece na barra de quem já estava dentro',
          aparece(pgA, """() => document.querySelectorAll(
              'section[aria-label="Chamada em andamento"] img, ' +
              'section[aria-label="Chamada em andamento"] [class*="avatarNaChamada"]').length >= 2"""),
          barra.inner_text()[:80])

    # Quem está fora vê os avatares no canal da lista. Aqui os dois estão
    # dentro, mas a fileira é a mesma coisa que quem está fora enxerga.
    check('e os avatares aparecem no canal da lista',
          pgA.locator('nav[aria-label="Canais"] [class*="noCanal"] > span').count() >= 2,
          str(pgA.locator('nav[aria-label="Canais"] [class*="noCanal"] > span').count()))

    # --- a conversa da sala ---------------------------------------------------
    #
    # Canal de voz tem histórico de verdade: quem está na chamada cola um link
    # sem sair dela, e quem chegou depois lê o que ficou combinado.
    recado = f'combinado na chamada {marca}'
    pgA.fill('#compositor', recado)
    pgA.keyboard.press('Enter')
    check('dá para escrever na sala, e chega do outro lado',
          aparece(pgB, f"""() => document.body.innerText.includes({recado!r})"""),
          recado)

    # --- microfone e surdez --------------------------------------------------
    mudo = barra.locator('button[aria-label="Microfone aberto"]')
    check('o microfone entra aberto', mudo.count() == 1)

    def tracos(rotulo):
        return pgA.evaluate(
            """(rotulo) => {
                const b = document.querySelector(
                  `section[aria-label="Chamada em andamento"] button[aria-label="${rotulo}"]`);
                return b ? b.querySelectorAll('svg path, svg line').length : -1;
            }""",
            rotulo,
        )

    aberto = tracos('Microfone aberto')
    mudo.click()
    pgA.wait_for_timeout(600)
    check('e fechar troca o ícone, não só a cor',
          barra.locator('button[aria-label="Microfone fechado"]').count() == 1)

    # A barra diagonal do ícone é o que cobre daltonismo: sem ela, "desligado"
    # existiria só como cor.
    fechado = tracos('Microfone fechado')
    check('o mesmo ícone ganha um traço ao fechar', fechado == aberto + 1,
          f'aberto {aberto}, fechado {fechado}')

    barra.locator('button[aria-label="Áudio ligado"]').click()
    pgA.wait_for_timeout(600)
    check('ensurdecer cala junto',
          barra.locator('button[aria-label="Áudio desligado"]').count() == 1
          and barra.locator('button[aria-label="Microfone fechado"]').count() == 1)
    pgA.screenshot(path=str(SHOTS / '82-controles.png'))

    # --- sair ----------------------------------------------------------------
    barra.locator('button', has_text='Sair').click()
    check('sair fecha a barra, sem confirmação',
          aparece(pgA, """() => !document.querySelector(
              'section[aria-label="Chamada em andamento"]')"""))
    check('e o outro lado vê a saída',
          aparece(pgB, """() => document.querySelectorAll(
              'nav[aria-label="Canais"] [class*="noCanal"] > span').length === 1"""),
          str(pgB.locator('nav[aria-label="Canais"] [class*="noCanal"] > span').count()))

    pgB.locator('section[aria-label="Chamada em andamento"] button', has_text='Sair').click()
    pgB.wait_for_timeout(800)

    check('nenhum erro de página', not errosA and not errosB,
          '; '.join((errosA + errosB)[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
