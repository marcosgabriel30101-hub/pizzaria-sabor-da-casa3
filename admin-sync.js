/* Cardápio sempre gerado pelo banco de dados; sem cartões HTML duplicados. */
(async () => {
  const categories = {'catalogo30.html':'30cm','catalogo35.html':'35cm','mini.html':'mini','bebidas.html':'bebidas','promocoes.html':'promocoes'};
  const category = categories[location.pathname.split('/').pop()];
  if (!category) return;
  const catalog = document.querySelector('.catalogo-pizzas');
  if (!catalog) return;
  const message = (text) => { catalog.replaceChildren(); const el=document.createElement('p');el.className='catalog-message';el.textContent=text;catalog.append(el); };
  try {
    const response = await fetch('/api/public/products', {cache:'no-store'});
    if (!response.ok) throw new Error('HTTP '+response.status);
    const products = await response.json();
    if (!Array.isArray(products)) throw new Error('Resposta inesperada');
    const items = products.filter(p => p.category === category && p.active);
    catalog.replaceChildren();
    if (!items.length) { message('Nenhum produto disponível nesta categoria no momento.'); return; }
    const money = n => Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    for (const product of items) {
      const card=document.createElement('article');card.className='pizza-card';card.dataset.productId=product.id;
      const img=document.createElement('img');img.src=product.image||'';img.alt=product.name;img.loading='lazy';
      const info=document.createElement('div');info.className='pizza-info';
      const title=document.createElement('h2');title.textContent=product.name;
      const desc=document.createElement('p');desc.textContent=product.description||'';
      const price=document.createElement('h3');price.textContent=money(product.price);
      const button=document.createElement('button');button.type='button';
      const icon=document.createElement('i');icon.className='fa-solid fa-cart-plus';
      button.append(icon,document.createTextNode(' Adicionar'));
      button.addEventListener('click',()=>{
        if(typeof window.abrirAdicionais==='function')window.abrirAdicionais(product.name+' '+category,Number(product.price));
        else alert('Carrinho indisponível. Atualize a página.');
      });
      info.append(title,desc,price,button);card.append(img,info);catalog.append(card);
    }
  } catch(err) {
    console.error('Erro ao carregar produtos',err);
    message('Não foi possível carregar o cardápio. Atualize a página ou tente novamente mais tarde.');
  }
})();
