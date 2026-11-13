require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'pizzaria.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
 price REAL NOT NULL CHECK(price >= 0), category TEXT NOT NULL,
 image TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
 sourcePage TEXT DEFAULT '', updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, items TEXT NOT NULL, customer TEXT NOT NULL,
 payment TEXT DEFAULT '', changeFor REAL, total REAL NOT NULL,
 status TEXT NOT NULL DEFAULT 'Novo', createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
 username TEXT PRIMARY KEY, passwordHash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, amount REAL NOT NULL CHECK(amount >= 0), date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
 sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
`);
const now = () => new Date().toISOString();
const adminUser = process.env.ADMIN_USER || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'SaborCasa@2026');
if (!adminPassword) throw new Error('Configure ADMIN_PASSWORD no Render antes de iniciar.');
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('Configure SESSION_SECRET no Render antes de iniciar.');
const adminExists = db.prepare('SELECT username FROM admins WHERE username = ?').get(adminUser);
if (!adminExists) {
  db.prepare('INSERT INTO admins(username,passwordHash) VALUES(?,?)')
    .run(adminUser, bcrypt.hashSync(adminPassword, 12));
}
if (!db.prepare('SELECT id FROM products LIMIT 1').get()) {
  const seed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.seed.json'), 'utf8'));
  const insert = db.prepare(`INSERT INTO products
    (id,name,description,price,category,image,active,sourcePage,updatedAt)
    VALUES (@id,@name,@description,@price,@category,@image,@active,@sourcePage,@updatedAt)`);
  const tx = db.transaction(rows => rows.forEach(p => insert.run({...p, active: p.active ? 1 : 0, updatedAt: now()})));
  tx(seed);
}

// Correção pontual de cadastros antigos com IDs trocados; preserva alterações feitas pelo administrador.
// Novas instalações recebem diretamente o seed revisado.
const catalogMigrationKey = 'catalog_migration_v3';
if (!db.prepare('SELECT 1 FROM settings WHERE key=?').get(catalogMigrationKey)) {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname,'data','products.seed.json'),'utf8'));
  const byId = new Map(seed.map(p => [p.id,p]));
  const migrate = db.transaction(() => {
    const corrections = [
      ['30cm-romeu-e-julieta','Brigadeiro','30cm-brigadeiro'],
      ['35cm-romeu-e-julieta','Brigadeiro','35cm-brigadeiro'],
      ['35cm-frango-com-catupiry','Romeu e Julieta','35cm-romeu-e-julieta'],
      ['35cm-napolitana-10','Napolitana','35cm-especial-da-casa'],
      ['mini-napolitana-8','Napolitana','mini-presunto']
    ];
    for (const [wrongId, legacyName, correctId] of corrections) {
      const row = db.prepare('SELECT * FROM products WHERE id=?').get(wrongId);
      if (!row || row.name !== legacyName || db.prepare('SELECT 1 FROM products WHERE id=?').get(correctId)) continue;
      const desired = byId.get(correctId);
      if (!desired) continue;
      db.prepare('UPDATE products SET id=?,name=?,description=?,image=?,sourcePage=?,updatedAt=? WHERE id=?')
        .run(correctId,desired.name,desired.description,desired.image,desired.sourcePage,now(),wrongId);
    }
    // Insere somente produtos ausentes do catálogo original; não restaura itens excluídos futuramente.
    for (const product of seed) {
      if (db.prepare('SELECT 1 FROM products WHERE id=?').get(product.id)) continue;
      db.prepare(`INSERT INTO products(id,name,description,price,category,image,active,sourcePage,updatedAt)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(product.id,product.name,product.description,product.price,product.category,product.image,1,product.sourcePage,now());
    }
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(catalogMigrationKey,'done');
  });
  migrate();
}

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render usa proxy HTTPS; necessário para cookies secure
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));
class SqliteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess,expire FROM sessions WHERE sid=?').get(sid);
      if (!row) return callback(null, null);
      if (row.expire <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8*60*60*1000;
      db.prepare('INSERT INTO sessions(sid,sess,expire) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expire=excluded.expire')
        .run(sid, JSON.stringify(sess), expires);
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); callback(null); }
    catch (error) { callback(error); }
  }
  touch(sid, sess, callback = () => {}) { this.set(sid, sess, callback); }
}
app.use(session({
  store: new SqliteSessionStore(),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 *  60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const requireAuth = (req, res, next) => req.session && req.session.admin
  ? next() : res.status(401).json({ error: 'Faça login para continuar.' });
const cleanText = (v, max=500) => String(v ?? '').trim().slice(0,max);
const money = v => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(Number(v).toFixed(2)) : null;

const defaults = {businessName:'Pizzaria Sabor de Casa', whatsapp:process.env.WHATSAPP_NUMBER||'', address:'', openingHours:'', deliveryInfo:'', pixKey:'', instagram:''};
const settingGet = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? defaults[key] ?? '';
const allSettings = () => Object.fromEntries(Object.keys(defaults).map(k=>[k,settingGet(k)]));
app.get('/api/public/settings', (_req,res)=> {
 const {businessName,whatsapp,address,openingHours,deliveryInfo,instagram}=allSettings();
 res.json({businessName,whatsapp,address,openingHours,deliveryInfo,instagram});
});
app.get('/api/admin/settings', requireAuth, (_req,res)=>res.json(allSettings()));
app.put('/api/admin/settings', requireAuth, (req,res)=>{
 const data=req.body||{};
 const save=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
 db.transaction(()=>{for(const key of Object.keys(defaults)){
   if(Object.prototype.hasOwnProperty.call(data,key)){
     let val=cleanText(data[key],300);
     if(key==='whatsapp') {val=val.replace(/\D/g,''); if(val && !/^\d{10,15}$/.test(val)) throw new Error('WhatsApp deve ter DDI, DDD e número (10 a 15 dígitos).');}
     save.run(key,val);
   }
 }})();
 res.json(allSettings());
});
app.get('/api/admin/report', requireAuth, (req,res)=>{
 const month=String(req.query.month||now().slice(0,7));
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({error:'Mês inválido.'});
 const orders=db.prepare('SELECT * FROM orders WHERE substr(createdAt,1,7)=? ORDER BY id DESC').all(month).map(o=>({...o,items:JSON.parse(o.items),customer:JSON.parse(o.customer)}));
 const expenses=db.prepare('SELECT * FROM expenses WHERE substr(date,1,7)=? ORDER BY date DESC,id DESC').all(month);
 const valid=orders.filter(o=>o.status!=='Cancelado');
 const sales=Number(valid.reduce((s,o)=>s+o.total,0).toFixed(2));
 const expenseTotal=Number(expenses.reduce((s,e)=>s+e.amount,0).toFixed(2));
 const products=new Map();
 for(const o of valid) for(const item of o.items){const x=products.get(item.name)||{name:item.name,quantity:0,total:0};x.quantity+=item.quantity;x.total+=item.quantity*item.unitPrice;products.set(item.name,x);}
 res.json({month,orders,expenses,summary:{orders:orders.length,completed:orders.filter(o=>o.status==='Concluído').length,cancelled:orders.filter(o=>o.status==='Cancelado').length,sales,expenses:expenseTotal,balance:Number((sales-expenseTotal).toFixed(2))},products:[...products.values()].sort((a,b)=>b.quantity-a.quantity)});
});
app.post('/api/admin/expenses',requireAuth,(req,res)=>{
 const description=cleanText(req.body?.description,150),amount=money(req.body?.amount),date=String(req.body?.date||'');
 if(!description||amount===null||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))return res.status(400).json({error:'Preencha descrição, valor e data válidos.'});
 const r=db.prepare('INSERT INTO expenses(description,amount,date) VALUES(?,?,?)').run(description,amount,date);res.status(201).json({id:r.lastInsertRowid});
});
app.delete('/api/admin/expenses/:id',requireAuth,(req,res)=>{
 const r=db.prepare('DELETE FROM expenses WHERE id=?').run(Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Despesa não encontrada.'});res.json({ok:true});
});
app.get('/api/health', (_req,res) => res.json({ok:true, service:'Pizzaria Sabor de Casa'}));
app.get('/api/public/products', (_req,res) => {
  const rows = db.prepare('SELECT id,name,description,price,category,image,active FROM products ORDER BY category,name').all();
  res.json(rows.map(p => ({...p, active: !!p.active})));
});
app.post('/api/admin/login', loginLimiter, (req,res) => {
  const username = cleanText(req.body.username,80);
  const password = String(req.body.password || '');
  const admin = db.prepare('SELECT username,passwordHash FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.passwordHash)) {
    return res.status(401).json({error:'Usuário ou senha incorretos.'});
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({error:'Não foi possível iniciar a sessão.'});
    req.session.admin = admin.username;
    res.json({ok:true, username:admin.username});
  });
});
app.post('/api/admin/logout', requireAuth, (req,res) => req.session.destroy(() => res.json({ok:true})));
app.get('/api/admin/me', requireAuth, (req,res) => res.json({username:req.session.admin}));
app.get('/api/admin/dashboard', requireAuth, (_req,res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  const activeProducts = db.prepare('SELECT COUNT(*) n FROM products WHERE active=1').get().n;
  const totalOrders = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  const pendingOrders = db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('Novo','Em preparo')").get().n;
  const sales = db.prepare("SELECT COALESCE(SUM(total),0) total FROM orders WHERE status <> 'Cancelado'").get().total;
  res.json({totalProducts,activeProducts,totalOrders,pendingOrders,sales});
});
app.get('/api/admin/products', requireAuth, (_req,res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY category,name').all().map(p=>({...p,active:!!p.active})));
});
app.post('/api/admin/products', requireAuth, (req,res) => {
  const p=req.body||{}, name=cleanText(p.name,100), category=cleanText(p.category,30);
  const price=money(p.price);
  if(!name || !category || price===null) return res.status(400).json({error:'Informe nome, categoria e preço válido.'});
  const id=cleanText(p.id,100) || `${category}-${crypto.randomUUID().slice(0,8)}`;
  try {
    db.prepare(`INSERT INTO products(id,name,description,price,category,image,active,sourcePage,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id,name,cleanText(p.description,500),price,category,cleanText(p.image,250),p.active===false?0:1,'',now());
    res.status(201).json({ok:true,id});
  } catch(e) { res.status(409).json({error:'Já existe um produto com esse identificador.'}); }
});
app.put('/api/admin/products/:id', requireAuth, (req,res) => {
  const p=req.body||{}, name=cleanText(p.name,100), category=cleanText(p.category,30), price=money(p.price);
  if(!name || !category || price===null) return res.status(400).json({error:'Informe nome, categoria e preço válido.'});
  const result=db.prepare(`UPDATE products SET name=?,description=?,price=?,category=?,image=?,active=?,updatedAt=? WHERE id=?`)
    .run(name,cleanText(p.description,500),price,category,cleanText(p.image,250),p.active===false?0:1,now(),req.params.id);
  if(!result.changes) return res.status(404).json({error:'Produto não encontrado.'});
  res.json({ok:true});
});
app.delete('/api/admin/products/:id', requireAuth, (req,res) => {
  const result=db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  if(!result.changes) return res.status(404).json({error:'Produto não encontrado.'});
  res.json({ok:true});
});
app.get('/api/admin/orders', requireAuth, (_req,res) => {
  const rows=db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all();
  res.json(rows.map(o=>({...o,items:JSON.parse(o.items),customer:JSON.parse(o.customer)})));
});
app.patch('/api/admin/orders/:id/status', requireAuth, (req,res) => {
  const allowed=['Novo','Em preparo','Saiu para entrega','Concluído','Cancelado'];
  const status=cleanText(req.body.status,40);
  if(!allowed.includes(status)) return res.status(400).json({error:'Status inválido.'});
  const result=db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,Number(req.params.id));
  if(!result.changes) return res.status(404).json({error:'Pedido não encontrado.'});
  res.json({ok:true});
});
app.post('/api/orders', (req,res) => {
  const b=req.body||{}, items=Array.isArray(b.items)?b.items.slice(0,40):[];
  if(!items.length) return res.status(400).json({error:'Pedido sem itens.'});
  const normalized=items.map(i=>({name:cleanText(i.name,120),quantity:Math.max(1,Math.min(99,Number(i.quantity)||1)),unitPrice:money(i.unitPrice)}));
  if(normalized.some(i=>!i.name || i.unitPrice===null)) return res.status(400).json({error:'Itens inválidos.'});
  const calculated=Number(normalized.reduce((sum,i)=>sum+i.quantity*i.unitPrice,0).toFixed(2));
  const total=money(b.total);
  if(total===null || Math.abs(total-calculated)>0.02) return res.status(400).json({error:'Total do pedido inválido.'});
  const customer=b.customer||{};
  const result=db.prepare(`INSERT INTO orders(items,customer,payment,changeFor,total,status,createdAt)
    VALUES(?,?,?,?,?,'Novo',?)`).run(JSON.stringify(normalized),JSON.stringify({
      name:cleanText(customer.name,100),phone:cleanText(customer.phone,30),street:cleanText(customer.street,150),
      number:cleanText(customer.number,20),neighborhood:cleanText(customer.neighborhood,100),
      complement:cleanText(customer.complement,150),notes:cleanText(customer.notes,500)
    }),cleanText(b.payment,40),money(b.changeFor),calculated,now());
  res.status(201).json({ok:true,orderId:result.lastInsertRowid});
});

// Servir apenas arquivos públicos: nunca exponha banco SQLite, .env, servidor ou scripts internos.
const publicFiles = new Set(['index.html','catalogo30.html','catalogo35.html','mini.html','bebidas.html','promocoes.html','script.js','admin-sync.js','style.css','business-info.js']);
app.get('/', (_req,res) => res.sendFile(path.join(__dirname,'index.html')));
app.get('/:file', (req,res,next) => publicFiles.has(req.params.file)
  ? res.sendFile(path.join(__dirname,req.params.file)) : next());
app.use('/imagens', express.static(path.join(__dirname,'imagens'), {dotfiles:'deny'}));
// A mesma página responde em /admin e /admin/, sem redirecionamento em loop.
app.get(['/admin', '/admin/'], (_req,res)=>res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.use('/admin', express.static(path.join(__dirname,'admin'), { index:false, redirect:false, dotfiles:'deny' }));
app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({error:'Erro interno do servidor.'}); });
app.listen(PORT,()=> {
  console.log(`Pizzaria Sabor de Casa disponível em http://localhost:${PORT}`);
  console.log(`Painel administrativo: http://localhost:${PORT}/admin`);
  if (!process.env.ADMIN_PASSWORD) console.warn(`Senha inicial do painel: ${adminPassword} — altere ADMIN_PASSWORD no arquivo .env antes de publicar.`);
});
