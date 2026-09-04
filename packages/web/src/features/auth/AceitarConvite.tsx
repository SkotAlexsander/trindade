import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/http';
import {
  AuthScreen,
  Banner,
  Brand,
  buttonClass,
  footerClass,
  ledeClass,
  linkClass,
  titleClass,
} from './components';

type PreviewResponse = { valid: true; serverName: string; invitedBy: string } | { valid: false };

export function AceitarConvite() {
  const { codigo } = useParams<{ codigo: string }>();
  const navigate = useNavigate();

  const { data, isPending } = useQuery({
    queryKey: ['invite', codigo],
    queryFn: () => api<PreviewResponse>(`/invites/${codigo}/preview`, { auth: false }),
    retry: false,
  });

  return (
    <AuthScreen>
      <Brand />

      {isPending ? <p className={ledeClass}>Conferindo o convite…</p> : null}

      {data && !data.valid ? (
        <>
          <Banner>Este convite não vale mais.</Banner>
          <p className={ledeClass}>
            Ele pode ter expirado ou já ter sido usado. Peça um novo para quem te chamou.
          </p>
          {/* Sem botão: não há ação possível aqui, e um botão falso é pior que
              nenhum. Ver design/06-autenticacao.md. */}
        </>
      ) : null}

      {data?.valid ? (
        <>
          {/* Mostra apenas quem convidou. Nunca quantas pessoas existem, quais
              canais ou quais nomes: um código vazado não entrega o mapa. */}
          <h1 className={titleClass}>{data.invitedBy} convidou você</h1>
          <p className={ledeClass}>Um espaço de trabalho para cinco pessoas.</p>

          <button className={buttonClass} type="button" onClick={() => navigate(`/criar-conta/${codigo}`)}>
            Criar minha conta
          </button>

          <p className={footerClass}>
            Já tem conta?{' '}
            <Link className={linkClass} to="/entrar">
              Entrar
            </Link>
          </p>
        </>
      ) : null}
    </AuthScreen>
  );
}
