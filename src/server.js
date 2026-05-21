"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

const db = require("./db");
const { verificar, hostValido, portaValida, tipoValido } = require("./verificadores");
const emailer = require("./emailer");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PORTA = parseInt(process.env.PORT || "3000", 10);
const INTERVALO_CHECK_SEG = parseInt(process.env.INTERVALO || "30", 10);
const VERIFICACAO_TIMEOUT_MS = 3000;
const EM_PRODUCAO = process.env.NODE_ENV === "production";

const app = express();
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DATA_DIR = path.join(__dirname, "..", "data");

// ============================================================
// Session secret persistente: env var > arquivo > gerar e salvar
// ============================================================
function obterSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const keyFile = path.join(DATA_DIR, "secret.key");
  try {
    if (fs.existsSync(keyFile)) {
      const txt = fs.readFileSync(keyFile, "utf8").trim();
      if (txt.length >= 32) return txt;
    }
  } catch (e) {
    console.warn("Falha ao ler secret.key:", e.message);
  }
  // Gera e salva
  const novo = crypto.randomBytes(48).toString("hex");
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(keyFile, novo, { encoding: "utf8", mode: 0o600 });
    console.log("SESSION_SECRET gerado e salvo em data/secret.key");
  } catch (e) {
    console.warn("Nao foi possivel salvar secret.key (sessions invalidam ao reiniciar):", e.message);
  }
  return novo;
}

// ============================================================
// Audit log: append-only em data/audit.log
// ============================================================
const AUDIT_FILE = path.join(DATA_DIR, "audit.log");
function audit(req, acao, detalhe) {
  try {
    const linha = JSON.stringify({
      ts: new Date().toISOString(),
      ip: req.ip || req.connection?.remoteAddress || "?",
      usuario: req.session?.usuario?.usuario || "(anonimo)",
      usuarioId: req.session?.usuario?.id || null,
      acao,
      detalhe: detalhe || null,
    }) + "\n";
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, linha, "utf8");
  } catch (e) {
    console.warn("Falha ao gravar audit log:", e.message);
  }
}

// ============================================================
// Headers de seguranca (helmet)
// ============================================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // inline scripts em paginas
        scriptSrcAttr: ["'unsafe-inline'"], // permite onclick="" nos botoes (sem isso, o default 'none' do helmet bloqueia)
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"], // bloqueia clickjacking
      },
    },
    crossOriginEmbedderPolicy: false, // permite Google Fonts
  })
);

// app.set('trust proxy', 1) — habilita se rodar atras de proxy/nginx para rate limit por IP correto
if (EM_PRODUCAO) app.set("trust proxy", 1);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use(
  session({
    name: "rastreio.sid",
    secret: obterSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: EM_PRODUCAO,
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);

// ============================================================
// CSRF mitigation: valida Origin/Referer em mutacoes
// ============================================================
const METODOS_MUTACAO = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use((req, res, next) => {
  if (!METODOS_MUTACAO.has(req.method)) return next();
  // So aplica em /api (paginas estaticas nao processam mutacoes)
  if (!req.path.startsWith("/api/")) return next();
  // /api/install precisa funcionar mesmo sem origin (primeiro acesso)
  if (req.path === "/api/install" && !db.temUsuarios()) return next();

  const origin = req.get("Origin");
  const referer = req.get("Referer");
  const host = req.get("Host");
  if (!host) return res.status(400).json({ erro: "host_obrigatorio" });

  // Modern browsers always send Origin on POST/PATCH/DELETE
  const fonte = origin || referer;
  if (!fonte) {
    return res.status(403).json({ erro: "origem_ausente" });
  }
  try {
    const url = new URL(fonte);
    if (url.host !== host) {
      audit(req, "csrf_bloqueado", { fonte, host });
      return res.status(403).json({ erro: "origem_invalida" });
    }
  } catch (e) {
    return res.status(403).json({ erro: "origem_invalida" });
  }
  next();
});

// ============================================================
// Rate limiters
// ============================================================
const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5, // 5 tentativas por IP
  message: { erro: "muitas_tentativas", mensagem: "Muitas tentativas de login. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // sucesso nao conta
});

const limiterRecuperacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3, // 3 solicitacoes por IP a cada 15 min
  message: { erro: "muitas_tentativas", mensagem: "Muitas solicitações de recuperação. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Hash dummy para constant-time login (evita user enumeration por timing)
// Pre-computado de uma string aleatoria
const HASH_DUMMY = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

// ============================================================
// Middlewares de autenticacao
// ============================================================

function requerLogin(req, res, next) {
  if (req.session && req.session.usuario) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ erro: "nao_autenticado" });
  }
  return res.redirect("/login.html");
}

