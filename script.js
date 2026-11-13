

let carrinho = [];
try {
    const salvo = JSON.parse(localStorage.getItem("carrinho") || "[]");
    carrinho = Array.isArray(salvo) ? salvo.filter(i => i && typeof i.nome === "string" && Number(i.preco) >= 0 && Number(i.quantidade) > 0) : [];
} catch (_) { carrinho = []; }

function escaparHTML(valor) {
    return String(valor).replace(/[&<>"']/g, caractere => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[caractere]);
}

function moeda(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function salvarCarrinho() {
    localStorage.setItem("carrinho", JSON.stringify(carrinho));
}

function abrirCarrinho() {
    document.getElementById("carrinho").classList.add("ativo");
}

function fecharCarrinho() {
    document.getElementById("carrinho").classList.remove("ativo");
}

function adicionarCarrinho(nome, preco) {

    const item = carrinho.find(produto => produto.nome === nome);

    if (item) {
        item.quantidade = Number(item.quantidade) + 1;
    } else {
        carrinho.push({
            nome: nome,
            preco: preco,
            quantidade: 1
        });
    }

    salvarCarrinho();
    atualizarCarrinho();
    abrirCarrinho();
}



function atualizarContadorCarrinho() {
    const quantidade = carrinho.reduce(
        (total, item) => total + Number(item.quantidade || 0),
        0
    );

    document.querySelectorAll(".contador-carrinho").forEach(contador => {
        contador.textContent = quantidade;
        contador.setAttribute("aria-label", `${quantidade} item(ns) no carrinho`);
    });
}

function atualizarCarrinho() {

    atualizarContadorCarrinho();

    const lista = document.getElementById("lista-carrinho");
    const total = document.getElementById("total");

    lista.innerHTML = "";

    if (carrinho.length === 0) {

        lista.innerHTML = "<p>Seu carrinho está vazio.</p>";
        total.innerHTML = "R$ 0,00";
        return;

    }

    let valorTotal = 0;

    carrinho.forEach((item, index) => {

        valorTotal += item.preco * item.quantidade;

        lista.innerHTML += `

        <div class="item-carrinho">

            <div>

                <strong>${escaparHTML(item.nome)}</strong>

                <p>${moeda(item.preco)}</p>

                <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">

                    <button onclick="diminuir(${index})">-</button>

                    <span>${item.quantidade}</span>

                    <button onclick="aumentar(${index})">+</button>

                </div>

            </div>

            <button onclick="removerItem(${index})">
                🗑
            </button>

        </div>

        `;

    });

    total.innerHTML = moeda(valorTotal);

}

function aumentar(index){

    carrinho[index].quantidade++;

    salvarCarrinho();

    atualizarCarrinho();

}

function diminuir(index){

    carrinho[index].quantidade--;

    if(carrinho[index].quantidade <= 0){

        carrinho.splice(index,1);

    }

    salvarCarrinho();

    atualizarCarrinho();

}

function removerItem(index){

    carrinho.splice(index,1);

    salvarCarrinho();

    atualizarCarrinho();

}

function limparCarrinho(){

    carrinho=[];

    salvarCarrinho();

    atualizarCarrinho();

}



function finalizarPedido(){

    if(carrinho.length === 0){

        alert("Seu carrinho está vazio!");

        return;

    }

    abrirPagamento();

}




let pagamentoSelecionado = "";

let trocoSelecionado = "";


// Abrir janela de pagamento

function abrirPagamento(){

    if(carrinho.length === 0){

        alert("Seu carrinho está vazio!");

        return;

    }

    pagamentoSelecionado = "";

    trocoSelecionado = "";

    document.getElementById("valorTroco").value = "";

    document.getElementById("campoTrocoPagamento").style.display = "none";

    document
        .getElementById("janelaPagamento")
        .classList.add("ativo");

}


// Fechar janela

function fecharPagamento(){

    document
        .getElementById("janelaPagamento")
        .classList.remove("ativo");

}


// Escolher pagamento

function selecionarPagamento(tipo){

    pagamentoSelecionado = tipo;

    const botoes =
        document.querySelectorAll(".opcoes-pagamento button");

    botoes.forEach(botao => {

        botao.classList.remove("selecionado");

    });

    const botoesArray = Array.from(botoes);

    const botaoSelecionado =
        botoesArray.find(botao =>
            botao.getAttribute("onclick")?.includes(tipo)
        );

    if(botaoSelecionado){

        botaoSelecionado.classList.add("selecionado");

    }

    if(tipo === "Dinheiro"){

        document.getElementById(
            "campoTrocoPagamento"
        ).style.display = "block";

    }else{

        document.getElementById(
            "campoTrocoPagamento"
        ).style.display = "none";

        document.getElementById(
            "valorTroco"
        ).value = "";

    }

}


// Confirmar pagamento

function confirmarPagamento(){

    if(!pagamentoSelecionado){

        alert("Escolha uma forma de pagamento.");

        return;

    }

    if(pagamentoSelecionado === "Dinheiro"){

        trocoSelecionado =
            document.getElementById("valorTroco").value;

        if(!trocoSelecionado){

            alert("Informe o valor para o troco.");

            return;

        }

    }else{

        trocoSelecionado = "";

    }

    fecharPagamento();

    enviarPedidoWhatsApp();

}




async function enviarPedidoWhatsApp(){

    if(carrinho.length === 0){

        alert("Seu carrinho está vazio!");

        return;

    }

    let mensagem = "🍕 *NOVO PEDIDO*%0A%0A";

    let total = 0;

    carrinho.forEach(item => {

        const subtotal =
            item.preco * item.quantidade;

        total += subtotal;

        mensagem +=
            `• ${escaparHTML(item.nome)}%0A`;

        mensagem +=
            `Quantidade: ${item.quantidade}%0A`;

        mensagem +=
            `Valor: R$ ${subtotal.toFixed(2)}%0A%0A`;

    });


  

    const nome =
        document.getElementById("nomeCliente")?.value || "";

    const telefone =
        document.getElementById("telefoneCliente")?.value || "";

    const rua =
        document.getElementById("ruaCliente")?.value || "";

    const numero =
        document.getElementById("numeroCliente")?.value || "";

    const bairro =
        document.getElementById("bairroCliente")?.value || "";

    const complemento =
        document.getElementById("complementoCliente")?.value || "";

    const observacao =
        document.getElementById("observacaoCliente")?.value || "";


    mensagem += "-------------------------%0A";

    mensagem +=
        `*TOTAL: R$ ${total.toFixed(2)}*%0A%0A`;


    mensagem += "👤 *CLIENTE*%0A";

    if(nome)
        mensagem += `Nome: ${nome}%0A`;

    if(telefone)
        mensagem += `Telefone: ${telefone}%0A`;

    mensagem += "%0A📍 *ENDEREÇO*%0A";

    if(rua)
        mensagem += `Rua: ${rua}%0A`;

    if(numero)
        mensagem += `Número: ${numero}%0A`;

    if(bairro)
        mensagem += `Bairro: ${bairro}%0A`;

    if(complemento)
        mensagem += `Complemento: ${complemento}%0A`;


    mensagem += "%0A💳 *PAGAMENTO*%0A";

    mensagem +=
        `Forma: ${pagamentoSelecionado}%0A`;

    if(pagamentoSelecionado === "Dinheiro"){

        mensagem +=
            `Troco para: R$ ${parseFloat(trocoSelecionado).toFixed(2)}%0A`;

    }


    if(observacao){

        mensagem +=
            `%0A📝 *OBSERVAÇÃO*%0A${observacao}%0A`;

    }


    mensagem += "%0A❤️ Obrigado pela preferência!";


   

    let telefonePizzaria = '';
    try {const r=await fetch('/api/public/settings');if(r.ok)telefonePizzaria=(await r.json()).whatsapp||'';}catch(e){console.warn('Falha ao consultar WhatsApp:',e);}
    if(!telefonePizzaria){alert('WhatsApp da pizzaria não configurado. Entre no painel administrativo > Dados da pizzaria.');return;}



    // Registra o pedido no painel administrativo sem bloquear a abertura do WhatsApp.
    let pedidoRegistrado = false;
    try { const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            items: carrinho.map(item => ({
                name: String(item.nome),
                quantity: Number(item.quantidade),
                unitPrice: Number(item.preco)
            })),
            customer: { name: nome, phone: telefone, street: rua, number: numero,
                neighborhood: bairro, complement: complemento, notes: observacao },
            payment: pagamentoSelecionado,
            changeFor: trocoSelecionado ? Number(trocoSelecionado) : null,
            total: Number(total.toFixed(2))
        })
    });
      if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Erro ao registrar pedido');
      pedidoRegistrado=true;
    }catch(error){console.error(error);alert('Não foi possível salvar o pedido no painel. Verifique sua conexão e tente novamente.');return;}
    if(!pedidoRegistrado)return;

    window.open(
        `https://wa.me/${telefonePizzaria}?text=${mensagem}`,
        "_blank",
        "noopener"
    );

}



