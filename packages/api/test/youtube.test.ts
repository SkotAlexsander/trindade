import { describe, expect, it } from 'vitest';
import { idDoYoutube, segundosDoYoutube } from '../src/lib/youtube.js';

/**
 * O identificador que sai daqui vira `src` de um iframe.
 *
 * Por isso a validação é por **forma** e não por tentativa: onze caracteres do
 * alfabeto do YouTube, e nada mais passa. Uma URL convincente com um id de
 * quarenta caracteres não é vídeo — é alguém testando o que a gente aceita.
 */

describe('o id do vídeo', () => {
  it('acha nas quatro formas que existem no mundo', () => {
    const esperado = 'dQw4w9WgXcQ';
    expect(idDoYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(esperado);
    expect(idDoYoutube('https://youtu.be/dQw4w9WgXcQ')).toBe(esperado);
    expect(idDoYoutube('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(esperado);
    expect(idDoYoutube('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(esperado);
  });

  it('aceita as variações de domínio que o próprio YouTube gera', () => {
    expect(idDoYoutube('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).not.toBeNull();
    expect(idDoYoutube('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).not.toBeNull();
    expect(idDoYoutube('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).not.toBeNull();
  });

  it('não confunde playlist, canal e busca com vídeo', () => {
    // Um cartão de "assistir aqui" que abre uma lista é uma promessa quebrada.
    expect(idDoYoutube('https://www.youtube.com/playlist?list=PLabc')).toBeNull();
    expect(idDoYoutube('https://www.youtube.com/@algumcanal')).toBeNull();
    expect(idDoYoutube('https://www.youtube.com/results?search_query=oi')).toBeNull();
    expect(idDoYoutube('https://www.youtube.com/')).toBeNull();
  });

  it('recusa o que não tem a forma de um id', () => {
    expect(idDoYoutube('https://www.youtube.com/watch?v=curto')).toBeNull();
    expect(idDoYoutube('https://www.youtube.com/watch?v=' + 'a'.repeat(40))).toBeNull();
    // Barra, ponto e interrogação sairiam do caminho do embed.
    expect(idDoYoutube('https://www.youtube.com/watch?v=../../etc/pw')).toBeNull();
    expect(idDoYoutube('https://www.youtube.com/watch?v=abc?autoplay')).toBeNull();
  });

  it('recusa domínio parecido', () => {
    // `youtube.com.exemplo.net` termina em `exemplo.net`, e um `endsWith`
    // ingênuo teria deixado passar.
    expect(idDoYoutube('https://youtube.com.exemplo.net/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(idDoYoutube('https://naoyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(idDoYoutube('javascript:alert(1)')).toBeNull();
    expect(idDoYoutube('não é url')).toBeNull();
  });
});

describe('o instante em que o vídeo começa', () => {
  it('entende os três formatos que o YouTube gera', () => {
    expect(segundosDoYoutube('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(90);
    expect(segundosDoYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toBe(90);
    expect(segundosDoYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=90')).toBe(90);
    expect(segundosDoYoutube('https://youtu.be/dQw4w9WgXcQ?t=1h2m3s')).toBe(3723);
  });

  it('sem tempo, é nulo — e começa do começo', () => {
    expect(segundosDoYoutube('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(segundosDoYoutube('https://youtu.be/dQw4w9WgXcQ?t=')).toBeNull();
    expect(segundosDoYoutube('https://youtu.be/dQw4w9WgXcQ?t=abc')).toBeNull();
  });

  it('recusa o que não é um instante de vídeo', () => {
    // Acima de 24h é lixo, e negativo não existe. O valor entra numa URL.
    expect(segundosDoYoutube('https://youtu.be/dQw4w9WgXcQ?t=999999')).toBeNull();
    expect(segundosDoYoutube('https://youtu.be/dQw4w9WgXcQ?t=-5')).toBeNull();
    expect(segundosDoYoutube('https://youtu.be/dQw4w9WgXcQ?t=0')).toBeNull();
  });
});