function requerAdmin(req, res, next) {
  if (req.session && req.session.usuario && req.session.usuario.isAdmin) {
    return next();
  }
  return res.status(403).json({ erro: "acesso_negado" });
}

// Redireciona / para login ou painel conforme estado
app.get("/", (req, res) => {
  if (!db.temUsuarios()) return res.redirect("/install.html");
  if (req.session && req.session.usuario) return res.redirect("/painel.html");
  return res.redirect("/login.html");
});

// Bloqueia acesso direto a paginas que exigem login
const paginasProtegidas = ["/painel.html", "/servidores.html", "/usuarios.html", "/minha-conta.html", "/logs.html", "/configuracoes.html"];
const paginasAdmin = ["/usuarios.html", "/configuracoes.html"];
app.use((req, res, next) => {
  if (paginasProtegidas.includes(req.path)) {
    if (!req.session || !req.session.usuario) {
      return res.redirect("/login.html");
    }
    if (paginasAdmin.includes(req.path) && !req.session.usuario.isAdmin) {
      return res.redirect("/painel.html");
    }
  }
  next();
});

// ============================================================
// API - Estado / instalacao
// ============================================================

// Healthcheck publico (Railway/Render/etc) — nao requer sessao
app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/estado", (req, res) => {
  res.json({
    instalado: db.temUsuarios(),
    autenticado: !!(req.session && req.session.usuario),
    usuario: req.session && req.session.usuario ? req.session.usuario : null,
    intervaloSeg: INTERVALO_CHECK_SEG,
  });
});

app.post("/api/install", async (req, res) => {
  if (db.temUsuarios()) {
    return res.status(400).json({ erro: "ja_instalado" });
  }
  const { nome, usuario, senha, email } = req.body || {};
  if (!nome || !usuario || !senha) {
    return res.status(400).json({ erro: "campos_obrigatorios" });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: "senha_curta" });
  }
  if (!/^[a-zA-Z0-9_.\-]{3,50}$/.test(usuario)) {
    return res.status(400).json({ erro: "usuario_invalido" });
  }
  if (email && !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ erro: "email_invalido" });
  }
  const hash = await bcrypt.hash(senha, 10);
  const novo = db.criarUsuario({
    nome,
    usuario,
    senhaHash: hash,
    isAdmin: true,
    email: email ? email.trim() : null,
  });
  req.session.usuario = {
    id: novo.id,
    nome: novo.nome,
    usuario: novo.usuario,
    isAdmin: true,
  };
  res.json({ ok: true });
});

// ============================================================
// API - Login / logout
// ============================================================

app.post("/api/login", limiterLogin, async (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ erro: "campos_obrigatorios" });
  }
  const u = db.buscarUsuarioPorLogin(String(usuario).trim());
  // Constant-time: sempre faz bcrypt, mesmo se usuario nao existe
  // (evita timing attack para enumeracao de usuarios)
  const hashAlvo = u ? u.senhaHash : HASH_DUMMY;
  const ok = await bcrypt.compare(senha, hashAlvo);
  if (!u || !ok) {
    audit(req, "login_falha", { usuario: String(usuario).trim() });
    return res.status(401).json({ erro: "credenciais_invalidas" });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ erro: "erro_sessao" });
    req.session.usuario = {
      id: u.id,
      nome: u.nome,
      usuario: u.usuario,
      isAdmin: !!u.isAdmin,
    };
    audit(req, "login_sucesso", null);
    res.json({ ok: true, usuario: req.session.usuario });
  });
});

app.post("/api/logout", (req, res) => {
  if (!req.session) return res.json({ ok: true });
  audit(req, "logout", null);
  req.session.destroy(() => {
    res.clearCookie("rastreio.sid");
    res.json({ ok: true });
  });
});

// ============================================================
// API - Recuperacao de senha por email (token temporario)
// ============================================================

// Store em memoria: token -> { usuarioId, expira }
// Tokens duram 1h e nao persistem entre restarts (intencional: limita janela)
const tokensRecuperacao = new Map();
const TOKEN_VALIDADE_MS = 60 * 60 * 1000; // 1 hora

function limparTokensExpirados() {
  const agora = Date.now();
  for (const [tk, dados] of tokensRecuperacao.entries()) {
    if (dados.expira < agora) tokensRecuperacao.delete(tk);
  }
}
// Limpeza periodica a cada 10 minutos
setInterval(limparTokensExpirados, 10 * 60 * 1000);

