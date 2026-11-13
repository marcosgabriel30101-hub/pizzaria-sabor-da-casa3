const $ = (s) => document.querySelector(s);
const money = n => Number(n || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date = s => new Date(s).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
let products=[], orders=[];
async function api(url, options={}) {
  const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data= response.status===204 ? {} : await response.json().catch(()=>({}));
  if(response.status===401){showLogin();throw new Error(data.error||'Sessão encerrada.');}
  if(!response.ok) throw new Error(data.error||'Não foi possível concluir a operação.');
  return data;
}
function showLogin(){ $('#appView').hidden=true; $('#loginView').hidden=false; }
function showApp(user){ $('#loginView').hidden=true; $('#appView').hidden=false; $('#adminName').textContent=user||'Admin'; loadAll(); }
$('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault(); $('#loginError').textContent='';
 const form=new FormData(e.currentTarget);
 try {const r=await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:form.get('username'),password:form.get('password')})});showApp(r.username);}
 catch(err){$('#loginError').textContent=err.message;}
});
async function boot(){try{const me=await api('/api/admin/me');showApp(me.username);}catch(_){showLogin();}}
async function loadAll(){await Promise.all([loadDashboard(),loadOrders(),loadProducts(),loadSettings()]);}
async function loadDashboard(){
 try{
  const d=await api('/api/admin/dashboard');
  $('#statOrders').textContent=d.totalOrders;$('#statPending').textContent=d.pendingOrders;
  $('#statProducts').textContent=d.activeProducts;$('#statProductsSub').textContent=`${d.activeProducts} de ${d.totalProducts} disponíveis`;
  $('#statSales').textContent=money(d.sales);$('#pendingBadge').textContent=d.pendingOrders||'';
 }catch(e){console.error(e);}
}
async function loadOrders(){
 try{orders=await api('/api/admin/orders');renderOrders();renderRecent();}
 catch(e){$('#ordersList').innerHTML=`<p class="empty">${e.message}</p>`;}
}
function orderMarkup(o,compact=false){
 const customer=o.customer||{}, items=o.items||[];
 return `<div class="order-card">
  <div class="order-top"><div><b>Pedido #${o.id}</b><small>${date(o.createdAt)}</small></div><span class="status status-${o.status.toLowerCase().replaceAll(' ','-')}">${o.status}</span></div>
  <div class="order-customer"><b>${esc(customer.name||'Cliente não informado')}</b><span>${esc(customer.phone||'')}</span></div>
  <div class="order-items">${items.map(i=>`<div><span>${Number(i.quantity)}× ${esc(i.name)}</span><b>${money(i.quantity*i.unitPrice)}</b></div>`).join('')}</div>
  <div class="order-bottom"><div><small>Total do pedido</small><strong>${money(o.total)}</strong></div>${compact?'':`<label class="status-select-label">Atualizar status<select data-order-status="${o.id}">${['Novo','Em preparo','Saiu para entrega','Concluído','Cancelado'].map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}</select></label>`}</div>
  ${compact?'':`<details><summary>Dados de entrega e observações</summary><p>${esc([customer.street,customer.number,customer.neighborhood,customer.complement].filter(Boolean).join(', ')||'Endereço não informado')}</p><p>${esc(customer.notes||'Sem observações')}</p><p>Pagamento: ${esc(o.payment||'Não informado')} ${o.changeFor?`• Troco para ${money(o.changeFor)}`:''}</p></details>`}
 </div>`;
}
function renderOrders(){ $('#ordersList').innerHTML=orders.length?`<div class="orders-grid">${orders.map(o=>orderMarkup(o)).join('')}</div>`:'<div class="empty">Ainda não há pedidos registrados.</div>'; }
function renderRecent(){ $('#recentOrders').innerHTML=orders.length?orders.slice(0,4).map(o=>orderMarkup(o,true)).join(''):'<div class="empty">Nenhum pedido recebido ainda.</div>'; }
async function loadProducts(){try{products=await api('/api/admin/products');renderProducts();}catch(e){$('#productsList').textContent=e.message;}}
function renderProducts(){
 const q=$('#productSearch').value.toLocaleLowerCase('pt-BR'), cat=$('#categoryFilter').value;
 const list=products.filter(p=>(!cat||p.category===cat)&&`${p.name} ${p.description}`.toLocaleLowerCase('pt-BR').includes(q));
 $('#productsList').innerHTML=list.length?list.map(p=>`<article class="product-card">
  <div class="product-image">${p.image?`<img src="../${esc(p.image)}" alt="${esc(p.name)}" onerror="this.style.display='none'">`:'🍕'}</div>
  <div class="product-body"><div class="product-line"><span class="category-tag">${categoryName(p.category)}</span><span class="availability ${p.active?'available':'unavailable'}">${p.active?'Disponível':'Indisponível'}</span></div>
  <h3>${esc(p.name)}</h3><p>${esc(p.description||'Sem descrição')}</p><strong>${money(p.price)}</strong>
  <div class="product-actions"><button class="secondary" data-edit="${esc(p.id)}">Editar</button><button class="secondary" data-toggle="${esc(p.id)}">${p.active?'Pausar':'Ativar'}</button><button class="secondary" data-delete="${esc(p.id)}">Excluir</button></div></div></article>`).join(''):'<div class="empty">Nenhum produto encontrado.</div>';
}
function categoryName(c){return ({'30cm':'Pizza 30 cm','35cm':'Pizza 35 cm',mini:'Mini pizza',bebidas:'Bebidas',promocoes:'Promoções'})[c]||c;}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.goto)));
function switchView(name){document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));document.querySelectorAll('.view').forEach(v=>v.hidden=true);$(`#${name}View`).hidden=false;$('#pageTitle').textContent=({overview:'Visão geral',orders:'Pedidos',products:'Produtos',reports:'Relatórios mensais',settings:'Dados da pizzaria'})[name];}
$('#refreshOrders').addEventListener('click',loadOrders);
$('#productSearch').addEventListener('input',renderProducts);$('#categoryFilter').addEventListener('change',renderProducts);
$('#productsList').addEventListener('click',async e=>{
 const edit=e.target.closest('[data-edit]'),toggle=e.target.closest('[data-toggle]'),del=e.target.closest('[data-delete]');
 if(edit){const p=products.find(x=>x.id===edit.dataset.edit);openProduct(p);}
 if(del){const p=products.find(x=>x.id===del.dataset.delete);if(p&&confirm(`Excluir ${p.name}? O produto deixará de aparecer no cardápio.`)){try{await api(`/api/admin/products/${encodeURIComponent(p.id)}`,{method:'DELETE'});await loadProducts();await loadDashboard();}catch(err){alert(err.message);}}}
 if(toggle){const p=products.find(x=>x.id===toggle.dataset.toggle);try{await api(`/api/admin/products/${encodeURIComponent(p.id)}`,{method:'PUT',body:JSON.stringify({...p,active:!p.active})});await loadProducts();await loadDashboard();}catch(err){alert(err.message);}}
});
$('#ordersList').addEventListener('change',async e=>{
 const id=e.target.dataset.orderStatus;if(!id)return;
 try{await api(`/api/admin/orders/${id}/status`,{method:'PATCH',body:JSON.stringify({status:e.target.value})});await loadOrders();await loadDashboard();}
 catch(err){alert(err.message);}
});
function openProduct(p=null){
 const form=$('#productForm');form.reset();$('#productError').textContent='';
 $('#productDialogTitle').textContent=p?'Editar produto':'Novo produto';
 for(const key of ['id','name','description','price','category','image'])form.elements[key].value=p?.[key]??'';
 form.elements.active.checked=p?p.active:true;
 $('#productDialog').showModal();
}
$('#addProduct').addEventListener('click',()=>openProduct());
$('#closeProduct').addEventListener('click',()=>$('#productDialog').close());
$('#cancelProduct').addEventListener('click',()=>$('#productDialog').close());
$('#productForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget, p=Object.fromEntries(new FormData(f).entries());
 p.price=Number(p.price);p.active=f.elements.active.checked;
 const id=p.id;delete p.id;
 try{await api(id?`/api/admin/products/${encodeURIComponent(id)}`:'/api/admin/products',{method:id?'PUT':'POST',body:JSON.stringify(p)});$('#productDialog').close();await loadProducts();await loadDashboard();}
 catch(err){$('#productError').textContent=err.message;}
});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});}finally{showLogin();}});
boot();

