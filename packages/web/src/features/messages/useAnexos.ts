import { create } from 'zustand';
import { ANEXOS_POR_MENSAGEM, type Attachment } from '@trindade/shared';
import { HttpError, upload } from '../../lib/http';

/**
 * Anexos pendentes: o que já subiu, mas ainda não foi enviado.
 *
 * O upload começa **ao anexar**, não ao enviar. Quando a pessoa termina de
 * escrever a legenda, o arquivo já está lá — em vez de olhar uma barra de
 * progresso depois de apertar Enter. Ver design/04-mensagens.md, "Anexo
 * pendente".
 *
 * O preço dessa escolha é o arquivo que sobe e nunca é enviado. Ele fica
 * pendente no servidor e a varredura de órfãos o remove depois de uma hora —
 * `services/varredura-de-anexos.ts` do lado da API.
 */

export const TAMANHO_MAXIMO = 50 * 1024 * 1024;

export type EstadoDoAnexo = 'subindo' | 'pronto' | 'falhou';

export interface AnexoPendente {
  /** Id local. O do servidor só existe depois que o upload termina. */
  chave: string;
  nome: string;
  tamanho: number;
  /** `blob:` da imagem escolhida, para a miniatura aparecer na hora. */
  miniatura: string | null;
  progresso: number;
  estado: EstadoDoAnexo;
  erro?: string;
  anexo?: Attachment;
}

interface AnexosState {
  porCanal: Record<string, AnexoPendente[]>;
  anexar: (channelId: string, arquivos: readonly File[]) => void;
  remover: (channelId: string, chave: string) => void;
  limpar: (channelId: string) => void;
}

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export { tamanhoLegivel };

export const useAnexos = create<AnexosState>((set, get) => {
  function alterar(
    channelId: string,
    chave: string,
    mudanca: Partial<AnexoPendente> | null,
  ): void {
    set((s) => {
      const lista = s.porCanal[channelId];
      if (!lista) return s;
      const proxima = mudanca
        ? lista.map((a) => (a.chave === chave ? { ...a, ...mudanca } : a))
        : lista.filter((a) => a.chave !== chave);
      return { porCanal: { ...s.porCanal, [channelId]: proxima } };
    });
  }

  return {
    porCanal: {},

    anexar: (channelId, arquivos) => {
      const jaTem = get().porCanal[channelId]?.length ?? 0;
      const cabem = arquivos.slice(0, Math.max(0, ANEXOS_POR_MENSAGEM - jaTem));

      const novos: AnexoPendente[] = cabem.map((arquivo) => ({
        chave: crypto.randomUUID(),
        nome: arquivo.name,
        tamanho: arquivo.size,
        // A miniatura sai do arquivo local: ela aparece antes de o primeiro
        // byte chegar ao servidor, e é o que faz o anexo parecer instantâneo.
        miniatura: arquivo.type.startsWith('image/') ? URL.createObjectURL(arquivo) : null,
        progresso: 0,
        estado: arquivo.size > TAMANHO_MAXIMO ? 'falhou' : 'subindo',
        ...(arquivo.size > TAMANHO_MAXIMO ? { erro: 'passa de 50 MB' } : {}),
      }));

      set((s) => ({
        porCanal: { ...s.porCanal, [channelId]: [...(s.porCanal[channelId] ?? []), ...novos] },
      }));

      novos.forEach((pendente, i) => {
        if (pendente.estado === 'falhou') return;
        const arquivo = cabem[i];
        if (!arquivo) return;

        const form = new FormData();
        form.append('file', arquivo, arquivo.name);

        void upload<{ attachments: Attachment[] }>(`/channels/${channelId}/attachments`, form, {
          onProgresso: (fracao) => alterar(channelId, pendente.chave, { progresso: fracao }),
        })
          .then((r) => {
            const anexo = r.attachments[0];
            if (!anexo) throw new Error('o servidor não devolveu o anexo');
            alterar(channelId, pendente.chave, { estado: 'pronto', progresso: 1, anexo });
          })
          .catch((err: unknown) => {
            alterar(channelId, pendente.chave, {
              estado: 'falhou',
              erro: err instanceof HttpError ? err.message : 'não subiu',
            });
          });
      });
    },

    remover: (channelId, chave) => {
      const alvo = get().porCanal[channelId]?.find((a) => a.chave === chave);
      // O `blob:` fica preso na memória até alguém devolvê-lo.
      if (alvo?.miniatura) URL.revokeObjectURL(alvo.miniatura);
      // O arquivo que já subiu continua no servidor, pendente, e a varredura o
      // recolhe. Um `DELETE` aqui só adiantaria a limpeza, e falharia
      // exatamente quando mais importa: com a rede ruim.
      alterar(channelId, chave, null);
    },

    limpar: (channelId) => {
      for (const a of get().porCanal[channelId] ?? []) {
        if (a.miniatura) URL.revokeObjectURL(a.miniatura);
      }
      set((s) => ({ porCanal: { ...s.porCanal, [channelId]: [] } }));
    },
  };
});

/** Só os que terminaram. Enviar com upload em curso perderia o arquivo. */
export function prontos(lista: readonly AnexoPendente[]): Attachment[] {
  return lista.filter((a) => a.estado === 'pronto' && a.anexo).map((a) => a.anexo as Attachment);
}

export function algumSubindo(lista: readonly AnexoPendente[]): boolean {
  return lista.some((a) => a.estado === 'subindo');
}
