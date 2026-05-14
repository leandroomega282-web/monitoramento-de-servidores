// Controle de tema claro/escuro.
// Aplicado IMEDIATAMENTE (antes do <body> renderizar) para evitar piscar.
(function () {
    "use strict";

    // Aplica o tema salvo (ou escuro por padrao) IMEDIATAMENTE
    var salvo = localStorage.getItem("tema") || "escuro";
    document.documentElement.setAttribute("data-tema", salvo);

    function temaAtual() {
        return document.documentElement.getAttribute("data-tema") || "escuro";
    }

    function aplicar(tema) {
        document.documentElement.setAttribute("data-tema", tema);
        localStorage.setItem("tema", tema);
    }

    // Funcao global usada pelos botoes
    window.alternarTema = function () {
        aplicar(temaAtual() === "escuro" ? "claro" : "escuro");
    };
})();
