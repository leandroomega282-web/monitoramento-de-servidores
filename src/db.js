"use strict";

// Persistencia simples em arquivo JSON.
// Para um sistema pequeno (poucos usuarios e servidores) e perfeitamente
// adequado e nao requer instalacao de banco.

const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "..", "data", "data.json");

const VAZIO = () => ({
  usuarios: [],
  servidores: [],
  eventos: [],
  verificacoes: [],
  seq: { usuario: 0, servidor: 0, evento: 0, verificacao: 0 },
});

const MAX_VERIFICACOES = 5000;

function garantirDir() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function carregar() {
  garantirDir();
  if (!fs.existsSync(DB_FILE)) return VAZIO();
  try {
    const txt = fs.readFileSync(DB_FILE, "utf8");
    const obj = JSON.parse(txt);
    const dados = Object.assign(VAZIO(), obj);
    if (!Array.isArray(dados.verificacoes)) dados.verificacoes = [];
    if (!dados.seq.verificacao) dados.seq.verificacao = 0;
    // Migracao: garante campo email em usuarios antigos
    (dados.usuarios || []).forEach((u) => {
      if (u.email === undefined) u.email = null;
    });
    // Migracao: garante campos novos em servidores antigos
    (dados.servidores || []).forEach((s) => {
      if (s.tipo === undefined) s.tipo = "ping";
      if (s.porta === undefined) s.porta = null;
      if (s.intervaloSeg === undefined) s.intervaloSeg = null;
      if (s.monitoradoresIds === undefined) s.monitoradoresIds = [];
    });
    // Migracao: campo de notificacao por usuario nos eventos
    (dados.eventos || []).forEach((e) => {
      if (e.notificadoPara === undefined) {
        e.notificadoPara = e.notificado ? ["__antigo__"] : [];
      }
    });
    return dados;
  } catch (e) {
    console.error("Erro ao ler banco:", e.message);
    return VAZIO();
  }
}

let cache = carregar();

function salvar() {
  garantirDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function proximoId(tipo) {
  cache.seq[tipo] = (cache.seq[tipo] || 0) + 1;
  return cache.seq[tipo];
}

// ---- Usuarios ----
function listarUsuarios() {
  return cache.usuarios.map(({ senhaHash, codigoRecuperacaoHash, ...rest }) => rest);
}
function buscarUsuarioPorLogin(login) {
  return cache.usuarios.find((u) => u.usuario === login) || null;
}
function buscarUsuarioPorId(id) {
  return cache.usuarios.find((u) => u.id === id) || null;
}
function criarUsuario({ nome, usuario, senhaHash, isAdmin, email }) {
  if (buscarUsuarioPorLogin(usuario)) {
    throw new Error("Já existe um usuário com esse login.");
  }
  const novo = {
    id: proximoId("usuario"),
    nome,
    usuario,
    senhaHash,
    isAdmin: !!isAdmin,
    email: email || null,
    criadoEm: new Date().toISOString(),
  };
  cache.usuarios.push(novo);
  salvar();
  return novo;
}

function atualizarPerfil(id, dados) {
  const u = buscarUsuarioPorId(id);
  if (!u) return null;
  if (dados.nome !== undefined) u.nome = dados.nome;
  if (dados.usuario !== undefined && dados.usuario !== u.usuario) {
    if (buscarUsuarioPorLogin(dados.usuario)) {
      throw new Error("Já existe um usuário com esse login.");
    }
    u.usuario = dados.usuario;
  }
  if (dados.senhaHash !== undefined) u.senhaHash = dados.senhaHash;
  if (dados.email !== undefined) u.email = dados.email || null;
  if (dados.isAdmin !== undefined) u.isAdmin = !!dados.isAdmin;
  salvar();
  return u;
}
function atualizarSenha(id, senhaHash) {
  const u = buscarUsuarioPorId(id);
  if (!u) return false;
  u.senhaHash = senhaHash;
  salvar();
  return true;
}
function excluirUsuario(id) {
  const i = cache.usuarios.findIndex((u) => u.id === id);
  if (i < 0) return false;
  cache.usuarios.splice(i, 1);
  salvar();
  return true;
}
function temUsuarios() {
  return cache.usuarios.length > 0;
}

// ---- Servidores ----
function listarServidores(apenasAtivos = false) {
  let list = cache.servidores.slice();
  if (apenasAtivos) list = list.filter((s) => s.ativo);
  list.sort((a, b) => a.nome.localeCompare(b.nome));
  return list;
}
function buscarServidor(id) {
  return cache.servidores.find((s) => s.id === id) || null;
}
function criarServidor({ nome, host, descricao, tipo, porta, intervaloSeg, monitoradoresIds, ativo }) {
  const novo = {
    id: proximoId("servidor"),
    nome,
    host,
    descricao: descricao || null,
    tipo: tipo || "ping",
    porta: porta == null ? null : Number(porta),
    intervaloSeg: intervaloSeg == null ? null : Number(intervaloSeg),
    monitoradoresIds: Array.isArray(monitoradoresIds) ? monitoradoresIds.map(Number) : [],
    statusAtual: "desconhecido",
    ultimaVerificacao: null,
    ultimoTempoMs: null,
    ativo: ativo == null ? true : !!ativo,
    criadoEm: new Date().toISOString(),
  };
  cache.servidores.push(novo);
  salvar();
  return novo;
}

function editarServidor(id, dados) {
  const s = buscarServidor(id);
  if (!s) return null;
  if (dados.nome !== undefined) s.nome = String(dados.nome).trim().slice(0, 100);
  if (dados.host !== undefined) s.host = String(dados.host).trim();
  if (dados.descricao !== undefined) {
    s.descricao = dados.descricao ? String(dados.descricao).trim().slice(0, 255) : null;
  }
  if (dados.tipo !== undefined) s.tipo = dados.tipo;
  if (dados.porta !== undefined) s.porta = dados.porta == null ? null : Number(dados.porta);
  if (dados.intervaloSeg !== undefined) {
    s.intervaloSeg = dados.intervaloSeg == null ? null : Number(dados.intervaloSeg);
  }
  if (dados.monitoradoresIds !== undefined) {
    s.monitoradoresIds = Array.isArray(dados.monitoradoresIds)
      ? dados.monitoradoresIds.map(Number)
      : [];
  }
  if (dados.ativo !== undefined) s.ativo = !!dados.ativo;
  salvar();
  return s;
}
function atualizarServidor(id, dados) {
  const s = buscarServidor(id);
  if (!s) return null;
  Object.assign(s, dados);
  salvar();
  return s;
}
function toggleServidor(id) {
  const s = buscarServidor(id);
  if (!s) return null;
  s.ativo = !s.ativo;
  salvar();
  return s;
}
function excluirServidor(id) {
  const i = cache.servidores.findIndex((s) => s.id === id);
  if (i < 0) return false;
  cache.servidores.splice(i, 1);
  // Remove eventos relacionados
  cache.eventos = cache.eventos.filter((e) => e.servidorId !== id);
  salvar();
  return true;
}

// ---- Eventos ----
function registrarEvento({ servidorId, statusAnterior, statusNovo, mensagem }) {
  const novo = {
    id: proximoId("evento"),
    servidorId,
    statusAnterior,
    statusNovo,
    mensagem,
    notificadoPara: [],
    criadoEm: new Date().toISOString(),
  };
  cache.eventos.push(novo);
  // Mantem apenas os ultimos 500 eventos para nao crescer infinitamente
  if (cache.eventos.length > 500) {
    cache.eventos = cache.eventos.slice(-500);
  }
  salvar();
  return novo;
}
function listarEventos(limite = 20) {
  return cache.eventos
    .slice()
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, limite)
    .map((e) => {
      const s = buscarServidor(e.servidorId);
      return Object.assign({}, e, {
        servidorNome: s ? s.nome : "(removido)",
        servidorHost: s ? s.host : "",
      });
    });
}
// ---- Verificacoes (log de cada checagem) ----
function registrarVerificacao({ servidorId, status, tempoMs, mensagem }) {
  const novo = {
    id: proximoId("verificacao"),
    servidorId,
    status,
    tempoMs: tempoMs == null ? null : Number(tempoMs),
    mensagem: mensagem || null,
    criadoEm: new Date().toISOString(),
  };
  cache.verificacoes.push(novo);
  if (cache.verificacoes.length > MAX_VERIFICACOES) {
    cache.verificacoes = cache.verificacoes.slice(-MAX_VERIFICACOES);
  }
  // Persistencia: nao salva a cada chamada para evitar I/O excessivo.
  // O ciclo /api/verificar ja chama salvar() via atualizarServidor.
  return novo;
}

