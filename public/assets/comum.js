"use strict";

// Helpers compartilhados por todas as páginas autenticadas.

function escapar(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
}

async function iniciarHeader() {
    const est = await fetch("/api/estado").then((r) => r.json()).catch(() => null);
    if (!est || !est.autenticado) {
        location.href = "/login.html";
        return null;
    }
    const nomeEl = document.getElementById("nome-usuario");
    if (nomeEl) nomeEl.textContent = est.usuario.nome;
    if (est.usuario.isAdmin) {
        const t = document.getElementById("tag-admin");
        if (t) t.style.display = "inline-block";
        const l = document.getElementById("link-usuarios");
        if (l) l.style.display = "inline";
    }
    const intervaloEl = document.getElementById("intervalo");
    if (intervaloEl) intervaloEl.textContent = est.intervaloSeg;

    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
        btnLogout.addEventListener("click", async () => {
            await fetch("/api/logout", { method: "POST" });
            location.href = "/login.html";
        });
    }
    return est;
}

// Inicia automaticamente ao carregar
window.estadoAppPromise = iniciarHeader();
