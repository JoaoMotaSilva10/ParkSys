/* ============================================================
   ParkSys — script.js
   Protótipo front-end de gestão de estacionamento.
   Sem backend: todos os dados vivem no localStorage/sessionStorage
   deste navegador. Ver aviso completo na tela de Configurações.
   ============================================================ *///

/* ============================================================
   1) CONFIG
   ============================================================ */
const APP_PREFIX = 'parkingApp:v1:';

const STORAGE_KEYS = {
  clients: APP_PREFIX + 'clients',
  employees: APP_PREFIX + 'employees',
  vehicles: APP_PREFIX + 'vehicles',
  spots: APP_PREFIX + 'spots',
  sessions: APP_PREFIX + 'sessions',
  tickets: APP_PREFIX + 'tickets',
  history: APP_PREFIX + 'history',
  config: APP_PREFIX + 'config',
  seeded: APP_PREFIX + 'seeded',
  theme: APP_PREFIX + 'theme'
};
const SESSION_AUTH_KEY = APP_PREFIX + 'session';

// Credenciais de demonstração — NUNCA representar isto como autenticação segura.
const DEMO_CREDENTIALS = { usuario: 'admin', senha: 'admin' };

const DEFAULT_CONFIG = {
  nomeEstacionamento: 'ParkSys — Estacionamento Demonstração',
  precoPorHora: 8,
  taxaBilhetePerdido: 35,
  amostraMinimaPrevisao: 3,
  locaisAlternativos: []
};

// Estado em memória. Carregado uma vez no início e sempre persistido
// após qualquer mutação (ver persist()).
const state = {
  clients: [],
  employees: [],
  vehicles: [],
  spots: [],
  sessions: [],
  tickets: [],
  history: [],
  config: null
};

// Flags simples de "operação em andamento" para evitar duplo envio de formulários.
const busyFlags = {};
function isBusy(key) { return !!busyFlags[key]; }
function setBusy(key, val) { busyFlags[key] = val; }

/* ============================================================
   2) STORAGE — leitura/gravação centralizadas
   ============================================================ */
function safeGetJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Falha ao ler chave', key, err);
    return fallback;
  }
}

// Retorna true/false — a chamadora NUNCA deve informar sucesso se isto retornar false.
function safeSetJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Falha ao gravar chave', key, err);
    return false;
  }
}

const ENTITY_TO_KEY = {
  clients: STORAGE_KEYS.clients,
  employees: STORAGE_KEYS.employees,
  vehicles: STORAGE_KEYS.vehicles,
  spots: STORAGE_KEYS.spots,
  sessions: STORAGE_KEYS.sessions,
  tickets: STORAGE_KEYS.tickets,
  history: STORAGE_KEYS.history,
  config: STORAGE_KEYS.config
};

// Grava a fatia do estado correspondente a `entity` (ex: 'clients').
// Em caso de falha, avisa o usuário e retorna false para que a operação
// que chamou NÃO finja ter sido concluída com sucesso.
function persist(entity) {
  const key = ENTITY_TO_KEY[entity];
  const ok = safeSetJSON(key, state[entity]);
  if (!ok) {
    showToast('Não foi possível salvar os dados (armazenamento local indisponível ou cheio).', 'error', 5000);
  }
  return ok;
}

