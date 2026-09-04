"""Upload e prévia de link, direto na API.

Sem navegador: o que está sendo verificado aqui não é interface, é o que o
servidor faz com um arquivo e com uma URL que outra pessoa escolheu. Estas
duas coisas são a parte perigosa da fatia.

    pnpm dev:seed
"""

import io
import sys
from pathlib import Path

import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import fixturas  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

API = 'http://localhost:3000/api'
TMP = Path(__file__).parent / '.tmp'
SENHA = 'cavalo-bateria-grampo-9'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


sessao = requests.Session()
entrada = sessao.post(f'{API}/auth/login', json={'username': 'alex', 'password': SENHA})
entrada.raise_for_status()
token = entrada.json()['access']
cab = {'Authorization': f'Bearer {token}'}

canais = sessao.get(f'{API}/channels', headers=cab).json()['channels']
geral = next(c for c in canais if c['slug'] == 'geral')


def subir(caminho: Path, nome=None, tipo='application/octet-stream'):
    with caminho.open('rb') as f:
        return sessao.post(
            f'{API}/channels/{geral["id"]}/attachments',
            headers=cab,
            files={'file': (nome or caminho.name, f, tipo)},
        )


# --- 1. imagem: re-encode obrigatório ---------------------------------------
foto = fixturas.foto_com_exif(TMP / 'foto.jpg')
check('a foto de origem tem EXIF', fixturas.tem_exif(foto))

r = subir(foto, tipo='image/jpeg')
check('o upload de imagem responde 201', r.status_code == 201, str(r.status_code)[:40])
anexo = r.json()['attachments'][0]

check('o servidor devolve WebP, não o JPEG que subiu',
      anexo['contentType'] == 'image/webp', anexo['contentType'])
check('com largura e altura', bool(anexo['width'] and anexo['height']),
      f"{anexo['width']}x{anexo['height']}")
check('e com blurhash', bool(anexo['blurhash']), str(anexo['blurhash']))
check('a chave da URL não carrega o nome do arquivo',
      'foto' not in anexo['url'] and anexo['url'].startswith('/api/files/'), anexo['url'])

servida = requests.get(f'http://localhost:3000{anexo["url"]}')
check('o arquivo é servido', servida.status_code == 200, str(servida.status_code))
check('como image/webp', servida.headers.get('content-type') == 'image/webp',
      str(servida.headers.get('content-type')))
check('com nosniff', servida.headers.get('x-content-type-options') == 'nosniff')
check('imagem re-encodada abre na página, não baixa',
      servida.headers.get('content-disposition', '').startswith('inline'),
      str(servida.headers.get('content-disposition')))

check('os bytes servidos são mesmo WebP',
      servida.content[:4] == b'RIFF' and servida.content[8:12] == b'WEBP',
      repr(servida.content[:12]))
check('nenhum byte original chegou ao disco: o EXIF sumiu',
      not fixturas.tem_exif(servida.content))
check('e a descrição secreta não sobreviveu',
      b'secreta' not in servida.content and b'TesteDeCamera' not in servida.content)

# A orientação 6 diz "girada 90°": o `rotate()` aplica e descarta, então a
# imagem servida tem de sair em pé, 600x800, e não deitada.
girada = Image.open(io.BytesIO(servida.content))
check('a orientação do EXIF foi aplicada antes de ser descartada',
      girada.size == (600, 800), str(girada.size))

# --- 2. arquivo comum: baixa, nunca abre ------------------------------------
doc = fixturas.documento(TMP / 'relatorio.txt')
r = subir(doc, tipo='text/plain')
comum = r.json()['attachments'][0]
check('arquivo comum vira octet-stream',
      comum['contentType'] == 'application/octet-stream', comum['contentType'])

servido = requests.get(f'http://localhost:3000{comum["url"]}')
check('e é servido para baixar, não para abrir',
      servido.headers.get('content-disposition', '').startswith('attachment'),
      str(servido.headers.get('content-disposition')))