let pizzaSelecionada = null;

function abrirAdicionais(nome, preco){

    pizzaSelecionada = {
        nome: nome,
        preco: Number(preco)
    };

    const janela = document.getElementById("adicionais");

    if(janela){

        janela.classList.add("ativo");

    }else{

        // Se a janela não existir, adiciona direto ao carrinho
        adicionarCarrinho(nome, Number(preco));

    }

}


function fecharAdicionais(){

    const janela = document.getElementById("adicionais");

    if(janela){

        janela.classList.remove("ativo");

    }

}


function adicionarComBorda(tipo){

    if(!pizzaSelecionada){

        return;

    }

    let nome = pizzaSelecionada.nome;

    let preco = pizzaSelecionada.preco;


    if(tipo === "catupiry"){

        nome += " + Borda Catupiry";

        preco += 3;

    }


    if(tipo === "cheddar"){

        nome += " + Borda Cheddar";

        preco += 4;

    }


    adicionarCarrinho(nome, preco);

    fecharAdicionais();

    pizzaSelecionada = null;

}


const traducoes = {
    "pt-BR": {
        inicio:"Início",
        catalogo:"Catálogo",
        pizza30:"30 CM",
        pizza35:"35 CM",
        mini:"Mini Pizzas",
        bebidas:"Bebidas",
        promocoes:"Promoções",
        idioma:"Idioma",
        modoNoturno:"Modo noturno",
        modoClaro:"Modo claro"
    },
    "es": {
        inicio:"Inicio",
        catalogo:"Catálogo",
        pizza30:"30 CM",
        pizza35:"35 CM",
        mini:"Mini Pizzas",
        bebidas:"Bebidas",
        promocoes:"Promociones",
        idioma:"Idioma",
        modoNoturno:"Modo nocturno",
        modoClaro:"Modo claro"
    },
    "en": {
        inicio:"Home",
        catalogo:"Menu",
        pizza30:"30 CM",
        pizza35:"35 CM",
        mini:"Mini Pizzas",
        bebidas:"Drinks",
        promocoes:"Promotions",
        idioma:"Language",
        modoNoturno:"Dark mode",
        modoClaro:"Light mode"
    }
};

