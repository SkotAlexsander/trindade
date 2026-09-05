"""Cadastro aberto: um nome, uma senha, e nada mais.

O convite continua existindo — as duas portas servem a momentos diferentes:
abrir o produto para o grupo entrar, e convidar alguém pontualmente depois que
as vagas fecharam. Este roteiro exercita a porta aberta, que é a que a pessoa
encontra quando abre o endereço pela primeira vez.

    pnpm dev
    python e2e/fase-12-cadastro.py .capturas
"""

import secrets
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

# Nome novo a cada execução: o cadastro é irreversível, e um roteiro que só
# passa da primeira vez não é um roteiro.
NOME = f'teste{secrets.randbelow(10**6):06d}'
SENHA = 'cavalo-bateria-grampo-9'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))

    # --- 1. o caminho até o cadastro existe na tela de entrar ---------------
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    link = pg.get_by_role('link', name='Criar uma')
    check('a tela de entrar oferece criar conta', link.count() == 1)

    link.first.click()
    pg.wait_for_url('**/criar-conta', timeout=10000)
    pg.wait_for_timeout(500)

    # --- 2. dois campos, e só ----------------------------------------------
    campos = pg.locator('form input:not([type="hidden"])')
    check('o formulário pede duas coisas: nome e senha', campos.count() == 2,
          f'{campos.count()} campos')
    check('e não pergunta nome de exibição',
          pg.get_by_label('Como quer aparecer').count() == 0)
    pg.screenshot(path=str(SHOTS / 'cadastro-01-vazio.png'))

    # --- 3. criar a conta ---------------------------------------------------
    pg.fill('input[autocomplete="username"]', NOME)
    pg.fill('input[autocomplete="new-password"]', SENHA)
    pg.wait_for_timeout(800)

    botao = pg.get_by_role('button', name='Criar conta')
    check('o botão libera com nome e senha preenchidos', botao.is_enabled())
    botao.click()

    pg.wait_for_url('**/entrar', timeout=20000)
    corpo = pg.locator('body').inner_text()
    check('a conta é criada e a pessoa volta para entrar', 'Conta criada' in corpo,
          corpo[:80].replace('\n', ' '))

    # Sem login automático: exercitar a senha uma vez logo depois de criá-la é
    # o que faz ela ser lembrada. Ver design/06-autenticacao.md.
    guardado = pg.evaluate('() => JSON.stringify(Object.keys(localStorage))')
    check('e nada de credencial no localStorage', guardado == '[]', guardado)

    # --- 4. a senha recém-criada entra --------------------------------------
    pg.fill('input[autocomplete="username"]', NOME)
    pg.fill('input[autocomplete="current-password"]', SENHA)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_timeout(1500)
    check('e a senha recém-criada entra', '/c/' in pg.url, pg.url)
    pg.screenshot(path=str(SHOTS / 'cadastro-02-dentro.png'))

    # --- 5. o nome de exibição virou o nome de usuário ----------------------
    eu = pg.evaluate("""async () => {
        const r = await fetch('/api/users/me', { credentials: 'include' });
        return r.ok ? await r.json() : null;
    }""")
    if eu:
        check('o nome de exibição virou o nome de usuário',
              eu.get('displayName') == NOME, str(eu.get('displayName')))

    # --- 6. o mesmo nome não entra duas vezes -------------------------------
    pg.goto(f'{BASE}/criar-conta', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', NOME)
    pg.fill('input[autocomplete="new-password"]', SENHA)
    pg.wait_for_timeout(800)
    pg.get_by_role('button', name='Criar conta').click()
    pg.wait_for_timeout(2500)
    check('o mesmo nome não entra duas vezes',
          'já está sendo usado' in pg.locator('body').inner_text())

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