function loadAllFromStorage() {
  state.clients = safeGetJSON(STORAGE_KEYS.clients, []);
  state.employees = safeGetJSON(STORAGE_KEYS.employees, []);
  state.vehicles = safeGetJSON(STORAGE_KEYS.vehicles, []);
  state.spots = safeGetJSON(STORAGE_KEYS.spots, []);
  state.sessions = safeGetJSON(STORAGE_KEYS.sessions, []);
  state.tickets = safeGetJSON(STORAGE_KEYS.tickets, []);
  state.history = safeGetJSON(STORAGE_KEYS.history, []);
  state.config = safeGetJSON(STORAGE_KEYS.config, null) || JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function nowISO() { return new Date().toISOString(); }

// Registra uma entrada no histórico de auditoria (mais recente primeiro).
// `before`/`after` são opcionais e devem ser mantidos pequenos.
function logHistory(acao, entidade, entidadeId, resumo, before, after) {
  const entry = {
    id: genId('hist'),
    timestamp: nowISO(),
    usuario: 'admin',
    acao, entidade, entidadeId,
    resumo,
    before: before || null,
    after: after || null
  };
  state.history.unshift(entry);
  if (state.history.length > 500) state.history.length = 500;
  persist('history');
  return entry;
}

/* ============================================================
   3) AUTH — demonstrativo, sessionStorage apenas
   ============================================================ */
function isAuthenticated() {
  try {
    const raw = sessionStorage.getItem(SESSION_AUTH_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return !!(data && data.loggedIn);
  } catch (err) {
    return false;
  }
}

// Compara credenciais e, se corretas, grava apenas uma flag de sessão.
// A senha jamais é persistida em localStorage/sessionStorage.
function attemptLogin(usuario, senha) {
  const okUser = (usuario || '').trim() === DEMO_CREDENTIALS.usuario;
  const okPass = (senha || '') === DEMO_CREDENTIALS.senha;
  if (okUser && okPass) {
    try {
      sessionStorage.setItem(SESSION_AUTH_KEY, JSON.stringify({ loggedIn: true, usuario: 'admin', loginAt: nowISO() }));
    } catch (err) {
      // Mesmo sem conseguir persistir a flag, mantemos a navegação nesta aba.
    }
    return true;
  }
  return false;
}

function logout() {
  try { sessionStorage.removeItem(SESSION_AUTH_KEY); } catch (err) {}
}

/* ============================================================
   4) VALIDATION — normalização e validações de negócio
   ============================================================ */
function normStr(s) { return (s === null || s === undefined) ? '' : String(s).trim(); }
function normCPF(s) { return normStr(s).replace(/\D/g, ''); }
function normPlaca(s) { return normStr(s).toUpperCase().replace(/[\s-]/g, ''); }
function normEmail(s) { return normStr(s).toLowerCase(); }

// Validação matemática do CPF (dígitos verificadores). Não garante que a
// pessoa exista — apenas que o número é estruturalmente válido.
function isValidCPF(digits) {
  if (!digits || digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // todos os dígitos iguais
  const nums = digits.split('').map(Number);
  function calcDigit(arr, factorStart) {
    let sum = 0, factor = factorStart;
    for (const d of arr) { sum += d * factor; factor--; }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  }
  const d1 = calcDigit(nums.slice(0, 9), 10);
  const d2 = calcDigit(nums.slice(0, 9).concat([d1]), 11);
  return d1 === nums[9] && d2 === nums[10];
}

function formatCPF(digits) {
  const d = normCPF(digits);
  if (d.length !== 11) return d;
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

// Placa antiga (ABC1234) ou Mercosul (ABC1D23). Apenas valida formato.
function isValidPlaca(placaNorm) {
  if (!placaNorm) return false;
  const oldFormat = /^[A-Z]{3}[0-9]{4}$/;
  const mercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
  return oldFormat.test(placaNorm) || mercosul.test(placaNorm);
}

function isValidEmail(email) {
  if (!email) return true; // campo opcional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Máscara visual simples — a validação "de verdade" sempre roda em JS
// separadamente (normCPF/normPlaca), nunca confiando apenas na máscara.
function maskCPFInput(el) {
  el.addEventListener('input', () => {
    let d = el.value.replace(/\D/g, '').slice(0, 11);
    let out = d;
    if (d.length > 9) out = d.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
    else if (d.length > 6) out = d.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
    else if (d.length > 3) out = d.replace(/(\d{3})(\d{0,3})/, '$1.$2');
    el.value = out;
  });
}
function maskPhoneInput(el) {
  el.addEventListener('input', () => {
    let d = el.value.replace(/\D/g, '').slice(0, 11);
    let out = d;
    if (d.length > 10) out = d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
    else if (d.length > 6) out = d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    else if (d.length > 2) out = d.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    el.value = out;
  });
}
function maskPlacaInput(el) {
  el.addEventListener('input', () => {
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  });
}

// Escapa texto para uso seguro em innerHTML (nunca inserir dados digitados
// pelo usuário diretamente sem isto).
function esc(value) {
  const d = document.createElement('div');
  d.textContent = (value === null || value === undefined) ? '' : String(value);
  return d.innerHTML;
}

/* ============================================================
   5) FORMATAÇÃO
   ============================================================ */
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDateOnly(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoney(n) {
  const v = (typeof n === 'number' && !isNaN(n)) ? n : 0;
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDuration(minutesTotal) {
  const m = Math.max(0, Math.round(minutesTotal || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h <= 0) return rest + ' min';
  return h + 'h ' + rest + 'min';
}
function minutesBetween(isoStart, isoEnd) {
  const a = new Date(isoStart).getTime();
  const b = new Date(isoEnd).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, (b - a) / 60000);
}
function isSameLocalDay(iso, refDate) {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === refDate.getFullYear() && d.getMonth() === refDate.getMonth() && d.getDate() === refDate.getDate();
}
function isoDateKey(iso) {
  const d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ============================================================
   6) REGRA DE TARIFA — centralizada em um único lugar.
   Cobrança mínima de 1 hora; hora iniciada é cobrada integralmente.
   Valores e política são demonstrativos (configuráveis em Configurações).
   ============================================================ */
function calcularTarifa(entradaISO, saidaISO, precoPorHora) {
  const minutos = minutesBetween(entradaISO, saidaISO);
  const horasCobradas = Math.max(1, Math.ceil(minutos / 60));
  const preco = (typeof precoPorHora === 'number' && precoPorHora >= 0) ? precoPorHora : DEFAULT_CONFIG.precoPorHora;
  return Math.round(horasCobradas * preco * 100) / 100;
}

/* ============================================================
   7) INTEGRIDADE — helpers de consulta usados pelas regras de negócio
   ============================================================ */
function getSpotById(id) { return state.spots.find(s => s.id === id) || null; }
function getClientById(id) { return state.clients.find(c => c.id === id) || null; }
function getVehicleById(id) { return state.vehicles.find(v => v.id === id) || null; }
function getSessionById(id) { return state.sessions.find(s => s.id === id) || null; }
function getTicketById(id) { return state.tickets.find(t => t.id === id) || null; }
function getTicketBySession(sessionId) { return state.tickets.find(t => t.sessionId === sessionId) || null; }

function findClientByCPF(cpfDigits, excludeId) {
  return state.clients.find(c => c.cpf === cpfDigits && c.id !== excludeId) || null;
}
function findEmployeeByCPF(cpfDigits, excludeId) {
  return state.employees.find(e => e.cpf === cpfDigits && e.id !== excludeId) || null;
}
function findVehicleByPlaca(placaNorm, excludeId) {
  return state.vehicles.find(v => v.placa === placaNorm && v.id !== excludeId) || null;
}
function getActiveSessionByVehicle(vehicleId) {
  return state.sessions.find(s => s.vehicleId === vehicleId && s.status === 'ativa') || null;
}
function vehicleHasAnySessionHistory(vehicleId) {
  return state.sessions.some(s => s.vehicleId === vehicleId);
}
function clientVehicleIds(clientId) {
  return state.vehicles.filter(v => v.clienteId === clientId).map(v => v.id);
}
function clientHasActiveSession(clientId) {
  const ids = clientVehicleIds(clientId);
  return state.sessions.some(s => ids.includes(s.vehicleId) && s.status === 'ativa');
}
function clientHasAnySessionHistory(clientId) {
  const ids = clientVehicleIds(clientId);
  return state.sessions.some(s => ids.includes(s.vehicleId));
}

/* ============================================================
   8) PREVISÃO DE LIBERAÇÃO DE VAGAS (estacionamento lotado)
   Regra (ver especificação §1.5 e §13):
   1. Usar previsaoSaida das sessões ativas, quando houver.
   2. Caso nenhuma sessão ativa tenha previsão, usar a média de
      permanência das sessões encerradas — somente se houver amostra
      mínima configurada.
   3. Caso contrário, informar que a previsão está indisponível.
   Nunca promete horário exato; é sempre identificada como estimativa.
   ============================================================ */
function occupancyPrediction() {
  const now = new Date();
  const ativas = state.sessions.filter(s => s.status === 'ativa');
  const comPrevisao = ativas
    .filter(s => s.previsaoSaida)
    .sort((a, b) => new Date(a.previsaoSaida) - new Date(b.previsaoSaida));

  if (comPrevisao.length > 0) {
    const top = comPrevisao.slice(0, 3).map(s => {
      const spot = getSpotById(s.spotId);
      const minutos = Math.max(0, Math.round((new Date(s.previsaoSaida) - now) / 60000));
      return { codigo: spot ? spot.codigo : '—', minutos };
    });
    return { type: 'previsao', items: top, totalComPrevisao: comPrevisao.length };
  }

  const amostraMinima = (state.config && state.config.amostraMinimaPrevisao) || DEFAULT_CONFIG.amostraMinimaPrevisao;
  const encerradas = state.sessions.filter(s => s.status === 'encerrada' && s.saidaEfetiva);
  if (encerradas.length >= amostraMinima) {
    const amostra = encerradas.slice(-30); // amostra recente, mais relevante
    const media = amostra.reduce((acc, s) => acc + minutesBetween(s.entrada, s.saidaEfetiva), 0) / amostra.length;
    return { type: 'media', avgMinutos: Math.round(media), amostra: amostra.length };
  }

  return { type: 'indisponivel' };
}

/* ============================================================
   9) SERVICES — Clientes
   ============================================================ */
const clientsService = {
  list({ query, showInactive } = {}) {
    const q = normStr(query).toLowerCase();
    return state.clients
      .filter(c => showInactive ? true : c.status !== 'inativo')
      .filter(c => {
        if (!q) return true;
        return c.nome.toLowerCase().includes(q) || c.cpf.includes(q.replace(/\D/g, '')) ||
          (c.telefone || '').toLowerCase().includes(q);
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  },

  // Cria OU reaproveita um cliente existente com o mesmo CPF (evita duplicidade).
  // Retorna { ok, client, merged } — merged=true quando reaproveitou um cadastro existente.
  createOrMerge(data) {
    const nome = normStr(data.nome);
    const cpf = normCPF(data.cpf);
    if (!nome) return { ok: false, error: 'Nome é obrigatório.' };
    if (!isValidCPF(cpf)) return { ok: false, error: 'CPF inválido. Verifique os dígitos informados.' };

    const existing = findClientByCPF(cpf);
    if (existing) {
      existing.nome = nome || existing.nome;
      existing.telefone = normStr(data.telefone) || existing.telefone;
      existing.email = normEmail(data.email) || existing.email;
      if (data.observacoes !== undefined) existing.observacoes = normStr(data.observacoes) || existing.observacoes;
      existing.updatedAt = nowISO();
      persist('clients');
      logHistory('editar', 'Cliente', existing.id, 'Dados atualizados ao reaproveitar cadastro existente (CPF já cadastrado): ' + existing.nome);
      return { ok: true, client: existing, merged: true };
    }

    if (data.email && !isValidEmail(normEmail(data.email))) {
      return { ok: false, error: 'E-mail em formato inválido.' };
    }

    const client = {
      id: genId('cli'), nome, cpf,
      telefone: normStr(data.telefone), email: normEmail(data.email),
      observacoes: normStr(data.observacoes), status: 'ativo',
      createdAt: nowISO(), updatedAt: nowISO()
    };
    state.clients.push(client);
    persist('clients');
    logHistory('criar', 'Cliente', client.id, 'Cliente cadastrado: ' + client.nome);
    return { ok: true, client, merged: false };
  },

  update(id, data) {
    const client = getClientById(id);
    if (!client) return { ok: false, error: 'Cliente não encontrado.' };
    const nome = normStr(data.nome);
    const cpf = normCPF(data.cpf);
    if (!nome) return { ok: false, error: 'Nome é obrigatório.' };
    if (!isValidCPF(cpf)) return { ok: false, error: 'CPF inválido. Verifique os dígitos informados.' };
    const dup = findClientByCPF(cpf, id);
    if (dup) return { ok: false, error: 'Este CPF já está cadastrado para ' + dup.nome + '.', duplicate: dup };
    if (data.email && !isValidEmail(normEmail(data.email))) return { ok: false, error: 'E-mail em formato inválido.' };

    const before = { nome: client.nome, cpf: client.cpf, telefone: client.telefone, email: client.email };
    client.nome = nome; client.cpf = cpf;
    client.telefone = normStr(data.telefone); client.email = normEmail(data.email);
    client.observacoes = normStr(data.observacoes);
    client.updatedAt = nowISO();
    persist('clients');
    logHistory('editar', 'Cliente', client.id, 'Cliente editado: ' + client.nome, before, { nome: client.nome, cpf: client.cpf });
    return { ok: true, client };
  },

  toggleStatus(id) {
    const client = getClientById(id);
    if (!client) return { ok: false, error: 'Cliente não encontrado.' };
    if (client.status !== 'inativo' && clientHasActiveSession(id)) {
      return { ok: false, error: 'Não é possível inativar: há sessão ativa vinculada a este cliente.' };
    }
    client.status = client.status === 'inativo' ? 'ativo' : 'inativo';
    client.updatedAt = nowISO();
    persist('clients');
    logHistory(client.status === 'inativo' ? 'inativar' : 'editar', 'Cliente', client.id, (client.status === 'inativo' ? 'Cliente inativado: ' : 'Cliente reativado: ') + client.nome);
    return { ok: true, client };
  },

  remove(id) {
    const client = getClientById(id);
    if (!client) return { ok: false, error: 'Cliente não encontrado.' };
    if (clientHasActiveSession(id)) {
      return { ok: false, error: 'Este cliente possui uma sessão ativa. Encerre a sessão antes de excluir.' };
    }
    if (clientHasAnySessionHistory(id)) {
      return { ok: false, error: 'Este cliente possui histórico de sessões. Use "Inativar" para preservar relatórios e auditoria.' };
    }
    state.clients = state.clients.filter(c => c.id !== id);
    persist('clients');
    logHistory('excluir', 'Cliente', id, 'Cliente excluído: ' + client.nome);
    return { ok: true };
  }
};

/* ============================================================
   10) SERVICES — Colaboradores (sem login próprio nesta versão)
   ============================================================ */
const employeesService = {
  list({ query, showInactive } = {}) {
    const q = normStr(query).toLowerCase();
    return state.employees
      .filter(e => showInactive ? true : e.status !== 'inativo')
      .filter(e => !q || e.nome.toLowerCase().includes(q) || e.cargo.toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  },
  create(data) {
    const nome = normStr(data.nome);
    const cpf = normCPF(data.cpf);
    if (!nome) return { ok: false, error: 'Nome é obrigatório.' };
    if (!isValidCPF(cpf)) return { ok: false, error: 'CPF inválido.' };
    const dup = findEmployeeByCPF(cpf);
    if (dup) return { ok: false, error: 'CPF já cadastrado para o colaborador ' + dup.nome + '.', duplicate: dup };
    if (data.email && !isValidEmail(normEmail(data.email))) return { ok: false, error: 'E-mail em formato inválido.' };
    const emp = {
      id: genId('emp'), nome, cpf,
      telefone: normStr(data.telefone), email: normEmail(data.email),
      cargo: normStr(data.cargo) || 'Atendente',
      status: data.status === 'inativo' ? 'inativo' : 'ativo',
      createdAt: nowISO(), updatedAt: nowISO()
    };
    state.employees.push(emp);
    persist('employees');
    logHistory('criar', 'Colaborador', emp.id, 'Colaborador cadastrado: ' + emp.nome + ' (' + emp.cargo + ')');
    return { ok: true, employee: emp };
  },
  update(id, data) {
    const emp = state.employees.find(e => e.id === id);
    if (!emp) return { ok: false, error: 'Colaborador não encontrado.' };
    const nome = normStr(data.nome);
    const cpf = normCPF(data.cpf);
    if (!nome) return { ok: false, error: 'Nome é obrigatório.' };
    if (!isValidCPF(cpf)) return { ok: false, error: 'CPF inválido.' };
    const dup = findEmployeeByCPF(cpf, id);
    if (dup) return { ok: false, error: 'CPF já cadastrado para o colaborador ' + dup.nome + '.', duplicate: dup };
    if (data.email && !isValidEmail(normEmail(data.email))) return { ok: false, error: 'E-mail em formato inválido.' };
    emp.nome = nome; emp.cpf = cpf;
    emp.telefone = normStr(data.telefone); emp.email = normEmail(data.email);
    emp.cargo = normStr(data.cargo) || emp.cargo;
    emp.status = data.status === 'inativo' ? 'inativo' : 'ativo';
    emp.updatedAt = nowISO();
    persist('employees');
    logHistory('editar', 'Colaborador', emp.id, 'Colaborador editado: ' + emp.nome);
    return { ok: true, employee: emp };
  },
  toggleStatus(id) {
    const emp = state.employees.find(e => e.id === id);
    if (!emp) return { ok: false, error: 'Colaborador não encontrado.' };
    emp.status = emp.status === 'inativo' ? 'ativo' : 'inativo';
    emp.updatedAt = nowISO();
    persist('employees');
    logHistory('editar', 'Colaborador', emp.id, (emp.status === 'inativo' ? 'Colaborador inativado: ' : 'Colaborador reativado: ') + emp.nome);
    return { ok: true, employee: emp };
  },
  remove(id) {
    const emp = state.employees.find(e => e.id === id);
    if (!emp) return { ok: false, error: 'Colaborador não encontrado.' };
    state.employees = state.employees.filter(e => e.id !== id);
    persist('employees');
    logHistory('excluir', 'Colaborador', id, 'Colaborador excluído: ' + emp.nome);
    return { ok: true };
  }
};

/* ============================================================
   11) SERVICES — Veículos
   ============================================================ */
const vehiclesService = {
  list({ query, showInactive } = {}) {
    const q = normStr(query).toLowerCase();
    return state.vehicles
      .filter(v => showInactive ? true : v.status !== 'inativo')
      .filter(v => {
        if (!q) return true;
        const cliente = getClientById(v.clienteId);
        return v.placa.toLowerCase().includes(q) || (v.modelo || '').toLowerCase().includes(q) ||
          (cliente && cliente.nome.toLowerCase().includes(q));
      })
      .sort((a, b) => a.placa.localeCompare(b.placa));
  },
  create(data) {
    const placa = normPlaca(data.placa);
    if (!isValidPlaca(placa)) return { ok: false, error: 'Placa inválida. Use o formato antigo (ABC1234) ou Mercosul (ABC1D23).' };
    if (!data.clienteId || !getClientById(data.clienteId)) return { ok: false, error: 'Selecione um cliente responsável válido.' };
    const dup = findVehicleByPlaca(placa);
    if (dup) return { ok: false, error: 'Esta placa já está cadastrada.', duplicate: dup };
    const vehicle = {
      id: genId('veh'), placa,
      marca: normStr(data.marca), modelo: normStr(data.modelo), cor: normStr(data.cor),
      categoria: normStr(data.categoria) || 'Carro',
      clienteId: data.clienteId,
      status: data.status === 'inativo' ? 'inativo' : 'ativo',
      createdAt: nowISO(), updatedAt: nowISO()
    };
    state.vehicles.push(vehicle);
    persist('vehicles');
    logHistory('criar', 'Veículo', vehicle.id, 'Veículo cadastrado: ' + vehicle.placa);
    return { ok: true, vehicle };
  },
  update(id, data) {
    const vehicle = getVehicleById(id);
    if (!vehicle) return { ok: false, error: 'Veículo não encontrado.' };
    const placa = normPlaca(data.placa);
    if (!isValidPlaca(placa)) return { ok: false, error: 'Placa inválida. Use o formato antigo (ABC1234) ou Mercosul (ABC1D23).' };
    if (!data.clienteId || !getClientById(data.clienteId)) return { ok: false, error: 'Selecione um cliente responsável válido.' };
    const dup = findVehicleByPlaca(placa, id);
    if (dup) return { ok: false, error: 'Esta placa já está cadastrada para outro veículo.', duplicate: dup };
    vehicle.placa = placa;
    vehicle.marca = normStr(data.marca); vehicle.modelo = normStr(data.modelo); vehicle.cor = normStr(data.cor);
    vehicle.categoria = normStr(data.categoria) || vehicle.categoria;
    vehicle.clienteId = data.clienteId;
    vehicle.status = data.status === 'inativo' ? 'inativo' : 'ativo';
    vehicle.updatedAt = nowISO();
    persist('vehicles');
    logHistory('editar', 'Veículo', vehicle.id, 'Veículo editado: ' + vehicle.placa);
    return { ok: true, vehicle };
  },
  toggleStatus(id) {
    const vehicle = getVehicleById(id);
    if (!vehicle) return { ok: false, error: 'Veículo não encontrado.' };
    if (vehicle.status !== 'inativo' && getActiveSessionByVehicle(id)) {
      return { ok: false, error: 'Não é possível inativar: este veículo possui sessão ativa.' };
    }
    vehicle.status = vehicle.status === 'inativo' ? 'ativo' : 'inativo';
    vehicle.updatedAt = nowISO();
    persist('vehicles');
    logHistory('editar', 'Veículo', vehicle.id, (vehicle.status === 'inativo' ? 'Veículo inativado: ' : 'Veículo reativado: ') + vehicle.placa);
    return { ok: true, vehicle };
  },
  remove(id) {
    const vehicle = getVehicleById(id);
    if (!vehicle) return { ok: false, error: 'Veículo não encontrado.' };
    if (getActiveSessionByVehicle(id)) return { ok: false, error: 'Este veículo possui sessão ativa. Encerre a sessão antes de excluir.' };
    if (vehicleHasAnySessionHistory(id)) return { ok: false, error: 'Este veículo possui histórico de sessões. Use "Inativar" para preservar relatórios e auditoria.' };
    state.vehicles = state.vehicles.filter(v => v.id !== id);
    persist('vehicles');
    logHistory('excluir', 'Veículo', id, 'Veículo excluído: ' + vehicle.placa);
    return { ok: true };
  }
};

/* ============================================================
   12) SERVICES — Vagas e Sessões de estacionamento
   ============================================================ */
const parkingService = {
  // Ocupa uma vaga livre, criando uma sessão ativa. Esta função assume que
  // as validações de cliente/veículo/duplicidade JÁ foram feitas por quem
  // chama (ver fluxo do modal de ocupação).
  occupySpot(spotId, { clientId, vehicleId, previsaoSaida }) {
    const spot = getSpotById(spotId);
    if (!spot) return { ok: false, error: 'Vaga não encontrada.' };
    if (spot.status !== 'livre') return { ok: false, error: 'Esta vaga não está livre (ocupada ou interditada).' };
    const client = getClientById(clientId);
    const vehicle = getVehicleById(vehicleId);
    if (!client) return { ok: false, error: 'Cliente inválido.' };
    if (!vehicle) return { ok: false, error: 'Veículo inválido.' };
    // Regra: não permitir mais de uma sessão ativa para o mesmo veículo/placa.
    if (getActiveSessionByVehicle(vehicleId)) {
      return { ok: false, error: 'Este veículo já possui uma sessão ativa em outra vaga.' };
    }

    const session = {
      id: genId('ses'), spotId, clientId, vehicleId,
      placaNoMomento: vehicle.placa,
      entrada: nowISO(),
      previsaoSaida: previsaoSaida || null,
      saidaEfetiva: null,
      ticketId: null,
      valor: null,
      situacaoPagamento: 'pendente',
      status: 'ativa',
      ajusteValor: null
    };
    state.sessions.push(session);
    spot.status = 'ocupada';
    spot.activeSessionId = session.id;
    if (!persist('sessions') || !persist('spots')) {
      // reverte em memória se a gravação falhou, para não mentir pro usuário
      state.sessions = state.sessions.filter(s => s.id !== session.id);
      spot.status = 'livre'; spot.activeSessionId = null;
      return { ok: false, error: 'Falha ao salvar a entrada. Nada foi registrado.' };
    }

    const ticket = ticketsService.emitForSession(session);
    session.ticketId = ticket.id;
    persist('sessions');

    logHistory('entrada', 'Sessão', session.id, 'Entrada registrada — vaga ' + spot.codigo + ', placa ' + vehicle.placa + ', cliente ' + client.nome);
    logHistory('editar', 'Vaga', spot.id, 'Vaga ' + spot.codigo + ' marcada como ocupada');
    return { ok: true, session, ticket };
  },

  // Atualiza os dados de cliente/veículo vinculados a uma sessão ATIVA,
  // sem criar nova sessão nem mover a vaga (usado tanto em "Editar dados"
  // quanto na regra de placa duplicada com sessão ativa).
  editActiveSession(sessionId, { placa, marca, modelo, cor, categoria }) {
    const session = getSessionById(sessionId);
    if (!session || session.status !== 'ativa') return { ok: false, error: 'Sessão ativa não encontrada.' };
    const vehicle = getVehicleById(session.vehicleId);
    if (!vehicle) return { ok: false, error: 'Veículo da sessão não encontrado.' };
    const placaNorm = normPlaca(placa);
    if (!isValidPlaca(placaNorm)) return { ok: false, error: 'Placa inválida.' };
    const dupVehicle = findVehicleByPlaca(placaNorm, vehicle.id);
    if (dupVehicle && getActiveSessionByVehicle(dupVehicle.id)) {
      return { ok: false, error: 'Esta placa já pertence a outro veículo com sessão ativa.' };
    }
    vehicle.placa = placaNorm;
    vehicle.marca = normStr(marca); vehicle.modelo = normStr(modelo); vehicle.cor = normStr(cor);
    vehicle.categoria = normStr(categoria) || vehicle.categoria;
    vehicle.updatedAt = nowISO();
    session.placaNoMomento = placaNorm;
    persist('vehicles'); persist('sessions');
    logHistory('editar', 'Sessão', session.id, 'Dados da sessão atualizados — placa ' + placaNorm);
    return { ok: true, session };
  },

  // Encerra a sessão: calcula (ou aplica ajuste) do valor, libera a vaga.
  registerExit(sessionId, { valorAjustado, justificativa } = {}) {
    const session = getSessionById(sessionId);
    if (!session || session.status !== 'ativa') return { ok: false, error: 'Sessão ativa não encontrada.' };
    const spot = getSpotById(session.spotId);
    if (!spot) return { ok: false, error: 'Vaga da sessão não encontrada.' };

    const saida = nowISO();
    if (new Date(saida) < new Date(session.entrada)) {
      return { ok: false, error: 'Horário de saída não pode ser anterior à entrada.' };
    }
    const precoPorHora = (state.config && state.config.precoPorHora) || DEFAULT_CONFIG.precoPorHora;
    const valorCalculado = calcularTarifa(session.entrada, saida, precoPorHora);

    let valorFinal = valorCalculado;
    let ajuste = null;
    if (valorAjustado !== undefined && valorAjustado !== null && valorAjustado !== '') {
      const v = Number(valorAjustado);
      if (isNaN(v) || v < 0) return { ok: false, error: 'Valor ajustado inválido.' };
      if (!normStr(justificativa)) return { ok: false, error: 'Informe a justificativa para o ajuste de valor.' };
      ajuste = { valorOriginal: valorCalculado, valorAjustado: v, justificativa: normStr(justificativa), usuario: 'admin', dataHora: saida };
      valorFinal = v;
    }

    session.saidaEfetiva = saida;
    session.valor = valorFinal;
    session.situacaoPagamento = 'demonstrativo-pago';
    session.status = 'encerrada';
    session.ajusteValor = ajuste;
    spot.status = 'livre';
    spot.activeSessionId = null;

    persist('sessions'); persist('spots');
    logHistory('saida', 'Sessão', session.id, 'Saída registrada — vaga ' + spot.codigo + ', valor ' + fmtMoney(valorFinal) + (ajuste ? ' (ajustado)' : ''));
    if (ajuste) {
      logHistory('editar', 'Sessão', session.id, 'Ajuste de valor: ' + fmtMoney(ajuste.valorOriginal) + ' → ' + fmtMoney(ajuste.valorAjustado) + '. Justificativa: ' + ajuste.justificativa);
    }
    return { ok: true, session };
  },

  interdict(spotId, motivo) {
    const spot = getSpotById(spotId);
    if (!spot) return { ok: false, error: 'Vaga não encontrada.' };
    if (spot.status === 'ocupada') return { ok: false, error: 'Não é possível interditar uma vaga ocupada. Registre a saída primeiro.' };
    if (!normStr(motivo)) return { ok: false, error: 'Informe o motivo da interdição.' };
    spot.status = 'interditada';
    spot.motivoInterdicao = normStr(motivo);
    persist('spots');
    logHistory('interditar', 'Vaga', spot.id, 'Vaga ' + spot.codigo + ' interditada: ' + spot.motivoInterdicao);
    return { ok: true, spot };
  },

  editInterdictReason(spotId, motivo) {
    const spot = getSpotById(spotId);
    if (!spot) return { ok: false, error: 'Vaga não encontrada.' };
    if (spot.status !== 'interditada') return { ok: false, error: 'Esta vaga não está interditada.' };
    if (!normStr(motivo)) return { ok: false, error: 'Informe o motivo da interdição.' };
    spot.motivoInterdicao = normStr(motivo);
    persist('spots');
    logHistory('editar', 'Vaga', spot.id, 'Motivo de interdição atualizado — vaga ' + spot.codigo);
    return { ok: true, spot };
  },

  liberate(spotId) {
    const spot = getSpotById(spotId);
    if (!spot) return { ok: false, error: 'Vaga não encontrada.' };
    if (spot.status !== 'interditada') return { ok: false, error: 'Esta vaga não está interditada.' };
    spot.status = 'livre';
    spot.motivoInterdicao = null;
    persist('spots');
    logHistory('liberar', 'Vaga', spot.id, 'Vaga ' + spot.codigo + ' liberada da interdição');
    return { ok: true, spot };
  }
};

/* ============================================================
   13) SERVICES — Tickets e QR Code demonstrativo
   ============================================================ */
const ticketsService = {
  emitForSession(session) {
    const numero = 'TCK-' + String(state.tickets.length + 1).padStart(6, '0');
    const ticket = {
      id: genId('tkt'), numero, sessionId: session.id,
      qrToken: genId('qr').toUpperCase(),
      emittedAt: nowISO(),
      status: 'emitido',
      perdido: null,
      reprintCount: 0,
      lastReprintAt: null
    };
    state.tickets.push(ticket);
    persist('tickets');
    logHistory('emitir_ticket', 'Ticket', ticket.id, 'Ticket ' + ticket.numero + ' emitido para a sessão ' + session.id);
    return ticket;
  },

  reprint(ticketId) {
    const ticket = getTicketById(ticketId);
    if (!ticket) return { ok: false, error: 'Ticket não encontrado.' };
    ticket.reprintCount = (ticket.reprintCount || 0) + 1;
    ticket.lastReprintAt = nowISO();
    persist('tickets');
    logHistory('reimprimir_ticket', 'Ticket', ticket.id, '2ª via emitida para o ticket ' + ticket.numero);
    return { ok: true, ticket };
  },

  // Registra a perda do bilhete SEM encerrar ou recriar a sessão.
  registerLoss(sessionId, justificativa) {
    const session = getSessionById(sessionId);
    if (!session || session.status !== 'ativa') return { ok: false, error: 'Sessão ativa não encontrada.' };
    const ticket = getTicketBySession(sessionId);
    if (!ticket) return { ok: false, error: 'Ticket da sessão não encontrado.' };
    if (ticket.perdido) return { ok: false, error: 'Este ticket já está registrado como perdido.' };
    const taxa = (state.config && state.config.taxaBilhetePerdido) || DEFAULT_CONFIG.taxaBilhetePerdido;
    ticket.status = 'perdido';
    ticket.perdido = { taxa, justificativa: normStr(justificativa), usuario: 'admin', dataHora: nowISO() };
    persist('tickets');
    const spot = getSpotById(session.spotId);
    logHistory('perder_ticket', 'Ticket', ticket.id, 'Bilhete perdido — vaga ' + (spot ? spot.codigo : '—') + ', taxa demonstrativa ' + fmtMoney(taxa) + '. Sessão mantida ativa.');
    return { ok: true, ticket, session };
  },

  // Lista sessões ativas, já formatadas para busca (placa, cliente ou vaga).
  activeSessionsForSearch() {
    return state.sessions.filter(s => s.status === 'ativa').map(s => {
      const spot = getSpotById(s.spotId);
      const client = getClientById(s.clientId);
      const vehicle = getVehicleById(s.vehicleId);
      return {
        sessionId: s.id,
        label: 'Vaga ' + (spot ? spot.codigo : '—') + ' — ' + (vehicle ? vehicle.placa : '—') + ' — ' + (client ? client.nome : '—'),
        spotCodigo: spot ? spot.codigo : '—',
        placa: vehicle ? vehicle.placa : '—',
        clienteNome: client ? client.nome : '—'
      };
    });
  },

  searchTickets(query) {
    const q = normStr(query).toLowerCase();
    return state.tickets.map(t => {
      const session = getSessionById(t.sessionId);
      const spot = session ? getSpotById(session.spotId) : null;
      const vehicle = session ? getVehicleById(session.vehicleId) : null;
      const client = session ? getClientById(session.clientId) : null;
      return { ticket: t, session, spot, vehicle, client };
    }).filter(row => {
      if (!q) return true;
      return row.ticket.numero.toLowerCase().includes(q) ||
        (row.vehicle && row.vehicle.placa.toLowerCase().includes(q)) ||
        (row.client && row.client.nome.toLowerCase().includes(q));
    }).sort((a, b) => new Date(b.ticket.emittedAt) - new Date(a.ticket.emittedAt));
  }
};

/* ============================================================
   14) SERVICES — Relatórios e histórico de auditoria
   ============================================================ */
const reportsService = {
  dashboardStats() {
    const capacidadeTotal = state.spots.length;
    const livres = state.spots.filter(s => s.status === 'livre').length;
    const ocupadas = state.spots.filter(s => s.status === 'ocupada').length;
    const interditadas = state.spots.filter(s => s.status === 'interditada').length;
    const taxaOcupacao = capacidadeTotal ? Math.round((ocupadas / capacidadeTotal) * 1000) / 10 : 0;
    const now = new Date();
    const faturamentoHoje = state.sessions
      .filter(s => s.status === 'encerrada' && s.saidaEfetiva && isSameLocalDay(s.saidaEfetiva, now))
      .reduce((acc, s) => acc + (s.valor || 0), 0);
    const ticketsPerdidosHoje = state.tickets.filter(t => t.perdido && isSameLocalDay(t.perdido.dataHora, now)).length;
    return { capacidadeTotal, livres, ocupadas, interditadas, taxaOcupacao, veiculosEstacionados: ocupadas, faturamentoHoje, ticketsPerdidosHoje };
  },

  periodStats(dataIniISO, dataFimISO) {
    const ini = dataIniISO ? new Date(dataIniISO) : null;
    const fim = dataFimISO ? new Date(dataFimISO) : null;
    const inRange = (iso) => {
      if (!iso) return false;
      const d = new Date(iso);
      if (ini && d < ini) return false;
      if (fim && d > fim) return false;
      return true;
    };
    const entradas = state.sessions.filter(s => inRange(s.entrada));
    const saidas = state.sessions.filter(s => s.saidaEfetiva && inRange(s.saidaEfetiva));
    const encerradasNoPeriodo = state.sessions.filter(s => s.status === 'encerrada' && s.saidaEfetiva && inRange(s.saidaEfetiva));
    const faturamento = encerradasNoPeriodo.reduce((acc, s) => acc + (s.valor || 0), 0);
    const permanencias = encerradasNoPeriodo.map(s => minutesBetween(s.entrada, s.saidaEfetiva));
    const tempoMedio = permanencias.length ? permanencias.reduce((a, b) => a + b, 0) / permanencias.length : null;
    const ticketsPerdidos = state.tickets.filter(t => t.perdido && inRange(t.perdido.dataHora)).length;

    const usoPorVaga = {};
    entradas.forEach(s => { usoPorVaga[s.spotId] = (usoPorVaga[s.spotId] || 0) + 1; });
    let vagaMaisUtilizada = null, maxUso = 0;
    Object.keys(usoPorVaga).forEach(spotId => {
      if (usoPorVaga[spotId] > maxUso) { maxUso = usoPorVaga[spotId]; vagaMaisUtilizada = spotId; }
    });
    const spotTop = vagaMaisUtilizada ? getSpotById(vagaMaisUtilizada) : null;

    return {
      entradas: entradas.length, saidas: saidas.length, faturamento,
      tempoMedioPermanencia: tempoMedio, ticketsPerdidos,
      sessoesEncerradas: encerradasNoPeriodo.length,
      vagaMaisUtilizada: spotTop ? spotTop.codigo : '—', vagaMaisUtilizadaUsos: maxUso,
      sessoesNoPeriodo: state.sessions.filter(s => inRange(s.entrada) || (s.saidaEfetiva && inRange(s.saidaEfetiva)))
        .sort((a, b) => new Date(b.entrada) - new Date(a.entrada))
    };
  },

  revenueLast7Days() {
    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      days.push({ key: isoDateKey(d.toISOString()), label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) });
    }
    const sums = {};
    state.sessions.filter(s => s.status === 'encerrada' && s.saidaEfetiva).forEach(s => {
      const k = isoDateKey(s.saidaEfetiva);
      sums[k] = (sums[k] || 0) + (s.valor || 0);
    });
    return days.map(d => ({ label: d.label, value: sums[d.key] || 0 }));
  },

  historyList({ entidade, dataIniISO, dataFimISO } = {}) {
    return state.history.filter(h => {
      if (entidade && h.entidade !== entidade) return false;
      if (dataIniISO && new Date(h.timestamp) < new Date(dataIniISO)) return false;
      if (dataFimISO && new Date(h.timestamp) > new Date(dataFimISO)) return false;
      return true;
    });
  }
};

/* ============================================================
   15) DADOS MOCKADOS — carregados apenas na primeira execução
   ============================================================ */
function buildValidCPF(seedDigits) {
  // seedDigits: array com 9 números (0-9), não todos iguais.
  function calcDigit(arr, factorStart) {
    let sum = 0, factor = factorStart;
    for (const d of arr) { sum += d * factor; factor--; }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  }
  const d1 = calcDigit(seedDigits, 10);
  const d2 = calcDigit(seedDigits.concat([d1]), 11);
  return seedDigits.concat([d1, d2]).join('');
}

function seedMockData() {
  const alreadySeeded = localStorage.getItem(STORAGE_KEYS.seeded);
  if (alreadySeeded) return false;

  // ---- Configuração demonstrativa ----
  state.config = {
    nomeEstacionamento: 'ParkSys — Estacionamento Demonstração',
    precoPorHora: 8,
    taxaBilhetePerdido: 35,
    amostraMinimaPrevisao: 3,
    locaisAlternativos: [
      { id: genId('loc'), nome: 'Estacionamento Vizinho Centro (demo)', endereco: 'Rua Exemplo, 123 - Centro', observacoes: 'Local fictício cadastrado apenas para demonstração.' }
    ]
  };

  // ---- Vagas: 4 setores x 7 vagas = 28 vagas ----
  const setores = ['A', 'B', 'C', 'D'];
  state.spots = [];
  setores.forEach(setor => {
    for (let n = 1; n <= 7; n++) {
      state.spots.push({
        id: genId('spot'), codigo: setor + '-' + String(n).padStart(2, '0'), setor,
        status: 'livre', motivoInterdicao: null, activeSessionId: null
      });
    }
  });
  // 4 vagas interditadas (uma por setor, para variedade)
  const motivos = ['Manutenção da pintura do solo', 'Lâmpada do setor queimada', 'Reforma do bloqueador', 'Decisão administrativa — reservada à direção'];
  setores.forEach((setor, idx) => {
    const spot = state.spots.find(s => s.setor === setor && s.codigo.endsWith('-07'));
    spot.status = 'interditada';
    spot.motivoInterdicao = motivos[idx];
  });

  // ---- Clientes fictícios (CPFs matematicamente válidos, sem dados reais) ----
  const clientSeeds = [
    { nome: 'Ana Beatriz Souza', seed: [1, 2, 3, 4, 5, 6, 7, 8, 9], tel: '(11) 98888-1001', obs: 'Cliente mensalista.' },
    { nome: 'Carlos Eduardo Lima', seed: [9, 8, 7, 6, 5, 4, 3, 2, 1], tel: '(11) 97777-1002', obs: '' },
    { nome: 'Fernanda Oliveira Costa', seed: [1, 1, 2, 2, 3, 3, 4, 4, 5], tel: '(21) 96666-1003', obs: 'Prefere vaga próxima à entrada.' },
    { nome: 'Gustavo Henrique Rocha', seed: [5, 4, 3, 2, 1, 9, 8, 7, 6], tel: '(21) 95555-1004', obs: '' },
    { nome: 'Juliana Pereira Alves', seed: [2, 4, 6, 8, 1, 3, 5, 7, 9], tel: '(31) 94444-1005', obs: '' },
    { nome: 'Marcos Vinícius Teixeira', seed: [9, 1, 8, 2, 7, 3, 6, 4, 5], tel: '(31) 93333-1006', obs: 'Cliente mensalista.' },
    { nome: 'Patrícia Mendes Ferreira', seed: [3, 3, 6, 6, 9, 9, 1, 1, 4], tel: '(41) 92222-1007', obs: '' },
    { nome: 'Rafael Augusto Barbosa', seed: [7, 6, 5, 4, 3, 2, 1, 9, 8], tel: '(41) 91111-1008', obs: '' }
  ];
  state.clients = clientSeeds.map((c, idx) => ({
    id: genId('cli'), nome: c.nome, cpf: buildValidCPF(c.seed),
    telefone: c.tel, email: c.nome.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, '.') + '@exemplo.com',
    observacoes: c.obs, status: 'ativo',
    createdAt: new Date(Date.now() - (30 - idx) * 86400000).toISOString(), updatedAt: nowISO()
  }));

  // ---- Colaboradores fictícios ----
  const empSeeds = [
    { nome: 'Beatriz Almeida Santos', seed: [1, 0, 2, 0, 3, 0, 4, 0, 5], cargo: 'Gerente', status: 'ativo' },
    { nome: 'Diego Fernandes Cardoso', seed: [5, 0, 4, 0, 3, 0, 2, 0, 1], cargo: 'Atendente', status: 'ativo' },
    { nome: 'Larissa Gomes Pinto', seed: [2, 2, 4, 4, 6, 6, 8, 8, 0], cargo: 'Atendente', status: 'ativo' },
    { nome: 'Thiago Martins Nunes', seed: [3, 1, 4, 1, 5, 9, 2, 6, 5], cargo: 'Manobrista', status: 'ativo' },
    { nome: 'Vinícius Ribeiro Dias', seed: [8, 1, 8, 2, 8, 4, 5, 9, 0], cargo: 'Segurança', status: 'inativo' }
  ];
  state.employees = empSeeds.map((e, idx) => ({
    id: genId('emp'), nome: e.nome, cpf: buildValidCPF(e.seed),
    telefone: '(11) 9' + (7000 + idx) + '-20' + String(idx).padStart(2, '0'),
    email: e.nome.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, '.') + '@parksys-demo.com',
    cargo: e.cargo, status: e.status, createdAt: new Date(Date.now() - (60 - idx) * 86400000).toISOString(), updatedAt: nowISO()
  }));

  // ---- Veículos fictícios ----
  const vehicleSeeds = [
    { placa: 'ABC1D23', marca: 'Chevrolet', modelo: 'Onix', cor: 'Prata', categoria: 'Carro' },
    { placa: 'BRA2E19', marca: 'Fiat', modelo: 'Argo', cor: 'Branco', categoria: 'Carro' },
    { placa: 'CTB4F56', marca: 'Volkswagen', modelo: 'Gol', cor: 'Preto', categoria: 'Carro' },
    { placa: 'DFG7H88', marca: 'Hyundai', modelo: 'HB20', cor: 'Vermelho', categoria: 'Carro' },
    { placa: 'EFG9J34', marca: 'Honda', modelo: 'Civic', cor: 'Cinza', categoria: 'Carro' },
    { placa: 'FHI1K77', marca: 'Toyota', modelo: 'Corolla', cor: 'Branco', categoria: 'Carro' },
    { placa: 'GHJ3L02', marca: 'Honda', modelo: 'CG 160', cor: 'Azul', categoria: 'Moto' },
    { placa: 'HIJ5M61', marca: 'Renault', modelo: 'Kwid', cor: 'Laranja', categoria: 'Carro' },
    { placa: 'IJK8N45', marca: 'Jeep', modelo: 'Renegade', cor: 'Preto', categoria: 'Utilitário' },
    { placa: 'JKL2P90', marca: 'Volkswagen', modelo: 'T-Cross', cor: 'Branco', categoria: 'Utilitário' },
    { placa: 'KLM6Q13', marca: 'Yamaha', modelo: 'Factor 125', cor: 'Vermelho', categoria: 'Moto' },
    { placa: 'LMN0R58', marca: 'Fiat', modelo: 'Toro', cor: 'Cinza', categoria: 'Utilitário' }
  ];
  state.vehicles = vehicleSeeds.map((v, idx) => ({
    id: genId('veh'), placa: v.placa, marca: v.marca, modelo: v.modelo, cor: v.cor, categoria: v.categoria,
    clienteId: state.clients[idx % state.clients.length].id, status: 'ativo',
    createdAt: new Date(Date.now() - (45 - idx) * 86400000).toISOString(), updatedAt: nowISO()
  }));

  state.sessions = [];
  state.tickets = [];
  state.history = [];

  // ---- Sessões ativas: ocupam as vagas livres não-interditadas (até 12) ----
  const livres = state.spots.filter(s => s.status === 'livre');
  const quantidadeOcupar = Math.min(12, livres.length - 4); // mantém algumas livres para demonstração
  for (let i = 0; i < quantidadeOcupar; i++) {
    const spot = livres[i];
    const vehicle = state.vehicles[i % state.vehicles.length];
    const client = getClientById(vehicle.clienteId);
    const minutosAtras = 15 + i * 23;
    const entrada = new Date(Date.now() - minutosAtras * 60000).toISOString();
    // metade das sessões tem previsão de saída (algumas no passado, para simular "atraso")
    const previsaoSaida = (i % 2 === 0) ? new Date(Date.now() + (10 + i * 7) * 60000).toISOString() : null;

    const session = {
      id: genId('ses'), spotId: spot.id, clientId: client.id, vehicleId: vehicle.id,
      placaNoMomento: vehicle.placa, entrada, previsaoSaida, saidaEfetiva: null,
      ticketId: null, valor: null, situacaoPagamento: 'pendente', status: 'ativa', ajusteValor: null
    };
    state.sessions.push(session);
    spot.status = 'ocupada';
    spot.activeSessionId = session.id;

    const ticket = {
      id: genId('tkt'), numero: 'TCK-' + String(state.tickets.length + 1).padStart(6, '0'),
      sessionId: session.id, qrToken: genId('qr').toUpperCase(), emittedAt: entrada,
      status: 'emitido', perdido: null, reprintCount: 0, lastReprintAt: null
    };
    state.tickets.push(ticket);
    session.ticketId = ticket.id;

    state.history.push({
      id: genId('hist'), timestamp: entrada, usuario: 'admin', acao: 'entrada', entidade: 'Sessão', entidadeId: session.id,
      resumo: 'Entrada registrada — vaga ' + spot.codigo + ', placa ' + vehicle.placa + ', cliente ' + client.nome,
      before: null, after: null
    });
  }

  // ---- Um caso de ticket perdido (mantendo a sessão ativa) ----
  const sessaoParaPerda = state.sessions.find(s => s.status === 'ativa');
  if (sessaoParaPerda) {
    const ticketPerdido = getTicketBySession(sessaoParaPerda.id);
    const dataPerda = new Date(new Date(sessaoParaPerda.entrada).getTime() + 5 * 60000).toISOString();
    ticketPerdido.status = 'perdido';
    ticketPerdido.perdido = { taxa: state.config.taxaBilhetePerdido, justificativa: 'Cliente relatou perda do bilhete no balcão.', usuario: 'admin', dataHora: dataPerda };
    const spot = getSpotById(sessaoParaPerda.spotId);
    state.history.push({
      id: genId('hist'), timestamp: dataPerda, usuario: 'admin', acao: 'perder_ticket', entidade: 'Ticket', entidadeId: ticketPerdido.id,
      resumo: 'Bilhete perdido — vaga ' + spot.codigo + ', taxa demonstrativa ' + fmtMoney(ticketPerdido.perdido.taxa) + '. Sessão mantida ativa.',
      before: null, after: null
    });
  }

  // ---- Sessões encerradas nos últimos dias (histórico para relatórios e média) ----
  for (let i = 0; i < 18; i++) {
    const vehicle = state.vehicles[(i * 3) % state.vehicles.length];
    const client = getClientById(vehicle.clienteId);
    const spotRef = state.spots[(i * 5) % state.spots.length];
    const diasAtras = 1 + (i % 6);
    const horaBase = new Date(Date.now() - diasAtras * 86400000);
    horaBase.setHours(8 + (i % 10), (i * 7) % 60, 0, 0);
    const duracaoMin = 25 + (i * 17) % 220;
    const entrada = new Date(horaBase).toISOString();
    const saidaEfetiva = new Date(horaBase.getTime() + duracaoMin * 60000).toISOString();
    const valor = calcularTarifa(entrada, saidaEfetiva, state.config.precoPorHora);

    const session = {
      id: genId('ses'), spotId: spotRef.id, clientId: client.id, vehicleId: vehicle.id,
      placaNoMomento: vehicle.placa, entrada, previsaoSaida: null, saidaEfetiva,
      ticketId: null, valor, situacaoPagamento: 'demonstrativo-pago', status: 'encerrada', ajusteValor: null
    };
    state.sessions.push(session);
    const ticket = {
      id: genId('tkt'), numero: 'TCK-' + String(state.tickets.length + 1).padStart(6, '0'),
      sessionId: session.id, qrToken: genId('qr').toUpperCase(), emittedAt: entrada,
      status: 'emitido', perdido: null, reprintCount: 0, lastReprintAt: null
    };
    state.tickets.push(ticket);
    session.ticketId = ticket.id;

    state.history.push({
      id: genId('hist'), timestamp: saidaEfetiva, usuario: 'admin', acao: 'saida', entidade: 'Sessão', entidadeId: session.id,
      resumo: 'Saída registrada — vaga ' + spotRef.codigo + ', valor ' + fmtMoney(valor), before: null, after: null
    });
  }

  // ---- Demais eventos de auditoria variados ----
  const extraHist = [
    { diasAtras: 5, acao: 'criar', entidade: 'Cliente', resumo: 'Cliente cadastrado: ' + state.clients[0].nome },
    { diasAtras: 5, acao: 'criar', entidade: 'Colaborador', resumo: 'Colaborador cadastrado: ' + state.employees[0].nome },
    { diasAtras: 4, acao: 'criar', entidade: 'Veículo', resumo: 'Veículo cadastrado: ' + state.vehicles[0].placa },
    { diasAtras: 3, acao: 'interditar', entidade: 'Vaga', resumo: 'Vaga ' + state.spots.find(s => s.status === 'interditada').codigo + ' interditada: manutenção programada' },
    { diasAtras: 2, acao: 'editar', entidade: 'Configuração', resumo: 'Preço por hora definido como ' + fmtMoney(state.config.precoPorHora) + ' (demonstrativo)' }
  ];
  extraHist.forEach(h => {
    state.history.push({
      id: genId('hist'), timestamp: new Date(Date.now() - h.diasAtras * 86400000).toISOString(),
      usuario: 'admin', acao: h.acao, entidade: h.entidade, entidadeId: genId('ref'), resumo: h.resumo, before: null, after: null
    });
  });

  state.history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  persist('clients'); persist('employees'); persist('vehicles'); persist('spots');
  persist('sessions'); persist('tickets'); persist('history'); persist('config');
  try { localStorage.setItem(STORAGE_KEYS.seeded, '1'); } catch (err) {}
  return true;
}

function resetDemoData() {
  [STORAGE_KEYS.clients, STORAGE_KEYS.employees, STORAGE_KEYS.vehicles, STORAGE_KEYS.spots,
   STORAGE_KEYS.sessions, STORAGE_KEYS.tickets, STORAGE_KEYS.history, STORAGE_KEYS.config,
   STORAGE_KEYS.seeded].forEach(k => { try { localStorage.removeItem(k); } catch (err) {} });
  seedMockData();
  loadAllFromStorage();
}

/* ============================================================
   16) BACKUP COMPLETO (JSON) — exportar/importar com validação
   ============================================================ */
function exportBackupJSON() {
  const backup = {
    __parkingAppBackup: true, version: 1, exportedAt: nowISO(),
    clients: state.clients, employees: state.employees, vehicles: state.vehicles,
    spots: state.spots, sessions: state.sessions, tickets: state.tickets,
    history: state.history, config: state.config
  };
  downloadFile('parksys-backup-' + isoDateKey(nowISO()) + '.json', JSON.stringify(backup, null, 2), 'application/json');
  showToast('Backup exportado com sucesso.', 'success');
}

function importBackupJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const requiredArrays = ['clients', 'employees', 'vehicles', 'spots', 'sessions', 'tickets', 'history'];
      const valid = data && requiredArrays.every(k => Array.isArray(data[k])) && data.config && typeof data.config === 'object';
      if (!valid) {
        showToast('Arquivo de backup inválido ou incompleto. Nada foi importado.', 'error', 5000);
        return;
      }
      state.clients = data.clients; state.employees = data.employees; state.vehicles = data.vehicles;
      state.spots = data.spots; state.sessions = data.sessions; state.tickets = data.tickets;
      state.history = data.history; state.config = data.config;
      const okAll = ['clients', 'employees', 'vehicles', 'spots', 'sessions', 'tickets', 'history', 'config'].every(persist);
      try { localStorage.setItem(STORAGE_KEYS.seeded, '1'); } catch (err) {}
      if (!okAll) {
        showToast('Backup carregado, mas houve falha ao salvar alguns dados localmente.', 'warning', 5000);
      } else {
        showToast('Backup importado com sucesso.', 'success');
      }
      renderAll();
    } catch (err) {
      showToast('Não foi possível interpretar o arquivo como JSON válido.', 'error', 5000);
    }
  };
  reader.onerror = () => showToast('Falha ao ler o arquivo selecionado.', 'error', 5000);
  reader.readAsText(file);
}

/* ============================================================
   17) QR CODE DEMONSTRATIVO
   Codifica apenas um token fictício + id do ticket — nunca CPF,
   telefone ou outros dados pessoais. Não valida acesso em cancela real.
   ============================================================ */
function hashStringToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
  return h;
}
function makeSeededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function drawFakeQR(canvas, token) {
  try {
    const size = 160, modules = 21, cell = size / modules;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sem contexto 2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
    const rand = makeSeededRandom(hashStringToInt(token));
    ctx.fillStyle = '#0f172a';
    for (let y = 0; y < modules; y++) {
      for (let x = 0; x < modules; x++) {
        if (isFinderZone(x, y, modules)) continue;
        if (rand() > 0.55) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    drawFinderPattern(ctx, 0, 0, cell);
    drawFinderPattern(ctx, (modules - 7) * cell, 0, cell);
    drawFinderPattern(ctx, 0, (modules - 7) * cell, cell);
    return true;
  } catch (err) {
    return false;
  }
}
function isFinderZone(x, y, modules) {
  const inTopLeft = x < 7 && y < 7;
  const inTopRight = x >= modules - 7 && y < 7;
  const inBottomLeft = x < 7 && y >= modules - 7;
  return inTopLeft || inTopRight || inBottomLeft;
}
function drawFinderPattern(ctx, ox, oy, cell) {
  ctx.fillStyle = '#0f172a'; ctx.fillRect(ox, oy, 7 * cell, 7 * cell);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(ox + cell, oy + cell, 5 * cell, 5 * cell);
  ctx.fillStyle = '#0f172a'; ctx.fillRect(ox + 2 * cell, oy + 2 * cell, 3 * cell, 3 * cell);
}

/* ============================================================
   18) UI — Toasts
   ============================================================ */
function showToast(message, type, duration) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, duration || 3500);
}

/* ============================================================
   19) UI — Modais e drawer (abrir/fechar genérico)
   ============================================================ */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}
function openDrawer() {
  document.getElementById('vaga-drawer-overlay').hidden = false;
  document.getElementById('vaga-drawer').hidden = false;
}
function closeDrawer() {
  document.getElementById('vaga-drawer-overlay').hidden = true;
  document.getElementById('vaga-drawer').hidden = true;
}

function confirmAction(title, message, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  const btn = document.getElementById('confirm-ok-btn');
  const handler = () => { closeModal('modal-confirm'); btn.removeEventListener('click', handler); onConfirm(); };
  btn.replaceWith(btn.cloneNode(true)); // remove listeners antigos
  document.getElementById('confirm-ok-btn').addEventListener('click', handler);
  openModal('modal-confirm');
}

function wireGenericModalClosers() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
  });
  document.getElementById('vaga-drawer-overlay').addEventListener('click', closeDrawer);
  document.getElementById('vaga-drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay').forEach(ov => { if (!ov.hidden) ov.hidden = true; });
    if (!document.getElementById('vaga-drawer').hidden) closeDrawer();
  });
}

