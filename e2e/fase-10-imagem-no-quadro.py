"""Imagem no quadro: entra pelo upload de sempre e chega ao outro lado.

O que este roteiro prova, com dois navegadores: inserir uma imagem no quadro
funciona, ela **sobe** pelo caminho de todo upload (e volta servida como WebP,
re-encodada), e aparece desenhada na tela de quem está do outro lado — que é a
parte que nenhum teste de rota alcança, porque os bytes não viajam pelo CRDT.

    docker compose up -d
    pnpm dev
    pnpm dev:seed

    python e2e/fase-10-imagem-no-quadro.py <pasta> [quem] [outro]
"""

import base64
import struct
import sys
import time
import zlib
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


def png_solido(caminho, largura=240, altura=180, cor=(220, 60, 90)):
    """Um PNG de uma cor só, escrito à mão — sem dependência para um retângulo."""
    linhas = b''.join(b'\x00' + bytes(cor) * largura for _ in range(altura))

    def bloco(tipo, dados):
        return (struct.pack('>I', len(dados)) + tipo + dados
                + struct.pack('>I', zlib.crc32(tipo + dados) & 0xFFFFFFFF))

    cabeca = struct.pack('>IIBBBBB', largura, altura, 8, 2, 0, 0, 0)
    caminho.write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + bloco(b'IHDR', cabeca)
        + bloco(b'IDAT', zlib.compress(linhas))
        + bloco(b'IEND', b'')
    )
    return caminho


# Colar é o gesto de verdade — arrastar do desktop e colar dão no mesmo caminho
# dentro do Excalidraw, e o seletor de arquivos do sistema não é automatizável
# de forma estável aqui.
COLAR = """([b64]) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const arquivo = new File([bytes], 'quadrado.png', { type: 'image/png' });
    const dados = new DataTransfer();
    dados.items.add(arquivo);
    const alvo = document.querySelector('.excalidraw') || document.body;
    alvo.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dados, bubbles: true, cancelable: true,
    }));
    return true;
}"""


def tinta(pg):
    return pg.evaluate("""() => {
        const tela = document.querySelector('canvas.excalidraw__canvas.static');
        if (!tela) return -1;
        const d = tela.getContext('2d').getImageData(0, 0, tela.width, tela.height).data;
        const r0 = d[0], g0 = d[1], b0 = d[2];
        let n = 0;
        for (let i = 0; i < d.length; i += 16) {
          if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 30) n += 1;
        }
        return n;
    }""")


marca = str(int(time.time()))[-5:]
NOME = f'Imagens {marca}'
ARQUIVO = png_solido(SHOTS / 'quadrado.png')

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    def entrar(usuario):
        ctx = b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
        pg = ctx.new_page()
        erros = []
        servidas = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.on('response', lambda r: (
            servidas.append((r.url, r.status, r.headers.get('content-type', '')))
            if '/api/files/quadros/' in r.url or '/files/' in r.url and '/boards/' in r.url
            else None
        ))
        pg.goto(f'{BASE}/entrar', wait_until='networkidle')
        pg.fill('input[autocomplete="username"]', usuario)
        pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
        pg.click('button[type="submit"]')
        pg.wait_for_url('**/c/**', timeout=25000)
        pg.wait_for_selector('#compositor', timeout=15000)
        return ctx, pg, erros, servidas

    ctxA, quem, errosA, servidasA = entrar(QUEM)
    ctxB, outro, errosB, servidasB = entrar(OUTRO)

    # --- um quadro novo -------------------------------------------------------
    quem.locator('button[aria-label="Quadros"]').first.click()
    quem.wait_for_selector('aside[aria-label="Quadros"]', timeout=10000)
    quem.fill('input[aria-label="Nome do quadro novo"]', NOME)
    quem.locator('aside[aria-label="Quadros"] button[type="submit"]').click()
    quem.wait_for_selector('canvas', timeout=25000)
    quem.wait_for_timeout(1500)

    check('a ferramenta de imagem está na barra',
          quem.locator('label[title*="Inserir imagem"]').count() == 1)

    # --- inserir a imagem -----------------------------------------------------
    #
    # A ferramenta abre o seletor de arquivos do navegador; o Playwright o
    # intercepta. Depois é um clique no canvas para soltar a imagem.
    caixa = quem.locator('canvas').first.bounding_box()
    quem.mouse.click(caixa['x'] + 420, caixa['y'] + 320)
    quem.evaluate(COLAR, [base64.b64encode(ARQUIVO.read_bytes()).decode()])
    quem.wait_for_timeout(3000)

    check('a imagem entra como um elemento do quadro',
          espera(quem, """() => Number(document.querySelector('[data-elementos]')
              ?.getAttribute('data-elementos') ?? 0) >= 1"""),
          quem.evaluate("""() => document.querySelector('[data-elementos]')
              ?.getAttribute('data-elementos')"""))
    quem.screenshot(path=str(SHOTS / 'i1-com-imagem.png'))

    # --- o outro lado ---------------------------------------------------------
    outro.locator('button[aria-label="Quadros"]').first.click()
    outro.wait_for_selector('aside[aria-label="Quadros"]', timeout=10000)
    outro.locator('aside[aria-label="Quadros"] button', has_text=NOME).first.click()
    outro.wait_for_selector('canvas', timeout=25000)
    outro.wait_for_timeout(3000)

    check('e chega desenhada na tela de quem está do outro lado',
          tinta(outro) > 200, f'{tinta(outro)} pixels de tinta')
    outro.screenshot(path=str(SHOTS / 'i2-do-outro-lado.png'))

    # --- o caminho dos bytes --------------------------------------------------
    #
    # Os bytes **não** viajam pelo CRDT: eles sobem pelo upload de sempre e
    # voltam servidos. Se um dia alguém os enfiar no documento, esta linha some.
    servidas = [s for s in servidasB if '/api/files/quadros/' in s[0]]
    check('a imagem veio servida pelo nosso storage, já re-encodada',
          any(status == 200 and 'image/webp' in tipo for _, status, tipo in servidas),
          '; '.join(f'{st} {tp}' for _, st, tp in servidas[:2]) or 'nenhuma resposta')

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
