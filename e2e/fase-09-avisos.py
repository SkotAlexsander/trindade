"""Notificações: o que avisa, o que cala, e o que atravessa o silêncio.

As regras estão testadas como função pura em `packages/web/test/notificacoes.test.ts`.
O que este roteiro prova é que elas chegam à tela: o contador no título, o
ponto e o contador na lista, o sino cortado do canal silenciado, e a regra que
mais importa — **canal silenciado deixa passar menção direta**.

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

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def espera(pg, funcao, tentativas=40, intervalo=250):
    for _ in range(tentativas):
        if pg.evaluate(funcao):
            return True
        pg.wait_for_timeout(intervalo)
    return False


def entrar(b, usuario, senha='cavalo-bateria-grampo-9'):
    # A permissão já concedida: o pedido de verdade é uma caixa do navegador
    # que o Playwright não clica, e o que se quer verificar aqui é a regra, não
    # o diálogo do Chrome.
    ctx = b.new_context(
        viewport={'width': 1500, 'height': 950},
        color_scheme='dark',
        permissions=['notifications'],
    )
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    return ctx, pg, erros


def ir(pg, slug):
    """Troca de canal **pela barra lateral**, e não com `goto`.

    Cada carregamento de página gasta um `POST /auth/refresh`, que tem limite
    de 30 por hora e por IP. Um roteiro que navega com `goto` seis vezes esgota
    a cota em poucas corridas e depois cai na tela de entrar — o que parece
    sessão quebrada e é a proteção funcionando. Clicar no link também é o que a
    pessoa faz.
    """
    pg.locator(f'nav[aria-label="Canais"] a[href="/c/{slug}"]').click()
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(600)


def menu_do_sino(pg):
    """O botão troca de rótulo conforme o estado, e o roteiro roda mais de uma
    vez contra o mesmo banco: assumir "Silenciar canal" quebra na segunda
    corrida, quando o canal ainda está calado da primeira."""
    pg.locator(
        'button[aria-label="Silenciar canal"], button[aria-label="Canal silenciado"]'
    ).first.click()
    pg.wait_for_timeout(400)


def garantir_sem_silencio(pg):
    menu_do_sino(pg)
    if pg.locator('[role="menuitem"]', has_text='Reativar avisos').count():
        pg.locator('[role="menuitem"]', has_text='Reativar avisos').click()
        pg.wait_for_timeout(900)
    else:
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(300)


def falar(pg, texto):
    pg.fill('#compositor', texto)
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(1200)


# Quem fala e quem recebe.
#
# Parametrizado porque o login tem limite de 5 por 15 minutos **por usuário e
# IP**: depurar o roteiro esgota a cota de um par, e trocar de par é mais
# honesto que desligar a proteção nos testes.
QUEM_FALA, QUEM_RECEBE = (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ('carla', 'daniel')

NOMES = {
    'alex': 'Alex Souza',
    'bruno': 'Bruno Lima',
    'carla': 'Carla Nunes',
    'daniel': 'Daniel Prado',
    'eva': 'Eva Marques',
}

marca = str(int(time.time()))[-5:]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxC, carla, errosC = entrar(b, QUEM_FALA)
    ctxD, daniel, errosD = entrar(b, QUEM_RECEBE)

    ir(carla, 'geral')
    # O Daniel fica em outro canal: com #geral aberto e a janela em foco, a
    # regra correta é **não** avisar — e o roteiro não veria nada.
    ir(daniel, 'produto')

    # --- menção ---------------------------------------------------------------
    falar(carla, f'@{QUEM_RECEBE} confere isso {marca}')

    check('menção conta no título da aba',
          espera(daniel, """() => document.title.startsWith('(')"""),
          daniel.title())

    check('e aparece como contador no canal',
          espera(daniel, """() => {
              const link = [...document.querySelectorAll('nav[aria-label="Canais"] a')]
                  .find((a) => a.innerText.includes('geral'));
              return Boolean(link) && /\\d/.test(link.innerText);
          }"""))
    daniel.screenshot(path=str(SHOTS / 'g1-badge.png'))

    # Ler zera: e é ler mesmo, com o canal aberto e a janela à vista.
    ir(daniel, 'geral')
    check('abrir o canal zera o contador do título',
          espera(daniel, """() => document.title === 'Trindade'"""),
          daniel.title())

    # --- silenciar ------------------------------------------------------------
    garantir_sem_silencio(daniel)
    menu_do_sino(daniel)
    daniel.locator('[role="menuitem"]', has_text='Por 1 hora').click()
    daniel.wait_for_timeout(1000)

    check('silenciar marca o canal com o sino cortado',
          daniel.locator('button[aria-label="Canal silenciado"]').count() == 1
          and daniel.locator('nav[aria-label="Canais"] [aria-label="silenciado"]').count() == 1)
    daniel.screenshot(path=str(SHOTS / 'g2-silenciado.png'))

    # O Daniel sai do canal para o aviso poder acontecer.
    ir(daniel, 'produto')
    falar(carla, f'conversa comum no canal {marca}')

    check('canal silenciado não conta mensagem comum no título',
          daniel.title() == 'Trindade',
          daniel.title())

    # A regra que mais importa: "não me interrompa com o fluxo" não é
    # "me esconda quando alguém fala comigo pelo nome".
    falar(carla, f'@{QUEM_RECEBE} isto é urgente {marca}')
    check('mas deixa passar a menção direta',
          espera(daniel, """() => document.title.startsWith('(')"""),
          daniel.title())

    # --- configurações --------------------------------------------------------
    daniel.locator('button[aria-label="Notificações"]').click()
    daniel.wait_for_timeout(800)

    check('a tela de notificações lista o canal silenciado',
          espera(daniel, """() => {
              const rotulos = [...document.querySelectorAll('.section-label')]
                  .map((e) => e.innerText.toLowerCase());
              return rotulos.some((r) => r.includes('canais silenciados'))
                  && (document.body.innerText || '').includes('#geral');
          }"""),
          daniel.locator('text=Canais silenciados').count() and '')
    daniel.screenshot(path=str(SHOTS / 'g3-configuracoes.png'))

    daniel.locator('button', has_text='Reativar').first.click()
    daniel.wait_for_timeout(1000)
    check('e reativar de lá tira o silêncio do canal',
          espera(daniel, """() => document.querySelectorAll(
              'nav[aria-label="Canais"] [aria-label="silenciado"]').length === 0"""))

    check('nenhum erro de página', not errosC and not errosD,
          '; '.join((errosC + errosD)[:2]))

    ctxC.close()
    ctxD.close()
    b.close()

print()
falhas = [nome for nome, ok, _ in resultados if not ok]
print(f'{len(resultados) - len(falhas)}/{len(resultados)} passaram')
if falhas:
    print('falhou: ' + ', '.join(falhas))
sys.exit(1 if falhas else 0)