/* ============================================================
   20) UI — Tema claro/escuro (persistido no localStorage)
   ============================================================ */
function initTheme() {
  const saved = (function () { try { return localStorage.getItem(STORAGE_KEYS.theme); } catch (e) { return null; } })() || 'light';
  applyTheme(saved);
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  const toggle = document.getElementById('theme-toggle');
  if (theme === 'dark') {
    icon.textContent = '☀️'; label.textContent = 'Modo claro'; toggle.setAttribute('aria-pressed', 'true');
  } else {
    icon.textContent = '🌙'; label.textContent = 'Modo escuro'; toggle.setAttribute('aria-pressed', 'false');
  }
  try { localStorage.setItem(STORAGE_KEYS.theme, theme); } catch (err) {}
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ============================================================
   21) UI — Relógio do cabeçalho
   ============================================================ */
function startClock() {
  const el = document.getElementById('clock');
  function tick() { el.textContent = new Date().toLocaleTimeString('pt-BR'); }
  tick();
  setInterval(tick, 1000);
}

/* ============================================================
   22) EXPORTS — CSV (UTF-8 com BOM) e download de arquivos
   ============================================================ */
function csvEscapeField(value) {
  const s = (value === null || value === undefined) ? '' : String(value);
  if (/[",;\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCSV(headers, rows) {
  const lines = [headers.map(csvEscapeField).join(';')];
  rows.forEach(row => lines.push(row.map(csvEscapeField).join(';')));
  return '﻿' + lines.join('\r\n');
}
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCSVOrWarn(filename, headers, rows) {
  if (!rows.length) {
    showToast('Não há registros para exportar com os filtros atuais.', 'warning');
    return;
  }
  downloadFile(filename, toCSV(headers, rows), 'text/csv');
  showToast('Exportação concluída: ' + filename, 'success');
}

/* ============================================================
   23) UI — Navegação entre views
   ============================================================ */
const VIEW_TITLES = {
  dashboard: ['Visão geral', 'Indicadores calculados a partir dos dados salvos'],
  mapa: ['Estacionamento', 'Planta esquemática e ocupação das vagas em tempo real'],
  clientes: ['Clientes', 'Cadastro e consulta de clientes'],
  colaboradores: ['Colaboradores', 'Cadastro e consulta de colaboradores'],
  veiculos: ['Veículos', 'Cadastro e consulta de veículos'],
  tickets: ['Tickets', 'Emissão, localização e segunda via de tickets'],
  relatorios: ['Relatórios', 'Indicadores por período e histórico de auditoria'],
  config: ['Configurações', 'Tarifas, locais alternativos e backup de dados']
};

function showView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.hidden = true);
  const target = document.getElementById('view-' + viewName);
  if (target) target.hidden = false;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-view') === viewName);
  });
  const titles = VIEW_TITLES[viewName] || ['', ''];
  document.getElementById('view-title').textContent = titles[0];
  document.getElementById('view-subtitle').textContent = titles[1];

  if (viewName === 'dashboard') renderDashboard();
  else if (viewName === 'mapa') renderFloorPlan();
  else if (viewName === 'clientes') renderClientesTable();
  else if (viewName === 'colaboradores') renderColaboradoresTable();
  else if (viewName === 'veiculos') renderVeiculosTable();
  else if (viewName === 'tickets') renderTicketsTable();
  else if (viewName === 'relatorios') renderRelatorios();
  else if (viewName === 'config') renderConfigView();
}

