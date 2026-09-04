"""Pessoas e convites — a fatia que fecha a fase 6.

    pnpm dev:seed
    pnpm dev:admin
"""

import sys
import time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'
API = 'http://localhost:3000/api'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def entrar(pg, usuario, senha='cavalo-bateria-grampo-9'):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(1000)


def token(usuario, senha='cavalo-bateria-grampo-9'):
    r = requests.post(f'{API}/auth/login', json={'username': usuario, 'password': senha})
    r.raise_for_status()
    return r.json()['access']


marca = str(int(time.time()))[-5:]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context(
        viewport={'width': 1500, 'height': 950},
        color_scheme='dark',
        permissions=['clipboard-read', 'clipboard-write'],
    )
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pg, 'admin', '010623')

    pg.goto(f'{BASE}/config/pessoas', wait_until='networkidle')
    pg.wait_for_timeout(1800)
    check('a página de pessoas abre', pg.url.endswith('/config/pessoas'), pg.url)

    corpo = pg.inner_text('body')
    check('mostra o elenco com @usuario', '@alex' in corpo and '@carla' in corpo)
    check('e marca qual linha é você', 'você' in corpo)
    # Cinco linhas cabem na tela: nenhum controle que só existiria para listas
    # grandes.
    check('sem busca, sem filtro, sem paginação',
          pg.locator('input[type="search"]').count() == 0
          and 'Página' not in corpo and 'Filtrar' not in corpo)
    pg.screenshot(path=str(SHOTS / '76-pessoas.png'), full_page=True)

    # --- o menu obedece à hierarquia ----------------------------------------
    #
    # A própria conta fica de fora das duas ações: o alcance sobre si mesmo é
    # empate, e o servidor recusa. Oferecer o item seria oferecer um 403.
    check('nenhum menu de ações na sua própria linha',
          pg.locator('button[aria-label="Ações para Admin"]').count() == 0)

    pg.locator('button[aria-label="Ações para Carla Nunes"]').click()
    pg.wait_for_timeout(400)
    itens = pg.evaluate(
        """() => [...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim())"""
    )
    check('admin vê gerenciar cargos e desativar',
          'Gerenciar cargos' in itens and 'Desativar conta' in itens, str(itens))
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)

    # --- desativar pede o nome digitado -------------------------------------
    pg.locator('button[aria-label="Ações para Carla Nunes"]').click()
    pg.wait_for_timeout(400)
    pg.locator('[role="menuitem"]', has_text='Desativar').click()
    pg.wait_for_selector('dialog[open]', timeout=5000)
    pg.wait_for_timeout(400)

    dialogo = pg.locator('dialog[open]')
    texto = dialogo.inner_text()
    # A confirmação explica a consequência real, não a operação.
    check('a confirmação diz que a conexão cai', 'conexão aberta cai' in texto, texto[:120])
    check('que as mensagens ficam', 'continuam no histórico' in texto)
    check('e que dá para reativar', 'reativar depois' in texto)

    confirmar = dialogo.locator('button', has_text='Desativar conta')
    check('e o botão começa desligado', confirmar.is_disabled())

    campo = dialogo.locator('input:not([type="file"])').first
    campo.fill('Carla')
    pg.wait_for_timeout(200)
    check('nome pela metade não libera', confirmar.is_disabled())
    campo.fill('Carla Nunes')
    pg.wait_for_timeout(200)
    check('o nome exato libera', not confirmar.is_disabled())
    pg.screenshot(path=str(SHOTS / '78-desativar.png'))

    confirmar.click()
    pg.wait_for_timeout(2000)
    corpo = pg.inner_text('body')
    check('desativar recolhe a pessoa numa seção à parte', 'Desativadas (' in corpo, corpo[-200:])

    pg.locator('button', has_text='Desativadas').click()
    pg.wait_for_timeout(400)
    check('e a seção abre com o botão de reativar',
          pg.locator('button', has_text='Reativar').count() >= 1)

    # A conexão dela cai na hora: o token de antes deixa de valer.
    r = requests.post(f'{API}/auth/login',
                      json={'username': 'carla', 'password': 'cavalo-bateria-grampo-9'})
    check('e a conta desativada não entra mais', r.status_code >= 400, str(r.status_code))

    pg.locator('button', has_text='Reativar').first.click()
    pg.wait_for_timeout(1800)
    check('reativar devolve a pessoa à lista',
          'Desativadas (' not in pg.inner_text('body'))

    # --- convite -------------------------------------------------------------
    pg.locator('button', has_text='Convidar').first.click()
    pg.wait_for_selector('dialog[open]', timeout=5000)
    # O link é gerado ao abrir, não atrás de um botão.
    pg.wait_for_function(
        """() => {
            const d = document.querySelector('dialog[open]');
            return d && /https?:\\/\\/\\S+\\/entrar\\//.test(d.textContent || '');
        }""",
        timeout=15000,
    )
    check('o link nasce com o diálogo, sem botão de gerar', True)

    convite = pg.locator('dialog[open]').inner_text()
    check('em texto claro, não em rótulo técnico',
          'Vale para uma pessoa' in convite and 'uso único' not in convite.lower(), convite[:120])
    check('e diz o prazo', 'expira em 7 dias' in convite)
    pg.screenshot(path=str(SHOTS / '77-convite.png'))

    link = pg.evaluate(
        """() => (document.querySelector('dialog[open] code')?.textContent || '').trim()"""
    )
    check('o link aponta para /entrar/<código>', '/entrar/' in link, link)

    # A verificação que importa: o link **abre**. Ele apontava para uma rota
    # que não existe, e caía no redirecionamento de rota desconhecida.
    outro = b.new_context(viewport={'width': 1200, 'height': 800})
    pgAnon = outro.new_page()
    pgAnon.goto(link, wait_until='networkidle')
    pgAnon.wait_for_timeout(1200)
    check('e a tela de convite abre de verdade',
          '/entrar/' in pgAnon.url and 'convidou' in pgAnon.inner_text('body').lower(),
          f'{pgAnon.url} :: ' + ' | '.join(pgAnon.inner_text('body').split('\n')[:4]))
    outro.close()

    # --- revogar --------------------------------------------------------------
    abertos = pg.locator('button[aria-label^="Revogar convite"]')
    quantos = abertos.count()
    check('os convites abertos aparecem', quantos >= 1, f'{quantos}')
    abertos.first.click()
    pg.wait_for_timeout(1500)
    check('revogar tira da lista',
          pg.locator('button[aria-label^="Revogar convite"]').count() == quantos - 1)

    # --- e do outro lado ------------------------------------------------------
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(500)

    ctx2 = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark')
    pg2 = ctx2.new_page()
    pg2.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pg2, 'daniel')
    pg2.goto(f'{BASE}/config/pessoas', wait_until='networkidle')
    pg2.wait_for_timeout(1500)
    check('membro comum vê a lista', '@alex' in pg2.inner_text('body'))
    check('mas nenhum menu de ações',
          pg2.locator('button[aria-label^="Ações para"]').count() == 0)

    t = token('daniel')
    alvo = next(u for u in requests.get(f'{API}/users',
                headers={'Authorization': f'Bearer {t}'}).json()['users']
                if u['username'] == 'bruno')
    r = requests.post(f'{API}/users/{alvo["id"]}/disable',
                      headers={'Authorization': f'Bearer {t}'})
    check('e a rota recusa direto na API', r.status_code == 403, f'{r.status_code} {r.text[:60]}')

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    ctx2.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
