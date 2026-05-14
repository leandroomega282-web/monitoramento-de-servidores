"use strict";

// =========================================================================
// Utilitarios reutilizaveis: modal de confirmacao, notificações do navegador,
// toggle de senha e atalhos de teclado.
// =========================================================================

(function () {
    // ----------------- Confirmacao customizada -----------------
    // Uso: await utils.confirmar({titulo, mensagem, textoOk, textoCancelar, perigo})

    function confirmar(opcoes) {
        opcoes = opcoes || {};
        var titulo = opcoes.titulo || "Confirmar";
        var mensagem = opcoes.mensagem || "Tem certeza?";
        var textoOk = opcoes.textoOk || "Confirmar";
        var textoCancelar = opcoes.textoCancelar || "Cancelar";
        var perigo = !!opcoes.perigo;

        return new Promise(function (resolve) {
            var overlay = document.createElement("div");
            overlay.className = "modal-fundo";
            overlay.innerHTML =
                '<div class="modal" role="dialog" aria-modal="true">' +
                    '<h2>' + (window.icones ? window.icones.svg(perigo ? "aviso" : "info") : "") + " " + escaparHTML(titulo) + "</h2>" +
                    '<p style="color:var(--texto-fraco);margin:8px 0 20px">' + escaparHTML(mensagem) + "</p>" +
                    '<div class="acoes">' +
                        '<button type="button" class="btn" data-acao="cancelar">' + escaparHTML(textoCancelar) + "</button>" +
                        '<button type="button" class="btn ' + (perigo ? "btn-perigo-solid" : "btn-primario") + '" data-acao="ok">' + escaparHTML(textoOk) + "</button>" +
                    "</div>" +
                "</div>";
            document.body.appendChild(overlay);
            if (window.icones) window.icones.renderizar(overlay);

            function fechar(resultado) {
                overlay.remove();
                document.removeEventListener("keydown", onKey);
                resolve(resultado);
            }
            function onKey(e) {
                if (e.key === "Escape") fechar(false);
                else if (e.key === "Enter") fechar(true);
            }

            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) fechar(false);
                var acao = e.target.closest("[data-acao]");
                if (!acao) return;
                fechar(acao.dataset.acao === "ok");
            });
            document.addEventListener("keydown", onKey);

            setTimeout(function () {
                var btnOk = overlay.querySelector('[data-acao="ok"]');
                if (btnOk) btnOk.focus();
            }, 50);
        });
    }

    // ----------------- Prompt customizado (substitui prompt() nativo) -----------------
    // Uso: await utils.solicitar({titulo, mensagem, label, tipo:'password'|'text', minLength, textoOk})
    // Retorna a string digitada ou null se cancelar.

    function solicitar(opcoes) {
        opcoes = opcoes || {};
        var titulo = opcoes.titulo || "Informar valor";
        var mensagem = opcoes.mensagem || "";
        var label = opcoes.label || "Valor";
        var tipo = opcoes.tipo || "text";
        var minLength = opcoes.minLength || 0;
        var textoOk = opcoes.textoOk || "Confirmar";
        var textoCancelar = opcoes.textoCancelar || "Cancelar";
        var placeholder = opcoes.placeholder || "";
        var iconeMod = opcoes.icone || (tipo === "password" ? "cadeado" : "info");

        return new Promise(function (resolve) {
            var overlay = document.createElement("div");
            overlay.className = "modal-fundo";
            overlay.innerHTML =
                '<div class="modal" role="dialog" aria-modal="true" style="max-width:440px">' +
                    '<h2>' + (window.icones ? window.icones.svg(iconeMod) : "") + " " + escaparHTML(titulo) + "</h2>" +
                    (mensagem ? '<p style="color:var(--texto-fraco);margin:8px 0 14px;font-size:0.92rem">' + escaparHTML(mensagem) + "</p>" : "") +
                    '<label style="display:flex;flex-direction:column;gap:6px;font-size:0.9rem">' +
                        '<span style="color:var(--texto-fraco);font-size:0.82rem;font-weight:500">' + escaparHTML(label) + "</span>" +
                        '<input type="' + (tipo === "password" ? "password" : "text") + '" ' +
                            (placeholder ? 'placeholder="' + escaparHTML(placeholder) + '" ' : "") +
                            (minLength ? 'minlength="' + minLength + '" ' : "") +
                            'data-input ' +
                            'style="background:var(--bg);border:1px solid var(--borda);color:var(--texto);padding:10px 13px;border-radius:6px;font-size:0.95rem;font-family:inherit;width:100%">' +
                    "</label>" +
                    '<p data-erro style="color:var(--erro);font-size:0.85rem;margin:6px 0 0;display:none"></p>' +
                    '<div class="acoes">' +
                        '<button type="button" class="btn" data-acao="cancelar">' + escaparHTML(textoCancelar) + "</button>" +
                        '<button type="button" class="btn btn-primario" data-acao="ok">' + escaparHTML(textoOk) + "</button>" +
                    "</div>" +
                "</div>";
            document.body.appendChild(overlay);
            if (window.icones) window.icones.renderizar(overlay);

            var input = overlay.querySelector("[data-input]");
            var erro = overlay.querySelector("[data-erro]");

            function fechar(resultado) {
                overlay.remove();
                document.removeEventListener("keydown", onKey);
                resolve(resultado);
            }
            function confirmar() {
                var v = input.value;
                if (minLength && v.length < minLength) {
                    erro.style.display = "block";
                    erro.textContent = "Mínimo " + minLength + " caracteres.";
                    input.focus();
                    return;
                }
                fechar(v);
            }
            function onKey(e) {
                if (e.key === "Escape") fechar(null);
                else if (e.key === "Enter") {
                    e.preventDefault();
                    confirmar();
                }
            }
            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) fechar(null);
                var acao = e.target.closest("[data-acao]");
                if (!acao) return;
                if (acao.dataset.acao === "ok") confirmar();
                else fechar(null);
            });
            document.addEventListener("keydown", onKey);
            setTimeout(function () { input.focus(); }, 50);
        });
    }

    // ----------------- Notificações do navegador -----------------

    function podeNotificar() {
        return "Notification" in window;
    }

    function permissaoNotificacao() {
        return podeNotificar() ? Notification.permission : "denied";
    }

    async function pedirPermissaoNotificacao() {
        if (!podeNotificar()) return "denied";
        if (Notification.permission === "default") {
            try { return await Notification.requestPermission(); }
            catch (e) { return "denied"; }
        }
        return Notification.permission;
    }

    function notificar(titulo, opcoes) {
        if (!podeNotificar() || Notification.permission !== "granted") return null;
        if (document.visibilityState === "visible" && !opcoes.forcar) return null;
        try {
            var n = new Notification(titulo, {
                body: opcoes.corpo || "",
                icon: opcoes.icone || "/assets/favicon-notif.svg",
                tag: opcoes.tag || "rastreio",
                requireInteraction: !!opcoes.persistente,
            });
            n.onclick = function () {
                window.focus();
                n.close();
            };
            return n;
        } catch (e) {
            console.warn("Falha ao notificar:", e);
            return null;
        }
    }

    // ----------------- Toggle de senha (mostrar/ocultar) -----------------
    // Marca campos <input type=password> com [data-toggle-senha] para receberem o botao.

    function inicializarTogglesSenha(escopo) {
        var raiz = escopo || document;
        raiz.querySelectorAll("input[type=password][data-toggle-senha]").forEach(function (input) {
            if (input.dataset.toggleRenderizado) return;
            var wrapper = document.createElement("div");
            wrapper.className = "campo-senha";
            input.parentNode.insertBefore(wrapper, input);
            wrapper.appendChild(input);

            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "toggle-senha";
            btn.tabIndex = -1;
            btn.title = "Mostrar/ocultar senha";
            btn.innerHTML = window.icones ? window.icones.svg("olho", "icone-sm") : "?";
            wrapper.appendChild(btn);

            btn.addEventListener("click", function () {
                var mostrar = input.type === "password";
                input.type = mostrar ? "text" : "password";
                btn.innerHTML = window.icones
                    ? window.icones.svg(mostrar ? "olho_fechado" : "olho", "icone-sm")
                    : "?";
            });
            input.dataset.toggleRenderizado = "1";
        });
    }

    // ----------------- Atalhos de teclado globais -----------------
    // Registra handlers em uma tecla. Ignora se o foco esta em input/textarea.

    function registrarAtalho(tecla, acao, descricao) {
        document.addEventListener("keydown", function (e) {
            var alvo = e.target;
            if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key.toLowerCase() === tecla.toLowerCase()) {
                e.preventDefault();
                acao();
            }
        });
        utils._atalhos.push({ tecla: tecla, descricao: descricao || "" });
    }

    // ----------------- Helpers -----------------
    function escaparHTML(s) {
        if (s == null) return "";
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
        });
    }

    // ----------------- Loading state em botoes -----------------
    // Uso: utils.botaoCarregando(btn, true)  -> mostra spinner, desabilita
    //      utils.botaoCarregando(btn, false) -> restaura
    function botaoCarregando(btn, ativando) {
        if (!btn) return;
        if (ativando) {
            if (btn.dataset.htmlOriginal !== undefined) return; // já ativo
            btn.dataset.htmlOriginal = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add("btn-carregando");
            var ico = window.icones ? window.icones.svg("refresh") : "";
            btn.innerHTML = '<span class="girando" style="display:inline-flex">' + ico + '</span> <span>Aguarde...</span>';
        } else {
            if (btn.dataset.htmlOriginal === undefined) return;
            btn.innerHTML = btn.dataset.htmlOriginal;
            delete btn.dataset.htmlOriginal;
            btn.disabled = false;
            btn.classList.remove("btn-carregando");
        }
    }

    // ----------------- Validacao de senhas que conferem (tempo real) -----------------
    // Uso: utils.validarSenhasConferem(inputSenha, inputConfirmacao)
    // Adiciona um indicador "<small>" abaixo do segundo campo com cor verde/vermelha.
    function validarSenhasConferem(inputSenha, inputConfirm) {
        if (!inputSenha || !inputConfirm) return;
        var indicador = document.createElement("small");
        indicador.className = "indicador-senha-match";
        indicador.style.display = "none";
        inputConfirm.parentNode.appendChild(indicador);

        function atualizar() {
            var s = inputSenha.value;
            var c = inputConfirm.value;
            if (!c) {
                indicador.style.display = "none";
                inputConfirm.classList.remove("input-ok", "input-erro");
                return;
            }
            if (s === c) {
                indicador.style.display = "block";
                indicador.textContent = "✓ As senhas conferem";
                indicador.style.color = "var(--ok)";
                inputConfirm.classList.remove("input-erro");
                inputConfirm.classList.add("input-ok");
            } else {
                indicador.style.display = "block";
                indicador.textContent = "✗ As senhas não conferem";
                indicador.style.color = "var(--erro)";
                inputConfirm.classList.remove("input-ok");
                inputConfirm.classList.add("input-erro");
            }
        }
        inputSenha.addEventListener("input", atualizar);
        inputConfirm.addEventListener("input", atualizar);
    }

    // Envolve uma promise de submit, gerenciando loading state automaticamente
    function submitComLoading(btn, executor) {
        botaoCarregando(btn, true);
        return Promise.resolve()
            .then(executor)
            .finally(function () { botaoCarregando(btn, false); });
    }

    var utils = {
        confirmar: confirmar,
        solicitar: solicitar,
        podeNotificar: podeNotificar,
        permissaoNotificacao: permissaoNotificacao,
        pedirPermissaoNotificacao: pedirPermissaoNotificacao,
        notificar: notificar,
        inicializarTogglesSenha: inicializarTogglesSenha,
        registrarAtalho: registrarAtalho,
        escaparHTML: escaparHTML,
        botaoCarregando: botaoCarregando,
        submitComLoading: submitComLoading,
        validarSenhasConferem: validarSenhasConferem,
        _atalhos: [],
    };
    window.utils = utils;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { inicializarTogglesSenha(); });
    } else {
        inicializarTogglesSenha();
    }
})();