// Solicita recuperacao: recebe email, envia link com token (se email existir)
// Sempre retorna ok para nao revelar quais emails existem no sistema.
app.post("/api/recuperar-senha", limiterRecuperacao, async (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_REGEX.test(String(email).trim())) {
    return res.status(400).json({ erro: "email_invalido" });
  }
  if (!emailer.estaConfigurado()) {
    return res.status(503).json({
      erro: "smtp_nao_configurado",
      mensagem: "Recuperação por email não está disponível. Contate um administrador.",
    });
  }
  const emailNorm = String(email).trim().toLowerCase();
  const usuario = db.listarUsuarios().find(
    (u) => u.email && u.email.toLowerCase() === emailNorm
  );
  // Sempre responde ok (nao revela se email existe)
  res.json({ ok: true });
  // Mas so envia o email se o usuario existir
  if (!usuario) return;

  const token = crypto.randomBytes(32).toString("hex");
  tokensRecuperacao.set(token, {
    usuarioId: usuario.id,
    expira: Date.now() + TOKEN_VALIDADE_MS,
  });
  const baseUrl = req.protocol + "://" + req.get("host");
  const link = baseUrl + "/redefinir-senha.html?token=" + token;
  try {
    await emailer.enviarEmail({
      para: usuario.email,
      assunto: "Recuperação de senha - Monitoramento de Servidores",
      html: emailer.gerarHtmlRecuperacaoSenha({
        nome: usuario.nome,
        link: link,
        validadeHoras: 1,
      }),
    });
  } catch (e) {
    console.error("Falha ao enviar email de recuperacao:", e.message);
  }
});

// Valida o token e retorna info basica (para a pagina de redefinicao mostrar pra quem eh)
app.get("/api/recuperar-senha/validar", (req, res) => {
  const { token } = req.query || {};
  if (!token) return res.status(400).json({ erro: "token_obrigatorio" });
  const dados = tokensRecuperacao.get(String(token));
  if (!dados || dados.expira < Date.now()) {
    if (dados) tokensRecuperacao.delete(String(token));
    return res.status(400).json({ erro: "token_invalido" });
  }
  const u = db.buscarUsuarioPorId(dados.usuarioId);
  if (!u) return res.status(400).json({ erro: "token_invalido" });
  res.json({ ok: true, nome: u.nome, usuario: u.usuario });
});

// Redefine a senha usando o token
app.post("/api/recuperar-senha/redefinir", async (req, res) => {
  const { token, novaSenha } = req.body || {};
  if (!token || !novaSenha) {
    return res.status(400).json({ erro: "campos_obrigatorios" });
  }
  if (novaSenha.length < 6) {
    return res.status(400).json({ erro: "senha_curta" });
  }
  const dados = tokensRecuperacao.get(String(token));
  if (!dados || dados.expira < Date.now()) {
    if (dados) tokensRecuperacao.delete(String(token));
    return res.status(400).json({ erro: "token_invalido" });
  }
  const u = db.buscarUsuarioPorId(dados.usuarioId);
  if (!u) {
    tokensRecuperacao.delete(String(token));
    return res.status(400).json({ erro: "token_invalido" });
  }
  const hash = await bcrypt.hash(novaSenha, 10);
  db.atualizarSenha(u.id, hash);
  // Invalida o token apos uso
  tokensRecuperacao.delete(String(token));
  res.json({ ok: true, usuario: u.usuario });
});

// ============================================================
// API - Minha conta (usuario logado altera proprios dados)
// ============================================================

app.get("/api/minha-conta", requerLogin, (req, res) => {
  const u = db.buscarUsuarioPorId(req.session.usuario.id);
  if (!u) return res.status(404).json({ erro: "nao_encontrado" });
  res.json({
    usuario: {
      id: u.id,
      nome: u.nome,
      usuario: u.usuario,
      email: u.email || null,
      isAdmin: !!u.isAdmin,
    },
  });
});

