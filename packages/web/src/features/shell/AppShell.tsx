import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Perm, can } from '@trindade/shared';
import { IconButton, Skeleton, Tooltip } from '../../components';
import { ChevronDown, Plus, Settings } from '../../components/icones';
import { Marca } from '../../components/Logo';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useHotkeys } from '../../lib/useHotkeys';
import { useAuth } from '../auth/store';
import { Elenco, SeuCanto } from '../cast/CastPanel';
import { DialogoDePerfil } from '../profile/DialogoDePerfil';
import { DialogoDeConvite } from '../people/DialogoDeConvite';
import { useDialogoDeConvite } from '../people/useDialogoDeConvite';
import { ChannelList } from '../channels/ChannelList';
import { useChannels, useUsers } from '../channels/queries';
import { useGateway } from '../realtime/useGateway';
import { BarraDeChamada } from '../voice/BarraDeChamada';
import { GradeDaChamada } from '../voice/GradeDaChamada';
import { JanelaFlutuante } from '../voice/JanelaFlutuante';
import { useVoz } from '../voice/store';
import { useChamada } from '../voice/useChamada';
import { digitandoAgora, useConexao, useDigitando, usePresenca } from '../realtime/store';
import { useThread } from '../messages/store';
import { primeiroDestino, withReadState } from '../channels/canais';
import { useLeitura } from '../messages/leitura';
import { ChannelHeader, type PainelAberto } from './ChannelHeader';
import { useQuadro } from '../tasks/store';
import { useNotificacoes } from '../notifications/useNotificacoes';
import { definirNavegador } from '../../lib/navegacao';
import { CommandPalette } from './CommandPalette';
import { ContextPanel } from './ContextPanel';
import { ServerMenu } from './ServerMenu';
import styles from './shell.module.css';

/**
 * A moldura de toda tela autenticada.
 *
 * A ordem das colunas segue estabilidade: o rail quase nunca muda, os canais
 * mudam raramente, as mensagens mudam sempre, o painel abre e fecha.
 * Ver design/02-shell-principal.md.
 */
