# ParkSys — Protótipo de Gestão de Estacionamento

Painel administrativo para gerenciar vagas, clientes, colaboradores, veículos, entradas,
saídas, tickets, faturamento demonstrativo e relatórios de um estacionamento.

Protótipo front-end **sem backend**: três arquivos, sem build, sem dependências externas.
Todos os dados ficam salvos no navegador (`localStorage`/`sessionStorage`) de quem o
estiver usando.

# Membros do grupo

- **Antony Haro dos Santos**
- **Felipe Teruel Cordeiro**
- **João Pedro Mota Silva**
- **Matheus Barros Meneses**

## Como executar

Não há instalação nem servidor. Basta abrir o arquivo `index.html` em um navegador atual
(Chrome, Firefox, Edge...):

```bash
# Linux
xdg-open index.html

# ou simplesmente arraste o arquivo index.html para uma aba do navegador
```

Também funciona normalmente ao abrir com duplo clique no `index.html` pelo gerenciador de
arquivos.

## Acesso

Tela de login antes do painel. Credenciais fixas de demonstração:

| Usuário | Senha |
|---|---|
| `admin` | `admin` |

> Isto é apenas demonstrativo — não há autenticação segura, não há múltiplos usuários, e a
> sessão vale só para a aba atual (`sessionStorage`). Ver avisos completos dentro do
> próprio app, na tela de Configurações.

## Estrutura do projeto

```text
estacionamento-fatec/
├── index.html                              # telas, menus, formulários, modais
├── style.css                                # identidade visual, temas, responsividade
├── script.js                                # estado, regras de negócio, persistência
├── requisitos.md                            # checklist de requisitos atendidos
├── especificacao_sistema_estacionamento.md  # especificação funcional/técnica completa
└── README.md                                # este arquivo
```

## O que o sistema faz

- **Planta interativa do estacionamento** — vista esquemática com setores e corredores;
  clique em uma vaga para ver detalhes e agir (ocupar, editar, registrar saída,
  interditar, liberar).
- **Entrada e ocupação** — cadastra ou reaproveita cliente e veículo, confere um resumo e
  gera um ticket demonstrativo com QR Code fictício.
- **Saída e cobrança** — calcula o valor por uma regra de tarifa centralizada e
  configurável, permite ajuste justificado, libera a vaga.
- **CRUD completo** de Clientes, Colaboradores e Veículos, com busca, validação e
  bloqueio de exclusão quando há sessões vinculadas.
- **Tickets** — segunda via e registro de bilhete perdido (sem encerrar a sessão).
- **Estacionamento lotado** — aviso com previsão de liberação baseada em dados reais das
  sessões, nunca em horários inventados.
- **Dashboard e Relatórios** — indicadores calculados a partir dos dados salvos, gráfico
  de faturamento, histórico de auditoria com filtros.
- **Exportações** — CSV (UTF-8 com BOM, pronto para Excel), backup completo em JSON,
  impressão de tickets/relatórios com opção de salvar como PDF.
- **Tema claro/escuro** persistido entre sessões.

A lista detalhada e marcada do que foi implementado está em
[`requisitos.md`](./requisitos.md). O raciocínio por trás de cada decisão de design está em
[`especificacao_sistema_estacionamento.md`](./especificacao_sistema_estacionamento.md).

## Dados de demonstração

Na primeira execução, o sistema carrega automaticamente uma base fictícia: vagas em
diferentes estados, clientes com CPFs válidos (porém fictícios), colaboradores, veículos,
sessões ativas e encerradas, um ticket perdido já registrado e histórico de auditoria dos
dias anteriores. Nas execuções seguintes, os dados salvos localmente são preservados — a
base de exemplo **não é recarregada por cima** do que você alterar.

Para voltar ao estado inicial de demonstração, use **Configurações → Restaurar dados de
exemplo** (ação destrutiva, pede confirmação).

## Limitações conhecidas (deliberadas)

- Sem backend: os dados existem somente no navegador/perfil/dispositivo usado. Limpar os
  dados do navegador apaga tudo.
- Login apenas demonstrativo, sem segurança de produção.
- Sem integração real com pagamentos, cancelas físicas ou leitura automática de placas.
- Exportação de planilha é CSV (abre no Excel/LibreOffice); `.xlsx` nativo exigiria uma
  biblioteca externa.
- PDF é gerado pela própria caixa de impressão do navegador ("Salvar como PDF"), não por
  uma biblioteca de geração de PDF.
- Sem paginação nas tabelas (o volume de dados do protótipo não exige).

## Compatibilidade

Testado visualmente em navegadores baseados em Chromium e Firefox recentes. Usa apenas
recursos padrão de HTML5/CSS3/ES6+ (Canvas 2D, `localStorage`/`sessionStorage`, `Blob`,
`datalist`, variáveis CSS, `prefers-color-scheme`) — sem polyfills.