app.post("/api/minha-conta", requerLogin, async (req, res) => {
  const { senhaAtual, nome, usuario, novaSenha, email } = req.body || {};
  if (!senhaAtual) {
    return res.status(400).json({ erro: "senha_atual_obrigatoria" });
  }
  const u = db.buscarUsuarioPorId(req.session.usuario.id);
  if (!u) return res.status(404).json({ erro: "nao_encontrado" });
  const ok = await bcrypt.compare(senhaAtual, u.senhaHash);
  if (!ok) return res.status(401).json({ erro: "senha_atual_incorreta" });

  const dados = {};
  if (nome && nome.trim()) dados.nome = nome.trim().slice(0, 100);
  if (usuario && usuario.trim() && usuario.trim() !== u.usuario) {
    if (!/^[a-zA-Z0-9_.\-]{3,50}$/.test(usuario.trim())) {
      return res.status(400).json({ erro: "usuario_invalido" });
    }
    dados.usuario = usuario.trim();
  }
  if (email !== undefined) {
    const e = (email || "").trim();
    if (e && !EMAIL_REGEX.test(e)) {
      return res.status(400).json({ erro: "email_invalido" });
    }
    dados.email = e || null;
  }
  if (novaSenha) {
    if (novaSenha.length < 6) {
      return res.status(400).json({ erro: "senha_curta" });
    }
    dados.senhaHash = await bcrypt.hash(novaSenha, 10);
  }

  try {
    const atualizado = db.atualizarPerfil(u.id, dados);
    if (!atualizado) return res.status(404).json({ erro: "nao_encontrado" });
    req.session.usuario = {
      id: atualizado.id,
      nome: atualizado.nome,
      usuario: atualizado.usuario,
      isAdmin: !!atualizado.isAdmin,
    };
    res.json({ ok: true, usuario: req.session.usuario });
  } catch (e) {
    res.status(400).json({ erro: "usuario_duplicado", mensagem: e.message });
  }
});

// ============================================================
// API - Servidores
// ============================================================

app.get("/api/servidores", requerLogin, (req, res) => {
  res.json({ servidores: db.listarServidores(false) });
});

function validarDadosServidor(body) {
  const { nome, host, descricao, tipo, porta, intervaloSeg, monitoradoresIds, ativo } = body || {};
  if (!nome || !host) return { erro: "campos_obrigatorios" };
  if (!hostValido(String(host).trim())) return { erro: "host_invalido" };
  const t = tipo || "ping";
  if (!tipoValido(t)) return { erro: "tipo_invalido" };
  let p = null;
  if (t !== "ping") {
    // HTTP/HTTPS/TCP exigem porta
    if (porta == null || porta === "") return { erro: "porta_obrigatoria" };
    if (!portaValida(porta)) return { erro: "porta_invalida" };
    p = Number(porta);
  } else if (porta != null && porta !== "" && portaValida(porta)) {
    // PING ignora porta, mas se vier valida-se mesmo assim
    p = Number(porta);
  }
  let intervalo = null;
  if (intervaloSeg != null && intervaloSeg !== "") {
    const n = Number(intervaloSeg);
    if (!Number.isInteger(n) || n < 5 || n > 86400) return { erro: "intervalo_invalido" };
    intervalo = n;
  }
  let mIds = [];
  if (Array.isArray(monitoradoresIds)) {
    mIds = monitoradoresIds
      .map((x) => Number(x))
      .filter((x) => Number.isInteger(x) && x > 0);
  }
  return {
    dados: {
      nome: String(nome).trim().slice(0, 100),
      host: String(host).trim(),
      descricao: descricao ? String(descricao).trim().slice(0, 255) : null,
      tipo: t,
      porta: p,
      intervaloSeg: intervalo,
      monitoradoresIds: mIds,
      ativo: ativo == null ? true : !!ativo,
    },
  };
}

app.post("/api/servidores", requerLogin, (req, res) => {
  const v = validarDadosServidor(req.body);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  const novo = db.criarServidor(v.dados);
  // Verifica o servidor imediatamente (fire-and-forget) para popular o status inicial
  // sem o usuário precisar abrir o painel.
  verificarServidorAgora(novo).catch((e) =>
    console.error("Falha na verificação inicial do servidor:", e.message)
  );
  res.json({ ok: true, servidor: novo });
});

async function verificarServidorAgora(servidor) {
  if (!servidor || !servidor.ativo) return;
  const r = await verificar(servidor, VERIFICACAO_TIMEOUT_MS);
  const novoStatus = r.online ? "online" : "offline";
  db.atualizarServidor(servidor.id, {
    statusAtual: novoStatus,
    ultimaVerificacao: new Date().toISOString(),
    ultimoTempoMs: r.tempoMs,
  });
  db.registrarVerificacao({
    servidorId: servidor.id,
    status: novoStatus,
    tempoMs: r.tempoMs,
    mensagem: r.mensagem || null,
  });
}

app.get("/api/servidores/:id", requerLogin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.buscarServidor(id);
  if (!s) return res.status(404).json({ erro: "nao_encontrado" });
  res.json({ servidor: s });
});