function renderAll() {
  const activeBtn = document.querySelector('.nav-item.is-active');
  showView(activeBtn ? activeBtn.getAttribute('data-view') : 'dashboard');
}

/* ============================================================
   24) UI — Dashboard (Visão geral)
   ============================================================ */
function statCard(label, value, sub, accentClass) {
  return '<div class="stat-card ' + (accentClass || '') + '">' +
    '<div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + esc(value) + '</div>' +
    (sub ? '<div class="stat-sub">' + esc(sub) + '</div>' : '') +
    '</div>';
}

function renderDashboard() {
  const s = reportsService.dashboardStats();
  const grid = document.getElementById('stat-grid');
  grid.innerHTML =
    statCard('Capacidade total', s.capacidadeTotal, 'vagas cadastradas', 'stat-accent-blue') +
    statCard('Vagas livres', s.livres, '', 'stat-accent-green') +
    statCard('Vagas ocupadas', s.ocupadas, '', 'stat-accent-blue') +
    statCard('Interditadas', s.interditadas, 'manutenção/administrativo', 'stat-accent-amber') +
    statCard('Taxa de ocupação', s.taxaOcupacao + '%', '', 'stat-accent-blue') +
    statCard('Veículos estacionados', s.veiculosEstacionados, 'agora', 'stat-accent-blue') +
    statCard('Faturamento hoje', fmtMoney(s.faturamentoHoje), 'demonstrativo — sessões encerradas', 'stat-accent-green') +
    statCard('Tickets perdidos hoje', s.ticketsPerdidosHoje, '', 'stat-accent-red');

  const tbody = document.querySelector('#recent-activity-table tbody');
  const recent = state.history.slice(0, 10);
  tbody.innerHTML = recent.length ? recent.map(h =>
    '<tr><td>' + esc(fmtDateTime(h.timestamp)) + '</td><td>' + esc(h.acao) + '</td><td>' + esc(h.entidade) + '</td><td>' + esc(h.resumo) + '</td><td>' + esc(h.usuario) + '</td></tr>'
  ).join('') : '<tr><td colspan="5" class="table-empty">Nenhuma atividade registrada ainda.</td></tr>';
}

/* ============================================================
   25) UI — Planta do estacionamento (mapa)
   ============================================================ */
function spotStatusLabel(status) {
  return status === 'livre' ? 'Livre' : status === 'ocupada' ? 'Ocupada' : 'Interditada';
}
function spotStatusIcon(status) {
  return status === 'livre' ? '✅' : status === 'ocupada' ? '🚗' : '🚧';
}

function renderFloorPlan() {
  const wrap = document.getElementById('floor-plan');
  wrap.innerHTML = '';

  const entranceRow = document.createElement('div');
  entranceRow.className = 'fp-entrance-row';
  const tagIn = document.createElement('span'); tagIn.className = 'fp-tag'; tagIn.textContent = '⬇ Entrada';
  const tagOut = document.createElement('span'); tagOut.className = 'fp-tag'; tagOut.textContent = 'Saída ⬇';
  entranceRow.append(tagIn, tagOut);
  wrap.appendChild(entranceRow);

  const setores = Array.from(new Set(state.spots.map(s => s.setor))).sort();
  setores.forEach((setor, idx) => {
    const block = document.createElement('div');
    block.className = 'fp-setor';
    const label = document.createElement('div');
    label.className = 'fp-setor-label';
    label.textContent = 'Setor ' + setor;
    block.appendChild(label);

    const row = document.createElement('div');
    row.className = 'fp-row';
    state.spots.filter(s => s.setor === setor).sort((a, b) => a.codigo.localeCompare(b.codigo)).forEach(spot => {
      row.appendChild(buildSpotButton(spot));
    });
    block.appendChild(row);
    wrap.appendChild(block);

    if (idx < setores.length - 1) {
      const lane = document.createElement('div');
      lane.className = 'fp-lane';
      wrap.appendChild(lane);
    }
  });

  renderLotFullBanner();
}

function buildSpotButton(spot) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vaga vaga-' + spot.status;
  btn.title = 'Vaga ' + spot.codigo + ' — ' + spotStatusLabel(spot.status);
  btn.setAttribute('aria-label', btn.title);
  btn.dataset.spotId = spot.id;

  const icon = document.createElement('span'); icon.className = 'vaga-icon'; icon.textContent = spotStatusIcon(spot.status);
  const code = document.createElement('span'); code.textContent = spot.codigo;
  const sub = document.createElement('span'); sub.className = 'vaga-sub'; sub.textContent = spotStatusLabel(spot.status);
  btn.append(icon, code, sub);

  btn.addEventListener('click', () => openVagaDrawer(spot.id));
  return btn;
}

