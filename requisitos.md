# Requisitos do Sistema — ParkSys (Protótipo de Gestão de Estacionamento)

Este documento lista os requisitos atendidos pela implementação atual, organizados por
categoria. Ele reflete o que está de fato implementado em `index.html`, `style.css` e
`script.js` — para o raciocínio e as decisões de refinamento por trás de cada ponto, ver
`especificacao_sistema_estacionamento.md`.

---

## 1. Requisitos gerais e de arquitetura

- [x] Aplicação front-end pura: `index.html`, `style.css`, `script.js` — sem backend, sem
      processo de build, sem dependências externas via CDN.
- [x] HTML5, CSS3 e JavaScript (ES6+) sem framework.
- [x] Todos os dados persistidos no `localStorage` do navegador, com chaves prefixadas e
      versionadas (`parkingApp:v1:*`).
- [x] Autenticação demonstrativa mantida apenas em `sessionStorage` (não sobrevive ao
      fechamento da aba/janela).
- [x] Avisos explícitos na interface de que o protótipo é demonstrativo, sem backend, sem
      validade fiscal e sem segurança de produção.

## 2. Autenticação (login demonstrativo)

- [x] Tela de login antes de qualquer acesso ao painel.
- [x] Credenciais fixas de demonstração: usuário `admin`, senha `admin`.
- [x] Mensagem de erro para credenciais inválidas.
- [x] Opção de mostrar/ocultar a senha digitada.
- [x] Ação de sair (logout) disponível a qualquer momento dentro do painel.
- [x] Sessão válida somente durante a sessão do navegador (`sessionStorage`); a senha nunca
      é persistida em `localStorage`.

## 3. Layout e identidade visual

- [x] Paleta neutra com acentos em azul-claro (ações/seleção) e verde-claro
      (disponibilidade/sucesso); vermelho/âmbar reservados a alertas e estados críticos.
- [x] Padrões visuais inspirados no shadcn/ui (cards, botões, campos, tabelas, modais,
      tooltips, notificações, estados de foco) reproduzidos em HTML/CSS puro.
- [x] Barra lateral de navegação: Visão geral, Estacionamento, Clientes, Colaboradores,
      Veículos, Tickets, Relatórios, Configurações.
- [x] Cabeçalho/rodapé da navegação com nome do sistema, identificação do administrador,
      alternância de tema e logout.
- [x] Light Mode e Dark Mode, com preferência persistida no `localStorage` e aplicada via
      atributo `data-theme` + variáveis CSS.
- [x] Layout responsivo (desktop, tablet, celular); planta com rolagem horizontal
      controlada em telas pequenas.
- [x] Foco visível em todos os controles interativos; estado das vagas nunca depende só de
      cor (ícone + texto + legenda).

## 4. Dashboard — Visão geral

- [x] Indicadores calculados a partir dos dados salvos (nunca fixos no HTML):
      capacidade total, vagas livres, ocupadas, interditadas, taxa de ocupação,
      veículos estacionados, faturamento do dia, tickets perdidos no dia.
- [x] Atalhos de serviço: cadastrar cliente, registrar entrada, consultar vagas,
      consultar clientes, consultar veículos, localizar ticket, abrir relatórios.
- [x] Lista de atividade recente (últimas operações do histórico de auditoria).

## 5. Planta interativa do estacionamento

- [x] Representação esquemática vista de cima, com setores, fileiras e corredores de
      circulação (não é apenas uma grade genérica de cards).
- [x] Vagas identificadas por código consistente (`A-01`, `B-03`, ...), agrupadas por setor.
- [x] Planta centralizada na área principal da tela do administrador.
- [x] Três estados possíveis por vaga: **Livre**, **Ocupada**, **Interditada**.
- [x] Legenda sempre visível com os três estados.
- [x] Hover com resumo (tooltip) e clique abrindo um painel lateral (drawer) com os
      detalhes da vaga.
- [x] Ações compatíveis com o estado da vaga:
  - Livre → Ocupar vaga / Interditar vaga.
  - Ocupada → Editar dados / Registrar saída / Emitir segunda via do ticket.
  - Interditada → Editar motivo / Liberar vaga.
- [x] Confirmação explícita antes de liberar vaga interditada ou registrar saída.
- [x] Bloqueio de ocupação de vaga já ocupada ou interditada.

## 6. Cadastro de clientes, colaboradores e veículos (CRUD)

### Clientes
- [x] Campos: nome completo\*, CPF\*, telefone, e-mail, observações, status
      (ativo/inativo), datas de cadastro/atualização geradas pelo sistema.