app.patch("/api/servidores/:id", requerLogin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existente = db.buscarServidor(id);
  if (!existente) return res.status(404).json({ erro: "nao_encontrado" });
  const v = validarDadosServidor(req.body);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  const atualizado = db.editarServidor(id, v.dados);
  res.json({ ok: true, servidor: atualizado });
});

app.patch("/api/servidores/:id/toggle", requerLogin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.toggleServidor(id);
  if (!s) return res.status(404).json({ erro: "nao_encontrado" });
  res.json({ ok: true, servidor: s });
});

// Lista usuarios disponiveis para associar como monitoradores (acessivel a qualquer logado)
app.get("/api/monitoradores", requerLogin, (req, res) => {
  const lista = db.listarUsuarios().map((u) => ({
    id: u.id,
    nome: u.nome,
    usuario: u.usuario,
  }));
  res.json({ usuarios: lista });
});

app.delete("/api/servidores/:id", requerLogin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ok = db.excluirServidor(id);
  if (!ok) return res.status(404).json({ erro: "nao_encontrado" });
  res.json({ ok: true });
});

// ============================================================
// API - Verificar (pinga todos os servidores ativos)
// ============================================================

let verificando = false;
app.get("/api/verificar", requerLogin, async (req, res) => {
  if (verificando) {
    return res.json({
      ok: true,
      ocupado: true,
      ...montarRespostaEstadoAtual(req.session.usuario.id),
    });
  }
  verificando = true;
  try {
    const agora = Date.now();
    const ativos = db.listarServidores(true);
    // So verifica servidores cujo intervalo individual ja venceu
    // (intervaloSeg do servidor, ou o global se for null/0)
    const aVerificar = ativos.filter((s) => {
      const intervalo = (s.intervaloSeg && s.intervaloSeg > 0) ? s.intervaloSeg : INTERVALO_CHECK_SEG;
      if (!s.ultimaVerificacao) return true;
      const decorrido = (agora - new Date(s.ultimaVerificacao).getTime()) / 1000;
      return decorrido >= intervalo;
    });
    const mudancas = new Map();
    await Promise.all(
      aVerificar.map(async (s) => {
        const r = await verificar(s, VERIFICACAO_TIMEOUT_MS);
        const novoStatus = r.online ? "online" : "offline";
        const anterior = s.statusAtual;
        db.atualizarServidor(s.id, {
          statusAtual: novoStatus,
          ultimaVerificacao: new Date().toISOString(),
          ultimoTempoMs: r.tempoMs,
        });
        db.registrarVerificacao({
          servidorId: s.id,
          status: novoStatus,
          tempoMs: r.tempoMs,
          mensagem: r.mensagem || null,
        });
        if (anterior !== novoStatus) {
          const msg =
            novoStatus === "online"
              ? `Servidor '${s.nome}' VOLTOU online`
              : `Servidor '${s.nome}' esta FORA do ar`;
          db.registrarEvento({
            servidorId: s.id,
            statusAnterior: anterior,
            statusNovo: novoStatus,
            mensagem: msg,
          });
          mudancas.set(s.id, true);
          // Dispara email assincronamente para os monitoradores (nao bloqueia a verificacao)
          enviarAlertaEmail(s, novoStatus, r).catch((err) =>
            console.error("Falha ao enviar email de alerta:", err.message)
          );
        }
      })
    );

    const resultados = db.listarServidores(true).map((s) => ({
      id: s.id,
      nome: s.nome,
      host: s.host,
      tipo: s.tipo,
      porta: s.porta,
      status: s.statusAtual,
      tempoMs: s.ultimoTempoMs,
      ultimaVerificacao: s.ultimaVerificacao,
      mudou: mudancas.has(s.id),
    }));
    const novosEventos = db.eventosNaoNotificados(req.session.usuario.id);
    res.json({
      ok: true,
      verificadoEm: new Date().toISOString(),
      servidores: resultados,
      novosEventos,
      eventos: db.listarEventos(15),
      totais: contarTotais(resultados),
      quedas24h: quedasUltimas24h(),
    });
  } catch (e) {
    console.error("Erro verificando:", e);
    res.status(500).json({ erro: "erro_verificacao", detalhe: e.message });
  } finally {
    verificando = false;
  }
});

// ============================================================
// API - Configuracoes (SMTP, etc) - admin only
// ============================================================

