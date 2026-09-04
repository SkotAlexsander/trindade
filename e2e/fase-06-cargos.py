"""Cargos e permissões.

Fatia 4 da fase 6. A lista da esquerda **é** a hierarquia, e é isso que este
roteiro verifica dos dois lados: o que a tela esconde e o que o servidor recusa.

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
    ctx = b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pg, 'admin', '010623')

    pg.goto(f'{BASE}/config/cargos', wait_until='networkidle')
    pg.wait_for_timeout(1800)

    # A rota não pode devolver para a conversa: o shell mandava de volta
    # qualquer caminho sem `slug`, e `/config/...` também não tem.
    check('a página de cargos abre e fica', pg.url.endswith('/config/cargos'), pg.url)

    lista = pg.locator('[aria-label="Cargos"] li button')
    check('a lista traz os cargos', lista.count() >= 2, f'{lista.count()} cargos')
    nomes = pg.evaluate(
        """() => [...document.querySelectorAll('[aria-label="Cargos"] li button')]
            .map(b => b.textContent.trim())"""
    )
    check('do mais alto para o mais baixo', nomes[0].startswith('Admin'), str(nomes))

    # --- permissões em linguagem de gente -----------------------------------
    corpo = pg.inner_text('body')
    check('nomes de permissão em português, não constantes',
          'Apagar mensagens de outros' in corpo and 'DELETE_ANY_MESSAGE' not in corpo)
    check('agrupadas por área',
          all(g in corpo for g in ('CONVERSA', 'CHAMADA', 'ADMINISTRAÇÃO')), corpo[:0])

    interruptores = pg.locator('[role="switch"]')
    check('interruptores anunciam ligado/desligado, não marcado',
          interruptores.count() >= 10, f'{interruptores.count()}')

    # --- ADMINISTRATOR separado, com o aviso literal -------------------------
    admin = pg.locator('[role="switch"]', has_text='Administrador').last
    check('ADMINISTRATOR aparece separado no fim', admin.count() == 1)
    check('com o aviso literal',
          'concede acesso total' in admin.inner_text(), admin.inner_text()[:80])
    check('e é o último da página',
          pg.evaluate("""() => {
              const todos = [...document.querySelectorAll('[role=switch]')];
              return todos[todos.length - 1].textContent.includes('Administrador');
          }"""))
    pg.screenshot(path=str(SHOTS / '75-cargos.png'), full_page=True)

    # --- salvamento automático ----------------------------------------------
    check('nenhum "Salvo" antes de mexer em nada', 'Salvo' not in pg.inner_text('body'))

    pg.locator('[aria-label="Cargos"] li button', has_text='Membro').click()
    pg.wait_for_timeout(600)
    alvo = pg.locator('[role="switch"]', has_text='Silenciar outras pessoas').first
    antes = alvo.get_attribute('aria-checked')
    alvo.click()
    pg.wait_for_timeout(300)
    check('não salva na hora — espera 800ms', 'Salvo' not in pg.inner_text('body'))
    pg.wait_for_timeout(1600)
    check('e depois avisa "Salvo"', 'Salvo' in pg.inner_text('body'))

    pg.reload(wait_until='networkidle')
    pg.wait_for_timeout(2000)
    pg.locator('[aria-label="Cargos"] li button', has_text='Membro').click()
    pg.wait_for_timeout(800)
    depois = pg.locator('[role="switch"]', has_text='Silenciar outras pessoas').first.get_attribute(
        'aria-checked'
    )
    check('a mudança sobrevive ao recarregar', depois != antes, f'{antes} -> {depois}')

    # Devolve ao estado anterior, para o roteiro poder rodar de novo.
    pg.locator('[role="switch"]', has_text='Silenciar outras pessoas').first.click()
    pg.wait_for_timeout(1800)

    # --- criar e apagar ------------------------------------------------------
    quantos = pg.locator('[aria-label="Cargos"] li button').count()
    pg.locator('button', has_text='Criar cargo').click()
    pg.wait_for_timeout(1500)
    check('criar acrescenta um cargo',
          pg.locator('[aria-label="Cargos"] li button').count() == quantos + 1)

    # Nasce **abaixo** de quem criou: deixar o cliente escolher a posição daria
    # um caminho de uma chamada até o topo da hierarquia.
    novos = pg.evaluate(
        """() => [...document.querySelectorAll('[aria-label="Cargos"] li button')]
            .map(b => b.textContent.trim())"""
    )
    check('e não nasce no topo', not novos[0].startswith('Cargo novo'), str(novos))

    pg.fill('input[maxlength="24"]', f'Revisão {marca}')
    pg.wait_for_timeout(1600)
    check('renomear salva sozinho',
          f'Revisão {marca}' in pg.inner_text('[aria-label="Cargos"]'))

    pg.locator('button[aria-label="Apagar cargo"]').click()
    pg.wait_for_timeout(1500)
    check('apagar tira da lista',
          pg.locator('[aria-label="Cargos"] li button').count() == quantos)

    # --- a hierarquia, vista de baixo ---------------------------------------
    ctx2 = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark')
    pg2 = ctx2.new_page()
    pg2.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pg2, 'daniel')
    pg2.goto(f'{BASE}/config/cargos', wait_until='networkidle')
    pg2.wait_for_timeout(1500)
    texto2 = pg2.inner_text('body')
    check('sem MANAGE_ROLES a página recusa',
          'não tem permissão' in texto2, texto2[-120:].replace('\n', ' | '))

    # E o servidor recusa de qualquer forma — esconder um botão não é controle
    # de acesso, e é isso que esta linha prova.
    t = token('daniel')
    cargos = requests.get(f'{API}/roles', headers={'Authorization': f'Bearer {t}'}).json()['roles']
    idDoAdmin = next(r['id'] for r in cargos if r['name'] == 'Admin')
    r = requests.patch(
        f'{API}/roles/{idDoAdmin}',
        headers={'Authorization': f'Bearer {t}'},
        json={'name': 'invadido'},
    )
    check('e a rota também, direto na API', r.status_code == 403, f'{r.status_code} {r.text[:60]}')
    check('com MISSING_PERMISSION', r.json().get('code') == 'MISSING_PERMISSION', r.text[:80])

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    ctx2.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
