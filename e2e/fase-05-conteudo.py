"""Conteúdo da mensagem: markdown, código realçado, menções e links.

Fatia 4 da fase 5. Uma janela basta — o que se verifica aqui é como o texto é
desenhado, não como ele viaja.

    pnpm dev:seed
"""

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

# A conta sai do ambiente: entrar tem limite de 5 por 15 minutos por usuário e
# IP, e este roteiro se repete muito enquanto se mexe no conteúdo da mensagem.
CONTA = os.environ.get('TRINDADE_A', 'alex')


resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    # A área de transferência precisa de permissão: sem ela o `writeText` é
    # recusado, o botão nunca vira "Copiado", e o roteiro acusa um defeito que é
    # dele, não do produto. No navegador de verdade quem concede é a pessoa.
    ctx = b.new_context(viewport={'width': 1440, 'height': 950}, color_scheme='dark',
                        permissions=['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))

    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', CONTA)
    pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.goto(f'{BASE}/c/bugs', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(1200)

    marca = str(int(time.time()))[-6:]

    def escrever(texto):
        pg.click('#compositor')
        pg.fill('#compositor', texto)
        pg.keyboard.press('Enter')
        pg.wait_for_timeout(800)

    def ultima():
        return pg.locator('article[class*="mensagem"]').last

    # --- 1. ênfase e código em linha ---------------------------------------
    escrever(f'**forte** *leve* ~~fora~~ `codigo` {marca}')
    m = ultima()
    check('negrito', m.locator('strong').count() == 1)
    check('itálico', m.locator('em').count() == 1)
    check('riscado', m.locator('s').count() == 1)
    check('código em linha', m.locator('code[class*="codigoEmLinha"]').count() == 1)

    # --- 2. o que **não** é markdown aqui -----------------------------------
    escrever(f'# Título não vira título {marca}')
    check('`#` com espaço não vira título', ultima().locator('h1, h2, h3').count() == 0)
    check('e o texto aparece como foi escrito', '# Título' in ultima().inner_text())

    escrever(f'![alt](https://exemplo.com/x.png) {marca}')
    check('imagem por URL não vira imagem', ultima().locator('img').count() == 0)

    # --- 3. menção e canal ---------------------------------------------------
    escrever(f'oi @daniel, veja #geral {marca}')
    m = ultima()
    check('menção vira objeto com o nome de exibição',
          'Daniel' in m.locator('span[class*="mencao"]').first.inner_text())
    check('canal vira objeto clicável', m.locator('button[class*="mencao"]').count() == 1)

    # A regra do documento fala em trocar de família, mas isso foi escrito
    # quando o corpo era serifado: hoje `--font-read` e `--font-ui` são a mesma
    # família e a comparação passaria sem verificar nada. O que de fato separa
    # a menção do texto é o par fundo + peso.
    estilo = m.locator('span[class*="mencao"]').first.evaluate(
        """el => {
            const s = getComputedStyle(el);
            const c = getComputedStyle(el.closest('p, div'));
            return { fundo: s.backgroundColor, peso: s.fontWeight,
                     fundoDoCorpo: c.backgroundColor, pesoDoCorpo: c.fontWeight };
        }"""
    )
    check('a menção tem fundo próprio',
          estilo['fundo'] != estilo['fundoDoCorpo'] and 'rgba(0, 0, 0, 0)' not in estilo['fundo'],
          estilo['fundo'])
    check('e peso maior que o do corpo',
          int(estilo['peso']) > int(estilo['pesoDoCorpo']),
          f"{estilo['peso']} contra {estilo['pesoDoCorpo']}")

    escrever(f'`@daniel` dentro de código {marca}')
    check('menção dentro de código não vira menção',
          ultima().locator('span[class*="mencao"]').count() == 0)

    # A linha só acende para quem foi citado.
    escrever(f'@{CONTA} é você mesmo {marca}')
    check('a linha acende quando citam você',
          ultima().get_attribute('data-mencionado') == 'true')

    # --- 4. links -------------------------------------------------------------
    escrever(f'veja https://exemplo.com/pagina {marca}')
    link = ultima().locator('a[class*="link"]').first
    check('URL solta vira link', link.count() == 1)
    check('com noopener e noreferrer',
          'noopener' in (link.get_attribute('rel') or '')
          and 'noreferrer' in (link.get_attribute('rel') or ''))

    escrever(f'[clique](javascript:alert(1)) {marca}')
    check('link com destino executável não vira link',
          ultima().locator('a').count() == 0)

    # --- 5. citação, lista e spoiler ------------------------------------------
    escrever(f'> citada {marca}')
    check('citação', ultima().locator('blockquote').count() == 1)

    escrever(f'- um\n- dois\n- três {marca}')
    check('lista com três itens', ultima().locator('ul li').count() == 3)

    escrever(f'||escondido|| {marca}')
    spoiler = ultima().locator('button[class*="spoiler"]').first
    check('spoiler nasce fechado', spoiler.get_attribute('data-aberto') != 'true')
    escondido = spoiler.evaluate('el => getComputedStyle(el).color')
    check('e o texto não é legível', 'rgba(0, 0, 0, 0)' in escondido, escondido)
    spoiler.click()
    pg.wait_for_timeout(200)
    check('clicar revela', spoiler.get_attribute('data-aberto') == 'true')

    # --- 6. bloco de código ----------------------------------------------------
    codigo = '```ts\ninterface A {\n  b: string;\n}\n```'
    escrever(codigo)
    pg.wait_for_timeout(2500)
    bloco = ultima().locator('div[class*="bloco"]').first
    check('bloco de código com barra de linguagem',
          'ts' in bloco.locator('span[class*="blocoLingua"]').inner_text())
    coloridos = bloco.locator('pre code span[style*="color"]').count()
    check('o realce colore os tokens', coloridos > 3, f'{coloridos} pedaços')

    # `**1**` dentro da cerca é literal.
    escrever('```\nliteral **aqui** @daniel\n```')
    pg.wait_for_timeout(600)
    check('dentro da cerca nada é interpretado',
          ultima().locator('strong').count() == 0
          and ultima().locator('span[class*="mencao"]').count() == 0)

    # Copiar vira "Copiado" e volta.
    ultima().locator('div[class*="bloco"]').first.hover()
    pg.wait_for_timeout(200)
    copiar = ultima().locator('button[class*="blocoCopiar"]').first
    copiar.click()
    pg.wait_for_timeout(200)
    # `[data-kind]` é o toast de verdade — o mesmo seletor da fase 3. A região
    # `[role="status"]` existe sempre, com um `div` vazio dentro, e contar esse
    # `div` acusava um toast que nunca houve.
    toasts = pg.locator('[role="status"] [data-kind]').count()
    check('copiar vira "Copiado", sem toast',
          copiar.inner_text() == 'Copiado' and toasts == 0,
          f'botão={copiar.inner_text()!r} toasts={toasts}')
    pg.wait_for_timeout(1700)
    check('e volta sozinho depois de 1,5s', copiar.inner_text() == 'Copiar')

    # Acima de 15 linhas colapsa.
    longo = '```\n' + '\n'.join(f'linha {i}' for i in range(1, 26)) + '\n```'
    escrever(longo)
    pg.wait_for_timeout(600)
    grande = ultima().locator('div[class*="bloco"]').first
    check('acima de 15 linhas nasce colapsado',
          grande.get_attribute('data-colapsado') == 'true')
    ultima().locator('button[class*="mostrarTudo"]').click()
    pg.wait_for_timeout(300)
    check('"Mostrar tudo" abre', grande.get_attribute('data-colapsado') != 'true')

    pg.screenshot(path=str(SHOTS / '59-conteudo.png'))

    # --- 7. tema claro ---------------------------------------------------------
    # O bloco de código não acompanha o tema: é superfície de terminal. O que
    # não pode acontecer é texto quase preto sobre fundo quase preto.
    pg.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
    pg.wait_for_timeout(400)
    contraste = pg.evaluate(
        """() => {
            const pre = document.querySelector('pre[class*="blocoCodigo"]');
            const bloco = pre.closest('div[class*="bloco"]');
            const lum = (c) => {
                const [r, g, b] = c.match(/\\d+/g).slice(0, 3).map(Number);
                const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const a = lum(getComputedStyle(pre).color);
            const b = lum(getComputedStyle(bloco).backgroundColor);
            const [hi, lo] = a > b ? [a, b] : [b, a];
            return (hi + 0.05) / (lo + 0.05);
        }"""
    )
    check('o bloco de código continua legível no tema claro',
          contraste > 4.5, f'{contraste:.1f}:1')
    pg.screenshot(path=str(SHOTS / '60-conteudo-claro.png'))

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    b.close()

passou = sum(1 for _, ok, _ in resultados if ok)
print(f'\n{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