- [x] Validação matemática do CPF (dígitos verificadores) e unicidade após normalização.
- [x] Busca por nome, CPF ou telefone; filtro para exibir/ocultar inativos.
- [x] Exportação CSV respeitando os filtros ativos.

### Colaboradores
- [x] Campos: nome\*, CPF\*, telefone, e-mail, cargo/função\*, status (ativo/inativo),
      data de cadastro.
- [x] Sem login próprio nesta versão (apenas registro administrativo).
- [x] Unicidade de CPF entre colaboradores.

### Veículos
- [x] Campos: placa\* (normalizada, maiúscula, sem espaços/hífen), marca, modelo, cor,
      categoria (Carro/Moto/Utilitário/Outro), cliente responsável\*, status.
- [x] Validação de placa nos formatos antigo (`ABC1234`) e Mercosul (`ABC1D23`).
- [x] Indicação de "Em uso — vaga X" quando o veículo possui sessão ativa.

### Regras de exclusão (comuns às três entidades)
- [x] Confirmação obrigatória antes de excluir.
- [x] Bloqueio de exclusão física de cliente/veículo com sessão ativa.
- [x] Bloqueio de exclusão física quando há qualquer histórico de sessões — a interface
      orienta a usar "Inativar" para preservar relatórios e auditoria.
- [x] Toda alteração relevante é registrada no histórico.

## 7. Entrada, ocupação de vaga e sessão de estacionamento

- [x] Fluxo: seleção de vaga livre → formulário de cliente/veículo (existente ou novo) →
      resumo de conferência → confirmação → criação da sessão + ticket.
- [x] Cada entrada cria uma **sessão** própria (id, vaga, cliente, veículo, placa no
      momento, entrada, previsão de saída opcional, saída efetiva, ticket, valor,
      situação de pagamento, situação da sessão).
- [x] Validação de campos obrigatórios (nome, CPF válido, placa válida) antes de avançar.
- [x] **Regra de placa duplicada:** se a placa já possui sessão ativa em outra vaga, o
      sistema **não cria uma segunda sessão**; exibe aviso e oferece abrir a sessão
      existente para atualização dos dados do cliente, preservando vaga, veículo e
      histórico.
- [x] Não permite mais de uma sessão ativa por vaga nem por veículo/placa.
- [x] Previsão de saída não pode ser anterior à entrada.
- [x] Formulário preserva os dados digitados em caso de erro de validação.
- [x] Proteção contra duplo envio (clique duplo) do formulário de entrada.

## 8. Saída, cobrança e faturamento

- [x] Tela de saída com cliente, veículo, placa, vaga, entrada e duração calculada.
- [x] Regra de tarifa **centralizada em uma única função** (`calcularTarifa`): cobrança
      mínima de 1 hora, hora iniciada cobrada integralmente, preço/hora configurável.
- [x] Ajuste manual do valor na saída, exigindo justificativa obrigatória e registrado
      em auditoria (valor original × valor ajustado).
- [x] Confirmação antes de encerrar a sessão.
- [x] Ao encerrar: vaga liberada, dashboard/relatórios/histórico atualizados
      automaticamente.
- [x] Nenhuma integração real com meios de pagamento — apenas status demonstrativo.

## 9. Ticket e QR Code demonstrativos

- [x] Ticket emitido na entrada com: nome do estacionamento, número único, placa, vaga,
      nome do cliente, data/hora de entrada, QR Code fictício, aviso de documento
      demonstrativo sem validade fiscal.
- [x] QR Code (canvas, desenhado localmente) contém apenas um token fictício — nunca CPF,
      telefone, e-mail ou outro dado pessoal.
- [x] Se o desenho do QR falhar por qualquer motivo, a interface recorre a um
      identificador textual do ticket em vez de travar a emissão.
- [x] Impressão / "Salvar como PDF" via janela de impressão do navegador, tanto para
      tickets quanto para relatórios.
- [x] Tela de Tickets permite localizar (por número, placa ou cliente) e emitir segunda
      via de qualquer ticket já emitido.

## 10. Ticket perdido

- [x] Localização da sessão ativa por placa, cliente ou vaga (busca com autocompletar).
- [x] Pré-visualização dos dados da sessão antes da confirmação.
- [x] Aplicação de taxa demonstrativa configurável, com justificativa opcional e
      responsável/data registrados.
- [x] **A sessão e a vaga permanecem ativas** — a perda do ticket não encerra nem recria
      a sessão.
- [x] Emissão de comprovante de ocorrência (identificado como demonstrativo).
- [x] Bloqueio de registro duplicado de perda para o mesmo ticket.

