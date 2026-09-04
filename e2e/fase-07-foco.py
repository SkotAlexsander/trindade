"""Tela cheia, zoom, janela do sistema e o apontador.

O que fecha a fase 7: assistir a uma tela alheia de perto. Duas pessoas, uma
transmitindo, e o que se verifica é a leitura — a rolagem aproxima onde o cursor
está, arrastar não deixa a imagem sair do quadro, e `Alt` + clique põe um ponto
na tela de quem transmite.

    docker compose up -d
    pnpm dev
    pnpm dev:seed
"""

import sys
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


def aparece(pg, funcao, tentativas=60, intervalo=250):
    for _ in range(tentativas):
        if pg.evaluate(funcao):
            return True
        pg.wait_for_timeout(intervalo)
    return False


TELA_FALSA = """
(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const x = c.getContext('2d');
    let n = 0;
    setInterval(() => { n += 6; x.fillStyle = '#101a2e'; x.fillRect(0, 0, 1280, 720);
      x.fillStyle = '#22d3ee'; x.fillRect((n * 4) % 1180, 280, 100, 100);
      x.fillStyle = '#e8f3fa'; x.font = '40px sans-serif';
      x.fillText('linha de código ' + n, 40, 100); }, 66);
    return c.captureStream(15);
  };
})()
"""

CONECTADO = """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
                     ?.textContent || '').includes('Conectado')"""


def entrar(b, usuario):
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark',
                        permissions=['microphone', 'camera'])
    ctx.add_init_script(TELA_FALSA)
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor')
    pg.locator('button', has_text='sala').first.click()
    return ctx, pg, erros


