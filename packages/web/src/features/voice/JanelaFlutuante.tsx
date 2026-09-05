import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Channel, User } from '@trindade/shared';
import { Avatar, Menu, MenuItem, MenuSeparator, Tooltip } from '../../components';
import { Board, Check, Expandir, Mic, MicOff, Monitor, X } from '../../components/icones';
import { useQuadroAberto } from '../boards/store';
import { useApresentacoes, apresentacaoNoCanal } from '../boards/apresentacoes';
import { useQuadros } from '../boards/queries';
import { lerPreferencias, salvarPreferencias } from '../../lib/preferencias';
import type { Participante } from './sala';
import { useVoz } from './store';
import { useChamada } from './useChamada';
import styles from './flutuante.module.css';

/**
 * A janela flutuante da chamada.
 *
 * Aparece quando a chamada sai da tela — porque você escolheu "só a conversa"
 * ou porque foi para outro canal — e mantém à vista quem importa. É a resposta
 * para a coisa mais comum de uma chamada de trabalho: continuar vendo alguém
 * enquanto se faz outra coisa.
 *
 * **Quem aparece é escolha sua.** Por padrão, quem tem imagem — câmera ou tela;
 * o menu deixa fixar pessoas específicas, e é isso que a torna diferente de uma
 * miniatura que decide sozinha e sempre mostra a pessoa errada.
 *
 * Arrastar move, o canto redimensiona, e as duas coisas ficam guardadas: a
 * posição de canto é hábito, e hábito é da máquina.
 */
