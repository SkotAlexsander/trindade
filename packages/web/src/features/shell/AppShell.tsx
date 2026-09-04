import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { Perm, can } from '@trindade/shared';
import { IconButton, Skeleton, Tooltip } from '../../components';
import { ChevronDown, Plus, Settings } from '../../components/icones';
import { Marca } from '../../components/Logo';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useHotkeys } from '../../lib/useHotkeys';
import { useAuth } from '../auth/store';
import { CastPanel } from '../cast/CastPanel';
import { ChannelList } from '../channels/ChannelList';
import { useChannels, useUsers } from '../channels/queries';
import { useGateway } from '../realtime/useGateway';
import { digitandoAgora, useConexao, useDigitando, usePresenca } from '../realtime/store';
import { primeiroDestino, withPlaceholderState } from '../channels/canais';
import { ChannelHeader, type PainelAberto } from './ChannelHeader';
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

  const canais = useMemo(() => withPlaceholderState(canaisCrus ?? []), [canaisCrus]);
  const canalAtual = canais.find((c) => c.slug === slug);

  const digitando = useMemo(
    () => new Set(canalAtual ? digitandoAgora(digitandoPorCanal, canalAtual.id) : []),
    [digitandoPorCanal, canalAtual],
  );
  const podeGerenciar = can(permissoes, Perm.MANAGE_CHANNEL);

  const [painel, setPainel] = useState<PainelAberto>(null);
  const [elencoVisivel, setElencoVisivel] = useState(true);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [gaveta, setGaveta] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);

  // Abaixo de 900px a navegação vira pilha: escolher um canal fecha a gaveta.
  const estreito = useMediaQuery('(max-width: 899px)');
  useEffect(() => {
    setGaveta(false);
  }, [slug, estreito]);

  // Sem slug na URL, vai para o primeiro não lido — ou `geral`.
  useEffect(() => {
    if (slug || canais.length === 0) return;
    const destino = primeiroDestino(canais);
    if (destino) navigate(`/c/${destino.slug}`, { replace: true });
  }, [slug, canais, navigate]);

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

  const alternarPainel = useCallback((qual: Exclude<PainelAberto, null>) => {
    setPainel((atual) => (atual === qual ? null : qual));
  }, []);

  useHotkeys([
    { key: 'k', mod: true, emCampo: true, run: () => setPaletaAberta(true) },
    // Do canal em que você está.
    { key: 'p', mod: true, emCampo: true, run: () => alternarPainel('fixadas') },
    { key: 'u', mod: true, emCampo: true, run: () => setElencoVisivel((v) => !v) },
    // Suas, de todas as conversas.
    { key: 'b', mod: true, shift: true, emCampo: true, run: () => alternarPainel('guardadas') },
    { key: 'ArrowDown', alt: true, run: () => irParaVizinho(1) },
    { key: 'ArrowUp', alt: true, run: () => irParaVizinho(-1) },
    {
      key: 'Escape',
      emCampo: true,
      run: () => {
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

        {/* Escondido, não desmontado: na faixa estreita o elenco é o último
            filho e recebe `order: -1` para virar faixa no topo da gaveta.
            Desmontá-lo passaria essa regra para a lista de canais, que subiria
            por cima do cabeçalho. */}
        <div className={styles.elencoSlot} hidden={!elencoVisivel}>
          <CastPanel
            users={pessoas}
            typing={digitando}
            acender={conectado}
            onGuardadas={() => alternarPainel('guardadas')}
          />
        </div>
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
      >
        <Outlet />
      </ChannelHeader>

      {/* --- coluna 4: painel contextual --- */}
      <ContextPanel
        ref={painelRef}
        aberto={painel}
        canal={canalAtual}
        onFechar={() => setPainel(null)}
      />

      <CommandPalette
        aberta={paletaAberta}
        onFechar={() => setPaletaAberta(false)}
        canais={canais}
        pessoas={pessoas}
        onAbrirPainel={alternarPainel}
      />
    </div>
  );
}