app.get("/api/configuracoes/smtp", requerLogin, requerAdmin, (req, res) => {
  const cfg = emailer.lerConfig() || {};
  // Nao devolver a senha em texto plano; so um indicador
  res.json({
    smtp: {
      host: cfg.host || "",
      porta: cfg.porta || 587,
      usuario: cfg.usuario || "",
      senhaConfigurada: !!(cfg.senha),
      remetente: cfg.remetente || "",
      seguro: !!cfg.seguro,
    },
    configurado: emailer.estaConfigurado(),
  });
});

app.post("/api/configuracoes/smtp", requerLogin, requerAdmin, (req, res) => {
  const { host, porta, usuario, senha, remetente, seguro } = req.body || {};
  if (!host || !host.trim()) {
    return res.status(400).json({ erro: "host_obrigatorio" });
  }
  const portaNum = parseInt(porta, 10);
  if (!Number.isInteger(portaNum) || portaNum < 1 || portaNum > 65535) {
    return res.status(400).json({ erro: "porta_invalida" });
  }
  if (remetente && !EMAIL_REGEX.test(String(remetente).trim())) {
    return res.status(400).json({ erro: "remetente_invalido" });
  }
  // Se senha veio vazia, preserva a senha existente (admin nao quis trocar)
  const cfgAtual = emailer.lerConfig() || {};
  const novaConfig = {
    host: String(host).trim(),
    porta: portaNum,
    usuario: usuario ? String(usuario).trim() : "",
    senha: senha != null && senha !== "" ? String(senha) : (cfgAtual.senha || ""),
    remetente: remetente ? String(remetente).trim() : (usuario ? String(usuario).trim() : ""),
    seguro: !!seguro,
  };
  try {
    emailer.salvarConfig(novaConfig);
    audit(req, "smtp_atualizado", { host: novaConfig.host, usuario: novaConfig.usuario });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: "falha_salvar", detalhe: e.message });
  }
});

app.post("/api/configuracoes/smtp/testar", requerLogin, requerAdmin, async (req, res) => {
  const { para, host, porta, usuario, senha, remetente, seguro } = req.body || {};
  // Se vierem campos do form, monta override (usa form em vez da config salva)
  let override = null;
  if (host && String(host).trim()) {
    const cfgSalva = emailer.lerConfig() || {};
    override = {
      host: String(host).trim(),
      porta: Number(porta) || 587,
      usuario: usuario ? String(usuario).trim() : "",
      // Senha vazia no form → usa a senha salva (admin nao precisa reentrar)
      senha: (senha != null && senha !== "") ? String(senha) : (cfgSalva.senha || ""),
      remetente: remetente ? String(remetente).trim() : "",
      seguro: !!seguro,
    };
  }
  try {
    await emailer.enviarEmailTeste(para ? String(para).trim() : null, override);
    res.json({ ok: true });
  } catch (e) {
    console.error("Falha enviando email de teste:", e.message);
    res.status(500).json({ erro: "falha_envio", detalhe: e.message });
  }
});

// ============================================================
// API - Logs (verificacoes)
// ============================================================

app.get("/api/logs", requerLogin, (req, res) => {
  const { servidorId, dataInicio, dataFim, limite } = req.query || {};
  const r = db.listarVerificacoes({
    servidorId: servidorId || null,
    dataInicio: dataInicio || null,
    dataFim: dataFim || null,
    limite: limite || 500,
  });
  res.json({ ok: true, total: r.total, verificacoes: r.verificacoes });
});

// Envia email aos monitoradores associados a um servidor que mudou de status.
// Se a lista de monitoradores estiver vazia, envia para TODOS usuarios com email.
// Falhas em SMTP nao bloqueiam o ciclo de verificacao.
async function enviarAlertaEmail(servidor, statusNovo, resultadoVerif) {
  if (!emailer.estaConfigurado()) return;
  const todosUsuarios = db.listarUsuarios();
  const monitoradores = Array.isArray(servidor.monitoradoresIds) ? servidor.monitoradoresIds : [];
  let destinatarios;
  if (monitoradores.length === 0) {
    destinatarios = todosUsuarios.filter((u) => u.email);
  } else {
    destinatarios = todosUsuarios.filter((u) => monitoradores.includes(u.id) && u.email);
  }
  if (destinatarios.length === 0) return;
  const emails = destinatarios.map((u) => u.email);
  const html = emailer.gerarHtmlAlertaServidor({
    servidor: servidor.nome,
    statusNovo,
    host: servidor.host,
    porta: servidor.porta,
    tipo: servidor.tipo,
    tempoMs: resultadoVerif.tempoMs,
    mensagem: resultadoVerif.mensagem,
  });
  const assunto =
    (statusNovo === "offline" ? "🔴 OFFLINE: " : "🟢 ONLINE: ") + servidor.nome;
  // Envia uma copia para cada destinatario (TO) para nao expor lista entre eles.
  // Usar Promise.allSettled para nao parar se um falhar.
  await Promise.allSettled(
    emails.map((para) =>
      emailer.enviarEmail({ para, assunto, html }).catch((err) => {
        console.error("Email falhou para", para, "-", err.message);
      })
    )
  );
}

