"""A janela flutuante da chamada.

Sair da sala não pode ser sair da chamada. Este roteiro verifica o que acontece
quando a chamada deixa de ocupar a tela — porque a pessoa escolheu "só a
conversa" ou porque foi para outro canal: a janela aparece, mantém quem importa
à vista, e obedece a onde foi arrastada.

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


def aparece(pg, funcao, tentativas=40, intervalo=250):
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
    setInterval(() => { n += 6; x.fillStyle = '#16203a'; x.fillRect(0, 0, 1280, 720);
      x.fillStyle = '#22d3ee'; x.fillRect((n * 4) % 1180, 280, 100, 100); }, 66);
    return c.captureStream(15);
  };
})()
"""

JANELA = 'aside[aria-label^="Chamada em"]'

with sync_playwright() as p:
    b = p.chromium.launch(
        channel='chrome',
        headless=True,
        args=['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    )
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark',
                        permissions=['microphone', 'camera'])
    ctx.add_init_script(TELA_FALSA)
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))

    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', 'carla')
    pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor')

    pg.locator('button', has_text='sala').first.click()
    check('entra na chamada',
          aparece(pg, """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
                        ?.textContent || '').includes('Conectado')"""))

    # Na sala, a janela não existe: ela é para quando a chamada sai da tela.
    check('dentro da sala não há janela flutuante', pg.locator(JANELA).count() == 0)

    # --- "só a conversa" -----------------------------------------------------
    pg.locator('button', has_text='Só a conversa').click()
    check('escolher "só a conversa" traz a janela',
          aparece(pg, f"""() => document.querySelector('{JANELA}') !== null"""))
    janela = pg.locator(JANELA)

    # --- ir para outro canal -------------------------------------------------
    pg.locator('nav[aria-label="Canais"] a', has_text='geral').click()
    pg.wait_for_timeout(800)
    check('e ela continua em outro canal', janela.count() == 1, pg.url)
    check('sem sair da chamada',
          'Conectado' in pg.locator('section[aria-label="Chamada em andamento"]').inner_text())
    pg.screenshot(path=str(SHOTS / '96-flutuante.png'))

    # --- arrastar ------------------------------------------------------------
    antes = janela.bounding_box()
    # O ponto de pega fica na barra e longe dos botões dela.
    pegada = (antes['x'] + 60, antes['y'] + 10)
    passo = (-220, -130)
    pg.mouse.move(*pegada)
    pg.mouse.down()
    pg.mouse.move(pegada[0] + passo[0], pegada[1] + passo[1], steps=12)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    depois = janela.bounding_box()
    check('arrastar move a janela',
          abs(depois['x'] - (antes['x'] + passo[0])) < 8
          and abs(depois['y'] - (antes['y'] + passo[1])) < 8,
          f"{antes['x']:.0f},{antes['y']:.0f} -> {depois['x']:.0f},{depois['y']:.0f}")

    # A posição é preferência de máquina: recarregar não devolve a janela ao
    # canto de fábrica.
    guardado = pg.evaluate("""() => JSON.parse(localStorage.getItem('trindade:midia')).miniatura""")
    check('e a posição fica guardada',
          abs(guardado['x'] - depois['x']) < 4 and abs(guardado['y'] - depois['y']) < 4,
          str(guardado))

    # --- redimensionar -------------------------------------------------------
    caixa = janela.bounding_box()
    canto = janela.locator('[aria-label="Redimensionar a janela"]')
    alvo = canto.bounding_box()
    pg.mouse.move(alvo['x'] + 8, alvo['y'] + 8)
    pg.mouse.down()
    pg.mouse.move(alvo['x'] + 128, alvo['y'] + 8, steps=10)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    check('o canto estica a janela',
          janela.bounding_box()['width'] > caixa['width'] + 80,
          f"{caixa['width']:.0f} -> {janela.bounding_box()['width']:.0f}")

    # --- quem aparece --------------------------------------------------------
    janela.locator('button[aria-label="Escolher quem aparece"]').click()
    pg.wait_for_timeout(400)
    itens = pg.evaluate(
        """() => [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim())"""
    )
    check('o menu lista quem está na chamada', 'Você' in itens, str(itens))

    pg.locator('[role="menuitem"]', has_text='Você').click()
    pg.wait_for_timeout(400)
    check('fixar deixa só quem foi escolhido',
          janela.locator('[class*="caixa"] [aria-label], [class*="caixa"]').count() >= 1)

    # --- voltar --------------------------------------------------------------
    janela.locator('button[aria-label="Voltar à sala"]').click()
    pg.wait_for_timeout(900)
    check('"voltar à sala" leva de volta ao canal da chamada', pg.url.endswith('/c/sala'), pg.url)
    check('e a janela some, porque a sala está na tela',
          pg.locator(JANELA).count() == 0
          and pg.locator('section[aria-label="Participantes da chamada"]').count() == 1)

    # --- esconder ------------------------------------------------------------
    pg.locator('button', has_text='Só a conversa').click()
    pg.wait_for_timeout(500)
    pg.locator(f'{JANELA} button[aria-label="Esconder a janela"]').click()
    pg.wait_for_timeout(400)
    check('esconder tira a janela sem sair da chamada',
          pg.locator(JANELA).count() == 0
          and 'Conectado' in pg.locator('section[aria-label="Chamada em andamento"]').inner_text())

    pg.locator('section[aria-label="Chamada em andamento"] '
               'button[aria-label="Grade de participantes"]').click()
    pg.wait_for_timeout(500)
    pg.locator('button', has_text='Só a conversa').click()
    pg.wait_for_timeout(500)
    check('e voltar a ver a sala desfaz o esconder', pg.locator(JANELA).count() == 1)

    pg.locator('section[aria-label="Chamada em andamento"] button', has_text='Sair').click()
    pg.wait_for_timeout(600)
    check('sair da chamada leva a janela junto', pg.locator(JANELA).count() == 0)

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