export function AppShell() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { pathname } = useLocation();
  const conviteAberto = useDialogoDeConvite((s) => s.aberto);
  const fecharConvite = useDialogoDeConvite((s) => s.fechar);
  const permissoes = useAuth((state) => state.permissions);

  const { data: canaisCrus, isPending: carregandoCanais } = useChannels();
  const { data: pessoasCruas } = useUsers();

  // Um hook só, montado uma vez: assinaturas de socket espalhadas pelos
  // componentes produzem o clássico "chegou duas vezes".
  useGateway();

  const presencas = usePresenca((s) => s.porUsuario);
  const conectado = useConexao((s) => s.estado === 'aberto');
  const digitandoPorCanal = useDigitando((s) => s.porCanal);

  // O status que o servidor mandou no READY já vem público (quem escolheu
  // invisível chega como offline). O que o socket atualiza depois vive fora do
  // cache de requisição, e é aqui que as duas fontes se juntam.
  const pessoas = useMemo(
    () =>
      (pessoasCruas ?? []).map((p) => {
        const presenca = presencas[p.id];
        return presenca
          ? { ...p, status: presenca.status, customStatus: presenca.customStatus }
          : p;
      }),
    [pessoasCruas, presencas],
  );

  const leitura = useLeitura((s) => s.porCanal);
  const canais = useMemo(
    () => withReadState(canaisCrus ?? [], leitura),
    [canaisCrus, leitura],
  );
  const canalAtual = canais.find((c) => c.slug === slug);

  const digitando = useMemo(
    () => new Set(canalAtual ? digitandoAgora(digitandoPorCanal, canalAtual.id) : []),
    [digitandoPorCanal, canalAtual],
  );
  const podeGerenciar = can(permissoes, Perm.MANAGE_CHANNEL);

  const [painel, setPainel] = useState<PainelAberto>(null);
  const pedidoDeQuadro = useQuadro((s) => s.pedido);
  const threadAberta = useThread((s) => s.parentId);
  const fecharThread = useThread((s) => s.fechar);
  const [elencoVisivel, setElencoVisivel] = useState(true);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [gaveta, setGaveta] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);

  // Abaixo de 900px a navegação vira pilha: escolher um canal fecha a gaveta.
  const estreito = useMediaQuery('(max-width: 899px)');
  useEffect(() => {
    setGaveta(false);
  }, [slug, estreito]);

  // Na raiz, vai para o primeiro não lido — ou `geral`.
  //
  // A condição é o caminho ser `/`, e não a ausência de `slug`: `/config/...`
  // também não tem slug, e a versão anterior devolvia para a conversa qualquer
  // pessoa que abrisse uma página de configuração. Ninguém tinha percebido
  // porque não havia nenhuma página lá até agora.
  useEffect(() => {
    if (pathname !== '/' || canais.length === 0) return;
    const destino = primeiroDestino(canais);
    if (destino) navigate(`/c/${destino.slug}`, { replace: true });
  }, [pathname, canais, navigate]);

  const irParaVizinho = useCallback(
    (passo: number) => {
      const texto = canais.filter((c) => c.kind === 'text');
      if (texto.length === 0) return;
      const atual = texto.findIndex((c) => c.slug === slug);
      const proximo = texto[(atual + passo + texto.length) % texto.length];
      if (proximo) navigate(`/c/${proximo.slug}`);
    },
    [canais, slug, navigate],
  );

  const {
    alternarMudo,
    alternarSurdo,
    alternarCamera,
    alternarGrade,
    escolherTela,
    pararDeTransmitir,
    focar: focarTela,
    sair: sairDaChamada,
  } = useChamada();
  const transmitindo = useVoz((state) => state.transmitindo);
  const telaEmFoco = useVoz((state) => state.telaEmFoco);
  const modoDaSala = useVoz((state) => (state.fase === 'fora' ? 'mensagens' : state.modo));
  const canalDaChamada = useVoz((state) => (state.fase === 'fora' ? null : state.channelId));

  // `Alt ⇧ C` leva ao canal da chamada em andamento. Serve para achar de volta
  // a conversa que estava acontecendo depois de navegar para longe dela.
  const irParaChamada = useCallback(() => {
    const canal = canais.find((c) => c.id === canalDaChamada);
    if (canal) navigate(`/c/${canal.slug}`);
  }, [canais, canalDaChamada, navigate]);

  const alternarPainel = useCallback((qual: Exclude<PainelAberto, null>) => {
    setPainel((atual) => (atual === qual ? null : qual));
  }, []);

  // Abrir uma thread abre o painel dela; fechar o painel esquece a thread,
  // senão a próxima abertura mostraria a conversa de antes.
  useEffect(() => {
    if (threadAberta) setPainel('thread');
  }, [threadAberta]);

  useEffect(() => {
    if (painel !== 'thread') fecharThread();
  }, [painel, fecharThread]);

  // "Virou tarefa" na mensagem abre o quadro. Sem isso o rodapé seria um
  // rótulo, e o elo entre a conversa e o quadro só valeria num sentido.
  useEffect(() => {
    if (pedidoDeQuadro > 0) setPainel('tarefas');
  }, [pedidoDeQuadro]);

  // O clique numa notificação da área de trabalho troca de canal sem recarregar
  // o produto — o que reconectaria o socket e derrubaria a chamada.
  useEffect(() => {
    definirNavegador((para) => navigate(para));
    return () => definirNavegador(null);
  }, [navigate]);

  useNotificacoes(canalAtual?.id);

  useHotkeys([
    { key: 'k', mod: true, emCampo: true, run: () => setPaletaAberta(true) },
    { key: 'f', mod: true, emCampo: true, run: () => alternarPainel('busca') },
    // Do canal em que você está.
    { key: 'p', mod: true, emCampo: true, run: () => alternarPainel('fixadas') },
    { key: 'u', mod: true, emCampo: true, run: () => setElencoVisivel((v) => !v) },
    // Suas, de todas as conversas.
    { key: 'b', mod: true, shift: true, emCampo: true, run: () => alternarPainel('guardadas') },
    // Voz. `Ctrl/⌘ ⇧ M` e `Ctrl/⌘ ⇧ A` valem **em campo de texto**: calar o
    // microfone no meio de uma frase digitada é exatamente quando se precisa
    // deles. Ver design/02-shell-principal.md.
    { key: 'm', mod: true, shift: true, emCampo: true, run: alternarMudo },
    { key: 'a', mod: true, shift: true, emCampo: true, run: alternarSurdo },
    { key: 'd', mod: true, shift: true, emCampo: true, run: () => void sairDaChamada() },
    { key: 'v', mod: true, shift: true, emCampo: true, run: alternarCamera },
    {
      key: 'e',
      mod: true,
      shift: true,
      emCampo: true,
      // O atalho abre o diálogo de qualidade, não o seletor do navegador: o
      // pedido de captura precisa vir de um clique para o Safari aceitar.
      run: () => (transmitindo ? pararDeTransmitir() : escolherTela(true)),
    },
    { key: 'c', alt: true, shift: true, run: irParaChamada },
    { key: 'ArrowDown', alt: true, run: () => irParaVizinho(1) },
    { key: 'ArrowUp', alt: true, run: () => irParaVizinho(-1) },
    {
      key: 'Escape',
      emCampo: true,
      run: () => {
        /* O `Escape` tem ordem, e ela é a de "desfazer o último passo": tela
           cheia, tela em primeiro plano, sala, gaveta, painel.

           A tela cheia **chega aqui**: o navegador entrega o `keydown` e só
           depois sai do modo, então no instante da tecla `fullscreenElement`
           ainda está preenchido. Sem esta linha, um único `Escape` saía da tela
           cheia e fechava a tela em primeiro plano junto. */
        if (document.fullscreenElement) return;
        if (telaEmFoco) {
          focarTela(null);
          return;
        }
        if (modoDaSala !== 'mensagens') {
          alternarGrade();
          return;
        }
        if (gaveta) {
          setGaveta(false);
          return;
        }
        // Fecha o painel **só** se o foco estiver dentro dele. Senão, Escape
        // limparia o painel de quem só queria sair do compositor.
        if (painel && painelRef.current?.contains(document.activeElement)) setPainel(null);
      },
    },
  ]);

  return (
    <div className={styles.shell} data-gaveta={gaveta}>
      <a className={styles.pular} href="#compositor">
        Pular para o compositor
      </a>

      {/* --- coluna 1: rail --- */}
      <nav className={styles.rail} aria-label="Espaços">
        <span className={styles.marca} aria-hidden="true">
          <Marca size={26} />
        </span>
        <button type="button" className={styles.espacoBotao} data-ativo="true" aria-current="page">
          <span className={styles.marcador} aria-hidden="true" />
          <span className="visually-hidden">Trindade</span>
          <Marca size={18} />
        </button>
        {/* O elenco mora aqui, na vertical: visível em qualquer largura, e sem
            disputar altura com a lista de canais. */}
        <div className={styles.elencoNoRail} hidden={!elencoVisivel}>
          <Elenco users={pessoas} typing={digitando} acender={conectado} orientacao="vertical" />
        </div>

        <span className={styles.espacador} />
        <Tooltip label="Configurações" placement="right">
          <IconButton label="Configurações" size="sm" onClick={() => navigate('/config/perfil')}>
            <Settings size={20} />
          </IconButton>
        </Tooltip>
      </nav>

      {/* --- coluna 2: canais e elenco --- */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <ServerMenu
            podeGerenciarCanal={podeGerenciar}
            trigger={
              <button type="button" className={styles.servidor}>
                Trindade
                <ChevronDown size={16} />
              </button>
            }
          />
          {podeGerenciar ? (
            <Tooltip label="Criar canal">
              <IconButton label="Criar canal" size="sm">
                <Plus size={16} />
              </IconButton>
            </Tooltip>
          ) : null}
        </div>

        <div className={styles.listaCanais}>
          {carregandoCanais ? (
            <div style={{ padding: 'var(--s-2) var(--s-3)', display: 'grid', gap: 'var(--s-2)' }}>
              <Skeleton height="20px" width="60%" />
              <Skeleton height="20px" />
              <Skeleton height="20px" width="80%" />
            </div>
          ) : (
            <ChannelList channels={canais} podeGerenciar={podeGerenciar} />
          )}
        </div>

        <BarraDeChamada canais={canais} pessoas={pessoas} />

        {/* Só o seu canto fica no pé da coluna: é a única parte que fala de
            você, e ela pertence ao rodapé, junto do que você faz. */}
        <SeuCanto onGuardadas={() => alternarPainel('guardadas')} />
      </div>

      {gaveta && estreito ? (
        <div className={styles.veuGaveta} onClick={() => setGaveta(false)} role="presentation" />
      ) : null}

      {/* --- coluna 3: conversa --- */}
      <ChannelHeader
        canal={canalAtual}
        painel={painel}
        onPainel={alternarPainel}
        onAbrirGaveta={() => setGaveta(true)}
        mostrarGaveta={estreito}
        modoDaSala={modoDaSala}
        chamada={<GradeDaChamada canais={canais} pessoas={pessoas} />}
      >
        <Outlet />
      </ChannelHeader>

      {/* --- coluna 4: painel contextual --- */}
      <ContextPanel
        ref={painelRef}
        aberto={painel}
        canal={canalAtual}
        canais={canais}
        pessoas={pessoas}
        onFechar={() => setPainel(null)}
      />

      <CommandPalette
        aberta={paletaAberta}
        onFechar={() => setPaletaAberta(false)}
        canais={canais}
        pessoas={pessoas}
        onAbrirPainel={alternarPainel}
      />

      {/* Montado uma vez no shell: o diálogo é aberto do cartão de perfil e do
          menu do rodapé, e uma store diz quando. */}
      {/* Fica por cima de tudo e fora das colunas: a chamada não pertence a
          nenhuma delas quando você saiu da sala. */}
      <JanelaFlutuante canais={canais} pessoas={pessoas} />

      <DialogoDePerfil />
      <DialogoDeConvite aberto={conviteAberto} onFechar={fecharConvite} />
    </div>
  );
}