function renderLotFullBanner() {
  const banner = document.getElementById('lot-full-banner');
  const livres = state.spots.filter(s => s.status === 'livre').length;
  if (livres > 0) { banner.hidden = true; banner.innerHTML = ''; return; }

  banner.hidden = false;
  banner.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = 'Estacionamento lotado no momento.';
  banner.appendChild(strong);

  const pred = occupancyPrediction();
  const p = document.createElement('div');
  if (pred.type === 'previsao') {
    p.appendChild(document.createTextNode(pred.items.length + ' vaga(s) com previsão de liberação (estimativa, sujeita a alteração):'));
    const ul = document.createElement('ul');
    pred.items.forEach(it => {
      const li = document.createElement('li');
      li.textContent = 'Vaga ' + it.codigo + ' em aproximadamente ' + it.minutos + ' min';
      ul.appendChild(li);
    });
    banner.appendChild(p); banner.appendChild(ul);
  } else if (pred.type === 'media') {
    p.textContent = 'Não há previsão individual registrada para as sessões ativas. Com base na média de permanência das últimas ' + pred.amostra + ' sessões encerradas, a espera estimada é de aproximadamente ' + pred.avgMinutos + ' minutos. Esta é apenas uma média — não garante horário exato.';
    banner.appendChild(p);
  } else {
    p.textContent = 'Previsão indisponível no momento — ainda não há dados suficientes (sessões ativas com previsão ou sessões encerradas o bastante) para estimar a espera.';
    banner.appendChild(p);
  }

  const locais = (state.config && state.config.locaisAlternativos) || [];
  if (locais.length) {
    const locTitle = document.createElement('div');
    locTitle.style.marginTop = '0.5rem';
    locTitle.innerHTML = '<strong>Locais alternativos cadastrados:</strong>';
    banner.appendChild(locTitle);
    const ul2 = document.createElement('ul');
    locais.forEach(l => {
      const li = document.createElement('li');
      li.textContent = l.nome + ' — ' + l.endereco + (l.observacoes ? ' (' + l.observacoes + ')' : '');
      ul2.appendChild(li);
    });
    banner.appendChild(ul2);
  }
}

/* ============================================================
   26) UI — Drawer de detalhes da vaga (clique na planta)
   ============================================================ */
function detailRow(k, v) {
  const r = document.createElement('div'); r.className = 'detail-row';
  const kk = document.createElement('span'); kk.className = 'k'; kk.textContent = k;
  const vv = document.createElement('span'); vv.className = 'v'; vv.textContent = v;
  r.append(kk, vv); return r;
}
function actionButton(label, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = className || 'btn btn-primary btn-block';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function openVagaDrawer(spotId) {
  const spot = getSpotById(spotId);
  if (!spot) return;
  document.getElementById('vaga-drawer-title').textContent = 'Vaga ' + spot.codigo;
  const body = document.getElementById('vaga-drawer-body');
  body.innerHTML = '';

  const pill = document.createElement('span');
  pill.className = 'status-pill status-' + spot.status;
  pill.textContent = spotStatusIcon(spot.status) + ' ' + spotStatusLabel(spot.status);
  body.appendChild(pill);

  const list = document.createElement('div');
  list.style.marginTop = '0.8rem';
  list.appendChild(detailRow('Setor', spot.setor));
  list.appendChild(detailRow('Código', spot.codigo));

  const actions = document.createElement('div');
  actions.className = 'drawer-actions';

  if (spot.status === 'livre') {
    list.appendChild(detailRow('Situação', 'Disponível para receber um veículo'));
    actions.appendChild(actionButton('🅿️ Ocupar vaga', 'btn btn-primary btn-block', () => {
      closeDrawer();
      openOcuparModal(spot.id, 'create', null);
    }));
    actions.appendChild(actionButton('Interditar vaga', 'btn-link', () => {
      closeDrawer();
      openInterditarModal(spot.id, false);
    }));
  } else if (spot.status === 'ocupada') {
    const session = getSessionById(spot.activeSessionId);
    const client = session ? getClientById(session.clientId) : null;
    const vehicle = session ? getVehicleById(session.vehicleId) : null;
    const ticket = session ? getTicketBySession(session.id) : null;
    const minutos = session ? minutesBetween(session.entrada, nowISO()) : 0;

    list.appendChild(detailRow('Cliente', client ? client.nome : '—'));
    list.appendChild(detailRow('Placa', vehicle ? vehicle.placa : '—'));
    list.appendChild(detailRow('Veículo', vehicle ? [vehicle.marca, vehicle.modelo, vehicle.cor].filter(Boolean).join(' ') || '—' : '—'));
    list.appendChild(detailRow('Entrada', session ? fmtDateTime(session.entrada) : '—'));
    list.appendChild(detailRow('Previsão de saída', session && session.previsaoSaida ? fmtDateTime(session.previsaoSaida) : 'não informada'));
    list.appendChild(detailRow('Permanência atual', fmtDuration(minutos)));
    list.appendChild(detailRow('Ticket', ticket ? ticket.numero : '—'));
    if (ticket) {
      const tpill = document.createElement('span');
      tpill.className = 'status-pill status-' + (ticket.perdido ? 'perdido' : 'emitido');
      tpill.textContent = ticket.perdido ? 'Bilhete perdido' : 'Emitido';
      const r = document.createElement('div'); r.className = 'detail-row';
      const kk = document.createElement('span'); kk.className = 'k'; kk.textContent = 'Situação do ticket';
      r.append(kk, tpill); list.appendChild(r);
    }

    actions.appendChild(actionButton('✏️ Editar dados', 'btn btn-outline btn-block', () => {
      closeDrawer();
      openOcuparModal(spot.id, 'edit', session.id);
    }));
    actions.appendChild(actionButton('🚪 Registrar saída', 'btn btn-primary btn-block', () => {
      closeDrawer();
      openSaidaModal(session.id);
    }));
    actions.appendChild(actionButton('🎫 Emitir segunda via', 'btn btn-outline btn-block', () => {
      ticketsService.reprint(ticket.id);
      showTicketModal('reimpressao', { session, client, vehicle, ticket });
      renderFloorPlan();
    }));
  } else if (spot.status === 'interditada') {
    list.appendChild(detailRow('Motivo', spot.motivoInterdicao || '—'));
    actions.appendChild(actionButton('✏️ Editar motivo', 'btn btn-outline btn-block', () => {
      closeDrawer();
      openInterditarModal(spot.id, true);
    }));
    actions.appendChild(actionButton('✅ Liberar vaga', 'btn btn-primary btn-block', () => {
      confirmAction('Liberar vaga', 'Confirma a liberação da vaga ' + spot.codigo + '? Ela ficará disponível para novas entradas.', () => {
        const res = parkingService.liberate(spot.id);
        if (!res.ok) { showToast(res.error, 'error'); return; }
        showToast('Vaga liberada.', 'success');
        closeDrawer();
        renderFloorPlan();
        renderDashboard();
      });
    }));
  }

  list.appendChild(actions);
  body.appendChild(list);
  openDrawer();
}

/* ============================================================
   27) UI — Modal de ocupação / edição de sessão
   ============================================================ */
let ocuparModalMode = 'create'; // 'create' | 'edit'
let ocuparModalPendingSpotId = null;
let ocuparModalPendingSessionId = null;

function populateClienteDatalist() {
  const dl = document.getElementById('ocupar-cliente-list');
  dl.innerHTML = state.clients.map(c => '<option value="' + esc(c.nome + ' — ' + formatCPF(c.cpf)) + '">').join('');
}
function populateVeiculoDatalist() {
  const dl = document.getElementById('ocupar-veiculo-list');
  dl.innerHTML = state.vehicles.map(v => '<option value="' + esc(v.placa) + '">').join('');
}

function openOcuparModal(spotId, mode, sessionId) {
  ocuparModalMode = mode; ocuparModalPendingSpotId = spotId; ocuparModalPendingSessionId = sessionId;
  const spot = getSpotById(spotId);
  const form = document.getElementById('form-ocupar');
  form.reset();
  document.getElementById('ocupar-error').hidden = true;
  document.getElementById('ocupar-cliente-aviso').hidden = true;
  document.getElementById('ocupar-veiculo-aviso').hidden = true;
  document.getElementById('ocupar-vaga-id').value = spotId;
  document.getElementById('ocupar-sessao-id').value = sessionId || '';
  document.getElementById('ocupar-cliente-id').value = '';
  document.getElementById('ocupar-veiculo-id').value = '';
  populateClienteDatalist();
  populateVeiculoDatalist();

  if (mode === 'edit' && sessionId) {
    const session = getSessionById(sessionId);
    const client = getClientById(session.clientId);
    const vehicle = getVehicleById(session.vehicleId);
    document.getElementById('modal-ocupar-title').textContent = 'Editar dados — vaga ' + spot.codigo;
    document.getElementById('ocupar-submit-btn').textContent = 'Salvar alterações';
    document.getElementById('ocupar-cliente-id').value = client.id;
    document.getElementById('ocupar-veiculo-id').value = vehicle.id;
    document.getElementById('ocupar-nome').value = client.nome;
    document.getElementById('ocupar-cpf').value = formatCPF(client.cpf);
    document.getElementById('ocupar-telefone').value = client.telefone;
    document.getElementById('ocupar-email').value = client.email;
    document.getElementById('ocupar-placa').value = vehicle.placa;
    document.getElementById('ocupar-marca').value = vehicle.marca;
    document.getElementById('ocupar-modelo').value = vehicle.modelo;
    document.getElementById('ocupar-cor').value = vehicle.cor;
    document.getElementById('ocupar-categoria').value = vehicle.categoria || 'Carro';
    if (session.previsaoSaida) {
      document.getElementById('ocupar-previsao').value = toDatetimeLocalValue(session.previsaoSaida);
    }
  } else {
    document.getElementById('modal-ocupar-title').textContent = 'Registrar entrada — vaga ' + spot.codigo;
    document.getElementById('ocupar-submit-btn').textContent = 'Confirmar entrada';
  }
  openModal('modal-ocupar');
}

function toDatetimeLocalValue(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function wireOcuparClienteBusca() {
  const input = document.getElementById('ocupar-cliente-busca');
  input.addEventListener('change', () => {
    const match = state.clients.find(c => (c.nome + ' — ' + formatCPF(c.cpf)) === input.value);
    if (!match) return;
    document.getElementById('ocupar-cliente-id').value = match.id;
    document.getElementById('ocupar-nome').value = match.nome;
    document.getElementById('ocupar-cpf').value = formatCPF(match.cpf);
    document.getElementById('ocupar-telefone').value = match.telefone;
    document.getElementById('ocupar-email').value = match.email;
    input.value = '';
  });
  ['ocupar-nome', 'ocupar-cpf'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => { document.getElementById('ocupar-cliente-id').value = ''; });
  });
}
function wireOcuparVeiculoBusca() {
  const input = document.getElementById('ocupar-veiculo-busca');
  input.addEventListener('change', () => {
    const match = state.vehicles.find(v => v.placa === normPlaca(input.value));
    if (!match) return;
    document.getElementById('ocupar-veiculo-id').value = match.id;
    document.getElementById('ocupar-placa').value = match.placa;
    document.getElementById('ocupar-marca').value = match.marca;
    document.getElementById('ocupar-modelo').value = match.modelo;
    document.getElementById('ocupar-cor').value = match.cor;
    document.getElementById('ocupar-categoria').value = match.categoria || 'Carro';
    input.value = '';
  });
  document.getElementById('ocupar-placa').addEventListener('input', () => { document.getElementById('ocupar-veiculo-id').value = ''; });
}

function handleOcuparSubmit(e) {
  e.preventDefault();
  if (isBusy('ocupar')) return;
  setBusy('ocupar', true);
  try {
    const errorEl = document.getElementById('ocupar-error');
    const avisoCliente = document.getElementById('ocupar-cliente-aviso');
    const avisoVeiculo = document.getElementById('ocupar-veiculo-aviso');
    errorEl.hidden = true; avisoCliente.hidden = true; avisoVeiculo.hidden = true;

    const nome = normStr(document.getElementById('ocupar-nome').value);
    const cpf = normCPF(document.getElementById('ocupar-cpf').value);
    const telefone = normStr(document.getElementById('ocupar-telefone').value);
    const email = normEmail(document.getElementById('ocupar-email').value);
    const placa = normPlaca(document.getElementById('ocupar-placa').value);
    const marca = normStr(document.getElementById('ocupar-marca').value);
    const modelo = normStr(document.getElementById('ocupar-modelo').value);
    const cor = normStr(document.getElementById('ocupar-cor').value);
    const categoria = normStr(document.getElementById('ocupar-categoria').value) || 'Carro';
    const previsaoRaw = document.getElementById('ocupar-previsao').value;

    if (!nome) { errorEl.textContent = 'Informe o nome completo do cliente.'; errorEl.hidden = false; return; }
    if (!isValidCPF(cpf)) { errorEl.textContent = 'CPF inválido. Verifique os dígitos informados.'; errorEl.hidden = false; return; }
    if (email && !isValidEmail(email)) { errorEl.textContent = 'E-mail em formato inválido.'; errorEl.hidden = false; return; }
    if (!placa) { errorEl.textContent = 'A placa é obrigatória.'; errorEl.hidden = false; return; }
    if (!isValidPlaca(placa)) { errorEl.textContent = 'Placa inválida. Use o formato antigo (ABC1234) ou Mercosul (ABC1D23).'; errorEl.hidden = false; return; }

    const currentVehicleId = document.getElementById('ocupar-veiculo-id').value || null;
    const existingVehicleByPlaca = findVehicleByPlaca(placa, (ocuparModalMode === 'edit') ? currentVehicleId : null);

    // ---- Regra de placa duplicada com sessão ativa (não cria segunda sessão) ----
    if (existingVehicleByPlaca) {
      const activeElsewhere = getActiveSessionByVehicle(existingVehicleByPlaca.id);
      const isSameSessionBeingEdited = ocuparModalMode === 'edit' && activeElsewhere && activeElsewhere.id === ocuparModalPendingSessionId;
      if (activeElsewhere && !isSameSessionBeingEdited) {
        const conflictSpot = getSpotById(activeElsewhere.spotId);
        avisoVeiculo.innerHTML = 'Esta placa já possui uma sessão ativa na vaga <strong>' + esc(conflictSpot ? conflictSpot.codigo : '—') +
          '</strong>. Não é possível abrir uma nova sessão para o mesmo veículo. ' +
          '<button type="button" id="ocupar-ir-sessao-existente" class="btn btn-outline btn-sm" style="margin-top:0.5rem;">Abrir sessão existente</button>';
        avisoVeiculo.hidden = false;
        document.getElementById('ocupar-ir-sessao-existente').addEventListener('click', () => {
          closeModal('modal-ocupar');
          openOcuparModal(activeElsewhere.spotId, 'edit', activeElsewhere.id);
        });
        return;
      }
    }

    const previsaoSaida = previsaoRaw ? new Date(previsaoRaw).toISOString() : null;

    if (ocuparModalMode === 'edit') {
      const sessionId = ocuparModalPendingSessionId;
      const session = getSessionById(sessionId);
      if (previsaoSaida && new Date(previsaoSaida) < new Date(session.entrada)) {
        errorEl.textContent = 'A previsão de saída não pode ser anterior ao horário de entrada.'; errorEl.hidden = false; return;
      }
      // Em modo edição, o id do cliente pode ter sido limpo pelo listener de
      // "digitação manual" (que serve ao modo criação). Nesse caso, cai de
      // volta para o cliente original da sessão — aqui estamos sempre
      // corrigindo os dados do MESMO cliente, nunca trocando para outro.
      const clienteIdParaEditar = document.getElementById('ocupar-cliente-id').value || session.clientId;
      const clientRes = clientsService.update(clienteIdParaEditar, { nome, cpf, telefone, email });
      if (!clientRes.ok) { errorEl.textContent = clientRes.error; errorEl.hidden = false; return; }
      const sessionRes = parkingService.editActiveSession(sessionId, { placa, marca, modelo, cor, categoria });
      if (!sessionRes.ok) { errorEl.textContent = sessionRes.error; errorEl.hidden = false; return; }
      session.previsaoSaida = previsaoSaida;
      persist('sessions');
      closeModal('modal-ocupar');
      showToast('Dados da sessão atualizados.', 'success');
      renderFloorPlan(); renderDashboard();
      return;
    }

    // ---- Modo criação: monta resumo para conferência antes de confirmar ----
    openResumoEntrada({ spotId: ocuparModalPendingSpotId, clienteId: document.getElementById('ocupar-cliente-id').value, nome, cpf, telefone, email, veiculoId: currentVehicleId, placa, marca, modelo, cor, categoria, previsaoSaida });
  } finally {
    setBusy('ocupar', false);
  }
}