let currentReport=null;
const reportMonth=$('#reportMonth');reportMonth.value=new Date().toISOString().slice(0,7);
$('#expenseForm').elements.date.value=new Date().toISOString().slice(0,10);
async function loadSettings(){try{const d=await api('/api/admin/settings');const f=$('#settingsForm');for(const [k,v] of Object.entries(d)){if(f.elements[k])f.elements[k].value=v;}}catch(e){console.error(e);}}
$('#settingsForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await api('/api/admin/settings',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(f)))});$('#settingsMessage').textContent='Informações salvas! Atualize a loja para ver as mudanças.';}catch(err){$('#settingsMessage').textContent=err.message;}});
async function loadReport(){try{
 const d=await api('/api/admin/report?month='+encodeURIComponent(reportMonth.value));currentReport=d;
 $('#reportOrders').textContent=d.summary.orders;$('#reportSales').textContent=money(d.summary.sales);$('#reportExpenses').textContent=money(d.summary.expenses);$('#reportBalance').textContent=money(d.summary.balance);
 $('#reportProducts').innerHTML=d.products.length?d.products.map(p=>`<div style="padding:12px;border-bottom:1px solid #ddd">${esc(p.name)} — ${p.quantity} unidades — ${money(p.total)}</div>`).join(''):'<p class="empty">Nenhum produto vendido neste mês.</p>';
 $('#expenseList').innerHTML=d.expenses.length?d.expenses.map(x=>`<div style="padding:12px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between">${esc(x.date)} — ${esc(x.description)} — ${money(x.amount)} <button class="secondary" data-remove-expense="${x.id}">Excluir</button></div>`).join(''):'<p class="empty">Nenhuma despesa cadastrada.</p>';
}catch(err){alert(err.message);}}
$('#loadReport').addEventListener('click',loadReport);reportMonth.addEventListener('change',loadReport);
document.querySelector('[data-view="reports"]').addEventListener('click',loadReport);
$('#expenseForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await api('/api/admin/expenses',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});f.elements.description.value='';f.elements.amount.value='';await loadReport();}catch(err){alert(err.message);}});
$('#expenseList').addEventListener('click',async e=>{const b=e.target.closest('[data-remove-expense]');if(!b||!confirm('Excluir esta despesa?'))return;try{await api('/api/admin/expenses/'+b.dataset.removeExpense,{method:'DELETE'});await loadReport();}catch(err){alert(err.message);}});
function csvCell(v){return '"'+String(v??'').replaceAll('"','""')+'"';}
$('#exportReport').addEventListener('click',async()=>{if(!currentReport||currentReport.month!==reportMonth.value)await loadReport();const d=currentReport;if(!d)return;
 const rows=[['Tipo','Data','ID','Descrição / Cliente','Status','Valor (R$)'],...d.orders.map(o=>['Pedido',o.createdAt,o.id,o.customer.name,o.status,o.total]),...d.expenses.map(x=>['Despesa',x.date,x.id,x.description,'',x.amount])];
 const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='relatorio-pizzaria-'+d.month+'.csv';a.click();URL.revokeObjectURL(url);
});
