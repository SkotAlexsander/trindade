# Visão e escopo

## O problema

Cinco pessoas tocando projetos juntas precisam de um lugar para conversar,
decidir e mostrar tela. As opções prontas resolvem, mas cada uma cobra um preço:
o Discord entrega a conversa e nada de projeto, além de expor metadado a um
terceiro. O Slack cobra por histórico. O Teams é pesado demais para cinco pessoas.

Este projeto é a alternativa auto-hospedada, desenhada para a escala exata de
cinco e para um requisito que os produtos comerciais não atendem: **os membros
não expõem o próprio endereço de rede uns aos outros durante chamadas.**

## Quem usa

Cinco pessoas que já se conhecem e confiam umas nas outras o bastante para
compartilhar um servidor, mas não o bastante — ou não têm motivo — para
compartilhar localização física. Uso diário, várias horas, em desktop
principalmente.

## O que o produto faz

**Conversa.** Canais de texto por assunto, mensagens em tempo real, histórico
permanente, busca, threads, reações, menções, anexos.

**Chamada.** Voz sempre disponível, vídeo e compartilhamento de tela sob demanda.
Todo o tráfego passa por relay.

**Projeto.** Notas colaborativas por canal, quadro de tarefas, enquetes,
mensagem fixada. É o que separa isto de um chat genérico.

**Identidade.** Cada pessoa tem foto, nome de exibição, bio e um ou mais cargos
com cor. Cargo define permissão e é atribuído por quem tem autoridade, nunca
pela própria pessoa.

## O que fica de fora, deliberadamente

| Não faremos | Por quê |
|---|---|
| Cadastro aberto | O elenco é fixo. Convite resolve e elimina abuso. |
| Descoberta de servidores | Existe um servidor. É este. |
| Recuperação de senha por e-mail | Sem e-mail no cadastro. Reset é manual por admin. |
| Aplicativo móvel nativo | Web responsiva cobre o caso de uso móvel real. |
| Criptografia ponta a ponta | Ver abaixo. |
| Bots e marketplace | Webhook de entrada cobre a necessidade real. |
| Moderação automática | Cinco pessoas conhecidas não precisam de filtro de spam. |
| Streaming para espectadores | Não é plataforma de conteúdo. |

## Sobre criptografia ponta a ponta

A tentação é grande e a decisão é não fazer, ao menos não na v1. O motivo não é
preguiça, é modelo de ameaça.

E2EE protege contra um servidor hostil ou comprometido. Aqui o servidor é seu,
está na sua conta de hospedagem, com disco criptografado. O adversário realista
não é o operador do servidor — é alguém de fora tentando entrar, e contra esse
TLS mais Argon2id mais 2FA já funcionam.

Em troca, E2EE custa caro: quebra a busca no servidor, quebra o histórico em
dispositivo novo, exige gestão de chave por dispositivo e transforma qualquer
erro de implementação numa falha silenciosa que ninguém percebe. É um projeto
inteiro, não uma funcionalidade.

Se o modelo de ameaça mudar, a implementação correta é MLS (RFC 9420), não
criptografia caseira, e vira a fase 9.

## Métrica de sucesso

O projeto deu certo se, seis meses depois, o grupo abandonou o WhatsApp para
assunto de trabalho e ninguém pediu para voltar. Não há métrica de engajamento,
retenção ou crescimento — o número de usuários é cinco por definição.
