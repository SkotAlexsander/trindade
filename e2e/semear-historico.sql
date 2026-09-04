-- Enche #geral com histórico antigo, para que a paginação tenha o que paginar.
--
-- Direto no banco de propósito: o envio real passa pelo WebSocket e pelo token
-- bucket de 10 mensagens por 10 segundos, então semear 120 linhas pela
-- interface levaria dois minutos e ainda testaria o rate limit por acidente.
--
-- Idempotente: só insere se ainda não houver histórico semeado.
--   docker compose exec -T postgres psql -U trindade -d trindade < e2e/semear-historico.sql

do $$
declare
  canal uuid;
  autores uuid[];
  quantos int;
begin
  select id into canal from channels where slug = 'geral';
  if canal is null then
    raise notice 'canal #geral não existe; nada a semear';
    return;
  end if;

  select count(*) into quantos from messages
   where channel_id = canal and content like '[semente]%';
  if quantos >= 120 then
    raise notice 'já semeado (% linhas)', quantos;
    return;
  end if;

  select array_agg(id order by username) into autores from users where disabled_at is null;

  insert into messages (channel_id, author_id, content, created_at)
  select
    canal,
    autores[1 + (i % array_length(autores, 1))],
    '[semente] linha ' || i || ' do histórico antigo',
    -- Espalhadas por três dias, para exercitar também os divisores de dia e a
    -- quebra de bloco por tempo.
    now() - interval '3 days' + (i * interval '31 minutes')
  from generate_series(1, 120) as i;

  raise notice 'semeadas 120 mensagens em #geral';
end $$;

-- Uma menção pendente em #bugs para cada pessoa.
--
-- O roteiro da fase 4 confere que menção vira pílula com contador, e a pílula
-- só existe se alguém tiver sido citado e ainda não tiver lido. Sem semear,
-- essa verificação passava por acaso — pelo resto que corridas anteriores
-- deixavam no banco — e falhava assim que o banco era limpo.
do $$
declare
  canal uuid;
  bruno uuid;
begin
  select id into canal from channels where slug = 'bugs';
  select id into bruno from users where username = 'bruno';
  if canal is null or bruno is null then
    raise notice 'sem #bugs ou sem bruno; nada a semear';
    return;
  end if;

  insert into messages (channel_id, author_id, content, created_at)
  select canal, bruno, '[semente] @' || u.username || ' consegue olhar isto?',
         now() - interval '2 hours'
    from users u
   where u.disabled_at is null and u.id <> bruno
     and not exists (
       select 1 from messages m
        where m.channel_id = canal
          and m.content = '[semente] @' || u.username || ' consegue olhar isto?'
     );

  -- `last_read_message_id = null` junto com a contagem: sem isso, quem já
  -- abriu #bugs numa corrida anterior continua com o canal lido, e a mensagem
  -- semeada — que é mais velha que a última lida — não volta a contar como não
  -- lida. Semear tem de devolver o estado, não só acrescentar linhas.
  insert into read_state (user_id, channel_id, mention_count, last_read_message_id)
  select u.id, canal, 1, null from users u
   where u.disabled_at is null and u.id <> bruno
      on conflict (user_id, channel_id)
      do update set mention_count = greatest(read_state.mention_count, 1),
                    last_read_message_id = null;

  raise notice 'menções pendentes semeadas em #bugs';
end $$;
