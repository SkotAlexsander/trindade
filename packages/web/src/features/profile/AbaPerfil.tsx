import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@trindade/shared';
import { Avatar, Button, Input, Textarea } from '../../components';
import { HttpError, api, upload } from '../../lib/http';
import { useAuth } from '../auth/store';
import { Recortador } from './Recortador';
import styles from './perfil.module.css';

/**
 * A aba de perfil.
 *
 * Ver design/05-perfil-e-cargos.md, "Editar perfil".
 */

const LIMITE_DA_BIO = 280;
/** O contador só aparece a partir daqui. Antes disso é ruído. */
const MOSTRAR_CONTADOR = 0.8;

/**
 * As cores de destaque prontas.
 *
 * Sete e um campo livre: uma paleta fechada faz a maioria escolher em dois
 * segundos, e quem quer um tom específico ainda digita o hex.
 */
const CORES = [
  '#22d3ee',
  '#4c8df6',
  '#a855f7',
  '#ec4899',
  '#f97316',
  '#22c55e',
  '#eab308',
] as const;

export interface AbaPerfilProps {
  user: User;
  onSujo: (sujo: boolean) => void;
  registrarSalvar: (salvar: (() => Promise<void>) | null) => void;
}

export function AbaPerfil({ user, onSujo, registrarSalvar }: AbaPerfilProps) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio ?? '');
  const [accentColor, setAccentColor] = useState(user.accentColor ?? '');

  const [aRecortar, setARecortar] = useState<File | null>(null);
  const [previaLocal, setPreviaLocal] = useState<string | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [erroDaFoto, setErroDaFoto] = useState<string | null>(null);
  const seletor = useRef<HTMLInputElement>(null);

  const mudou =
    displayName.trim() !== user.displayName ||
    bio !== (user.bio ?? '') ||
    (accentColor || null) !== user.accentColor;
  const podeSalvar = mudou && displayName.trim().length > 0;

  const salvar = useCallback(async () => {
    const { user: novo } = await api<{ user: User }>('/me', {
      method: 'PATCH',
      body: {
        displayName: displayName.trim(),
        bio: bio.trim() || null,
        accentColor: accentColor || null,
      },
    });
    useAuth.setState({ user: novo });
    qc.setQueryData<User[]>(['users'], (atuais) =>
      atuais?.map((u) => (u.id === novo.id ? novo : u)),
    );
  }, [displayName, bio, accentColor, qc]);

  // O diálogo precisa de duas coisas daqui: se há mudança pendente, para pedir
  // confirmação ao fechar, e como salvar. Num efeito, e não durante a
  // renderização — avisar o pai enquanto o filho desenha é mudar estado no
  // meio de um render, e o React reclama com razão.
  useEffect(() => {
    onSujo(mudou);
    registrarSalvar(podeSalvar ? salvar : null);
  }, [mudou, podeSalvar, salvar, onSujo, registrarSalvar]);

  async function enviarFoto(recorte: Blob, previa: string): Promise<void> {
    setARecortar(null);
    setErroDaFoto(null);
    // A foto nova aparece na hora, esmaecida até o servidor confirmar. Esperar
    // o upload para trocar o avatar faria a interface parecer travada.
    setPreviaLocal(previa);
    setSubindo(true);

    const form = new FormData();
    form.append('file', recorte, 'avatar.webp');

    try {
      const r = await upload<{ user: User }>('/me/avatar', form);
      useAuth.setState({ user: r.user });
      qc.setQueryData<User[]>(['users'], (atuais) =>
        atuais?.map((u) => (u.id === r.user.id ? r.user : u)),
      );
      setPreviaLocal(null);
    } catch (err) {
      // A falha reverte para a foto anterior, com a mensagem **no bloco da
      // foto** — não num toast num canto, longe do que a pessoa estava fazendo.
      setPreviaLocal(null);
      setErroDaFoto(err instanceof HttpError ? err.message : 'não consegui enviar a foto');
    } finally {
      setSubindo(false);
    }
  }

  async function removerFoto(): Promise<void> {
    setErroDaFoto(null);
    try {
      await api('/me/avatar', { method: 'DELETE' });
      const semFoto = { ...user, avatarUrl: null, avatarBlurhash: null };
      useAuth.setState({ user: semFoto });
      qc.setQueryData<User[]>(['users'], (atuais) =>
        atuais?.map((u) => (u.id === user.id ? semFoto : u)),
      );
    } catch {
      setErroDaFoto('não consegui remover a foto');
    }
  }

  const restam = LIMITE_DA_BIO - bio.length;
  const mostrarContador = bio.length >= LIMITE_DA_BIO * MOSTRAR_CONTADOR;

  return (
    <div className={styles.aba}>
      {aRecortar ? (
        <Recortador
          arquivo={aRecortar}
          onCancelar={() => setARecortar(null)}
          onPronto={(recorte, previa) => void enviarFoto(recorte, previa)}
        />
      ) : (
        <div className={styles.blocoFoto}>
          <span data-subindo={subindo} className={styles.fotoAtual}>
            <Avatar
              id={user.id}
              name={user.displayName}
              src={previaLocal ?? user.avatarUrl}
              size="xl"
            />
          </span>

          <div className={styles.fotoTexto}>
            <p className={styles.fotoRotulo}>Foto</p>
            <div className={styles.fotoBotoes}>
              <Button variant="secondary" size="sm" onClick={() => seletor.current?.click()}>
                Trocar
              </Button>
              {user.avatarUrl ? (
                <Button variant="ghost" size="sm" onClick={() => void removerFoto()}>
                  Remover
                </Button>
              ) : null}
            </div>
            <p className={styles.fotoDica}>PNG, JPG ou WebP. Até 8 MB.</p>
            {/* Não é aviso jurídico: é informação útil. A maioria das pessoas
                não sabe que a foto do celular carrega GPS, e dizer que você
                cuida disso constrói confiança. */}
            <p className={styles.fotoPrivacidade}>
              A localização e outros dados da foto são removidos ao enviar.
            </p>
            {erroDaFoto ? <p className={styles.erroFoto}>{erroDaFoto}</p> : null}
          </div>

          <input
            ref={seletor}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            hidden
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) {
                setErroDaFoto(null);
                setARecortar(arquivo);
              }
              e.target.value = '';
            }}
          />
        </div>
      )}

      <Input
        label="Nome de exibição"
        value={displayName}
        maxLength={32}
        hint="É assim que você aparece nas conversas."
        onChange={(e) => setDisplayName(e.target.value)}
      />

      {/* Texto, não campo desabilitado. Campo cinza convida a tentar clicar;
          texto simples com a explicação ao lado responde a pergunta antes de
          ela ser feita. */}
      <div className={styles.campoLido}>
        <p className={styles.rotuloLido}>Nome de usuário</p>
        <p className={styles.valorLido}>@{user.username}</p>
        <p className={styles.dicaLida}>Não pode ser alterado.</p>
      </div>

      <div className={styles.comContador}>
        <Textarea
          label="Sobre você"
          value={bio}
          rows={3}
          maxLength={LIMITE_DA_BIO}
          onChange={(e) => setBio(e.target.value)}
        />
        {mostrarContador ? (
          <span className={styles.contador} data-perto={restam <= 20}>
            {bio.length}/{LIMITE_DA_BIO}
          </span>
        ) : null}
      </div>

      <div className={styles.campoLido}>
        <p className={styles.rotuloLido}>Cor de destaque</p>
        <div className={styles.cores}>
          {CORES.map((cor) => (
            <button
              key={cor}
              type="button"
              className={styles.amostra}
              style={{ background: cor }}
              aria-label={`Usar ${cor}`}
              aria-pressed={accentColor === cor}
              data-ativa={accentColor === cor}
              onClick={() => setAccentColor(accentColor === cor ? '' : cor)}
            />
          ))}
          <input
            className={styles.hex}
            value={accentColor}
            placeholder="#4c8df6"
            aria-label="Cor em hexadecimal"
            maxLength={7}
            onChange={(e) => setAccentColor(e.target.value.toLowerCase())}
          />
        </div>
        <p className={styles.dicaLida}>Pinta a faixa do seu cartão de perfil.</p>
      </div>
    </div>
  );
}
