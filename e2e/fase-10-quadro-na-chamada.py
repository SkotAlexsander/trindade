"""O quadro durante uma chamada: a call minimiza, e dá para ir e voltar.

Desenhar junto e falar junto são a mesma reunião. Este roteiro cobre a parte em
que as duas telas se encontram: entrar numa chamada, abrir o quadro por dentro
dela, a chamada virar a janela flutuante **por cima** do quadro, e o mesmo botão
levar de volta para a conversa.

    docker compose up -d
    pnpm dev
    pnpm dev:seed

    python e2e/fase-10-quadro-na-chamada.py <pasta> [quem] [outro]
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

QUEM, OUTRO = (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ('alex', 'bruno')

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def espera(pg, funcao, tentativas=60, intervalo=250):
    for _ in range(tentativas):
        if pg.evaluate(funcao):
            return True
        pg.wait_for_timeout(intervalo)
    return False


marca = str(int(time.time()))[-5:]
NOME = f'Reuniao {marca}'

with sync_playwright() as p:
    b = p.chromium.launch(
        channel='chrome',
        headless=True,
        args=['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    )

    def abrir(usuario):
        ctx = b.new_context(
            viewport={'width': 1500, 'height': 950},
            color_scheme='dark',
            permissions=['microphone'],
        )
        pg = ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.goto(f'{BASE}/entrar', wait_until='networkidle')
        pg.fill('input[autocomplete="username"]', usuario)
        pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
        pg.click('button[type="submit"]')
        pg.wait_for_url('**/c/**', timeout=25000)
        pg.wait_for_selector('#compositor', timeout=15000)
        return ctx, pg, erros

    ctxA, quem, errosA = abrir(QUEM)
    ctxB, outro, errosB = abrir(OUTRO)

    # --- entrar na chamada ----------------------------------------------------
    #
    # Clicar no canal de voz conecta e abre a conversa dele: a chamada e o que
    # se escreve durante ela são a mesma sala. O quadro nasce **ali**, porque é
    # do canal em que a reunião está acontecendo.
    quem.locator('button', has_text='sala').first.click()
    check('a chamada conecta',
          espera(quem, """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
              ?.textContent || '').includes('Conectado')"""),
          quem.inner_text('section[aria-label="Chamada em andamento"]')[:60].replace('\n', ' · '))

    outro.locator('button', has_text='sala').first.click()
    espera(outro, """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
        ?.textContent || '').includes('Conectado')""")

    # --- um quadro no canal da reunião ----------------------------------------
    # O botão do cabeçalho abre o quadro do canal; a lista (onde se cria um com
    # nome) fica no menu do próprio quadro.
    quem.locator('button[aria-label="Quadro"]').first.click()
    quem.wait_for_selector('canvas', timeout=25000)
    quem.wait_for_timeout(1500)
    quem.locator('[data-elementos] button[aria-label="Mais ações do quadro"]').click()
    quem.wait_for_timeout(400)
    quem.locator('[role="menuitem"]', has_text='Outros quadros').click()
    quem.wait_for_selector('aside[aria-label="Quadros"]', timeout=10000)
    quem.fill('input[aria-label="Nome do quadro novo"]', NOME)
    quem.locator('aside[aria-label="Quadros"] button[type="submit"]').click()
    quem.wait_for_selector('canvas', timeout=25000)
    quem.wait_for_timeout(1200)
    quem.locator('[data-elementos] button[aria-label="Voltar para a conversa"]').click()
    quem.wait_for_timeout(800)

    # --- de dentro da chamada para o quadro -----------------------------------
    barra = quem.locator('section[aria-label="Chamada em andamento"]')
    check('a barra da chamada tem o caminho para o quadro',
          barra.locator('button[aria-label="Ir para o quadro"]').count() == 1)

    barra.locator('button[aria-label="Ir para o quadro"]').click()
    quem.wait_for_selector('canvas', timeout=25000)
    quem.wait_for_timeout(1500)

    check('o quadro abre em tela cheia sem derrubar a chamada',
          quem.locator('[data-elementos]').count() == 1
          and espera(quem, """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
              ?.textContent || '').includes('Conectado')"""))

    # A chamada não some: ela vira a janela flutuante, e a janela fica **por
    # cima** do quadro. Sem isso, entrar no quadro apagaria todo mundo da vista.
    check('a chamada vira janela flutuante por cima do quadro',
          espera(quem, """() => {
              const janela = document.querySelector('aside[aria-label^="Chamada em"]');
              if (!janela) return false;
              const quadro = document.querySelector('[data-elementos]');
              const zj = Number(getComputedStyle(janela).zIndex || 0);
              const zq = Number(getComputedStyle(quadro).zIndex || 0);
              return janela.getAttribute('data-sobre-quadro') === 'true' && zj > zq;
          }"""),
          quem.evaluate("""() => {
              const janela = document.querySelector('aside[aria-label^="Chamada em"]');
              const quadro = document.querySelector('[data-elementos]');
              return janela && quadro
                ? `janela ${getComputedStyle(janela).zIndex} · quadro ${getComputedStyle(quadro).zIndex}`
                : 'sem janela';
          }"""))
    quem.screenshot(path=str(SHOTS / 'c1-quadro-com-chamada.png'))

    # --- desenhar com a chamada aberta ----------------------------------------
    caixa = quem.locator('canvas').first.bounding_box()
    quem.mouse.click(caixa['x'] + 120, caixa['y'] + 500)
    quem.keyboard.press('r')
    quem.mouse.move(caixa['x'] + 340, caixa['y'] + 300)
    quem.mouse.down()
    quem.mouse.move(caixa['x'] + 520, caixa['y'] + 430, steps=6)
    quem.mouse.up()
    quem.wait_for_timeout(1200)

    check('e dá para desenhar com a chamada em andamento',
          espera(quem, """() => Number(document.querySelector('[data-elementos]')
              ?.getAttribute('data-elementos') ?? 0) === 1"""),
          quem.evaluate("""() => document.querySelector('[data-elementos]')
              ?.getAttribute('data-elementos')"""))

    # --- e de volta -----------------------------------------------------------
    quem.locator('aside[aria-label^="Chamada em"] button[aria-label="Sair do quadro"]').click()
    quem.wait_for_timeout(1000)

    check('o mesmo botão, na janela flutuante, volta para a conversa',
          quem.locator('[data-elementos]').count() == 0
          and quem.locator('#compositor').count() == 1)

    check('e a chamada continua de pé depois de tudo',
          espera(quem, """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
              ?.textContent || '').includes('Conectado')"""))
    quem.screenshot(path=str(SHOTS / 'c2-de-volta.png'))

    check('nenhum erro de página', not errosA and not errosB,
          '; '.join((errosA + errosB)[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

print()
falhas = [nome for nome, ok, _ in resultados if not ok]
print(f'{len(resultados) - len(falhas)}/{len(resultados)} passaram')
if falhas:
    print('falhou: ' + ', '.join(falhas))
sys.exit(1 if falhas else 0)
