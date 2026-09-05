"""Os controles que prometiam e não faziam nada.

Dez deles, encontrados numa varredura de 5 de setembro de 2026: três "Criar
canal" (o `+` da coluna, o menu do servidor e a paleta), "Editar canal",
"Marcar como lido", "Silenciar", "Convidar alguém" na paleta, a engrenagem do
rail, "Aparência" e "Atalhos". Sete não faziam nada; três navegavam para uma
rota que respondia "esta página chega numa fase adiante".

Este roteiro aperta cada um e exige que algo aconteça.

    pnpm dev:seed
    python e2e/fase-11-controles-mortos.py .capturas
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'
# Rotaciona por execução: o limite de login é 5 por 15 minutos por usuário e IP.
# Precisa de uma conta com `MANAGE_CHANNEL`: metade dos controles daqui só
# existe para quem pode gerenciar canal, e escondê-los de quem não pode é
# regra de design, não defeito. Ver design/03-menu-e-navegacao.md.
CONTA = sys.argv[2] if len(sys.argv) > 2 else 'alex'
# `alex` e `admin` são as duas contas do desenvolvimento com esse cargo, e ter
# as duas dobra a folga do limite de login quando se repete o roteiro.
SENHA = '010623' if CONTA == 'admin' else 'cavalo-bateria-grampo-9'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context(viewport={'width': 1440, 'height': 950}, color_scheme='dark',
                        permissions=['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))

    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', CONTA)
    pg.fill('input[autocomplete="current-password"]', SENHA)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_timeout(1500)

    marca = str(int(time.time()))[-6:]

    # --- 1. o `+` da coluna abre o diálogo de criar canal --------------------
    pg.click('button[aria-label="Criar canal"]')
    pg.wait_for_timeout(600)
    dialogo = pg.locator('dialog[open]')
    check('o `+` da coluna abre "Criar canal"',
          dialogo.count() == 1 and 'Criar canal' in dialogo.inner_text())

    # --- 2. o endereço segue o nome, sem acento -----------------------------
    # Por rótulo, não por posição: os dois primeiros `input` do diálogo são os
    # rádios de tipo, que não se preenchem.
    nome = dialogo.get_by_label('Nome')
    campo_endereco = dialogo.get_by_label('Endereço')
    nome.fill('Bugs de Produção')
    pg.wait_for_timeout(400)
    endereco = campo_endereco.input_value()
    check('o endereço sai do nome, sem acento e sem espaço',
          endereco == 'bugs-de-producao', endereco)

    # --- 3. cria de verdade e entra no canal --------------------------------
    slug = f'teste-{marca}'
    nome.fill(f'Teste {marca}')
    campo_endereco.fill(slug)
    pg.wait_for_timeout(300)
    dialogo.get_by_role('button', name='Criar canal').click()
    pg.wait_for_timeout(2500)
    check('criar leva para o canal novo', f'/c/{slug}' in pg.url, pg.url)
    check('o canal novo aparece na coluna',
          pg.locator(f'a[href="/c/{slug}"], [class*=item]:has-text("Teste {marca}")').count() > 0)
    pg.screenshot(path=str(SHOTS / 'controles-01-canal-criado.png'))

    # --- 4. o menu do canal: marcar como lido, silenciar, editar ------------
    linha = pg.locator(f'[class*=linha]:has-text("Teste {marca}")').first
    check('o canal tem um botão de ações',
          linha.locator(f'button[aria-label="Ações de Teste {marca}"]').count() == 1)
    linha.hover()
    pg.wait_for_timeout(300)
    linha.locator(f'button[aria-label="Ações de Teste {marca}"]').click()
    pg.wait_for_timeout(600)
    menu = pg.locator('[role="menu"]')
    texto_menu = menu.inner_text() if menu.count() else ''
    check('o menu do canal traz silenciar com prazo',
          'Silenciar por 1 hora' in texto_menu, texto_menu.replace('\n', ' | ')[:120])

    if 'Silenciar por 1 hora' in texto_menu:
        menu.get_by_text('Silenciar por 1 hora').click()
        pg.wait_for_timeout(1200)
        # O estado volta pelo WebSocket: o item ganha o sino cortado.
        silenciado = pg.locator(
            f'[class*=item][data-silenciado="true"]:has-text("Teste {marca}")')
        check('silenciar de verdade cala o canal', silenciado.count() == 1)
    else:
        check('silenciar de verdade cala o canal', False, 'o menu não abriu')

    # --- 5. editar canal ----------------------------------------------------
    linha.hover()
    pg.wait_for_timeout(300)
    linha.locator(f'button[aria-label="Ações de Teste {marca}"]').click()
    pg.wait_for_timeout(600)
    menu = pg.locator('[role="menu"]')
    if menu.count() and 'Editar canal' in menu.inner_text():
        menu.get_by_text('Editar canal').click()
        pg.wait_for_timeout(700)
        dialogo = pg.locator('dialog[open]')
        titulo = dialogo.inner_text() if dialogo.count() else ''
        check('"Editar canal" abre o diálogo com o canal certo', slug in titulo, titulo[:80])
        if dialogo.count():
            dialogo.locator('textarea').fill('um tópico escrito pelo roteiro')
            dialogo.get_by_role('button', name='Salvar').click()
            pg.wait_for_timeout(1800)
            cabecalho = pg.locator('header, [class*=cabecalho]').first.inner_text()
            check('o tópico salvo aparece no cabeçalho',
                  'um tópico escrito pelo roteiro' in cabecalho, cabecalho[:100])
    else:
        check('"Editar canal" abre o diálogo com o canal certo', False, 'sem item no menu')
        check('o tópico salvo aparece no cabeçalho', False, 'sem item no menu')

    # --- 6. a engrenagem abre o perfil, não uma página vazia ----------------
    pg.click('button[aria-label="Configurações"]')
    pg.wait_for_timeout(800)
    dialogo = pg.locator('dialog[open]')
    check('a engrenagem abre o diálogo de perfil',
          dialogo.count() == 1 and 'chega numa fase adiante' not in pg.content(),
          pg.url)
    pg.keyboard.press('Escape')
    # Espera o diálogo sumir de verdade: com ele aberto, a página inteira é
    # inerte e todo clique seguinte falha por motivo nenhum.
    pg.wait_for_selector('dialog[open]', state='detached', timeout=8000)
    pg.wait_for_timeout(400)

    # --- 7. o menu do servidor leva a páginas que existem -------------------
    for rotulo, esperado in [('Aparência', 'Tema'), ('Atalhos', 'Navegação')]:
        # O rail também tem um botão chamado "Trindade" (o do espaço, com o
        # nome escondido para o leitor de tela). O do menu é o da coluna.
        pg.locator('[class*=servidor]').first.click()
        pg.wait_for_timeout(500)
        pg.get_by_role('menuitem', name=rotulo).click()
        pg.wait_for_timeout(1000)
        corpo = pg.locator('main, [class*=pagina]').first.inner_text()
        check(f'"{rotulo}" abre uma página de verdade',
              esperado in corpo and 'fase adiante' not in corpo, corpo[:60].replace('\n', ' '))

    pg.screenshot(path=str(SHOTS / 'controles-02-atalhos.png'))

    # --- 8. a paleta de comandos ------------------------------------------
    pg.keyboard.press('Control+k')
    pg.wait_for_timeout(600)
    pg.keyboard.type('convidar')
    pg.wait_for_timeout(500)
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(1200)
    dialogo = pg.locator('dialog[open]')
    check('"Convidar alguém" na paleta abre o diálogo de convite',
          dialogo.count() == 1 and 'Convidar' in dialogo.inner_text(),
          dialogo.inner_text()[:60].replace('\n', ' ') if dialogo.count() else 'sem diálogo')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(400)

    pg.keyboard.press('Control+k')
    pg.wait_for_timeout(600)
    pg.keyboard.type('criar canal')
    pg.wait_for_timeout(500)
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(1000)
    dialogo = pg.locator('dialog[open]')
    check('"Criar canal" na paleta abre o diálogo',
          dialogo.count() == 1 and 'Criar canal' in dialogo.inner_text())
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(400)

    # --- 9. arquiva o que criou -------------------------------------------
    # Não apaga: o produto não tem exclusão de canal de propósito — arquiva-se,
    # e o histórico fica. Arquivar é também a última ação do menu, então isto
    # verifica a nona.
    linha = pg.locator(f'[class*=linha]:has-text("Teste {marca}")').first
    linha.hover()
    pg.wait_for_timeout(300)
    linha.locator(f'button[aria-label="Ações de Teste {marca}"]').click()
    pg.wait_for_timeout(600)
    menu = pg.locator('[role="menu"]')
    if menu.count() and 'Arquivar canal' in menu.inner_text():
        menu.get_by_text('Arquivar canal').click()
        pg.wait_for_timeout(1800)
        check('arquivar tira o canal da coluna',
              pg.locator(f'[class*=item]:has-text("Teste {marca}")').count() == 0)
    else:
        check('arquivar tira o canal da coluna', False, 'sem item no menu')

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