export function JanelaFlutuante({ canais, pessoas }: { canais: Channel[]; pessoas: User[] }) {
  const fase = useVoz((s) => s.fase);
  const modo = useVoz((s) => s.modo);
  const channelId = useVoz((s) => s.channelId);
  const participantes = useVoz((s) => s.participantes);
  const falando = useVoz((s) => s.falando);
  const muted = useVoz((s) => s.muted);
  const fixados = useVoz((s) => s.fixadosNaMiniatura);
  const escondida = useVoz((s) => s.miniaturaEscondida);

  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { alternarMudo, sair, definirModo, fixarNaMiniatura, esconderMiniatura } = useChamada();

  const [caixa, setCaixa] = useState(() => lerPreferencias().miniatura);
  const atual = useRef(caixa);
  atual.current = caixa;

  // Nasce no canto de baixo à direita na primeira vez, e nunca fora da tela —
  // uma janela que reabre fora da área visível é uma janela perdida.
  useEffect(() => {
    setCaixa((c) => {
      const largura = c.largura;
      const x = c.x < 0 ? window.innerWidth - largura - 24 : Math.min(c.x, window.innerWidth - 80);
      const y = c.y < 0 ? window.innerHeight - largura - 120 : Math.min(c.y, window.innerHeight - 80);
      return { x: Math.max(0, x), y: Math.max(0, y), largura };
    });
  }, []);

  const canal = canais.find((c) => c.id === channelId);

  /* O quadro cobre a tela inteira, inclusive a grade da chamada. Com ele
     aberto, a chamada **sai da tela** como sai quando você troca de canal — e
     é por isso que a janela flutuante aparece por cima dele. Sem esta linha,
     entrar no quadro durante uma chamada apagava todo mundo da vista. */
  const quadroAberto = useQuadroAberto((s) => s.aberto);
  const fecharQuadro = useQuadroAberto((s) => s.fechar);
  const abrirQuadro = useQuadroAberto((s) => s.abrir);

  const naSala = canal ? slug === canal.slug && modo !== 'mensagens' && !quadroAberto : false;
  const visivel = fase !== 'fora' && !naSala && !escondida;

  /* Para onde vai o botão do quadro: o que está sendo apresentado no canal da
     chamada, ou o mais recente dele. Quem está numa chamada e quer o quadro
     quase sempre quer **este**. */
  const apresentacao = useApresentacoes((s) =>
    canal ? apresentacaoNoCanal(s.porQuadro, canal.id) : undefined,
  );
  const { data: quadrosDoCanal } = useQuadros(canal?.id);
  const quadroParaAbrir = apresentacao?.boardId ?? quadrosDoCanal?.[0]?.id ?? null;

  const nomeDe = (p: Participante) =>
    pessoas.find((u) => u.id === p.identity)?.displayName ?? 'Alguém';

  // Fixados mandam; sem fixados, quem tem imagem; sem imagem nenhuma, todo
  // mundo — a janela existe para mostrar gente, e vazia não serve para nada.
  const comImagem = participantes.filter((p) => p.video ?? p.tela);
  const escolhidos =
    fixados.size > 0
      ? participantes.filter((p) => fixados.has(p.identity))
      : comImagem.length > 0
        ? comImagem
        : participantes;

  const arrastar = useCallback((evento: React.PointerEvent<HTMLElement>) => {
    /* Botão dentro da barra não arrasta: `setPointerCapture` na barra rouba os
       eventos seguintes, e o clique nunca chega ao botão — o menu de quem
       aparece simplesmente não abria. */
    if ((evento.target as HTMLElement).closest('button')) return;

    const alca = evento.currentTarget;
    const inicio = { x: evento.clientX, y: evento.clientY, caixa: atual.current };
    alca.setPointerCapture(evento.pointerId);

    const mover = (e: PointerEvent) => {
      const proximo = {
        ...inicio.caixa,
        x: inicio.caixa.x + (e.clientX - inicio.x),
        y: inicio.caixa.y + (e.clientY - inicio.y),
      };
      // Presa à tela: uma janela arrastada para fora não volta.
      proximo.x = Math.min(Math.max(0, proximo.x), window.innerWidth - 80);
      proximo.y = Math.min(Math.max(0, proximo.y), window.innerHeight - 60);
      atual.current = proximo;
      setCaixa(proximo);
    };
    const soltar = () => {
      alca.removeEventListener('pointermove', mover);
      alca.removeEventListener('pointerup', soltar);
      alca.removeEventListener('pointercancel', soltar);
      salvarPreferencias({ miniatura: atual.current });
    };
    alca.addEventListener('pointermove', mover);
    alca.addEventListener('pointerup', soltar);
    alca.addEventListener('pointercancel', soltar);
  }, []);

  const redimensionar = useCallback((evento: React.PointerEvent<HTMLElement>) => {
    const alca = evento.currentTarget;
    const inicio = { x: evento.clientX, largura: atual.current.largura };
    alca.setPointerCapture(evento.pointerId);

    const mover = (e: PointerEvent) => {
      const largura = Math.min(640, Math.max(180, inicio.largura + (e.clientX - inicio.x)));
      const proximo = { ...atual.current, largura };
      atual.current = proximo;
      setCaixa(proximo);
    };
    const soltar = () => {
      alca.removeEventListener('pointermove', mover);
      alca.removeEventListener('pointerup', soltar);
      alca.removeEventListener('pointercancel', soltar);
      salvarPreferencias({ miniatura: atual.current });
    };
    alca.addEventListener('pointermove', mover);
    alca.addEventListener('pointerup', soltar);
    alca.addEventListener('pointercancel', soltar);
  }, []);

  if (!visivel) return null;

  function voltarParaSala(): void {
    // Com o quadro aberto, "voltar à sala" é sair dele: a sala está atrás.
    if (quadroAberto) fecharQuadro();
    if (canal) navigate(`/c/${canal.slug}`);
    definirModo(lerPreferencias().modoDaSala === 'mensagens' ? 'ambos' : lerPreferencias().modoDaSala);
  }

  return (
    <aside
      className={styles.janela}
      /* Sobre o quadro, a janela sobe de camada: o quadro é `fixed` e cobre a
         tela inteira, e uma chamada escondida atrás dele é uma chamada que
         some no meio da conversa. */
      data-sobre-quadro={Boolean(quadroAberto)}
      style={{ left: caixa.x, top: caixa.y, width: caixa.largura }}
      aria-label={`Chamada em ${canal?.name ?? 'andamento'}`}
    >
      {/* A barra inteira é a alça: agarrar pela beirada é preciso demais. */}
      <header className={styles.barra} onPointerDown={arrastar}>
        <span className={styles.nome}>{canal?.name ?? 'Chamada'}</span>

        <Menu
          label="Quem aparece"
          placement="bottom-end"
          trigger={
            <button type="button" className={styles.acao} aria-label="Escolher quem aparece">
              ⋯
            </button>
          }
        >
          {participantes.map((p) => (
            <MenuItem
              key={p.identity}
              icon={fixados.has(p.identity) ? <Check size={14} /> : undefined}
              onSelect={() => fixarNaMiniatura(p.identity)}
            >
              {p.eu ? 'Você' : nomeDe(p)}
            </MenuItem>
          ))}
          {fixados.size > 0 ? (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => fixarNaMiniatura(null)}>Mostrar quem tem imagem</MenuItem>
            </>
          ) : null}
        </Menu>

        {/* Ir e voltar do quadro sem sair da chamada: são as duas telas que
            se usam juntas, e trocar entre elas não pode custar navegação. */}
        {quadroAberto || (canal && quadroParaAbrir) ? (
          <Tooltip label={quadroAberto ? 'Sair do quadro' : 'Ir para o quadro'}>
            <button
              type="button"
              className={styles.acao}
              data-ligado={Boolean(quadroAberto)}
              aria-label={quadroAberto ? 'Sair do quadro' : 'Ir para o quadro'}
              onClick={() => {
                if (quadroAberto) {
                  fecharQuadro();
                  return;
                }
                if (canal && quadroParaAbrir) {
                  navigate(`/c/${canal.slug}`);
                  abrirQuadro(quadroParaAbrir, canal.id);
                }
              }}
            >
              <Board size={14} />
            </button>
          </Tooltip>
        ) : null}

        <Tooltip label="Voltar à sala">
          <button
            type="button"
            className={styles.acao}
            aria-label="Voltar à sala"
            onClick={voltarParaSala}
          >
            <Expandir size={14} />
          </button>
        </Tooltip>

        <Tooltip label="Esconder até voltar à sala">
          <button
            type="button"
            className={styles.acao}
            aria-label="Esconder a janela"
            onClick={() => esconderMiniatura(true)}
          >
            <X size={14} />
          </button>
        </Tooltip>
      </header>

      <div className={styles.caixas} data-quantidade={Math.min(escolhidos.length, 4)}>
        {escolhidos.slice(0, 4).map((p) => (
          <Miniatura
            key={p.identity}
            participante={p}
            nome={p.eu ? 'Você' : nomeDe(p)}
            falando={falando.has(p.identity)}
            pessoa={pessoas.find((u) => u.id === p.identity)}
          />
        ))}
      </div>

      <footer className={styles.rodape}>
        <Tooltip label={muted ? 'Abrir microfone' : 'Fechar microfone'}>
          <button
            type="button"
            className={styles.acao}
            data-desligado={muted}
            aria-label={muted ? 'Microfone fechado' : 'Microfone aberto'}
            onClick={alternarMudo}
          >
            {muted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        </Tooltip>
        <button type="button" className={styles.sair} onClick={() => void sair()}>
          Sair
        </button>
      </footer>

      {/* O canto que estica. Fica fora do fluxo para não roubar clique de
          nada, e tem alvo de 16px — 4px é enfeite, não controle. */}
      <span
        className={styles.canto}
        role="separator"
        aria-label="Redimensionar a janela"
        onPointerDown={redimensionar}
      />
    </aside>
  );
}

function Miniatura({
  participante,
  nome,
  falando,
  pessoa,
}: {
  participante: Participante;
  nome: string;
  falando: boolean;
  pessoa: User | undefined;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const trilha = participante.tela ?? participante.video;

  useEffect(() => {
    const alvo = video.current;
    if (!trilha || !alvo) return;
    trilha.attach(alvo);
    return () => {
      trilha.detach(alvo);
    };
  }, [trilha]);

  return (
    <div className={styles.caixa} data-falando={falando} aria-label={nome}>
      {trilha ? (
        <video
          ref={video}
          className={styles.video}
          data-tela={Boolean(participante.tela)}
          data-espelhado={participante.eu && !participante.tela}
          autoPlay
          playsInline
          muted={participante.eu}
        />
      ) : (
        <Avatar id={participante.identity} name={nome} src={pessoa?.avatarUrl} size="md" />
      )}
      <span className={styles.legenda}>
        {participante.tela ? <Monitor size={10} /> : null} {nome}
      </span>
    </div>
  );
}
