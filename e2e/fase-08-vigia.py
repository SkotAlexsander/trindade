"""O aviso que a API não consegue mandar: ela mesma fora do ar.

Disco cheio e 5xx em série a API avisa sozinha, e `packages/api/test/alerta.test.ts`
prova isso. Mas processo caído não manda webhook — o terceiro alerta mora em
`scripts/vigia.sh`, fora do contêiner, e por isso a prova dele também é de fora:
um servidor que responde 200, depois 503, depois 200 de novo, e um webhook que
conta quantas vezes foi chamado.

Não precisa de navegador nem da aplicação de pé:

    python e2e/fase-08-vigia.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

RAIZ = Path(__file__).resolve().parent.parent

# No Linux é `bash` no PATH; no Windows, o do Git. O roteiro é POSIX e roda nos
# dois — o servidor é Linux, mas quem escreve o script está aqui.
BASH = shutil.which('bash') or r'C:\Program Files\Git\bin\bash.exe'

resultados = []
avisos = []
estado = {'saude': 200}


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    # A lista de avisos é o detalhe de toda verificação daqui, e imprimi-la
    # quando passa esconde a linha que falhou no meio do texto.
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe and not ok else ''),
          flush=True)


class Mao(BaseHTTPRequestHandler):
    # HTTP/1.0 de propósito: sem keep-alive, o `curl` fecha e o servidor não
    # fica esperando um segundo pedido que nunca vem — o que só produzia um
    # traceback de conexão reiniciada no meio da saída.

    def log_message(self, *args):
        pass

    def do_GET(self):
        corpo = b'{"ok":true}' if estado['saude'] == 200 else b'{"ok":false}'
        self.send_response(estado['saude'])
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_POST(self):
        tamanho = int(self.headers.get('content-length', 0))
        cru = self.rfile.read(tamanho)
        # Lido como UTF-8 **de propósito**: a primeira versão mandava o corpo
        # como argumento de linha de comando e o acento chegava quebrado.
        avisos.append(json.loads(cru.decode('utf-8')))
        self.send_response(204)
        self.send_header('content-length', '0')
        self.end_headers()


servidor = ThreadingHTTPServer(('127.0.0.1', 0), Mao)
porta = servidor.server_address[1]
threading.Thread(target=servidor.serve_forever, daemon=True).start()

pasta = tempfile.mkdtemp()
ambiente = dict(os.environ)
ambiente.update({
    'ALERTA_WEBHOOK': f'http://127.0.0.1:{porta}/avisos',
    'SAUDE_URL': f'http://127.0.0.1:{porta}/api/health',
    'VIGIA_ESTADO': str(Path(pasta) / 'vigia.estado').replace('\\', '/'),
})


def volta():
    """Uma passada do timer."""
    saida = subprocess.run([BASH, 'scripts/vigia.sh'], cwd=RAIZ, env=ambiente,
                           capture_output=True, text=True)
    if saida.returncode != 0:
        print(f'  (o script saiu com {saida.returncode}: {saida.stderr.strip()})')
    return saida


volta()
check('com o servidor de pé, ninguém é incomodado', not avisos, str(avisos))

estado['saude'] = 503
volta()
# A saúde responde 503 quando banco ou storage falham, e `curl -f` trata isso
# como falha: é exatamente o que se quer alertar.
check('uma falha só não avisa — isso é implantação, não incêndio', not avisos, str(avisos))

volta()
check('duas falhas seguidas viram aviso', len(avisos) == 1, str(avisos))
check('o aviso diz que a API não responde',
      len(avisos) == 1 and 'não responde' in avisos[0].get('content', ''),
      str(avisos))
check('o mesmo corpo serve Discord e Slack',
      len(avisos) == 1 and avisos[0].get('content') == avisos[0].get('text'),
      str(avisos))

volta()
volta()
check('não repete enquanto continua fora', len(avisos) == 1, str(avisos))

estado['saude'] = 200
volta()
check('avisa que voltou',
      len(avisos) == 2 and 'voltou' in avisos[1].get('content', ''), str(avisos))

volta()
check('e cala depois disso', len(avisos) == 2, str(avisos))

del ambiente['ALERTA_WEBHOOK']
estado['saude'] = 503
volta()
volta()
check('sem ALERTA_WEBHOOK, não tenta destino nenhum', len(avisos) == 2, str(avisos))

servidor.shutdown()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