with sync_playwright() as p:
    b = p.chromium.launch(
        channel='chrome',
        headless=True,
        args=['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    )
    ctxA, pgA, errosA = entrar(b, 'alex')
    ctxB, pgB, errosB = entrar(b, 'bruno')
    check('os dois entram na chamada', aparece(pgA, CONECTADO) and aparece(pgB, CONECTADO))

    # Alex transmite; Bruno assiste e põe em primeiro plano.
    pgA.locator('section[aria-label="Chamada em andamento"] '
                'button[aria-label="Compartilhar tela"]').click()
    pgA.wait_for_selector('dialog[open]')
    pgA.locator('dialog[open] button', has_text='Escolher').click()
    check('alex transmite', aparece(pgA, """() => (document.querySelector(
        'section[aria-label="Chamada em andamento"]')?.textContent || '')
        .includes('Você está transmitindo')"""))

    gradeB = pgB.locator('section[aria-label="Participantes da chamada"]')
    check('bruno recebe o convite',
          aparece(pgB, """() => document.querySelector(
              'section[aria-label="Participantes da chamada"] button') !== null"""))
    gradeB.locator('button', has_text='Assistir').first.click()
    pgB.wait_for_timeout(1200)
    gradeB.locator('[data-tela="true"]').first.click()
    check('e põe a tela em primeiro plano',
          aparece(pgB, """() => document.querySelector('[class*="palco"]') !== null"""))

    palco = pgB.locator('[class*="palco"]')

    # --- zoom ---------------------------------------------------------------
    caixa = palco.bounding_box()
    meio = (caixa['x'] + caixa['width'] / 2, caixa['y'] + caixa['height'] / 2)
    canto = (caixa['x'] + caixa['width'] * 0.25, caixa['y'] + caixa['height'] * 0.25)

    pgB.mouse.move(*canto)
    for _ in range(6):
        pgB.mouse.wheel(0, -120)
        pgB.wait_for_timeout(60)
    pgB.wait_for_timeout(300)

    zoom = pgB.evaluate(
        """() => {
            const v = document.querySelector('[class*="palco"] video');
            const t = getComputedStyle(v).transform;
            const m = t.match(/matrix\\(([^)]+)\\)/);
            const n = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
            return { escala: n[0], x: n[4], y: n[5],
                     aviso: (document.querySelector('[class*="zoom"]')||{}).textContent || '' };
        }"""
    )
    check('a rolagem amplia até no máximo 3x', 1 < zoom['escala'] <= 3.001, str(zoom['escala']))
    # Centrado no cursor: aproximar no canto superior esquerdo empurra a imagem
    # para baixo e para a direita.
    check('e aproxima onde o cursor está, não o meio',
          zoom['x'] > 0 and zoom['y'] > 0, f"{zoom['x']:.0f},{zoom['y']:.0f}")
    check('com o nível à vista', '×' in zoom['aviso'], zoom['aviso'])
    pgB.screenshot(path=str(SHOTS / '97-zoom.png'))

    # Arrastar não pode deixar faixa preta: a imagem fica presa ao quadro.
    pgB.mouse.move(*meio)
    pgB.mouse.down()
    pgB.mouse.move(meio[0] + 4000, meio[1] + 4000, steps=8)
    pgB.mouse.up()
    pgB.wait_for_timeout(300)
    preso = pgB.evaluate(
        """() => {
            const p = document.querySelector('[class*="palco"]').getBoundingClientRect();
            const v = document.querySelector('[class*="palco"] video').getBoundingClientRect();
            return { folgaEsquerda: Math.round(v.left - p.left),
                     folgaTopo: Math.round(v.top - p.top) };
        }"""
    )
    check('arrastar não descola a imagem do quadro',
          preso['folgaEsquerda'] <= 1 and preso['folgaTopo'] <= 1, str(preso))

    pgB.dblclick(f'[class*="palco"]')
    pgB.wait_for_timeout(300)
    check('duplo clique com zoom volta ao ajuste',
          aparece(pgB, """() => {
              const t = getComputedStyle(document.querySelector('[class*="palco"] video')).transform;
              return t === 'none' || t.startsWith('matrix(1,');
          }"""))

    # --- a janela do sistema -------------------------------------------------
    botao = pgB.locator('button[aria-label="Abrir numa janela do sistema"]')
    check('o botão de janela do sistema existe', botao.count() == 1)
    # Onde não há suporte ele aparece **desabilitado com o motivo**, nunca
    # escondido — a mesma regra da caixa de áudio do sistema.
    estado = pgB.evaluate(
        """() => {
            const b = document.querySelector('button[aria-label="Abrir numa janela do sistema"]');
            return { desabilitado: b.disabled, suporte: 'documentPictureInPicture' in window };
        }"""
    )
    check('e só fica desabilitado quando o navegador não sabe abrir',
          estado['desabilitado'] is not estado['suporte'], str(estado))

    # --- tela cheia ----------------------------------------------------------
    pgB.locator('button[aria-label="Tela cheia"]').click()
    pgB.wait_for_timeout(600)
    check('tela cheia entra pelo botão',
          pgB.evaluate("""() => document.fullscreenElement !== null"""))
    # Sair da tela cheia com `Esc` é do navegador, e o headless não o faz com
    # tecla sintética. O que dá para verificar aqui é o que é nosso: que a mesma
    # tecla não fecha a tela em primeiro plano por baixo. Um único `Escape`
    # fazia as duas coisas.
    pgB.keyboard.press('Escape')
    pgB.wait_for_timeout(600)

    # `Escape` tem ordem: sai da tela cheia sem fechar a sala nem soltar a tela
    # em primeiro plano — é a de "desfazer o último passo".
    check('e o Escape não fecha a tela em primeiro plano junto', palco.count() == 1)

    pgB.locator('button[aria-label="Sair da tela cheia"]').click()
    pgB.wait_for_timeout(500)
    check('o botão devolve da tela cheia',
          pgB.evaluate("""() => document.fullscreenElement === null"""))

    # --- apontar -------------------------------------------------------------
    #
    # "Olha ali" sem descrever coordenadas: `Alt` + clique põe um ponto na tela
    # de quem transmite, na cor de quem apontou, por dois segundos.
    caixa = palco.bounding_box()
    pgB.keyboard.down('Alt')
    pgB.mouse.click(caixa['x'] + caixa['width'] * 0.7, caixa['y'] + caixa['height'] * 0.3)
    pgB.keyboard.up('Alt')

    # Do lado de Alex: ele precisa estar vendo a própria tela em primeiro plano.
    pgA.locator('section[aria-label="Participantes da chamada"] [data-tela="true"]').first.click()
    pgA.wait_for_timeout(400)
    pgB.keyboard.down('Alt')
    pgB.mouse.click(caixa['x'] + caixa['width'] * 0.7, caixa['y'] + caixa['height'] * 0.3)
    pgB.keyboard.up('Alt')

    check('o apontador chega na tela de quem transmite',
          aparece(pgA, """() => document.querySelector('[class*="apontador"]') !== null""", 20))
    posicao = pgA.evaluate(
        """() => {
            const a = document.querySelector('[class*="apontador"]');
            return a ? { left: a.style.left, top: a.style.top } : null;
        }"""
    )
    # Relativa, e não em pixels: o ponto cai no mesmo lugar da imagem em
    # qualquer tamanho de janela dos dois lados.
    def pct(v):
        return float(v.rstrip('%'))

    check('na posição relativa, e não em pixels do outro monitor',
          posicao is not None
          and abs(pct(posicao['left']) - 70) < 1.5
          and abs(pct(posicao['top']) - 30) < 1.5,
          str(posicao))
    pgA.screenshot(path=str(SHOTS / '98-apontador.png'))

    # Dois segundos, e some sozinho: é um gesto, não um marcador.
    pgA.wait_for_timeout(2600)
    check('e some sozinho depois de dois segundos',
          pgA.locator('[class*="apontador"]').count() == 0)

    for pg in (pgA, pgB):
        pg.locator('section[aria-label="Chamada em andamento"] button', has_text='Sair').click()
    pgA.wait_for_timeout(600)

    check('nenhum erro de página', not errosA and not errosB,
          '; '.join((errosA + errosB)[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