check('o nome original volta no cabeçalho', 'relatorio.txt' in
      servido.headers.get('content-disposition', ''))

# --- 3. o SVG disfarçado de PNG ---------------------------------------------
#
# A extensão mente e o `Content-Type` declarado também. O servidor decide pelos
# bytes, e SVG fica fora da lista de imagens de propósito: é um formato de
# imagem que também é um documento com script.
falso = fixturas.svg_disfarcado(TMP / 'inocente.png')
r = subir(falso, tipo='image/png')
svg = r.json()['attachments'][0]
check('SVG disfarçado de PNG não é tratado como imagem',
      svg['contentType'] == 'application/octet-stream', svg['contentType'])
servido_svg = requests.get(f'http://localhost:3000{svg["url"]}')
check('e é servido para baixar, nunca para renderizar',
      servido_svg.headers.get('content-disposition', '').startswith('attachment'))

# --- 4. o que não é imagem nem tenta ser ------------------------------------
r = sessao.post(
    f'{API}/channels/{geral["id"]}/attachments',
    headers=cab,
    files={'file': ('vazio.bin', b'', 'application/octet-stream')},
)
check('arquivo vazio é recusado', r.status_code == 400, str(r.status_code))

r = sessao.post(f'{API}/channels/{geral["id"]}/attachments', headers=cab)
check('formulário sem arquivo é recusado', r.status_code in (400, 406), str(r.status_code))

# --- 5. sem sessão não se sobe nada -----------------------------------------
r = sessao.post(
    f'{API}/channels/{geral["id"]}/attachments',
    files={'file': ('x.txt', b'oi', 'text/plain')},
)
check('sem token o upload é 401', r.status_code == 401, str(r.status_code))

# --- 6. prévia de link: a guarda de SSRF ------------------------------------
#
# O servidor busca a prévia no lugar de quem lê. Isso o torna um servidor que
# busca URLs escolhidas por outra pessoa, e é aqui que se verifica que ele não
# pode ser mandado bater na porta da própria rede.
def previa(url):
    return sessao.get(f'{API}/link-preview', headers=cab, params={'url': url})


INTERNOS = [
    'http://127.0.0.1:3000/api/health',
    'http://localhost:3000/api/health',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.0.1/',
    'http://[::1]/',
    'http://127.0.0.1:9000/',
    'http://127.0.0.1:5432/',
]
for url in INTERNOS:
    r = previa(url)
    ok = r.status_code == 200 and r.json()['preview'] is None
    check(f'não busca {url}', ok, f'{r.status_code} {r.text[:80]}')

for url in ['file:///etc/passwd', 'gopher://127.0.0.1:11211/', 'ftp://exemplo.com/']:
    r = previa(url)
    # O `z.string().url()` derruba alguns antes da guarda; os dois caminhos
    # terminam no mesmo lugar, que é "sem cartão".
    ok = r.status_code == 400 or (r.status_code == 200 and r.json()['preview'] is None)
    check(f'não busca {url}', ok, f'{r.status_code} {r.text[:60]}')

# --- 7. prévia de link: o caminho feliz -------------------------------------
r = previa('https://example.com/')
if r.status_code == 200 and r.json()['preview']:
    p = r.json()['preview']
    check('a prévia de um site real traz título', bool(p['title']), str(p['title'])[:60])
    check('e o nome do site', p['siteName'] == 'example.com', str(p['siteName']))
    check('e a URL final', p['url'].startswith('https://example.com'), p['url'])
    # O que mais importa: se houver miniatura, ela aponta para **nós**.
    check('a miniatura, quando existe, é nossa e não do site de origem',
          p['thumbUrl'] is None or p['thumbUrl'].startswith('/api/link-preview/thumb/'),
          str(p['thumbUrl']))
else:
    check('a prévia de um site real traz título', False,
          f'sem internet? {r.status_code} {r.text[:80]}')

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