function openResumoEntrada(payload) {
  const spot = getSpotById(payload.spotId);
  const body = document.getElementById('resumo-entrada-body');
  body.innerHTML = '';
  const list = document.createElement('div');
  list.appendChild(detailRow('Vaga', spot.codigo));
  list.appendChild(detailRow('Cliente', payload.nome));
  list.appendChild(detailRow('CPF', formatCPF(payload.cpf)));
  list.appendChild(detailRow('Placa', payload.placa));
  list.appendChild(detailRow('Veículo', [payload.marca, payload.modelo, payload.cor].filter(Boolean).join(' ') || '—'));
  list.appendChild(detailRow('Entrada', fmtDateTime(nowISO()) + ' (ao confirmar)'));
  list.appendChild(detailRow('Previsão de saída', payload.previsaoSaida ? fmtDateTime(payload.previsaoSaida) : 'não informada'));
  body.appendChild(list);

  const btn = document.getElementById('resumo-entrada-confirmar');
  const handler = () => {
    if (isBusy('resumo-entrada')) return;
    setBusy('resumo-entrada', true);
    try {
      const clientRes = clientsService.createOrMerge({ nome: payload.nome, cpf: payload.cpf, telefone: payload.telefone, email: payload.email });
      if (!clientRes.ok) { showToast(clientRes.error, 'error'); return; }

      let vehicle;
      if (payload.veiculoId && getVehicleById(payload.veiculoId)) {
        vehicle = getVehicleById(payload.veiculoId);
        vehicle.marca = payload.marca; vehicle.modelo = payload.modelo; vehicle.cor = payload.cor; vehicle.categoria = payload.categoria;
        vehicle.clienteId = clientRes.client.id; vehicle.updatedAt = nowISO();
        persist('vehicles');
      } else {
        const existing = findVehicleByPlaca(payload.placa);
        if (existing) {
          vehicle = existing;
          vehicle.marca = payload.marca || vehicle.marca; vehicle.modelo = payload.modelo || vehicle.modelo;
          vehicle.cor = payload.cor || vehicle.cor; vehicle.categoria = payload.categoria || vehicle.categoria;
          vehicle.clienteId = clientRes.client.id; vehicle.updatedAt = nowISO();
          persist('vehicles');
        } else {
          const vRes = vehiclesService.create({ placa: payload.placa, marca: payload.marca, modelo: payload.modelo, cor: payload.cor, categoria: payload.categoria, clienteId: clientRes.client.id });
          if (!vRes.ok) { showToast(vRes.error, 'error'); return; }
          vehicle = vRes.vehicle;
        }
      }

      const occRes = parkingService.occupySpot(payload.spotId, { clientId: clientRes.client.id, vehicleId: vehicle.id, previsaoSaida: payload.previsaoSaida });
      if (!occRes.ok) { showToast(occRes.error, 'error'); return; }

      closeModal('modal-resumo-entrada');
      closeModal('modal-ocupar');
      showToast('Entrada registrada com sucesso.', 'success');
      showTicketModal('entrada', { session: occRes.session, client: clientRes.client, vehicle, ticket: occRes.ticket });
      renderFloorPlan(); renderDashboard();
    } finally {
      setBusy('resumo-entrada', false);
      btn.removeEventListener('click', handler);
    }
  };
  btn.replaceWith(btn.cloneNode(true));
  document.getElementById('resumo-entrada-confirmar').addEventListener('click', handler);
  openModal('modal-resumo-entrada');
}

/* ============================================================
   28) UI — Ticket / comprovantes (entrada, 2ª via, saída, perda)
   Nunca inclui CPF, telefone ou e-mail — apenas identificação do
   cliente pelo nome, conforme regra do QR Code demonstrativo.
   ============================================================ */
function showTicketModal(mode, data) {
  const titleEl = document.getElementById('modal-ticket-title');
  const content = document.getElementById('ticket-content');
  content.innerHTML = '';
  const nomeEst = (state.config && state.config.nomeEstacionamento) || DEFAULT_CONFIG.nomeEstacionamento;

  const title = document.createElement('div'); title.className = 'ticket-title'; title.textContent = nomeEst.toUpperCase();
  const sub = document.createElement('div'); sub.className = 'ticket-sub';
  content.appendChild(title);

  const divider = () => { const d = document.createElement('div'); d.className = 'ticket-divider'; return d; };
  const row = (k, v) => { const r = document.createElement('div'); r.className = 'ticket-row';
    const kk = document.createElement('span'); kk.textContent = k; const vv = document.createElement('span'); vv.textContent = v;
    r.append(kk, vv); return r; };

  if (mode === 'entrada' || mode === 'reimpressao') {
    titleEl.textContent = mode === 'entrada' ? 'Ticket de entrada' : 'Ticket — 2ª via';
    sub.textContent = mode === 'entrada' ? 'Ticket demonstrativo — sem validade fiscal' : '2ª via — ticket demonstrativo';
    content.appendChild(sub); content.appendChild(divider());
    const spot = getSpotById(data.session.spotId);
    content.appendChild(row('Ticket nº', data.ticket.numero));
    content.appendChild(row('Vaga', spot.codigo));
    content.appendChild(row('Placa', data.vehicle.placa));
    content.appendChild(row('Cliente', data.client.nome));
    content.appendChild(row('Entrada', fmtDateTime(data.session.entrada)));
    if (mode === 'reimpressao') content.appendChild(row('2ª via emitida em', fmtDateTime(data.ticket.lastReprintAt)));
    content.appendChild(divider());
    appendQRBlock(content, data.ticket.qrToken);
    const instr = document.createElement('div'); instr.className = 'ticket-footnote';
    instr.textContent = 'Apresente este ticket na saída. Documento demonstrativo, sem validade fiscal e sem integração com cancelas reais.';
    content.appendChild(instr);
  } else if (mode === 'saida') {
    titleEl.textContent = 'Comprovante de saída';
    sub.textContent = 'Comprovante demonstrativo — sem validade fiscal';
    content.appendChild(sub); content.appendChild(divider());
    const spot = getSpotById(data.session.spotId);
    content.appendChild(row('Ticket nº', data.ticket ? data.ticket.numero : '—'));
    content.appendChild(row('Vaga', spot.codigo));
    content.appendChild(row('Placa', data.vehicle.placa));
    content.appendChild(row('Entrada', fmtDateTime(data.session.entrada)));
    content.appendChild(row('Saída', fmtDateTime(data.session.saidaEfetiva)));
    content.appendChild(row('Permanência', fmtDuration(minutesBetween(data.session.entrada, data.session.saidaEfetiva))));
    content.appendChild(divider());
    const total = document.createElement('div'); total.className = 'ticket-total'; total.textContent = fmtMoney(data.session.valor);
    content.appendChild(total);
    const sitt = document.createElement('div'); sitt.className = 'ticket-sub'; sitt.textContent = 'Situação: pagamento demonstrativo registrado';
    content.appendChild(sitt);
    const instr = document.createElement('div'); instr.className = 'ticket-footnote';
    instr.textContent = 'Valor e cobrança são demonstrativos. Não há integração real com meios de pagamento.';
    content.appendChild(instr);
  } else if (mode === 'perda') {
    titleEl.textContent = 'Comprovante de ocorrência — bilhete perdido';
    sub.textContent = 'Comprovante demonstrativo — sem validade fiscal';
    content.appendChild(sub); content.appendChild(divider());
    const spot = getSpotById(data.session.spotId);
    content.appendChild(row('Ticket nº', data.ticket.numero));
    content.appendChild(row('Vaga', spot.codigo));
    content.appendChild(row('Placa', data.vehicle.placa));
    content.appendChild(row('Data/hora da ocorrência', fmtDateTime(data.ticket.perdido.dataHora)));
    content.appendChild(row('Taxa demonstrativa aplicada', fmtMoney(data.ticket.perdido.taxa)));
    content.appendChild(divider());
    const note = document.createElement('div'); note.className = 'ticket-footnote';
    note.textContent = 'A sessão permanece ativa. Esta ocorrência não encerra nem recria a sessão de estacionamento.';
    content.appendChild(note);
  }

  openModal('modal-ticket');
}

function appendQRBlock(container, token) {
  const wrap = document.createElement('div'); wrap.className = 'ticket-qr';
  const canvas = document.createElement('canvas');
  const drawn = drawFakeQR(canvas, token);
  if (drawn) {
    wrap.appendChild(canvas);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'ticket-qr-fallback';
    fallback.textContent = 'QR Code indisponível no momento. Identificador do ticket: ' + token;
    wrap.appendChild(fallback);
  }
  container.appendChild(wrap);
  const note = document.createElement('div'); note.className = 'ticket-footnote';
  note.textContent = 'QR Code fictício (token demonstrativo). Não contém CPF, telefone ou outros dados pessoais, e não valida acesso em cancela real.';
  container.appendChild(note);
}

function printCurrentTicket() {
  const content = document.getElementById('ticket-content').cloneNode(true);
  content.querySelectorAll('canvas').forEach(cv => {
    const img = document.createElement('img');
    img.src = cv.toDataURL('image/png');
    img.style.width = cv.width + 'px'; img.style.height = cv.height + 'px';
    cv.replaceWith(img);
  });
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) { showToast('Não foi possível abrir a janela de impressão (bloqueador de pop-up?).', 'error'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket</title><style>' +
    'body{font-family:"Courier New",monospace;padding:20px;color:#0f172a;}' +
    '.ticket-title{text-align:center;font-weight:700;font-size:16px;margin-bottom:4px;letter-spacing:.05em;}' +
    '.ticket-sub{text-align:center;color:#555;font-size:11px;margin-bottom:10px;}' +
    '.ticket-divider{border-top:1px dashed #999;margin:10px 0;}' +
    '.ticket-row{display:flex;justify-content:space-between;padding:2px 0;font-size:13px;gap:10px;}' +
    '.ticket-qr{display:flex;justify-content:center;margin:12px 0;}' +
    '.ticket-total{text-align:center;font-size:18px;font-weight:700;margin-top:8px;}' +
    '.ticket-footnote{font-size:10px;color:#777;text-align:center;margin-top:10px;line-height:1.4;}' +
    '</style></head><body>' + content.innerHTML + '</body></html>');
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

/* ============================================================
   29) UI — Modal de registrar saída
   ============================================================ */
function openSaidaModal(sessionId) {
  const session = getSessionById(sessionId);
  if (!session) return;
  const spot = getSpotById(session.spotId);
  const client = getClientById(session.clientId);
  const vehicle = getVehicleById(session.vehicleId);
  document.getElementById('saida-sessao-id').value = sessionId;
  document.getElementById('saida-ajustar').checked = false;
  document.getElementById('saida-ajuste-fields').hidden = true;
  document.getElementById('saida-error').hidden = true;

  const precoPorHora = (state.config && state.config.precoPorHora) || DEFAULT_CONFIG.precoPorHora;
  const valorEstimado = calcularTarifa(session.entrada, nowISO(), precoPorHora);
  document.getElementById('saida-valor-ajustado').value = valorEstimado;

  const resumo = document.getElementById('saida-resumo');
  resumo.innerHTML = '';
  resumo.appendChild(detailRow('Vaga', spot.codigo));
  resumo.appendChild(detailRow('Cliente', client.nome));
  resumo.appendChild(detailRow('Placa', vehicle.placa));
  resumo.appendChild(detailRow('Entrada', fmtDateTime(session.entrada)));
  resumo.appendChild(detailRow('Permanência até agora', fmtDuration(minutesBetween(session.entrada, nowISO()))));
  resumo.appendChild(detailRow('Valor calculado (demonstrativo)', fmtMoney(valorEstimado)));
  openModal('modal-saida');
}

function wireSaidaModal() {
  document.getElementById('saida-ajustar').addEventListener('change', (e) => {
    document.getElementById('saida-ajuste-fields').hidden = !e.target.checked;
  });
  document.getElementById('saida-confirmar').addEventListener('click', () => {
    if (isBusy('saida')) return;
    setBusy('saida', true);
    try {
      const errorEl = document.getElementById('saida-error');
      errorEl.hidden = true;
      const sessionId = document.getElementById('saida-sessao-id').value;
      const ajustar = document.getElementById('saida-ajustar').checked;
      const payload = {};
      if (ajustar) {
        payload.valorAjustado = document.getElementById('saida-valor-ajustado').value;
        payload.justificativa = document.getElementById('saida-justificativa').value;
      }
      const res = parkingService.registerExit(sessionId, payload);
      if (!res.ok) { errorEl.textContent = res.error; errorEl.hidden = false; return; }
      const session = res.session;
      const client = getClientById(session.clientId);
      const vehicle = getVehicleById(session.vehicleId);
      const ticket = getTicketBySession(session.id);
      closeModal('modal-saida');
      showToast('Saída registrada. Vaga liberada.', 'success');
      showTicketModal('saida', { session, client, vehicle, ticket });
      renderFloorPlan(); renderDashboard();
    } finally {
      setBusy('saida', false);
    }
  });
}

/* ============================================================
   30) UI — Modal de bilhete perdido
   ============================================================ */
function populatePerdidoDatalist() {
  const rows = ticketsService.activeSessionsForSearch();
  document.getElementById('perdido-sessao-list').innerHTML = rows.map(r => '<option value="' + esc(r.label) + '">').join('');
  return rows;
}
function openBilhetePerdidoModal() {
  document.getElementById('perdido-busca').value = '';
  document.getElementById('perdido-sessao-id').value = '';
  document.getElementById('perdido-justificativa').value = '';
  document.getElementById('perdido-error').hidden = true;
  document.getElementById('perdido-preview').innerHTML = '';
  populatePerdidoDatalist();
  openModal('modal-bilhete-perdido');
}
function wireBilhetePerdidoModal() {
  document.getElementById('perdido-busca').addEventListener('change', (e) => {
    const rows = ticketsService.activeSessionsForSearch();
    const match = rows.find(r => r.label === e.target.value);
    const preview = document.getElementById('perdido-preview');
    preview.innerHTML = '';
    if (!match) { document.getElementById('perdido-sessao-id').value = ''; return; }
    document.getElementById('perdido-sessao-id').value = match.sessionId;
    const session = getSessionById(match.sessionId);
    const ticket = getTicketBySession(match.sessionId);
    preview.appendChild(detailRow('Vaga', match.spotCodigo));
    preview.appendChild(detailRow('Placa', match.placa));
    preview.appendChild(detailRow('Cliente', match.clienteNome));
    preview.appendChild(detailRow('Ticket atual', ticket ? ticket.numero : '—'));
    preview.appendChild(detailRow('Taxa a aplicar', fmtMoney((state.config && state.config.taxaBilhetePerdido) || DEFAULT_CONFIG.taxaBilhetePerdido)));
    if (ticket && ticket.perdido) preview.appendChild(detailRow('Atenção', 'Este ticket já consta como perdido'));
  });
  document.getElementById('perdido-confirmar').addEventListener('click', () => {
    if (isBusy('perdido')) return;
    setBusy('perdido', true);
    try {
      const errorEl = document.getElementById('perdido-error');
      errorEl.hidden = true;
      const sessionId = document.getElementById('perdido-sessao-id').value;
      if (!sessionId) { errorEl.textContent = 'Localize e selecione uma sessão ativa.'; errorEl.hidden = false; return; }
      const justificativa = document.getElementById('perdido-justificativa').value;
      const res = ticketsService.registerLoss(sessionId, justificativa);
      if (!res.ok) { errorEl.textContent = res.error; errorEl.hidden = false; return; }
      closeModal('modal-bilhete-perdido');
      showToast('Ocorrência registrada. A sessão e a vaga permanecem ativas.', 'success');
      const session = getSessionById(sessionId);
      showTicketModal('perda', { session, client: getClientById(session.clientId), vehicle: getVehicleById(session.vehicleId), ticket: res.ticket });
      renderFloorPlan(); renderDashboard(); renderTicketsTable();
    } finally {
      setBusy('perdido', false);
    }
  });
}

/* ============================================================
   31) UI — Modal de interdição de vaga
   ============================================================ */
function openInterditarModal(spotId, isEdit) {
  const spot = getSpotById(spotId);
  document.getElementById('modal-interditar-title').textContent = isEdit ? 'Editar motivo — vaga ' + spot.codigo : 'Interditar vaga ' + spot.codigo;
  document.getElementById('interditar-vaga-id').value = spotId;
  document.getElementById('interditar-motivo').value = isEdit ? (spot.motivoInterdicao || '') : '';
  document.getElementById('interditar-error').hidden = true;
  openModal('modal-interditar');
}
function wireInterditarModal() {
  document.getElementById('interditar-confirmar').addEventListener('click', () => {
    const spotId = document.getElementById('interditar-vaga-id').value;
    const motivo = document.getElementById('interditar-motivo').value;
    const spot = getSpotById(spotId);
    const errorEl = document.getElementById('interditar-error');
    const res = spot.status === 'interditada' ? parkingService.editInterdictReason(spotId, motivo) : parkingService.interdict(spotId, motivo);
    if (!res.ok) { errorEl.textContent = res.error; errorEl.hidden = false; return; }
    closeModal('modal-interditar');
    showToast('Vaga atualizada.', 'success');
    renderFloorPlan(); renderDashboard();
  });
}

/* ============================================================
   32) UI — Tabela de Clientes
   ============================================================ */
function renderClientesTable() {
  const query = document.getElementById('clientes-search').value;
  const showInactive = document.getElementById('clientes-mostrar-inativos').checked;
  const list = clientsService.list({ query, showInactive });
  const tbody = document.querySelector('#clientes-table tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum cliente encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(c => {
    const veiculos = state.vehicles.filter(v => v.clienteId === c.id);
    const chips = veiculos.length ? veiculos.map(v => '<span class="chip">' + esc(v.placa) + '</span>').join('') : '<span class="muted">—</span>';
    return '<tr>' +
      '<td>' + esc(c.nome) + '</td>' +
      '<td>' + esc(formatCPF(c.cpf)) + '</td>' +
      '<td>' + esc(c.telefone || '—') + '</td>' +
      '<td>' + esc(c.email || '—') + '</td>' +
      '<td>' + chips + '</td>' +
      '<td><span class="status-pill status-' + (c.status === 'inativo' ? 'inativo' : 'ativo') + '">' + (c.status === 'inativo' ? 'Inativo' : 'Ativo') + '</span></td>' +
      '<td class="table-actions">' +
      '<button class="btn btn-outline btn-sm" data-act="edit" data-id="' + c.id + '">Editar</button>' +
      '<button class="btn btn-outline btn-sm" data-act="toggle" data-id="' + c.id + '">' + (c.status === 'inativo' ? 'Ativar' : 'Inativar') + '</button>' +
      '<button class="btn btn-danger-outline btn-sm" data-act="delete" data-id="' + c.id + '">Excluir</button>' +
      '</td></tr>';
  }).join('');
}