function alternarMenu(event){
    if(event) event.stopPropagation();

    const menu = document.querySelector(".menu-navegacao");
    if(menu){
        menu.classList.toggle("menu-aberto");
    }
}

document.addEventListener("click", function(event){
    const menu = document.querySelector(".menu-navegacao");
    if(menu && !menu.contains(event.target)){
        menu.classList.remove("menu-aberto");
    }
});

function aplicarIdioma(idioma){
    const idiomaAtual = traducoes[idioma] || traducoes["pt-BR"];

    document.querySelectorAll("[data-i18n]").forEach(elemento => {
        const chave = elemento.getAttribute("data-i18n");
        if(idiomaAtual[chave]){
            elemento.textContent = idiomaAtual[chave];
        }
    });

    const seletor = document.getElementById("seletor-idioma");
    if(seletor) seletor.value = idioma;

    const modoAtivo = document.body.classList.contains("modo-noturno");
    const textoTema = document.getElementById("texto-tema");
    if(textoTema){
        textoTema.textContent = modoAtivo
            ? idiomaAtual.modoClaro
            : idiomaAtual.modoNoturno;
    }
}

function alterarIdioma(idioma){
    localStorage.setItem("idiomaPizzaria", idioma);
    aplicarIdioma(idioma);
}

function alternarModoNoturno(){
    document.body.classList.toggle("modo-noturno");

    const ativo = document.body.classList.contains("modo-noturno");
    localStorage.setItem("modoNoturnoPizzaria", ativo ? "1" : "0");

    const icone = document.getElementById("icone-tema");
    if(icone){
        icone.className = ativo
            ? "fa-solid fa-sun"
            : "fa-solid fa-moon";
    }

    aplicarIdioma(localStorage.getItem("idiomaPizzaria") || "pt-BR");
}

function inicializarInterfacePizzaria(){
    const modoSalvo = localStorage.getItem("modoNoturnoPizzaria") === "1";

    if(modoSalvo){
        document.body.classList.add("modo-noturno");
    }

    const idioma = localStorage.getItem("idiomaPizzaria") || "pt-BR";

    const icone = document.getElementById("icone-tema");
    if(icone){
        icone.className = modoSalvo
            ? "fa-solid fa-sun"
            : "fa-solid fa-moon";
    }

    aplicarIdioma(idioma);
    atualizarContadorCarrinho();
}

if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", inicializarInterfacePizzaria);
}else{
    inicializarInterfacePizzaria();
}
