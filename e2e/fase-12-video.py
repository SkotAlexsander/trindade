"""Vídeo do YouTube assistido aqui dentro — e nada carregado antes do play.

O pedido do dono do projeto foi "ver vídeo do YouTube porém no app, apenas o
vídeo, não a navegação". A parte difícil não é o iframe: é que abrir a conversa
**não** pode entregar o IP de quem lê ao Google. A prévia inteira é buscada pelo
servidor e a miniatura é re-encodada pelo `sharp`; o quadro do YouTube só nasce
quando alguém aperta o play.

Este roteiro verifica exatamente isso: manda um link, confere que o cartão veio
do nosso domínio, confere que nenhuma requisição saiu para fora, aperta o play e
só então espera ver o quadro.

    pnpm dev:seed
    python e2e/fase-12-video.py .capturas [conta]
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'
CONTA = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('TRINDADE_A', 'alex')
SENHA = '010623' if CONTA == 'admin' else 'cavalo-bateria-grampo-9'

# Um vídeo que existe há quinze anos e não vai sumir.
VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
    pg = ctx.new_page()

    externas = []
    pg.on('request', lambda r: (
        externas.append(r.url)
        if not r.url.startswith(BASE) and not r.url.startswith('data:') else None
    ))
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))

    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', CONTA)
    pg.fill('input[autocomplete="current-password"]', SENHA)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.goto(f'{BASE}/c/bugs', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(1000)

    externas.clear()

    # --- 1. o cartão nasce como capa, não como player -----------------------
    pg.fill('#compositor', VIDEO)
    pg.keyboard.press('Enter')
    pg.wait_for_selector('[class*="videoCapa"]', timeout=20000)
    pg.wait_for_timeout(1500)

    capa = pg.locator('[class*="videoCapa"]').last
    check('o link vira uma capa de vídeo, não um cartão de link comum', capa.count() == 1)
    check('e nenhum iframe existe ainda', pg.locator('iframe').count() == 0)

    titulo = pg.locator('[class*="videoTitulo"]').last.inner_text()
    check('a capa traz o título do vídeo', len(titulo) > 10, titulo[:60])

    src = pg.locator('[class*="videoImagem"]').last.get_attribute('src') or ''
    check('a miniatura vem do nosso domínio, não do Google',
          src.startswith('/api/link-preview/thumb/'), src[:60])

    # --- 2. até aqui, nada saiu daqui ---------------------------------------
    de_fora = [u for u in externas if 'youtube' in u or 'ytimg' in u or 'google' in u]
    check('abrir a conversa não fala com o Google', not de_fora, '; '.join(de_fora[:2]))
    pg.screenshot(path=str(SHOTS / 'video-01-capa.png'))

    # --- 3. o play é a permissão -------------------------------------------
    pedidos_de_video = []
    pg.on('request', lambda r: (
        pedidos_de_video.append(r.url)
        if 'googlevideo.com' in r.url or '/youtubei/v1/player' in r.url else None
    ))
    capa.click()
    pg.wait_for_selector('iframe', timeout=15000)
    pg.wait_for_timeout(2500)

    quadro = pg.locator('iframe').last
    endereco = quadro.get_attribute('src') or ''
    check('só depois do play existe o quadro do YouTube', pg.locator('iframe').count() >= 1)
    check('e ele é o domínio sem cookie',
          endereco.startswith('https://www.youtube-nocookie.com/embed/'), endereco[:70])

    # "Apenas o vídeo, não a navegação."
    for parametro, oque in [
        ('rel=0', 'sem sugestões de outros canais no fim'),
        ('modestbranding=1', 'com a marca do player reduzida'),
        ('iv_load_policy=3', 'sem anotações sobrepostas'),
    ]:
        check(f'{oque} ({parametro})', parametro in endereco)

    check('e o instante do link é respeitado quando existe',
          't=' not in VIDEO or 'start=' in endereco, endereco[-40:])

    # A CSP tem de permitir **este** quadro e nenhum outro.
    check('o quadro tem tamanho', quadro.evaluate('(el) => el.clientWidth > 100'))

    # Tamanho não basta: a tela de "Erro 153" também é larga, e foi exatamente
    # assim que a primeira versão deste roteiro passou com o player recusado —
    # `referrerpolicy="no-referrer"` fazia o YouTube negar o embed. O sinal que
    # distingue os dois é o player **pedir o vídeo**: quando ele recusa, não
    # pede nada.
    check('e o player realmente foi buscar o vídeo (não é a tela de erro)',
          bool(pedidos_de_video), f'{len(pedidos_de_video)} pedidos de mídia')

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))
    pg.screenshot(path=str(SHOTS / 'video-02-tocando.png'))

    ctx.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