function openClienteModal(id) {
  const form = document.getElementById('form-cliente');
  form.reset();
  document.getElementById('cliente-error').hidden = true;
  document.getElementById('cliente-aviso').hidden = true;
  if (id) {
    const c = getClientById(id);
    document.getElementById('modal-cliente-title').textContent = 'Editar cliente';
    document.getElementById('cliente-id').value = c.id;
    document.getElementById('cliente-nome').value = c.nome;
    document.getElementById('cliente-cpf').value = formatCPF(c.cpf);
    document.getElementById('cliente-telefone').value = c.telefone;
    document.getElementById('cliente-email').value = c.email;
    document.getElementById('cliente-obs').value = c.observacoes || '';
  } else {
    document.getElementById('modal-cliente-title').textContent = 'Novo cliente';
    document.getElementById('cliente-id').value = '';
  }
  openModal('modal-cliente');
}

function wireClientesView() {
  document.getElementById('clientes-search').addEventListener('input', renderClientesTable);
  document.getElementById('clientes-mostrar-inativos').addEventListener('change', renderClientesTable);
  document.getElementById('btn-new-cliente').addEventListener('click', () => openClienteModal(null));
  document.getElementById('btn-export-clientes-csv').addEventListener('click', () => exportClientesCSV());
  document.getElementById('btn-export-clientes-csv-2').addEventListener('click', () => exportClientesCSV());

  document.getElementById('form-cliente').addEventListener('submit', (e) => {
    e.preventDefault();
    if (isBusy('cliente')) return;
    setBusy('cliente', true);
    try {
      const id = document.getElementById('cliente-id').value;
      const data = {
        nome: document.getElementById('cliente-nome').value,
        cpf: document.getElementById('cliente-cpf').value,
        telefone: document.getElementById('cliente-telefone').value,
        email: document.getElementById('cliente-email').value,
        observacoes: document.getElementById('cliente-obs').value
      };
      const errorEl = document.getElementById('cliente-error');
      const res = id ? clientsService.update(id, data) : clientsService.createOrMerge(data);
      if (!res.ok) { errorEl.textContent = res.error; errorEl.hidden = false; return; }
      if (!id && res.merged) showToast('CPF já cadastrado — dados vinculados ao cadastro existente de ' + res.client.nome + '.', 'warning', 5000);
      else showToast('Cliente salvo com sucesso.', 'success');
      closeModal('modal-cliente');
      renderClientesTable();
    } finally { setBusy('cliente', false); }
  });

  document.querySelector('#clientes-table tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id'); const act = btn.getAttribute('data-act');
    const client = getClientById(id);
    if (act === 'edit') openClienteModal(id);
    else if (act === 'toggle') {
      const res = clientsService.toggleStatus(id);
      if (!res.ok) showToast(res.error, 'error'); else { showToast('Status atualizado.', 'success'); renderClientesTable(); }
    } else if (act === 'delete') {
      confirmAction('Excluir cliente', 'Tem certeza que deseja excluir "' + client.nome + '"? Esta ação não pode ser desfeita.', () => {
        const res = clientsService.remove(id);
        if (!res.ok) showToast(res.error, 'error'); else { showToast('Cliente excluído.', 'success'); renderClientesTable(); }
      });
    }
  });
}

function exportClientesCSV() {
  const list = clientsService.list({ query: document.getElementById('clientes-search').value, showInactive: document.getElementById('clientes-mostrar-inativos').checked });
  exportCSVOrWarn('clientes.csv', ['Nome', 'CPF', 'Telefone', 'E-mail', 'Observações', 'Status', 'Cadastrado em'],
    list.map(c => [c.nome, formatCPF(c.cpf), c.telefone, c.email, c.observacoes, c.status, fmtDateTime(c.createdAt)]));
}

/* ============================================================
   33) UI — Tabela de Colaboradores
   ============================================================ */
function renderColaboradoresTable() {
  const query = document.getElementById('colaboradores-search').value;
  const showInactive = document.getElementById('colaboradores-mostrar-inativos').checked;
  const list = employeesService.list({ query, showInactive });
  const tbody = document.querySelector('#colaboradores-table tbody');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum colaborador encontrado.</td></tr>'; return; }
  tbody.innerHTML = list.map(e => '<tr>' +
    '<td>' + esc(e.nome) + '</td>' +
    '<td>' + esc(formatCPF(e.cpf)) + '</td>' +
    '<td>' + esc(e.cargo) + '</td>' +
    '<td>' + esc(e.telefone || '—') + '</td>' +
    '<td>' + esc(e.email || '—') + '</td>' +
    '<td><span class="status-pill status-' + (e.status === 'inativo' ? 'inativo' : 'ativo') + '">' + (e.status === 'inativo' ? 'Inativo' : 'Ativo') + '</span></td>' +
    '<td class="table-actions">' +
    '<button class="btn btn-outline btn-sm" data-act="edit" data-id="' + e.id + '">Editar</button>' +
    '<button class="btn btn-outline btn-sm" data-act="toggle" data-id="' + e.id + '">' + (e.status === 'inativo' ? 'Ativar' : 'Inativar') + '</button>' +
    '<button class="btn btn-danger-outline btn-sm" data-act="delete" data-id="' + e.id + '">Excluir</button>' +
    '</td></tr>').join('');
}

function openColaboradorModal(id) {
  const form = document.getElementById('form-colaborador');
  form.reset();
  document.getElementById('colaborador-error').hidden = true;
  document.getElementById('colaborador-aviso').hidden = true;
  if (id) {
    const emp = state.employees.find(x => x.id === id);
    document.getElementById('modal-colaborador-title').textContent = 'Editar colaborador';
    document.getElementById('colaborador-id').value = emp.id;
    document.getElementById('colaborador-nome').value = emp.nome;
    document.getElementById('colaborador-cpf').value = formatCPF(emp.cpf);
    document.getElementById('colaborador-telefone').value = emp.telefone;
    document.getElementById('colaborador-email').value = emp.email;
    document.getElementById('colaborador-cargo').value = emp.cargo;
    document.getElementById('colaborador-status').value = emp.status;
  } else {
    document.getElementById('modal-colaborador-title').textContent = 'Novo colaborador';
    document.getElementById('colaborador-id').value = '';
  }
  openModal('modal-colaborador');
}

function wireColaboradoresView() {
  document.getElementById('colaboradores-search').addEventListener('input', renderColaboradoresTable);
  document.getElementById('colaboradores-mostrar-inativos').addEventListener('change', renderColaboradoresTable);
  document.getElementById('btn-new-colaborador').addEventListener('click', () => openColaboradorModal(null));
  document.getElementById('btn-export-colaboradores-csv').addEventListener('click', exportColaboradoresCSV);
  document.getElementById('btn-export-colaboradores-csv-2').addEventListener('click', exportColaboradoresCSV);

  document.getElementById('form-colaborador').addEventListener('submit', (e) => {
    e.preventDefault();
    if (isBusy('colaborador')) return;
    setBusy('colaborador', true);
    try {
      const id = document.getElementById('colaborador-id').value;
      const data = {
        nome: document.getElementById('colaborador-nome').value,
        cpf: document.getElementById('colaborador-cpf').value,
        telefone: document.getElementById('colaborador-telefone').value,
        email: document.getElementById('colaborador-email').value,
        cargo: document.getElementById('colaborador-cargo').value,
        status: document.getElementById('colaborador-status').value
      };
      const errorEl = document.getElementById('colaborador-error');
      const res = id ? employeesService.update(id, data) : employeesService.create(data);
      if (!res.ok) { errorEl.textContent = res.error; errorEl.hidden = false; return; }
      showToast('Colaborador salvo com sucesso.', 'success');
      closeModal('modal-colaborador');
      renderColaboradoresTable();
    } finally { setBusy('colaborador', false); }
  });

  document.querySelector('#colaboradores-table tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id'); const act = btn.getAttribute('data-act');
    const emp = state.employees.find(x => x.id === id);
    if (act === 'edit') openColaboradorModal(id);
    else if (act === 'toggle') { employeesService.toggleStatus(id); showToast('Status atualizado.', 'success'); renderColaboradoresTable(); }
    else if (act === 'delete') {
      confirmAction('Excluir colaborador', 'Tem certeza que deseja excluir "' + emp.nome + '"?', () => {
        employeesService.remove(id); showToast('Colaborador excluído.', 'success'); renderColaboradoresTable();
      });
    }
  });
}

function exportColaboradoresCSV() {
  const list = employeesService.list({ query: document.getElementById('colaboradores-search').value, showInactive: document.getElementById('colaboradores-mostrar-inativos').checked });
  exportCSVOrWarn('colaboradores.csv', ['Nome', 'CPF', 'Cargo', 'Telefone', 'E-mail', 'Status', 'Cadastrado em'],
    list.map(e => [e.nome, formatCPF(e.cpf), e.cargo, e.telefone, e.email, e.status, fmtDateTime(e.createdAt)]));
}

/* ============================================================
   34) UI — Tabela de Veículos
   ============================================================ */
function renderVeiculosTable() {
  const query = document.getElementById('veiculos-search').value;
  const showInactive = document.getElementById('veiculos-mostrar-inativos').checked;
  const list = vehiclesService.list({ query, showInactive });
  const tbody = document.querySelector('#veiculos-table tbody');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Nenhum veículo encontrado.</td></tr>'; return; }
  tbody.innerHTML = list.map(v => {
    const cliente = getClientById(v.clienteId);
    const activeSession = getActiveSessionByVehicle(v.id);
    const spot = activeSession ? getSpotById(activeSession.spotId) : null;
    const situacao = spot ? '<span class="status-pill status-ocupada">Em uso — vaga ' + esc(spot.codigo) + '</span>' : '<span class="muted">Livre</span>';
    return '<tr>' +
      '<td>' + esc(v.placa) + '</td>' +
      '<td>' + esc([v.marca, v.modelo].filter(Boolean).join(' ') || '—') + '</td>' +
      '<td>' + esc(v.cor || '—') + '</td>' +
      '<td>' + esc(v.categoria || '—') + '</td>' +
      '<td>' + esc(cliente ? cliente.nome : '—') + '</td>' +
      '<td>' + situacao + '</td>' +
      '<td><span class="status-pill status-' + (v.status === 'inativo' ? 'inativo' : 'ativo') + '">' + (v.status === 'inativo' ? 'Inativo' : 'Ativo') + '</span></td>' +
      '<td class="table-actions">' +
      '<button class="btn btn-outline btn-sm" data-act="edit" data-id="' + v.id + '">Editar</button>' +
      '<button class="btn btn-outline btn-sm" data-act="toggle" data-id="' + v.id + '">' + (v.status === 'inativo' ? 'Ativar' : 'Inativar') + '</button>' +
      '<button class="btn btn-danger-outline btn-sm" data-act="delete" data-id="' + v.id + '">Excluir</button>' +
      '</td></tr>';
  }).join('');
}

function populateVeiculoClienteSelect(selectedId) {
  const sel = document.getElementById('veiculo-cliente');
  sel.innerHTML = state.clients.map(c => '<option value="' + c.id + '">' + esc(c.nome) + (c.status === 'inativo' ? ' (inativo)' : '') + '</option>').join('');
  if (selectedId) sel.value = selectedId;
}

function openVeiculoModal(id) {
  const form = document.getElementById('form-veiculo');
  form.reset();
  document.getElementById('veiculo-error').hidden = true;
  document.getElementById('veiculo-aviso').hidden = true;
  if (id) {
    const v = getVehicleById(id);
    document.getElementById('modal-veiculo-title').textContent = 'Editar veículo';
    document.getElementById('veiculo-id').value = v.id;
    document.getElementById('veiculo-placa').value = v.placa;
    document.getElementById('veiculo-marca').value = v.marca;
    document.getElementById('veiculo-modelo').value = v.modelo;
    document.getElementById('veiculo-cor').value = v.cor;
    document.getElementById('veiculo-categoria').value = v.categoria || 'Carro';
    document.getElementById('veiculo-status').value = v.status;
    populateVeiculoClienteSelect(v.clienteId);
  } else {
    document.getElementById('modal-veiculo-title').textContent = 'Novo veículo';
    document.getElementById('veiculo-id').value = '';
    populateVeiculoClienteSelect(null);
  }
  openModal('modal-veiculo');
}

function wireVeiculosView() {
  document.getElementById('veiculos-search').addEventListener('input', renderVeiculosTable);
  document.getElementById('veiculos-mostrar-inativos').addEventListener('change', renderVeiculosTable);
  document.getElementById('btn-new-veiculo').addEventListener('click', () => openVeiculoModal(null));
  document.getElementById('btn-export-veiculos-csv').addEventListener('click', exportVeiculosCSV);
  document.getElementById('btn-export-veiculos-csv-2').addEventListener('click', exportVeiculosCSV);

  document.getElementById('form-veiculo').addEventListener('submit', (e) => {
    e.preventDefault();
    if (isBusy('veiculo')) return;
    setBusy('veiculo', true);
    try {
      const id = document.getElementById('veiculo-id').value;
      const data = {
        placa: document.getElementById('veiculo-placa').value,
        marca: document.getElementById('veiculo-marca').value,
        modelo: document.getElementById('veiculo-modelo').value,
        cor: document.getElementById('veiculo-cor').value,
        categoria: document.getElementById('veiculo-categoria').value,
        clienteId: document.getElementById('veiculo-cliente').value,
        status: document.getElementById('veiculo-status').value
      };
      const errorEl = document.getElementById('veiculo-error');
      const res = id ? vehiclesService.update(id, data) : vehiclesService.create(data);
      if (!res.ok) { errorEl.textContent = res.error; errorEl.hidden = false; return; }
      showToast('Veículo salvo com sucesso.', 'success');
      closeModal('modal-veiculo');
      renderVeiculosTable();
    } finally { setBusy('veiculo', false); }
  });

  document.querySelector('#veiculos-table tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id'); const act = btn.getAttribute('data-act');
    const vehicle = getVehicleById(id);
    if (act === 'edit') openVeiculoModal(id);
    else if (act === 'toggle') {
      const res = vehiclesService.toggleStatus(id);
      if (!res.ok) showToast(res.error, 'error'); else { showToast('Status atualizado.', 'success'); renderVeiculosTable(); }
    } else if (act === 'delete') {
      confirmAction('Excluir veículo', 'Tem certeza que deseja excluir o veículo "' + vehicle.placa + '"?', () => {
        const res = vehiclesService.remove(id);
        if (!res.ok) showToast(res.error, 'error'); else { showToast('Veículo excluído.', 'success'); renderVeiculosTable(); }
      });
    }
  });
}

function exportVeiculosCSV() {
  const list = vehiclesService.list({ query: document.getElementById('veiculos-search').value, showInactive: document.getElementById('veiculos-mostrar-inativos').checked });
  exportCSVOrWarn('veiculos.csv', ['Placa', 'Marca', 'Modelo', 'Cor', 'Categoria', 'Cliente', 'Status'],
    list.map(v => { const c = getClientById(v.clienteId); return [v.placa, v.marca, v.modelo, v.cor, v.categoria, c ? c.nome : '—', v.status]; }));
}

/* ============================================================
   35) UI — Tabela de Tickets
   ============================================================ */
function renderTicketsTable() {
  const query = document.getElementById('tickets-search').value;
  const rows = ticketsService.searchTickets(query);
  const tbody = document.querySelector('#tickets-table tbody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum ticket encontrado.</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => {
    const statusKey = r.ticket.perdido ? 'perdido' : 'emitido';
    const statusLabel = r.ticket.perdido ? 'Perdido' : (r.ticket.reprintCount ? 'Reimpresso' : 'Emitido');
    return '<tr>' +
      '<td>' + esc(r.ticket.numero) + '</td>' +
      '<td>' + esc(r.vehicle ? r.vehicle.placa : '—') + '</td>' +
      '<td>' + esc(r.client ? r.client.nome : '—') + '</td>' +
      '<td>' + esc(r.spot ? r.spot.codigo : '—') + '</td>' +
      '<td>' + esc(fmtDateTime(r.ticket.emittedAt)) + '</td>' +
      '<td><span class="status-pill status-' + statusKey + '">' + statusLabel + '</span></td>' +
      '<td class="table-actions">' +
      '<button class="btn btn-outline btn-sm" data-act="reprint" data-id="' + r.ticket.id + '">Ver / 2ª via</button>' +
      '</td></tr>';
  }).join('');
}

function wireTicketsView() {
  document.getElementById('tickets-search').addEventListener('input', renderTicketsTable);
  document.getElementById('btn-bilhete-perdido-2').addEventListener('click', openBilhetePerdidoModal);
  document.querySelector('#tickets-table tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="reprint"]');
    if (!btn) return;
    const ticket = getTicketById(btn.getAttribute('data-id'));
    const session = getSessionById(ticket.sessionId);
    if (!session) { showToast('Sessão associada não encontrada.', 'error'); return; }
    ticketsService.reprint(ticket.id);
    showTicketModal('reimpressao', { session, client: getClientById(session.clientId), vehicle: getVehicleById(session.vehicleId), ticket });
    renderTicketsTable();
  });
}

