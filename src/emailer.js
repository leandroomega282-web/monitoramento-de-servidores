"use strict";

const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "data", "config.json");

function lerConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const txt = fs.readFileSync(CONFIG_FILE, "utf8");
    const obj = JSON.parse(txt);
    return obj && obj.smtp ? obj.smtp : null;
  } catch (e) {
    console.error("Erro lendo config.json:", e.message);
    return null;
  }
}

function salvarConfig(smtp) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let obj = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      obj = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {};
    } catch (e) { obj = {}; }
  }
  obj.smtp = smtp;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2), "utf8");
  resetCache();
}

function resetCache() {
  _transporterCache = null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function criarTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.porta) || 587,
    secure: !!cfg.seguro, // true para 465, false para outras portas
    auth: cfg.usuario
      ? { user: cfg.usuario, pass: cfg.senha || "" }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
  });
}

let _transporterCache = null;
function obterTransporterPadrao() {
  if (_transporterCache) return _transporterCache;
  const cfg = lerConfig();
  if (!cfg || !cfg.host || !cfg.usuario) return null;
  _transporterCache = criarTransporter(cfg);
  return _transporterCache;
}

function estaConfigurado() {
  const cfg = lerConfig();
  return !!(cfg && cfg.host && cfg.usuario);
}

// Resolve um remetente valido (cai para usuario se remetente for invalido/vazio)
function remetenteValido(cfg) {
  if (cfg.remetente && EMAIL_REGEX.test(cfg.remetente)) return cfg.remetente;
  if (cfg.usuario && EMAIL_REGEX.test(cfg.usuario)) return cfg.usuario;
  return cfg.usuario || cfg.remetente;
}

// `override`: usa essa config em vez da salva (util para testar antes de salvar)
async function enviarEmail({ para, assunto, html, texto, override }) {
  let cfg, transp;
  if (override && override.host) {
    cfg = override;
    transp = criarTransporter(cfg);
  } else {
    cfg = lerConfig();
    if (!cfg || !cfg.host) throw new Error("SMTP nao configurado");
    transp = obterTransporterPadrao();
    if (!transp) throw new Error("Transporter nao disponivel");
  }
  return transp.sendMail({
    from: remetenteValido(cfg),
    to: Array.isArray(para) ? para.join(", ") : para,
    subject: assunto,
    html: html,
    text: texto || (html ? html.replace(/<[^>]+>/g, "") : ""),
  });
}

async function enviarEmailTeste(paraEspecifico, override) {
  const cfg = override && override.host ? override : lerConfig();
  if (!cfg || !cfg.host) {
    throw new Error("SMTP não configurado — preencha os campos primeiro");
  }
  if (cfg.usuario && !cfg.senha) {
    throw new Error(
      "Senha SMTP em branco. Preencha o campo Senha (para Gmail, use uma senha de aplicativo)."
    );
  }
  const destino = paraEspecifico || remetenteValido(cfg);
  if (!destino) {
    throw new Error("Sem destinatário (informe um email no campo de teste ou no remetente/usuário)");
  }
  return enviarEmail({
    para: destino,
    assunto: "Teste de email - Monitoramento de Servidores",
    html:
      "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px'>" +
        "<h2 style='color:#4f8bff'>Teste de email</h2>" +
        "<p>Se você está lendo essa mensagem, a configuração SMTP está funcionando corretamente.</p>" +
        "<p style='color:#666;font-size:0.9em'>Enviado por <strong>Monitoramento de Servidores</strong> em " + new Date().toLocaleString("pt-BR") + "</p>" +
      "</div>",
    override,
  });
}

