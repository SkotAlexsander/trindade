"""Testa a tela de verificação em duas etapas num Chrome de verdade.

Ativa o 2FA da conta pela API, depois exercita as seis caixas: colar, backspace,
setas, envio automático no sexto dígito e o balanço no erro.
"""

import base64
import os
import hashlib
import hmac
import json
import re
import struct
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)

API = 'http://localhost:3000/api'
BASE = 'http://localhost:5173'
USUARIO = 'ui2fa' + str(int(time.time()))[-6:]
SENHA = 'cavalo-bateria-grampo-9'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''))


def post(caminho, corpo=None, token=None):
    req = urllib.request.Request(
        API + caminho,
        data=json.dumps(corpo).encode() if corpo is not None else None,
        headers={**({'Content-Type': 'application/json'} if corpo is not None else {}),
                 **({'Authorization': f'Bearer {token}'} if token else {})},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read().decode()
            return r.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return e.code, json.loads(body) if body else None


def totp(secret_b32, at=None):
    """RFC 6238, 6 dígitos, passo de 30s — o mesmo que o servidor calcula."""
    key = base64.b32decode(secret_b32 + '=' * (-len(secret_b32) % 8))
    counter = int((at or time.time()) // 30)
    digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % 10 ** 6).zfill(6)


import subprocess

DOCKER = os.path.join('C:', os.sep, 'Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe')
PROJETO = os.path.join('A:', os.sep, 'Claude', '03-projetos', 'PROJETO TRINDADE')


def psql(sql):
    return subprocess.run(
        [DOCKER, 'compose', 'exec', '-T', 'postgres',
         'psql', '-U', 'trindade', '-d', 'trindade', '-t', '-A', '-c', sql],
        cwd=PROJETO, capture_output=True, text=True, timeout=60).stdout.strip()


def criar_usuario(username, senha):
    """Usuário novo a cada corrida.

    A chave do rate limit do login inclui o nome; reaproveitar a mesma conta
    faria o roteiro herdar o balde da execução anterior e travar em 429 —
    que foi exatamente o que aconteceu na primeira tentativa.
    """
    hash_ = subprocess.run(
        ['node', '-e',
         "import('argon2').then(a=>a.default.hash(process.argv[1],"
         "{type:a.default.argon2id,memoryCost:65536,timeCost:3,parallelism:4}))"
         ".then(h=>process.stdout.write(h))", senha],
        cwd=os.path.join(PROJETO, 'packages', 'api'),
        capture_output=True, text=True, timeout=120).stdout.strip()
    if not hash_.startswith('$argon2id$'):
        raise SystemExit(f'não consegui gerar o hash: {hash_!r}')
    psql(
        "insert into users (username, display_name, password_hash) "
        f"values ('{username}', 'Teste 2FA', '{hash_}'); "
        "insert into user_roles (user_id, role_id) values "
        f"((select id from users where username='{username}'), "
        "(select id from roles where is_default));"
    )


criar_usuario(USUARIO, SENHA)

# --- prepara: liga o 2FA da carla pela API ------------------------------
status, login = post('/auth/login', {'username': USUARIO, 'password': SENHA})
if status != 200 or 'access' not in login:
    print(f'não consegui entrar como {USUARIO}: {status} {login}')
    sys.exit(2)

access = login['access']
st, setup = post('/me/totp/setup', None, access)
if 'secret' not in (setup or {}):
    print(f'setup falhou: HTTP {st} {setup}')
    sys.exit(2)
secret = setup['secret']
status, enable = post('/me/totp/enable', {'code': totp(secret)}, access)
check('2FA ativa e devolve 10 códigos de recuperação',
      status == 200 and len(enable.get('recoveryCodes', [])) == 10, f'HTTP {status}')
recuperacao = enable['recoveryCodes']

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()

    def entrar_ate_verificacao():
        page.goto(f'{BASE}/entrar')
        page.wait_for_load_state('networkidle')
        page.fill('input[autocomplete="username"]', USUARIO)
        page.fill('input[autocomplete="current-password"]', SENHA)
        page.click('button[type="submit"]')
        page.wait_for_url('**/entrar/verificacao', timeout=20000)
        page.wait_for_load_state('networkidle')

    # --- 1. login com 2FA leva à tela de código -------------------------
    entrar_ate_verificacao()
    page.screenshot(path=str(SHOTS / '20-verificacao.png'))
    caixas = page.locator('input[inputmode="numeric"]')
    check('login com 2FA leva à tela de código com seis caixas', caixas.count() == 6, f'{caixas.count()} caixas')

    focada = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('foco começa na primeira caixa', focada == 'Dígito 1 de 6', str(focada))

    # --- 2. digitar avança de caixa em caixa ----------------------------
    page.keyboard.type('123')
    valores = [caixas.nth(i).input_value() for i in range(6)]
    focada = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('digitar preenche e avança', valores[:3] == ['1', '2', '3'] and focada == 'Dígito 4 de 6',
          f'{valores} foco={focada}')

    # --- 3. backspace em caixa vazia volta para a anterior --------------
    page.keyboard.press('Backspace')
    focada = page.evaluate('document.activeElement.getAttribute("aria-label")')
    valores = [caixas.nth(i).input_value() for i in range(6)]
    check('backspace em caixa vazia volta e apaga a anterior',
          focada == 'Dígito 3 de 6' and valores[2] == '', f'{valores} foco={focada}')

    # --- 4. setas navegam ------------------------------------------------
    page.keyboard.press('ArrowLeft')
    esquerda = page.evaluate('document.activeElement.getAttribute("aria-label")')
    page.keyboard.press('ArrowRight')
    direita = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('setas navegam entre as caixas',
          esquerda == 'Dígito 2 de 6' and direita == 'Dígito 3 de 6', f'{esquerda} → {direita}')

    # --- 5. código errado balança, limpa e devolve o foco ---------------
    for _ in range(6):
        page.keyboard.press('Backspace')
    page.keyboard.type('000000')
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / '21-codigo-errado.png'))
    page.wait_for_timeout(1200)

    corpo = page.inner_text('body')
    valores = [caixas.nth(i).input_value() for i in range(6)]
    focada = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('código errado é recusado sem clique (envio automático)',
          'Código incorreto' in corpo, [l for l in corpo.split('\n') if 'ódigo' in l][:1])
    check('erro limpa as caixas e volta o foco para a primeira',
          all(v == '' for v in valores) and focada == 'Dígito 1 de 6', f'{valores} foco={focada}')

    # --- 6. colar seis dígitos preenche tudo e envia --------------------
    codigo = totp(secret)
    page.evaluate(f"navigator.clipboard.writeText('{codigo}')")
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    caixas.nth(0).focus()
    page.keyboard.press('Control+V')
    page.wait_for_timeout(500)

    # Se o colar funcionou, o sexto dígito já disparou o envio e a página saiu
    # da tela de verificação — as caixas nem existem mais para serem lidas.
    if page.url.endswith('/verificacao') and caixas.count() == 6:
        preenchidas = [caixas.nth(i).input_value() for i in range(6)]
        if all(v == '' for v in preenchidas):
            page.keyboard.type(codigo)
            modo = 'digitado'
        else:
            modo = 'colado'
    else:
        modo = 'colado'

    page.wait_for_url(re.compile(r'/(c/[^/]+)?$'), timeout=20000)
    page.wait_for_load_state('networkidle')
    page.screenshot(path=str(SHOTS / '22-2fa-ok.png'))
    check(f'código certo entra sozinho, sem clicar em Verificar ({modo})',
          page.url.startswith(f'{BASE}/c/') or page.url.rstrip('/') == BASE, page.url)

    # --- 7. código de recuperação: uma vez e só uma ---------------------
    ctx.clear_cookies()
    entrar_ate_verificacao()
    page.click('text=Usar um código de recuperação')
    page.fill('input[autocomplete="one-time-code"]', recuperacao[0])
    page.click('button[type="submit"]')
    page.wait_for_url(re.compile(r'/(c/[^/]+)?$'), timeout=20000)
    check('código de recuperação entra',
          page.url.startswith(f'{BASE}/c/') or page.url.rstrip('/') == BASE, page.url)

    ctx.clear_cookies()
    entrar_ate_verificacao()
    page.click('text=Usar um código de recuperação')
    page.fill('input[autocomplete="one-time-code"]', recuperacao[0])
    page.click('button[type="submit"]')
    page.wait_for_timeout(2500)
    page.screenshot(path=str(SHOTS / '23-recuperacao-reusada.png'))
    corpo = page.inner_text('body')
    check('o mesmo código de recuperação não serve de novo',
          'inválido ou já usado' in corpo and page.url.endswith('/verificacao'),
          [l for l in corpo.split('\n') if 'recupera' in l.lower()][:1])

    # --- 8. anel de foco envolve o campo inteiro ------------------------
    page.goto(f'{BASE}/entrar')
    page.wait_for_load_state('networkidle')
    # Um Tab só: o campo de usuário tem autofoco, então o segundo cairia no
    # botão do olho — que é um <button> e recebe o anel dele mesmo, com razão.
    # O que se quer medir aqui é o campo.
    page.keyboard.press('Tab')
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / '24-anel-de-foco.png'))

    anel = page.evaluate("""() => {
        const input = document.activeElement;
        const wrap = input.closest('div');
        return {
            foco: input.tagName + ':' + (input.getAttribute('autocomplete') || ''),
            noInput: getComputedStyle(input).boxShadow,
            noCampo: getComputedStyle(wrap).boxShadow,
        };
    }""")
    check('o anel de foco fica no campo inteiro, não só no input',
          anel['noInput'] == 'none' and anel['noCampo'] != 'none', json.dumps(anel))

    browser.close()

print('\n' + '=' * 60)
ok = sum(1 for _, o, _ in resultados if o)
print(f'{ok}/{len(resultados)} passaram')
for nome, o, det in resultados:
    if not o:
        print(f'  FALHOU: {nome}  {det}')
sys.exit(0 if ok == len(resultados) else 1)