/* ============================================================
   36) UI — Relatórios (período, indicadores, histórico)
   ============================================================ */
function currentPeriodISO() {
  const iniRaw = document.getElementById('relatorio-data-ini').value;
  const fimRaw = document.getElementById('relatorio-data-fim').value;
  const iniISO = iniRaw ? new Date(iniRaw + 'T00:00:00').toISOString() : null;
  const fimISO = fimRaw ? new Date(fimRaw + 'T23:59:59').toISOString() : null;
  return { iniISO, fimISO };
}

function renderRelatorios() {
  const { iniISO, fimISO } = currentPeriodISO();
  const stats = reportsService.periodStats(iniISO, fimISO);
  const resumo = document.getElementById('relatorio-resumo');
  resumo.innerHTML =
    statCard('Entradas no período', stats.entradas, '') +
    statCard('Saídas no período', stats.saidas, '') +
    statCard('Sessões encerradas', stats.sessoesEncerradas, '') +
    statCard('Faturamento', fmtMoney(stats.faturamento), 'demonstrativo') +
    statCard('Permanência média', stats.tempoMedioPermanencia !== null ? fmtDuration(stats.tempoMedioPermanencia) : '—', stats.tempoMedioPermanencia !== null ? '' : 'amostra insuficiente') +
    statCard('Tickets perdidos', stats.ticketsPerdidos, '') +
    statCard('Vaga mais utilizada', stats.vagaMaisUtilizada, stats.vagaMaisUtilizadaUsos ? stats.vagaMaisUtilizadaUsos + ' entrada(s)' : '');

  renderRevenueChart();

  const tbody = document.querySelector('#relatorio-table tbody');
  const sessoes = stats.sessoesNoPeriodo;
  tbody.innerHTML = sessoes.length ? sessoes.map(s => {
    const spot = getSpotById(s.spotId); const client = getClientById(s.clientId); const vehicle = getVehicleById(s.vehicleId);
    return '<tr><td>' + esc(s.id.slice(0, 10)) + '</td><td>' + esc(vehicle ? vehicle.placa : '—') + '</td><td>' + esc(client ? client.nome : '—') +
      '</td><td>' + esc(spot ? spot.codigo : '—') + '</td><td>' + esc(fmtDateTime(s.entrada)) + '</td><td>' + esc(s.saidaEfetiva ? fmtDateTime(s.saidaEfetiva) : '—') +
      '</td><td>' + esc(s.valor !== null ? fmtMoney(s.valor) : '—') + '</td><td>' + esc(s.status) + '</td></tr>';
  }).join('') : '<tr><td colspan="8" class="table-empty">Nenhuma sessão no período selecionado.</td></tr>';

  renderHistoricoTable();
}

function renderRevenueChart() {
  const data = reportsService.revenueLast7Days();
  const chart = document.getElementById('revenue-chart');
  const max = Math.max(1, ...data.map(d => d.value));
  chart.innerHTML = data.map(d => {
    const pct = Math.max(2, Math.round((d.value / max) * 100));
    return '<div class="bar-col"><div class="bar-value">' + esc(fmtMoney(d.value)) + '</div><div class="bar" style="height:' + pct + '%"></div><div class="bar-label">' + esc(d.label) + '</div></div>';
  }).join('');
}

function renderHistoricoTable() {
  const entidade = document.getElementById('hist-filter-entidade').value;
  const { iniISO, fimISO } = currentPeriodISO();
  const list = reportsService.historyList({ entidade, dataIniISO: iniISO, dataFimISO: fimISO });
  const tbody = document.querySelector('#historico-table tbody');
  tbody.innerHTML = list.length ? list.map(h =>
    '<tr><td>' + esc(fmtDateTime(h.timestamp)) + '</td><td>' + esc(h.acao) + '</td><td>' + esc(h.entidade) + '</td><td>' + esc(h.resumo) + '</td><td>' + esc(h.usuario) + '</td></tr>'
  ).join('') : '<tr><td colspan="5" class="table-empty">Nenhum evento encontrado para os filtros atuais.</td></tr>';
}

function wireRelatoriosView() {
  document.getElementById('btn-relatorio-aplicar').addEventListener('click', renderRelatorios);
  document.getElementById('hist-filter-entidade').addEventListener('change', renderHistoricoTable);

  document.getElementById('btn-export-sessoes-csv').addEventListener('click', () => {
    const { iniISO, fimISO } = currentPeriodISO();
    const stats = reportsService.periodStats(iniISO, fimISO);
    exportCSVOrWarn('sessoes.csv', ['Sessão', 'Placa', 'Cliente', 'Vaga', 'Entrada', 'Saída', 'Valor', 'Situação'],
      stats.sessoesNoPeriodo.map(s => { const spot = getSpotById(s.spotId); const client = getClientById(s.clientId); const vehicle = getVehicleById(s.vehicleId);
        return [s.id, vehicle ? vehicle.placa : '—', client ? client.nome : '—', spot ? spot.codigo : '—', fmtDateTime(s.entrada), s.saidaEfetiva ? fmtDateTime(s.saidaEfetiva) : '—', s.valor !== null ? s.valor : '', s.status]; }));
  });
  document.getElementById('btn-export-historico-csv').addEventListener('click', () => {
    const entidade = document.getElementById('hist-filter-entidade').value;
    const { iniISO, fimISO } = currentPeriodISO();
    const list = reportsService.historyList({ entidade, dataIniISO: iniISO, dataFimISO: fimISO });
    exportCSVOrWarn('historico.csv', ['Data/Hora', 'Ação', 'Entidade', 'Resumo', 'Responsável'],
      list.map(h => [fmtDateTime(h.timestamp), h.acao, h.entidade, h.resumo, h.usuario]));
  });
  document.getElementById('btn-export-vagas-csv').addEventListener('click', () => {
    exportCSVOrWarn('vagas.csv', ['Código', 'Setor', 'Status', 'Motivo interdição'],
      state.spots.map(s => [s.codigo, s.setor, s.status, s.motivoInterdicao || '']));
  });
  document.getElementById('btn-export-relatorio-pdf').addEventListener('click', printRelatorio);
}

function printRelatorio() {
  const { iniISO, fimISO } = currentPeriodISO();
  const stats = reportsService.periodStats(iniISO, fimISO);
  const nomeEst = (state.config && state.config.nomeEstacionamento) || DEFAULT_CONFIG.nomeEstacionamento;
  const periodoTxt = (document.getElementById('relatorio-data-ini').value || '—') + ' até ' + (document.getElementById('relatorio-data-fim').value || '—');

  let html = '<h1>' + esc(nomeEst) + '</h1>';
  html += '<p><strong>Relatório de operações</strong> — período: ' + esc(periodoTxt) + '<br>Gerado em: ' + esc(fmtDateTime(nowISO())) + '</p>';
  html += '<table><tr><th>Indicador</th><th>Valor</th></tr>';
  html += '<tr><td>Entradas</td><td>' + stats.entradas + '</td></tr>';
  html += '<tr><td>Saídas</td><td>' + stats.saidas + '</td></tr>';
  html += '<tr><td>Sessões encerradas</td><td>' + stats.sessoesEncerradas + '</td></tr>';
  html += '<tr><td>Faturamento (demonstrativo)</td><td>' + esc(fmtMoney(stats.faturamento)) + '</td></tr>';
  html += '<tr><td>Permanência média</td><td>' + (stats.tempoMedioPermanencia !== null ? esc(fmtDuration(stats.tempoMedioPermanencia)) : 'amostra insuficiente') + '</td></tr>';
  html += '<tr><td>Tickets perdidos</td><td>' + stats.ticketsPerdidos + '</td></tr>';
  html += '<tr><td>Vaga mais utilizada</td><td>' + esc(stats.vagaMaisUtilizada) + '</td></tr></table>';

  html += '<h2>Sessões no período</h2><table><tr><th>Placa</th><th>Cliente</th><th>Vaga</th><th>Entrada</th><th>Saída</th><th>Valor</th><th>Situação</th></tr>';
  stats.sessoesNoPeriodo.forEach(s => {
    const spot = getSpotById(s.spotId); const client = getClientById(s.clientId); const vehicle = getVehicleById(s.vehicleId);
    html += '<tr><td>' + esc(vehicle ? vehicle.placa : '—') + '</td><td>' + esc(client ? client.nome : '—') + '</td><td>' + esc(spot ? spot.codigo : '—') +
      '</td><td>' + esc(fmtDateTime(s.entrada)) + '</td><td>' + (s.saidaEfetiva ? esc(fmtDateTime(s.saidaEfetiva)) : '—') + '</td><td>' + (s.valor !== null ? esc(fmtMoney(s.valor)) : '—') + '</td><td>' + esc(s.status) + '</td></tr>';
  });
  html += '</table>';
  html += '<p class="footnote">Relatório demonstrativo gerado por protótipo sem backend. Valores e indicadores não possuem validade fiscal.</p>';

  const win = window.open('', '_blank');
  if (!win) { showToast('Não foi possível abrir a janela de impressão (bloqueador de pop-up?).', 'error'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório</title><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#0f172a;} h1{margin-bottom:4px;} h2{margin-top:24px;}' +
    'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;} th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}' +
    '.footnote{margin-top:24px;font-size:11px;color:#777;}' +
    '</style></head><body>' + html + '</body></html>');
  win.document.close(); win.focus();
  setTimeout(() => win.print(), 250);
}

/* ============================================================
   37) UI — Configurações (tarifas, locais alternativos, backup)
   ============================================================ */
function renderConfigView() {
  const cfg = state.config;
  document.getElementById('cfg-nome').value = cfg.nomeEstacionamento;
  document.getElementById('cfg-preco').value = cfg.precoPorHora;
  document.getElementById('cfg-taxa-perdido').value = cfg.taxaBilhetePerdido;
  document.getElementById('cfg-amostra-min').value = cfg.amostraMinimaPrevisao;
  renderLocaisTable();
}

function renderLocaisTable() {
  const tbody = document.querySelector('#locais-table tbody');
  const locais = state.config.locaisAlternativos || [];
  tbody.innerHTML = locais.length ? locais.map(l =>
    '<tr><td>' + esc(l.nome) + '</td><td>' + esc(l.endereco) + '</td><td>' + esc(l.observacoes || '—') + '</td>' +
    '<td class="table-actions"><button class="btn btn-danger-outline btn-sm" data-act="remove-local" data-id="' + l.id + '">Remover</button></td></tr>'
  ).join('') : '<tr><td colspan="4" class="table-empty">Nenhum local alternativo cadastrado.</td></tr>';
}

function wireConfigView() {
  document.getElementById('config-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const cfg = state.config;
    const before = { nome: cfg.nomeEstacionamento, preco: cfg.precoPorHora, taxa: cfg.taxaBilhetePerdido };
    const novoNome = normStr(document.getElementById('cfg-nome').value) || cfg.nomeEstacionamento;
    const novoPreco = Number(document.getElementById('cfg-preco').value);
    const novaTaxa = Number(document.getElementById('cfg-taxa-perdido').value);
    const novaAmostra = Number(document.getElementById('cfg-amostra-min').value);
    if (isNaN(novoPreco) || novoPreco < 0 || isNaN(novaTaxa) || novaTaxa < 0 || isNaN(novaAmostra) || novaAmostra < 1) {
      showToast('Valores inválidos. Verifique os campos numéricos.', 'error'); return;
    }
    cfg.nomeEstacionamento = novoNome; cfg.precoPorHora = novoPreco; cfg.taxaBilhetePerdido = novaTaxa; cfg.amostraMinimaPrevisao = novaAmostra;
    if (!persist('config')) return;
    logHistory('editar', 'Configuração', 'config', 'Configurações atualizadas — preço/hora: ' + fmtMoney(before.preco) + ' → ' + fmtMoney(novoPreco) + '; taxa bilhete perdido: ' + fmtMoney(before.taxa) + ' → ' + fmtMoney(novaTaxa));
    showToast('Preferências salvas.', 'success');
  });

  document.getElementById('form-local-alt').addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = normStr(document.getElementById('local-nome').value);
    const endereco = normStr(document.getElementById('local-endereco').value);
    const obs = normStr(document.getElementById('local-obs').value);
    if (!nome || !endereco) { showToast('Informe nome e endereço do local alternativo.', 'error'); return; }
    state.config.locaisAlternativos.push({ id: genId('loc'), nome, endereco, observacoes: obs });
    if (!persist('config')) return;
    logHistory('editar', 'Configuração', 'config', 'Local alternativo cadastrado: ' + nome);
    document.getElementById('form-local-alt').reset();
    renderLocaisTable();
    showToast('Local alternativo adicionado.', 'success');
  });

  document.querySelector('#locais-table tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="remove-local"]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const local = state.config.locaisAlternativos.find(l => l.id === id);
    confirmAction('Remover local alternativo', 'Remover "' + (local ? local.nome : '') + '" da lista de locais alternativos?', () => {
      state.config.locaisAlternativos = state.config.locaisAlternativos.filter(l => l.id !== id);
      persist('config');
      logHistory('editar', 'Configuração', 'config', 'Local alternativo removido: ' + (local ? local.nome : id));
      renderLocaisTable();
      showToast('Local removido.', 'success');
    });
  });

  document.getElementById('btn-export-backup').addEventListener('click', exportBackupJSON);
  document.getElementById('input-import-backup').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importBackupJSON(file);
    e.target.value = '';
  });
  document.getElementById('btn-reset-mock').addEventListener('click', () => {
    confirmAction('Restaurar dados de exemplo', 'Isto substituirá TODOS os dados salvos neste navegador pelos dados de demonstração originais. Esta ação não pode ser desfeita. Deseja continuar?', () => {
      resetDemoData();
      renderAll();
      showToast('Dados de demonstração restaurados.', 'success');
    });
  });
}

/* ============================================================
   38) UI — Login
   ============================================================ */
function wireLogin() {
  document.getElementById('login-pass-toggle').addEventListener('click', () => {
    const input = document.getElementById('login-pass');
    const toggle = document.getElementById('login-pass-toggle');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? '🙈' : '👁️';
    toggle.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });

  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (isBusy('login')) return;
    setBusy('login', true);
    try {
      const usuario = document.getElementById('login-user').value;
      const senha = document.getElementById('login-pass').value;
      const errorEl = document.getElementById('login-error');
      if (attemptLogin(usuario, senha)) {
        errorEl.hidden = true;
        enterApp();
      } else {
        errorEl.textContent = 'Usuário ou senha incorretos.';
        errorEl.hidden = false;
      }
    } finally { setBusy('login', false); }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    confirmAction('Sair', 'Deseja encerrar esta sessão de demonstração?', () => {
      logout();
      document.getElementById('app').hidden = true;
      document.getElementById('login-screen').hidden = false;
      document.getElementById('login-form').reset();
    });
  });
}

function enterApp() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app').hidden = false;
  renderAll();
}

/* ============================================================
   39) UI — Navegação lateral e atalhos do dashboard
   ============================================================ */
function wireNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.getAttribute('data-view')));
  });
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  document.getElementById('shortcut-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action === 'novo-cliente') { showView('clientes'); openClienteModal(null); }
    else if (action === 'ir-mapa') showView('mapa');
    else if (action === 'ir-clientes') showView('clientes');
    else if (action === 'ir-veiculos') showView('veiculos');
    else if (action === 'ir-tickets') showView('tickets');
    else if (action === 'ir-relatorios') showView('relatorios');
  });

  document.getElementById('btn-bilhete-perdido').addEventListener('click', openBilhetePerdidoModal);
  document.getElementById('ticket-print-btn').addEventListener('click', printCurrentTicket);
}

/* ============================================================
   40) UI — Máscaras visuais nos campos (auxiliares; validação
   de verdade sempre roda separadamente em JS)
   ============================================================ */
function wireInputMasks() {
  [['ocupar-cpf', maskCPFInput], ['cliente-cpf', maskCPFInput], ['colaborador-cpf', maskCPFInput]].forEach(([id, fn]) => {
    const el = document.getElementById(id); if (el) fn(el);
  });
  [['ocupar-telefone', maskPhoneInput], ['cliente-telefone', maskPhoneInput], ['colaborador-telefone', maskPhoneInput]].forEach(([id, fn]) => {
    const el = document.getElementById(id); if (el) fn(el);
  });
  [['ocupar-placa', maskPlacaInput], ['veiculo-placa', maskPlacaInput]].forEach(([id, fn]) => {
    const el = document.getElementById(id); if (el) fn(el);
  });
}

/* ============================================================
   41) INIT
   ============================================================ */
function initializeApp() {
  seedMockData();
  loadAllFromStorage();

  initTheme();
  wireLogin();
  wireGenericModalClosers();
  wireNav();
  wireInputMasks();

  wireOcuparClienteBusca();
  wireOcuparVeiculoBusca();
  document.getElementById('form-ocupar').addEventListener('submit', handleOcuparSubmit);
  wireSaidaModal();
  wireBilhetePerdidoModal();
  wireInterditarModal();

  wireClientesView();
  wireColaboradoresView();
  wireVeiculosView();
  wireTicketsView();
  wireRelatoriosView();
  wireConfigView();

  startClock();

  if (isAuthenticated()) {
    enterApp();
  } else {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app').hidden = true;
  }
}

document.addEventListener('DOMContentLoaded', initializeApp);