function contarTotais(resultados) {
  let online = 0;
  let offline = 0;
  for (const r of resultados) {
    if (r.status === "online") online++;
    else if (r.status === "offline") offline++;
  }
  return { online, offline, total: resultados.length };
}

function quedasUltimas24h() {
  const corte = Date.now() - 24 * 60 * 60 * 1000;
  return db
    .listarEventos(500)
    .filter(
      (e) => e.statusNovo === "offline" && new Date(e.criadoEm).getTime() >= corte
    ).length;
}

function montarRespostaEstadoAtual(usuarioId) {
  const servidores = db.listarServidores(true).map((s) => ({
    id: s.id,
    nome: s.nome,
    host: s.host,
    tipo: s.tipo,
    porta: s.porta,
    status: s.statusAtual,
    tempoMs: s.ultimoTempoMs,
    ultimaVerificacao: s.ultimaVerificacao,
  }));
  return {
    servidores,
    novosEventos: usuarioId ? db.eventosNaoNotificados(usuarioId) : [],
    eventos: db.listarEventos(15),
    totais: contarTotais(servidores),
  };
}

// ============================================================
// API - Usuarios (apenas admin)
// ============================================================

app.get("/api/usuarios", requerLogin, requerAdmin, (req, res) => {
  res.json({ usuarios: db.listarUsuarios() });
});

app.post("/api/usuarios", requerLogin, requerAdmin, async (req, res) => {
  const { nome, usuario, senha, isAdmin, email } = req.body || {};
  if (!nome || !usuario || !senha) {
    return res.status(400).json({ erro: "campos_obrigatorios" });
  }
  if (senha.length < 6) return res.status(400).json({ erro: "senha_curta" });
  if (!/^[a-zA-Z0-9_.\-]{3,50}$/.test(usuario)) {
    return res.status(400).json({ erro: "usuario_invalido" });
  }
  if (email && !EMAIL_REGEX.test(String(email).trim())) {
    return res.status(400).json({ erro: "email_invalido" });
  }
  try {
    const hash = await bcrypt.hash(senha, 10);
    const novo = db.criarUsuario({
      nome: String(nome).trim().slice(0, 100),
      usuario: String(usuario).trim(),
      senhaHash: hash,
      isAdmin: !!isAdmin,
      email: email ? String(email).trim() : null,
    });
    const { senhaHash, codigoRecuperacaoHash, codigoRecuperacao, ...semSensiveis } = novo;
    audit(req, "usuario_criado", { id: novo.id, usuario: novo.usuario, isAdmin: !!novo.isAdmin });
    res.json({ ok: true, usuario: semSensiveis });
  } catch (e) {
    res.status(400).json({ erro: "usuario_duplicado", mensagem: e.message });
  }
});

app.post(
  "/api/usuarios/:id/senha",
  requerLogin,
  requerAdmin,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { senha } = req.body || {};
    if (!senha || senha.length < 6) {
      return res.status(400).json({ erro: "senha_curta" });
    }
    const hash = await bcrypt.hash(senha, 10);
    const ok = db.atualizarSenha(id, hash);
    if (!ok) return res.status(404).json({ erro: "nao_encontrado" });
    res.json({ ok: true });
  }
);