## 11. Estacionamento lotado e previsão de espera

- [x] Mensagem clara quando não há vagas livres: "Estacionamento lotado no momento."
- [x] Prioridade 1: previsão de saída das sessões ativas (ordenada pela mais próxima),
      mostrando até 3 vagas com estimativa em minutos.
- [x] Prioridade 2 (fallback): média de permanência das sessões encerradas, **somente**
      quando há amostra mínima configurável — sempre identificada como média/estimativa.
- [x] Caso não haja dados suficientes: "Previsão indisponível no momento."
- [x] Locais alternativos exibidos **apenas** se previamente cadastrados pelo
      administrador em Configurações (nunca inventados).
- [x] Nenhuma promessa de horário exato — sempre tratado como estimativa sujeita a
      alteração.

## 12. Relatórios e auditoria

- [x] Filtro de período (data inicial/final) aplicado a indicadores, sessões e histórico.
- [x] Indicadores: entradas, saídas, sessões encerradas, faturamento, permanência média,
      tickets perdidos, vaga mais utilizada no período.
- [x] Gráfico de faturamento dos últimos 7 dias.
- [x] Histórico de auditoria com data/hora, ação, entidade, resumo e responsável, com
      filtro por entidade.
- [x] Eventos auditados: CRUD de clientes/colaboradores/veículos, entrada/saída/edição de
      sessão, interdição/liberação de vaga, emissão/reimpressão/perda de ticket, alteração
      de configurações.

## 13. Exportações

- [x] CSV em UTF-8 com BOM (compatível com Excel/LibreOffice em português), campos com
      aspas/vírgulas/quebras de linha tratados corretamente.
- [x] Exportação individual de clientes, colaboradores, veículos, vagas, sessões e
      histórico — sempre respeitando os filtros ativos no momento da exportação.
- [x] Mensagem de aviso (sem gerar arquivo) quando não há registros a exportar.
- [x] Relatórios e tickets exportáveis em PDF via impressão do navegador
      ("Salvar como PDF").
- [x] Backup completo em JSON (exportação e importação com validação do arquivo antes de
      sobrescrever os dados locais).

## 14. Dados mockados e persistência

- [x] Base de demonstração carregada **apenas na primeira execução** (verificada por uma
      flag em `localStorage`), nunca sobrescrevendo dados já existentes.
- [x] 28 vagas em 4 setores, com vagas livres, ocupadas e interditadas desde o início.
- [x] 8 clientes fictícios com CPFs matematicamente válidos (sem dados reais).
- [x] 5 colaboradores fictícios, 1 deles inativo.
- [x] ~12 veículos fictícios com placas válidas nos dois formatos.
- [x] Sessões ativas e encerradas (histórico de ~18 sessões encerradas para alimentar
      médias e o gráfico de faturamento).
- [x] Um caso de ticket perdido já incluído na base inicial.
- [x] Histórico de auditoria dos dias anteriores.
- [x] Tarifa, taxa de bilhete perdido e um local alternativo demonstrativos, todos
      editáveis.
- [x] Ação de "Restaurar dados de exemplo" disponível, exigindo confirmação explícita
      (ação destrutiva).

## 15. Validações e tratamento de erros

- [x] Campos obrigatórios vazios bloqueiam o salvamento com mensagem junto ao campo.
- [x] CPF: validação de formato e dígitos verificadores; duplicidade tratada oferecendo
      reaproveitar o cadastro existente.
- [x] Placa: formato antigo/Mercosul validado; vazia ou inválida bloqueia a operação.
- [x] Normalização antes de qualquer comparação: strings sem espaços nas pontas, CPF só
      dígitos, placa maiúscula sem hífen/espaço, e-mail em minúsculas.
- [x] Falha de gravação no `localStorage` nunca é reportada como sucesso ao usuário.
- [x] Dados digitados pelo usuário nunca são inseridos via `innerHTML` sem passar por
      escape (`esc()`), prevenindo XSS básico.
- [x] Prevenção de duplo envio em todos os formulários de operação (login, ocupação,
      saída, CRUD, bilhete perdido).

---

## Fora do escopo desta versão (propositalmente)

- Backend, banco de dados ou qualquer persistência fora do navegador local.
- Autenticação real, múltiplos perfis de acesso ou múltiplos operadores simultâneos.
- Integração com meios de pagamento, cancelas físicas ou leitura automática de placas.
- Geração de `.xlsx` nativo (é usado CSV, compatível com Excel) ou de PDF sem depender da
  janela de impressão do navegador.
- Validade fiscal de tickets, comprovantes ou relatórios.
