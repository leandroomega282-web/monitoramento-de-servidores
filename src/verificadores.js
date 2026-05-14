"use strict";

const net = require("net");
const http = require("http");
const https = require("https");
const { pingar, hostValido } = require("./ping");

const PORTA_REGEX = /^[0-9]{1,5}$/;

function portaValida(p) {
  if (p == null) return true;
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function tipoValido(tipo) {
  return ["ping", "http", "https", "tcp"].includes(tipo);
}

function verificarTcp(host, porta, timeoutMs) {
  return new Promise((resolve) => {
    if (!hostValido(host) || !portaValida(porta)) {
      return resolve({ online: false, tempoMs: null, mensagem: "Host ou porta inválidos" });
    }
    const inicio = Date.now();
    const socket = new net.Socket();
    let resolvido = false;
    const finalizar = (online, mensagem) => {
      if (resolvido) return;
      resolvido = true;
      socket.destroy();
      resolve({
        online,
        tempoMs: online ? Date.now() - inicio : null,
        mensagem,
      });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finalizar(true, "TCP conectou"));
    socket.once("timeout", () => finalizar(false, "Timeout TCP"));
    socket.once("error", (err) => finalizar(false, "Falha TCP: " + (err.code || err.message || "erro")));
    socket.connect(Number(porta), host);
  });
}

function verificarHttp(host, porta, timeoutMs, ehHttps) {
  return new Promise((resolve) => {
    if (!hostValido(host) || !portaValida(porta)) {
      return resolve({ online: false, tempoMs: null, mensagem: "Host ou porta inválidos" });
    }
    const mod = ehHttps ? https : http;
    const inicio = Date.now();
    const opts = {
      host,
      port: Number(porta) || (ehHttps ? 443 : 80),
      path: "/",
      method: "HEAD",
      timeout: timeoutMs,
      rejectUnauthorized: false,
    };
    const req = mod.request(opts, (resp) => {
      // Servidor respondeu = está vivo. Só 5xx (erro interno) conta como offline.
      // 4xx significa que o servidor está rodando, só não gostou da request.
      const code = resp.statusCode || 0;
      const online = code >= 200 && code < 500;
      resp.resume();
      resolve({
        online,
        tempoMs: Date.now() - inicio,
        codigoHttp: code,
        mensagem: "HTTP " + code,
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ online: false, tempoMs: null, mensagem: "Timeout HTTP" });
    });
    req.on("error", (err) => {
      resolve({ online: false, tempoMs: null, mensagem: "Falha HTTP: " + (err.code || err.message || "erro") });
    });
    req.end();
  });
}

async function verificar(servidor, timeoutMs) {
  const tipo = servidor.tipo || "ping";
  const t = timeoutMs || 3000;
  if (tipo === "ping") {
    const r = await pingar(servidor.host, t);
    return Object.assign({}, r, {
      mensagem: r.online ? "PING OK" : "Sem resposta ao PING",
    });
  }
  if (tipo === "tcp") return verificarTcp(servidor.host, servidor.porta, t);
  if (tipo === "http") return verificarHttp(servidor.host, servidor.porta, t, false);
  if (tipo === "https") return verificarHttp(servidor.host, servidor.porta, t, true);
  return { online: false, tempoMs: null, mensagem: "Tipo desconhecido" };
}

module.exports = {
  verificar,
  hostValido,
  portaValida,
  tipoValido,
  PORTA_REGEX,
};