// Editar dados basicos de um usuario (admin)
app.patch("/api/usuarios/:id", requerLogin, requerAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = db.buscarUsuarioPorId(id);
  if (!u) return res.status(404).json({ erro: "nao_encontrado" });

  const { nome, usuario, email, isAdmin } = req.body || {};
  const dados = {};

  if (nome !== undefined) {
    const n = String(nome).trim();
    if (!n) return res.status(400).json({ erro: "nome_obrigatorio" });
    dados.nome = n.slice(0, 100);
  }
  if (usuario !== undefined) {
    const novo = String(usuario).trim();
    if (!novo) return res.status(400).json({ erro: "usuario_obrigatorio" });
    if (novo !== u.usuario) {
      if (!/^[a-zA-Z0-9_.\-]{3,50}$/.test(novo)) {
        return res.status(400).json({ erro: "usuario_invalido" });
      }
      dados.usuario = novo;
    }
  }
  if (email !== undefined) {
    const e = (email || "").trim();
    if (e && !EMAIL_REGEX.test(e)) {
      return res.status(400).json({ erro: "email_invalido" });
    }
    dados.email = e || null;
  }
  if (isAdmin !== undefined) {
    const novoAdmin = !!isAdmin;
    // Seguranca: nao pode remover proprio admin
    if (u.id === req.session.usuario.id && u.isAdmin && !novoAdmin) {
      return res.status(400).json({ erro: "nao_pode_remover_proprio_admin" });
    }
    dados.isAdmin = novoAdmin;
  }

  try {
    const atualizado = db.atualizarPerfil(id, dados);
    if (!atualizado) return res.status(404).json({ erro: "nao_encontrado" });
    // Se editou si mesmo, atualiza a sessao
    if (u.id === req.session.usuario.id) {
      req.session.usuario.nome = atualizado.nome;
      req.session.usuario.usuario = atualizado.usuario;
      req.session.usuario.isAdmin = !!atualizado.isAdmin;
    }
    const { senhaHash, codigoRecuperacaoHash, ...semSensiveis } = atualizado;
    res.json({ ok: true, usuario: semSensiveis });
  } catch (e) {
    res.status(400).json({ erro: "usuario_duplicado", mensagem: e.message });
  }
});

// Associa/desassocia servidores que este usuario monitora (gerencia em massa)
app.get("/api/usuarios/:id/servidores", requerLogin, requerAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = db.buscarUsuarioPorId(id);
  if (!u) return res.status(404).json({ erro: "nao_encontrado" });
  const servidores = db.listarServidores(false).map((s) => ({
    id: s.id,
    nome: s.nome,
    host: s.host,
    tipo: s.tipo,
    ativo: s.ativo,
    associado: Array.isArray(s.monitoradoresIds) && s.monitoradoresIds.includes(id),
  }));
  res.json({ ok: true, servidores });
});

app.patch("/api/usuarios/:id/servidores", requerLogin, requerAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = db.buscarUsuarioPorId(id);
  if (!u) return res.status(404).json({ erro: "nao_encontrado" });
  const { servidorIds } = req.body || {};
  if (!Array.isArray(servidorIds)) {
    return res.status(400).json({ erro: "servidor_ids_invalido" });
  }
  const desejados = new Set(
    servidorIds.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
  );
  const servidores = db.listarServidores(false);
  servidores.forEach((s) => {
    const lista = Array.isArray(s.monitoradoresIds) ? s.monitoradoresIds.slice() : [];
    const temAgora = lista.includes(id);
    const deveTer = desejados.has(s.id);
    if (temAgora && !deveTer) {
      db.editarServidor(s.id, { monitoradoresIds: lista.filter((uid) => uid !== id) });
    } else if (!temAgora && deveTer) {
      lista.push(id);
      db.editarServidor(s.id, { monitoradoresIds: lista });
    }
  });
  res.json({ ok: true });
});

app.delete("/api/usuarios/:id", requerLogin, requerAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.session.usuario.id) {
    return res.status(400).json({ erro: "nao_pode_excluir_proprio" });
  }
  const alvo = db.buscarUsuarioPorId(id);
  const ok = db.excluirUsuario(id);
  if (!ok) return res.status(404).json({ erro: "nao_encontrado" });
  audit(req, "usuario_excluido", { id, usuario: alvo ? alvo.usuario : null });
  res.json({ ok: true });
});

// ============================================================
// Arquivos estaticos
// ============================================================

app.use(express.static(PUBLIC_DIR));

// 404 JSON para API
app.use("/api", (req, res) => {
  res.status(404).json({ erro: "rota_nao_encontrada" });
});

// 404 HTML para resto
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
});

// ============================================================
// Subir o servidor
// ============================================================

// Bind explicito em 0.0.0.0 para funcionar atras de proxy (Railway/Render/etc).
// Sem isso, em alguns ambientes o Node escuta so em IPv6 e o proxy retorna 502.
app.listen(PORTA, "0.0.0.0", () => {
  console.log(`Monitoramento de Servidores rodando na porta ${PORTA}`);
  if (!db.temUsuarios()) {
    console.log(
      `Acesse para criar o usuário administrador.`
    );
  }
});

// Loga erros nao tratados para aparecerem nos deploy logs do Railway
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
