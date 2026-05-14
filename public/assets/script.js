"use strict";

function escapar(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
}

(async function () {
    // ============ Estado inicial e header ============
    const est = await fetch("/api/estado").then((r) => r.json()).catch(() => null);
    if (!est || !est.autenticado) { location.href = "/login.html"; return; }

    document.getElementById("nome-usuario").textContent = est.usuario.nome;
    if (est.usuario.isAdmin) {
        document.getElementById("tag-admin").style.display = "inline-block";
        document.getElementById("link-usuarios").style.display = "inline-flex";
        const lc = document.getElementById("link-config");
        if (lc) lc.style.display = "inline-flex";
    }
    document.getElementById("intervalo").textContent = est.intervaloSeg;

    document.getElementById("btn-logout").addEventListener("click", async () => {
        await fetch("/api/logout", { method: "POST" });
        location.href = "/login.html";
    });

    const intervaloMs = (est.intervaloSeg || 30) * 1000;
    const tituloOriginal = document.title;

    function atualizarTituloAba(qtdOffline) {
        document.title = qtdOffline > 0
            ? "(" + qtdOffline + " offline) " + tituloOriginal
            : tituloOriginal;
    }

    function notificarDesktop(ev) {
        if (!window.utils) return;
        const titulo = ev.statusNovo === "offline" ? "Servidor FORA do ar" : "Servidor VOLTOU online";
        window.utils.notificar(titulo, {
            corpo: ev.mensagem + (ev.servidorHost ? " (" + ev.servidorHost + ")" : ""),
            tag: "servidor-" + ev.servidorId,
            persistente: ev.statusNovo === "offline",
        });
    }

    // Banner para pedir permissao de notificação do navegador
    function mostrarBannerPermissao() {
        if (!window.utils || !window.utils.podeNotificar()) return;
        if (window.utils.permissaoNotificacao() !== "default") return;
        if (sessionStorage.getItem("bannerPermissaoVisto")) return;

        const banner = document.createElement("div");
        banner.className = "banner-permissao";
        banner.innerHTML =
            '<div class="banner-permissao-info">' +
                (window.icones ? window.icones.svg("som_on") : "") +
                "<div><strong>Receba alertas mesmo com o navegador minimizado.</strong>" +
                "<br><small style='color:var(--texto-fraco)'>Permita notificações para ser avisado quando um servidor cair.</small></div>" +
            "</div>" +
            '<div style="display:flex;gap:8px">' +
                '<button type="button" class="btn btn-pequeno" data-acao="dispensar">Agora não</button>' +
                '<button type="button" class="btn btn-primario btn-pequeno" data-acao="permitir">Permitir</button>' +
            "</div>";

        const cont = document.querySelector(".conteudo");
        cont.insertBefore(banner, cont.firstChild);

        banner.addEventListener("click", async (e) => {
            const acao = e.target.closest("[data-acao]");
            if (!acao) return;
            sessionStorage.setItem("bannerPermissaoVisto", "1");
            if (acao.dataset.acao === "permitir") {
                await window.utils.pedirPermissaoNotificacao();
            }
            banner.remove();
        });
    }
    // Mostra o banner depois de 1s
    setTimeout(mostrarBannerPermissao, 1000);

    // Atalhos de teclado
    if (window.utils) {
        window.utils.registrarAtalho("r", () => verificar(), "Verificar agora");
        window.utils.registrarAtalho("t", () => window.alternarTema(), "Alternar tema");
    }

    // ============ Som ============
    let somLigado = localStorage.getItem("somLigado") !== "0";
    let audioCtx = null;

    function atualizarBotaoSom() {
        const txt = document.getElementById("texto-som");
        const ico = document.getElementById("icone-som-btn");
        if (txt) txt.textContent = somLigado ? "Som: ON" : "Som: OFF";
        if (ico && window.icones) {
            ico.dataset.icone = somLigado ? "som_on" : "som_off";
            ico.dataset.iconeRenderizado = "";
            window.icones.renderizar(ico.parentElement);
        }
    }
    // Espera o icones.js carregar para renderizar o icone inicial corretamente
    if (window.icones) atualizarBotaoSom();
    else window.addEventListener("DOMContentLoaded", atualizarBotaoSom);

    document.getElementById("btn-toggle-som").addEventListener("click", () => {
        somLigado = !somLigado;
        localStorage.setItem("somLigado", somLigado ? "1" : "0");
        atualizarBotaoSom();
        inicializarAudio();
        if (somLigado) tocar("online");
    });

    function inicializarAudio() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn("Audio não suportado", e);
            }
        }
        if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    }
    document.addEventListener("click", inicializarAudio, { once: true });

    function tocar(tipo) {
        if (!somLigado || !audioCtx) return;
        const agora = audioCtx.currentTime;

        if (tipo === "offline") {
            // Sirene: 3 ciclos de oscilacao agudo/grave
            for (let i = 0; i < 3; i++) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = "square";
                osc.frequency.setValueAtTime(880, agora + i * 0.4);
                osc.frequency.setValueAtTime(550, agora + i * 0.4 + 0.2);
                gain.gain.setValueAtTime(0.15, agora + i * 0.4);
                gain.gain.exponentialRampToValueAtTime(0.001, agora + i * 0.4 + 0.38);
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(agora + i * 0.4);
                osc.stop(agora + i * 0.4 + 0.4);
            }
        } else {
            // OK: duas notas ascendentes
            [523, 784].forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, agora + i * 0.15);
                gain.gain.setValueAtTime(0.18, agora + i * 0.15);
                gain.gain.exponentialRampToValueAtTime(0.001, agora + i * 0.15 + 0.25);
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(agora + i * 0.15);
                osc.stop(agora + i * 0.15 + 0.25);
            });
        }
    }

    // ============ Toasts ============
    const containerNotif = document.getElementById("notificações");
    const TOASTS_MAX_VISIVEIS = 3;

    function atualizarBotaoLimparToasts() {
        let acoes = containerNotif.querySelector(".toasts-acoes");
        const qtd = containerNotif.querySelectorAll(".toast").length;
        if (qtd >= 2) {
            if (!acoes) {
                acoes = document.createElement("div");
                acoes.className = "toasts-acoes";
                acoes.innerHTML = '<button type="button">Limpar tudo</button>';
                acoes.querySelector("button").addEventListener("click", () => {
                    containerNotif.querySelectorAll(".toast").forEach((t) => t.remove());
                    acoes.remove();
                });
                containerNotif.insertBefore(acoes, containerNotif.firstChild);
            }
        } else if (acoes) {
            acoes.remove();
        }
    }

    function mostrarToast(evento) {
        const tipo = evento.statusNovo;
        const div = document.createElement("div");
        div.className = "toast " + tipo;
        const dt = new Date(evento.criadoEm).toLocaleString("pt-BR");
        div.innerHTML =
            "<strong>" + (tipo === "offline" ? "FORA DO AR" : "VOLTOU ONLINE") + "</strong>" +
            "<div>" + escapar(evento.mensagem) + "</div>" +
            '<span class="hora">' + escapar(dt) + " - " + escapar(evento.servidorHost || "") + "</span>";
        div.addEventListener("click", () => {
            div.remove();
            atualizarBotaoLimparToasts();
        });
        containerNotif.appendChild(div);

        // Cap: remove os mais antigos se passou de 3 visiveis
        const todos = containerNotif.querySelectorAll(".toast");
        if (todos.length > TOASTS_MAX_VISIVEIS) {
            for (let i = 0; i < todos.length - TOASTS_MAX_VISIVEIS; i++) {
                todos[i].remove();
            }
        }
        atualizarBotaoLimparToasts();

        const ttl = tipo === "offline" ? 60000 : 15000;
        setTimeout(() => {
            div.remove();
            atualizarBotaoLimparToasts();
        }, ttl);
    }

    // ============ Renderizacao ============
    const containerTabela = document.getElementById("container-tabela");
    const listaEventos = document.getElementById("lista-eventos");
    const contadorOnline = document.getElementById("contador-online");
    const contadorOffline = document.getElementById("contador-offline");
    const contadorTotal = document.getElementById("contador-total");
    const contadorQuedas = document.getElementById("contador-quedas");

    function renderizarTabela(servidores) {
        if (!servidores || servidores.length === 0) {
            containerTabela.innerHTML =
                '<div class="estado-vazio">' +
                    (window.icones ? window.icones.svg("servidor", "icone-grande") : "") +
                    "<h3>Nenhum servidor cadastrado</h3>" +
                    "<p>Adicione o primeiro servidor para começar a monitorar.</p>" +
                    '<a href="/servidores.html" class="btn btn-primario">' +
                        (window.icones ? window.icones.svg("adicionar") : "") +
                        " Cadastrar servidor" +
                    "</a>" +
                "</div>";
            return;
        }
        let html = '<table class="tabela"><thead><tr>' +
            "<th>Status</th><th>Nome</th><th>Host / IP</th><th>Tempo</th><th>Última verificação</th>" +
            "</tr></thead><tbody>";
        for (const s of servidores) {
            const dt = s.ultimaVerificacao ? new Date(s.ultimaVerificacao).toLocaleString("pt-BR") : "Nunca";
            html += '<tr data-id="' + s.id + '" class="linha-' + s.status + '">' +
                '<td><span class="badge badge-' + s.status + '">' + s.status + "</span></td>" +
                "<td><strong>" + escapar(s.nome) + "</strong></td>" +
                "<td><code>" + escapar(s.host) + "</code></td>" +
                "<td>" + (s.tempoMs != null ? s.tempoMs + " ms" : "-") + "</td>" +
                "<td><small>" + escapar(dt) + "</small></td>" +
                "</tr>";
        }
        html += "</tbody></table>";
        containerTabela.innerHTML = html;
    }

    function renderizarEventos(eventos) {
        if (!eventos || eventos.length === 0) {
            listaEventos.innerHTML =
                '<div class="estado-vazio">' +
                    (window.icones ? window.icones.svg("atividade", "icone-grande") : "") +
                    "<h3>Sem eventos por enquanto</h3>" +
                    "<p>Quando algum servidor cair ou voltar, aparece aqui.</p>" +
                "</div>";
            return;
        }
        let html = '<ul class="eventos">';
        for (const ev of eventos) {
            const dt = new Date(ev.criadoEm).toLocaleString("pt-BR");
            html += '<li class="evento evento-' + ev.statusNovo + '">' +
                '<span class="evento-hora">' + escapar(dt) + "</span>" +
                '<span class="evento-msg">' + escapar(ev.mensagem) + "</span>" +
                "</li>";
        }
        html += "</ul>";
        listaEventos.innerHTML = html;
    }

    // ============ Verificação periodica ============
    let verificando = false;
    let ultimaAtualizacao = null;
    const btnVerificar = document.getElementById("btn-verificar-agora");
    const textoAtualizacao = document.getElementById("texto-atualizacao");

    function tempoRelativo(dt) {
        if (!dt) return "ainda não atualizado";
        const s = Math.floor((Date.now() - dt) / 1000);
        if (s < 2) return "atualizado agora";
        if (s < 60) return "atualizado há " + s + "s";
        const m = Math.floor(s / 60);
        if (m < 60) return "atualizado há " + m + " min";
        const h = Math.floor(m / 60);
        return "atualizado há " + h + "h";
    }

    function atualizarRelativo() {
        if (textoAtualizacao) {
            textoAtualizacao.textContent = tempoRelativo(ultimaAtualizacao);
        }
    }

    async function verificar() {
        if (verificando) return;
        verificando = true;
        btnVerificar.disabled = true;
        btnVerificar.classList.add("girando");
        if (textoAtualizacao) textoAtualizacao.textContent = "atualizando...";
        try {
            const resp = await fetch("/api/verificar", { cache: "no-store" });
            if (resp.status === 401) { location.href = "/login.html"; return; }
            const dados = await resp.json();
            if (!dados.ok) return;

            renderizarTabela(dados.servidores);
            renderizarEventos(dados.eventos);

            contadorOnline.textContent = dados.totais.online;
            contadorOffline.textContent = dados.totais.offline;
            contadorTotal.textContent = dados.totais.total;
            if (contadorQuedas) contadorQuedas.textContent = dados.quedas24h || 0;

            (dados.novosEventos || []).forEach((ev) => {
                mostrarToast(ev);
                tocar(ev.statusNovo);
                notificarDesktop(ev);
            });

            // Destaca linhas que mudaram de status
            (dados.servidores || [])
                .filter((s) => s.mudou)
                .forEach((s) => {
                    const linha = document.querySelector('tr[data-id="' + s.id + '"]');
                    if (linha) {
                        linha.classList.remove("linha-mudou");
                        void linha.offsetWidth; // forca reflow para reiniciar a animacao
                        linha.classList.add("linha-mudou");
                    }
                });

            // Atualiza titulo da aba com contador de offline
            atualizarTituloAba(dados.totais.offline);

            ultimaAtualizacao = Date.now();
            atualizarRelativo();
        } catch (e) {
            console.error("Falha ao verificar:", e);
            if (textoAtualizacao) textoAtualizacao.textContent = "falha na última atualização";
        } finally {
            verificando = false;
            btnVerificar.disabled = false;
            btnVerificar.classList.remove("girando");
        }
    }

    btnVerificar.addEventListener("click", verificar);

    verificar();
    setInterval(verificar, intervaloMs);
    // Atualiza o texto "atualizado ha Xs" a cada segundo
    setInterval(atualizarRelativo, 1000);
})();