function listarVerificacoes({ servidorId, dataInicio, dataFim, limite } = {}) {
  const lim = Math.min(Math.max(parseInt(limite, 10) || 500, 1), 5000);
  const sid = servidorId ? Number(servidorId) : null;
  const ini = dataInicio ? new Date(dataInicio).getTime() : null;
  const fim = dataFim ? new Date(dataFim).getTime() : null;
  const lista = cache.verificacoes.filter((v) => {
    if (sid != null && v.servidorId !== sid) return false;
    const t = new Date(v.criadoEm).getTime();
    if (ini != null && !isNaN(ini) && t < ini) return false;
    if (fim != null && !isNaN(fim) && t > fim) return false;
    return true;
  });
  const total = lista.length;
  const ordenado = lista
    .slice()
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, lim)
    .map((v) => {
      const s = buscarServidor(v.servidorId);
      return Object.assign({}, v, {
        servidorNome: s ? s.nome : "(removido)",
        servidorHost: s ? s.host : "",
      });
    });
  return { total, verificacoes: ordenado };
}

function eventosNaoNotificados(usuarioId) {
  // Retorna eventos ainda nao notificados para este usuario E
  // filtra por monitoradores: se o servidor tem monitoradores associados,
  // so esses recebem; lista vazia significa "todos recebem".
  const uid = Number(usuarioId);
  const novos = cache.eventos
    .filter((e) => {
      const s = buscarServidor(e.servidorId);
      if (s && Array.isArray(s.monitoradoresIds) && s.monitoradoresIds.length > 0) {
        if (!s.monitoradoresIds.includes(uid)) return false;
      }
      const lista = Array.isArray(e.notificadoPara) ? e.notificadoPara : [];
      return !lista.includes(uid);
    })
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  if (novos.length > 0) {
    novos.forEach((e) => {
      if (!Array.isArray(e.notificadoPara)) e.notificadoPara = [];
      e.notificadoPara.push(uid);
    });
    salvar();
  }
  return novos.map((e) => {
    const s = buscarServidor(e.servidorId);
    return Object.assign({}, e, {
      servidorNome: s ? s.nome : "(removido)",
      servidorHost: s ? s.host : "",
    });
  });
}

module.exports = {
  // usuarios
  listarUsuarios,
  buscarUsuarioPorLogin,
  buscarUsuarioPorId,
  criarUsuario,
  atualizarSenha,
  atualizarPerfil,
  excluirUsuario,
  temUsuarios,
  // servidores
  listarServidores,
  buscarServidor,
  criarServidor,
  editarServidor,
  atualizarServidor,
  toggleServidor,
  excluirServidor,
  // eventos
  registrarEvento,
  listarEventos,
  eventosNaoNotificados,
  // verificacoes (log)
  registrarVerificacao,
  listarVerificacoes,
};
