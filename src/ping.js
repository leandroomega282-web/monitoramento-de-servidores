"use strict";

const { exec } = require("child_process");
const os = require("os");

const HOST_REGEX =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;
const IP_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

/**
 * Valida se o host e um IP ou nome de dominio valido.
 * Bloqueia qualquer caractere que poderia ser usado em command injection.
 */
function hostValido(host) {
  if (typeof host !== "string") return false;
  const h = host.trim();
  if (!h || h.length > 253) return false;
  return IP_REGEX.test(h) || HOST_REGEX.test(h);
}

/**
 * Faz ping ICMP em um host.
 * Retorna Promise<{ online: boolean, tempoMs: number|null }>.
 */
function pingar(host, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!hostValido(host)) {
      return resolve({ online: false, tempoMs: null });
    }

    const ehWindows = os.platform() === "win32";
    let cmd;
    if (ehWindows) {
      // -n 1: 1 pacote, -w timeout em ms
      cmd = `ping -n 1 -w ${timeoutMs} ${host}`;
    } else {
      // -c 1: 1 pacote, -W timeout em segundos
      const seg = Math.max(1, Math.ceil(timeoutMs / 1000));
      cmd = `ping -c 1 -W ${seg} ${host}`;
    }

    const inicio = Date.now();
    exec(
      cmd,
      { timeout: timeoutMs + 2000, windowsHide: true },
      (err, stdout) => {
        const decorrido = Date.now() - inicio;
        if (err) {
          return resolve({ online: false, tempoMs: null });
        }
        // Extrai o tempo da saida do ping (mais preciso que medir o exec)
        const m = stdout.match(/(?:tempo|time)[=<]\s*([0-9]+(?:[.,][0-9]+)?)\s*ms/i);
        const tempoMs = m
          ? Math.round(parseFloat(m[1].replace(",", ".")))
          : decorrido;
        resolve({ online: true, tempoMs });
      }
    );
  });
}

module.exports = { pingar, hostValido };
