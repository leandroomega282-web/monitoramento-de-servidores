// Pacote de icones SVG inline (estilo heroicons / outline)
// Uso: <i class="icone" data-icone="server"></i>  ou  icones.html('server', 'icone-lg')
(function () {
    "use strict";

    var ICONES = {
        logo:
            '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>' +
            '<path stroke-linecap="round" stroke-linejoin="round" d="M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.3 5.3a9 9 0 000 13.4M18.7 5.3a9 9 0 010 13.4"/>',
        servidor:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M5 12H4a1 1 0 01-1-1V5a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-1M5 12h14M5 12v8a1 1 0 001 1h12a1 1 0 001-1v-8M7 8h.01M7 16h.01"/>',
        usuarios:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H2v-2a4 4 0 014-4h4a4 4 0 014 4v2zM12 11a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6 3 3 0 000 6z"/>',
        painel:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>',
        sair:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>',
        sol:
            '<circle cx="12" cy="12" r="4"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/>',
        lua:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
        som_on:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M11 5L6 9H2v6h4l5 4V5zm4.54 1.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14"/>',
        som_off:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6m0-6l6 6"/>',
        refresh:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582a8 8 0 0114.95 2M20 20v-5h-.581a8 8 0 01-14.95-2"/>',
        adicionar:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m-7-7h14"/>',
        chave:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>',
        cadeado:
            '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0110 0v4"/>',
        olho:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
        olho_fechado:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/>',
        copiar:
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
        check:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M20 6L9 17l-5-5"/>',
        info:
            '<circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 16v-4M12 8h.01"/>',
        aviso:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/>',
        erro:
            '<circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 9l-6 6M9 9l6 6"/>',
        ok:
            '<circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/>',
        excluir:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>',
        pausa:
            '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
        play:
            '<path d="M5 3l14 9-14 9V3z"/>',
        usuario:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        configuracoes:
            '<circle cx="12" cy="12" r="3"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
        atividade:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
        logs:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path stroke-linecap="round" stroke-linejoin="round" d="M14 2v6h6M8 13h8M8 17h5"/>',
        filtro:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M3 4h18l-7 9v6l-4 2v-8L3 4z"/>',
        salvar:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>' +
            '<polyline stroke-linecap="round" stroke-linejoin="round" points="17 21 17 13 7 13 7 21"/>' +
            '<polyline stroke-linecap="round" stroke-linejoin="round" points="7 3 7 8 15 8"/>',
        vinculo:
            '<path stroke-linecap="round" stroke-linejoin="round" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>' +
            '<path stroke-linecap="round" stroke-linejoin="round" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',
    };

    function svg(nome, classe) {
        var conteudo = ICONES[nome] || "";
        var cls = "icone" + (classe ? " " + classe : "");
        return (
            '<svg class="' + cls + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
            'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            conteudo +
            "</svg>"
        );
    }

    function renderizar(escopo) {
        var raiz = escopo || document;
        raiz.querySelectorAll("[data-icone]").forEach(function (el) {
            if (el.dataset.iconeRenderizado) return;
            var nome = el.dataset.icone;
            var classe = el.dataset.iconeClasse || "";
            el.innerHTML = svg(nome, classe);
            el.dataset.iconeRenderizado = "1";
        });
    }

    window.icones = { svg: svg, renderizar: renderizar, lista: ICONES };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { renderizar(); });
    } else {
        renderizar();
    }
})();
