"""Quadro branco: dois desenhando ao mesmo tempo, e nenhum traço perdido.

O aceite da fase 10 para o quadro, num navegador de verdade: criar, desenhar,
ver o traço do outro chegar, conferir que dois quadros do mesmo canal não se
misturam, e que a miniatura aparece na lista depois de fechar.

Duas verificações que só existem aqui: as fontes do Excalidraw saem do nosso
domínio (nenhuma requisição a `esm.sh`), e a contagem de elementos é a do
servidor — ela vive no atributo `data-elementos` da tela cheia.

    docker compose up -d
    pnpm dev
    pnpm dev:seed

    python e2e/fase-10-quadro.py <pasta-das-capturas> [quem-desenha] [quem-olha]
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

QUEM_DESENHA, QUEM_OLHA = (
    (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ('alex', 'bruno')
)

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


def entrar(b, usuario, senha='cavalo-bateria-grampo-9'):
    ctx = b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    externas = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    # Nenhuma tela deste produto busca coisa de fora. O Excalidraw busca as
    # próprias fontes num CDN quando ninguém lhe diz onde procurar — é isso que
    # esta lista existe para pegar.
    pg.on('request', lambda r: (
        externas.append(r.url)
        if not r.url.startswith(BASE) and not r.url.startswith('data:')
        else None
    ))
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(600)
    return ctx, pg, erros, externas


def abrir_painel(pg):
    """O botão 'Quadros' do cabeçalho do canal.

    O botão **alterna**: clicar com o painel já aberto o fecha. O painel
    continua aberto atrás da tela cheia, então voltar de um quadro não pede
    outro clique.
    """
    if pg.locator('aside[aria-label="Quadros"]').count() == 0:
        pg.locator('button[aria-label="Quadros"]').first.click()
    pg.wait_for_selector('aside[aria-label="Quadros"]', timeout=10000)
    pg.wait_for_timeout(400)


def elementos(pg):
    """A contagem que o servidor mandou, lida da tela cheia."""
    return pg.evaluate("""() => {
        const alvo = document.querySelector('[data-elementos]');
        return alvo ? Number(alvo.getAttribute('data-elementos')) : -1;
    }""")


TINTA = """() => {
    const tela = document.querySelector('canvas.excalidraw__canvas.static');
    if (!tela) return -1;
    const ctx = tela.getContext('2d');
    const d = ctx.getImageData(0, 0, tela.width, tela.height).data;
    const r0 = d[0], g0 = d[1], b0 = d[2];
    let n = 0;
    // De quatro em quatro pixels: é contagem de tinta, não perícia.
    for (let i = 0; i < d.length; i += 16) {
      if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 30) n += 1;
    }
    return n;
}"""


def tinta(pg):
    """Quantos pixels do canvas diferem do fundo.

    A contagem de elementos vem do servidor e prova que o traço chegou; isto
    prova que ele foi **desenhado**. São duas coisas diferentes, e o dia em que
    a segunda quebrar sozinha a primeira continuaria dizendo que está tudo bem.
    """
    return pg.evaluate(TINTA)


def desenhar(pg, x, y, largura=140, altura=90):
    """Um retângulo, com a ferramenta escolhida pelo teclado."""
    caixa = pg.locator('canvas').first.bounding_box()
    assert caixa, 'o canvas do Excalidraw não apareceu'
    # Um clique no vazio antes da tecla: o atalho da ferramenta só vale com o
    # foco no canvas. Longe do canto superior esquerdo, onde mora o menu.
    pg.mouse.click(caixa['x'] + 120, caixa['y'] + 500)
    pg.keyboard.press('r')
    pg.mouse.move(caixa['x'] + x, caixa['y'] + y)
    pg.mouse.down()
    pg.mouse.move(caixa['x'] + x + largura, caixa['y'] + y + altura, steps=8)
    pg.mouse.up()
    pg.wait_for_timeout(900)


def escrever(pg, x, y, texto):
    """Um texto, que é o que faz o navegador buscar a fonte do quadro."""
    caixa = pg.locator('canvas').first.bounding_box()
    assert caixa, 'o canvas do Excalidraw não apareceu'
    pg.mouse.click(caixa['x'] + 120, caixa['y'] + 500)
    pg.keyboard.press('t')
    pg.mouse.click(caixa['x'] + x, caixa['y'] + y)
    pg.keyboard.type(texto, delay=30)
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(900)


marca = str(int(time.time()))[-5:]
NOME_A = f'Fluxo {marca}'
NOME_B = f'Arquitetura {marca}'

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA, quem, errosA, externasA = entrar(b, QUEM_DESENHA)
    ctxB, olha, errosB, externasB = entrar(b, QUEM_OLHA)

    # --- criar e abrir --------------------------------------------------------
    abrir_painel(quem)
    quem.fill('input[aria-label="Nome do quadro novo"]', NOME_A)
    quem.locator('aside[aria-label="Quadros"] button[type="submit"]').click()

    check('criar um quadro abre ele em tela cheia',
          espera(quem, """() => Boolean(document.querySelector('[data-elementos]'))"""))

    quem.wait_for_selector('canvas', timeout=20000)
    quem.wait_for_timeout(1200)
    check('o canvas do Excalidraw carrega', quem.locator('canvas').count() > 0,
          f'{quem.locator("canvas").count()} canvas')
    quem.screenshot(path=str(SHOTS / 'q1-vazio.png'))

    # --- desenhar -------------------------------------------------------------
    desenhar(quem, 320, 260)
    check('o primeiro traço conta como um elemento',
          espera(quem, """() => Number(
              document.querySelector('[data-elementos]')?.getAttribute('data-elementos') ?? 0
          ) === 1"""),
          str(elementos(quem)))
    quem.screenshot(path=str(SHOTS / 'q2-desenhado.png'))

    # --- o outro lado ---------------------------------------------------------
    abrir_painel(olha)
    olha.locator('aside[aria-label="Quadros"] button', has_text=NOME_A).first.click()
    olha.wait_for_selector('canvas', timeout=20000)
    olha.wait_for_timeout(1500)

    check('quem abre depois recebe o desenho inteiro',
          espera(olha, """() => Number(
              document.querySelector('[data-elementos]')?.getAttribute('data-elementos') ?? 0
          ) === 1"""),
          str(elementos(olha)))

    check('e o traço aparece desenhado na tela dele, não só na contagem',
          tinta(olha) > 50, f'{tinta(olha)} pixels de tinta')

    check('e os dois aparecem um para o outro na barra',
          espera(quem, """() => document.querySelectorAll(
              '[data-elementos] header img, [data-elementos] header [aria-hidden]'
          ).length > 0"""))

    # --- desenhar junto -------------------------------------------------------
    tinta_antes = tinta(quem)
    desenhar(olha, 700, 300)
    check('o traço do outro chega sem ninguém recarregar nada',
          espera(quem, """() => Number(
              document.querySelector('[data-elementos]')?.getAttribute('data-elementos') ?? 0
          ) === 2"""),
          str(elementos(quem)))

    check('e o traço do outro também é desenhado, e não só contado',
          tinta(quem) > tinta_antes, f'{tinta_antes} -> {tinta(quem)} pixels')

    check('e nenhum dos dois traços se perdeu no caminho',
          elementos(quem) == 2 and elementos(olha) == 2,
          f'{elementos(quem)} e {elementos(olha)}')
    # Os dois lados: o enquadramento de cada um é seu, então o mesmo desenho
    # aparece em lugares diferentes da tela — e é assim mesmo até a fatia do
    # modo apresentação.
    quem.screenshot(path=str(SHOTS / 'q3-a-dois.png'))
    olha.screenshot(path=str(SHOTS / 'q3-do-outro-lado.png'))

    # --- dois quadros não se misturam ----------------------------------------
    quem.locator('button[aria-label="Voltar para a conversa"]').click()
    quem.wait_for_timeout(800)
    abrir_painel(quem)
    quem.fill('input[aria-label="Nome do quadro novo"]', NOME_B)
    quem.locator('aside[aria-label="Quadros"] button[type="submit"]').click()
    quem.wait_for_selector('canvas', timeout=20000)
    quem.wait_for_timeout(1500)

    check('dois quadros no mesmo canal não se misturam',
          elementos(quem) == 0, str(elementos(quem)))

    # Texto: é ele que obriga o navegador a buscar a fonte do Excalidraw, e é
    # a busca da fonte que este roteiro quer ver acontecendo **daqui**.
    escrever(quem, 400, 320, 'oi')
    check('escrever no quadro também conta como elemento',
          espera(quem, """() => Number(
              document.querySelector('[data-elementos]')?.getAttribute('data-elementos') ?? 0
          ) >= 1"""),
          str(elementos(quem)))

    # --- a miniatura ----------------------------------------------------------
    quem.locator('button[aria-label="Voltar para a conversa"]').click()
    quem.wait_for_timeout(2500)

    check('ao fechar, o cartão da lista ganha a miniatura',
          espera(quem, """() => Boolean(document.querySelector(
              'aside[aria-label="Quadros"] img[src^="/api/files/quadros/"]'
          ))""", tentativas=40),
          quem.locator('aside[aria-label="Quadros"] img').count())
    quem.screenshot(path=str(SHOTS / 'q4-lista.png'))

    # --- nada de fora ---------------------------------------------------------
    de_fora = [u for u in externasA + externasB if 'esm.sh' in u or 'unpkg' in u]
    check('nenhuma fonte buscada fora do nosso domínio', not de_fora,
          '; '.join(de_fora[:2]))

    fontes = quem.evaluate("""() => performance
        .getEntriesByType('resource')
        .map((r) => r.name)
        .filter((n) => n.includes('/excalidraw/fonts/'))""")
    check('e as fontes do quadro saíram daqui mesmo', len(fontes) > 0,
          fontes[0].replace(BASE, '') if fontes else 'nenhuma fonte buscada')

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