// Template de email para mudanca de status de servidor
function gerarHtmlAlertaServidor({ servidor, statusNovo, host, porta, tipo, tempoMs, mensagem }) {
  const ehOffline = statusNovo === "offline";
  const cor = ehOffline ? "#dc2626" : "#16a34a";
  const corBg = ehOffline ? "#fef2f2" : "#f0fdf4";
  const corBorda = ehOffline ? "#fecaca" : "#bbf7d0";
  const titulo = ehOffline ? "Servidor FORA do ar" : "Servidor VOLTOU online";
  const emoji = ehOffline ? "🔴" : "🟢";
  const portaTxt = porta ? ":" + porta : "";
  const dt = new Date().toLocaleString("pt-BR");
  return (
    "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;background:#f6f8fc'>" +
      "<div style='background:" + cor + ";color:#fff;padding:20px 24px;border-radius:8px 8px 0 0'>" +
        "<h2 style='margin:0;font-size:22px'>" + emoji + " " + titulo + "</h2>" +
      "</div>" +
      "<div style='background:#fff;padding:24px;border:1px solid " + corBorda + ";border-top:0;border-radius:0 0 8px 8px'>" +
        "<p style='margin:0 0 18px;font-size:15px'>O servidor abaixo mudou de status:</p>" +
        "<div style='background:" + corBg + ";border:1px solid " + corBorda + ";border-radius:6px;padding:16px;margin-bottom:18px'>" +
          "<table style='width:100%;font-size:14px;color:#333;border-collapse:collapse'>" +
            "<tr><td style='padding:6px 0;color:#666;width:35%'><strong>Nome:</strong></td><td style='padding:6px 0'>" + escaparHtml(servidor) + "</td></tr>" +
            "<tr><td style='padding:6px 0;color:#666'><strong>Host:</strong></td><td style='padding:6px 0;font-family:monospace'>" + escaparHtml(host + portaTxt) + "</td></tr>" +
            "<tr><td style='padding:6px 0;color:#666'><strong>Tipo:</strong></td><td style='padding:6px 0'>" + (tipo || "ping").toUpperCase() + "</td></tr>" +
            "<tr><td style='padding:6px 0;color:#666'><strong>Status:</strong></td><td style='padding:6px 0;color:" + cor + ";font-weight:bold;text-transform:uppercase'>" + statusNovo + "</td></tr>" +
            (tempoMs != null ? "<tr><td style='padding:6px 0;color:#666'><strong>Resposta:</strong></td><td style='padding:6px 0'>" + tempoMs + " ms</td></tr>" : "") +
            (mensagem ? "<tr><td style='padding:6px 0;color:#666'><strong>Detalhe:</strong></td><td style='padding:6px 0'>" + escaparHtml(mensagem) + "</td></tr>" : "") +
            "<tr><td style='padding:6px 0;color:#666'><strong>Horário:</strong></td><td style='padding:6px 0'>" + dt + "</td></tr>" +
          "</table>" +
        "</div>" +
        "<p style='margin:0;font-size:13px;color:#666'>Você está recebendo este alerta porque foi associado como monitorador deste servidor no sistema <strong>Monitoramento de Servidores</strong>.</p>" +
      "</div>" +
    "</div>"
  );
}

// Template de email para recuperacao de senha
function gerarHtmlRecuperacaoSenha({ nome, link, validadeHoras }) {
  return (
    "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;background:#f6f8fc'>" +
      "<div style='background:linear-gradient(135deg,#4f8bff,#3b76eb);color:#fff;padding:24px;border-radius:8px 8px 0 0'>" +
        "<h2 style='margin:0;font-size:22px'>🔐 Recuperação de senha</h2>" +
      "</div>" +
      "<div style='background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px'>" +
        "<p style='margin:0 0 16px;font-size:15px'>Olá <strong>" + escaparHtml(nome) + "</strong>,</p>" +
        "<p style='margin:0 0 20px;font-size:15px'>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Monitoramento de Servidores</strong>. Clique no botão abaixo para criar uma nova senha:</p>" +
        "<p style='text-align:center;margin:24px 0'>" +
          "<a href='" + link + "' style='display:inline-block;background:#4f8bff;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-weight:600;font-size:15px'>Redefinir minha senha</a>" +
        "</p>" +
        "<p style='margin:20px 0 8px;font-size:13px;color:#666'>Ou copie e cole esse link no navegador:</p>" +
        "<p style='font-size:12px;color:#4f8bff;word-break:break-all;background:#f1f4f9;padding:10px 12px;border-radius:4px'>" + escaparHtml(link) + "</p>" +
        "<div style='border-top:1px solid #e2e8f0;margin-top:24px;padding-top:16px;font-size:13px;color:#666'>" +
          "<p style='margin:0 0 8px'><strong>Importante:</strong></p>" +
          "<ul style='margin:0;padding-left:20px;line-height:1.7'>" +
            "<li>Este link expira em <strong>" + (validadeHoras || 1) + " hora" + ((validadeHoras || 1) > 1 ? "s" : "") + "</strong>.</li>" +
            "<li>Se você não solicitou essa recuperação, pode ignorar este email.</li>" +
            "<li>Sua senha atual continua válida até você criar uma nova.</li>" +
          "</ul>" +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

function escaparHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

module.exports = {
  lerConfig,
  salvarConfig,
  estaConfigurado,
  enviarEmail,
  enviarEmailTeste,
  gerarHtmlAlertaServidor,
  gerarHtmlRecuperacaoSenha,
};
