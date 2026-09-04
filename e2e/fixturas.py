"""Arquivos de teste gerados na hora.

A foto sai daqui **com EXIF de GPS dentro**, de propósito: é o que prova que o
re-encode do servidor apaga o metadado. Uma foto tirada de celular carrega a
coordenada de onde foi tirada, e servir o arquivo original publicaria onde cada
pessoa mora — docs/04-seguranca.md, "Upload de arquivo".
"""

import io
from pathlib import Path

from PIL import Image

# Latitude 48°51'29.6"N, longitude 2°17'40.2"E — a Torre Eiffel. Graus, minutos
# e segundos; o Pillow converte cada um para o racional que o EXIF guarda.
GPS = {
    0: b'\x02\x03\x00\x00',                      # GPSVersionID
    1: 'N',                                       # GPSLatitudeRef
    2: (48.0, 51.0, 29.6),                        # GPSLatitude
    3: 'E',                                       # GPSLongitudeRef
    4: (2.0, 17.0, 40.2),                         # GPSLongitude
}


def foto_com_exif(destino: Path, cor=(210, 70, 40), tamanho=(800, 600)) -> Path:
    """JPEG com GPS e um comentário no EXIF."""
    imagem = Image.new('RGB', tamanho, cor)
    # Um degradê simples, para o WebP não ficar num quadrado de cor sólida —
    # o blurhash de uma cor só não provaria nada.
    pixels = imagem.load()
    for x in range(tamanho[0]):
        for y in range(0, tamanho[1], 4):
            pixels[x, y] = (cor[0], (cor[1] + x // 4) % 256, cor[2])

    exif = Image.Exif()
    exif[0x8825] = GPS
    exif[0x010E] = 'ImageDescription secreta'
    exif[0x0110] = 'TesteDeCamera'
    # 6 = girada 90°. O `rotate()` do sharp precisa aplicá-la e descartá-la.
    exif[0x0112] = 6

    destino.parent.mkdir(parents=True, exist_ok=True)
    imagem.save(destino, 'JPEG', exif=exif, quality=90)
    return destino


def png(destino: Path, cor=(40, 90, 200), tamanho=(320, 240)) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    Image.new('RGB', tamanho, cor).save(destino, 'PNG')
    return destino


def documento(destino: Path, texto='relatório de setembro\n') -> Path:
    """Um arquivo que **não** é imagem: tem de baixar, nunca abrir na página."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(texto * 40, encoding='utf-8')
    return destino


def svg_disfarcado(destino: Path) -> Path:
    """SVG com script, salvo como `.png`.

    Duas armadilhas de uma vez: a extensão mente, e o formato é uma imagem que
    também é um documento com script. O servidor decide pelos bytes, e SVG não
    está na lista — então isto tem de virar `application/octet-stream` e baixar.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(
        b'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        b'<script>alert(document.domain)</script>'
        b'<rect width="100" height="100" fill="red"/></svg>'
    )
    return destino


def tem_exif(bytes_ou_caminho) -> bool:
    dados = (
        bytes_ou_caminho.read_bytes()
        if isinstance(bytes_ou_caminho, Path)
        else bytes_ou_caminho
    )
    try:
        imagem = Image.open(io.BytesIO(dados))
    except Exception:
        return False
    exif = imagem.getexif()
    return bool(exif) and len(dict(exif)) > 0
