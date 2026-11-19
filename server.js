require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL do Supabase no Render.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 12000 });
const app = express();
const PORT = Number(process.env.PORT || 3000);
const now = () => new Date().toISOString();
const adminUser = process.env.ADMIN_USER || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'SaborCasa@2026');
if (!adminPassword) throw new Error('Configure ADMIN_PASSWORD no Render.');
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('Configure SESSION_SECRET no Render.');
const query = (sql, args=[]) => pool.query(sql, args);
const one = async (sql,args=[]) => (await query(sql,args)).rows[0];
const rows = async (sql,args=[]) => (await query(sql,args)).rows;
const count = async (sql,args=[]) => (await query(sql,args)).rowCount;
const wrap = fn => (req,res,next) => Promise.resolve().then(()=>fn(req,res,next)).catch(next);
const cleanText = (v,max=500) => String(v ?? '').trim().slice(0,max);
const money = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v)>=0 ? Number(Number(v).toFixed(2)) : null;
const normalizeProduct = p => ({...p, price:Number(p.price),active:!!p.active});
const normalizeOrder = o => ({...o, total:Number(o.total),changeFor:o.changeFor==null?null:Number(o.changeFor),items:JSON.parse(o.items),customer:JSON.parse(o.customer)});

async function initialize() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(74019311)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', price NUMERIC(12,2) NOT NULL CHECK(price >= 0), category TEXT NOT NULL, image TEXT DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE, "sourcePage" TEXT DEFAULT '', "updatedAt" TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id BIGSERIAL PRIMARY KEY, items TEXT NOT NULL, customer TEXT NOT NULL, payment TEXT DEFAULT '', "changeFor" NUMERIC(12,2), total NUMERIC(12,2) NOT NULL, status TEXT NOT NULL DEFAULT 'Novo', "createdAt" TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admins (username TEXT PRIMARY KEY, "passwordHash" TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS expenses (id BIGSERIAL PRIMARY KEY, description TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0), date TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
    `);
    await client.query('INSERT INTO admins(username,"passwordHash") VALUES($1,$2) ON CONFLICT(username) DO NOTHING',[adminUser,bcrypt.hashSync(adminPassword,12)]);
    const existing = await client.query('SELECT 1 FROM products LIMIT 1');
    if (!existing.rowCount) {
      const seed = JSON.parse(fs.readFileSync(path.join(__dirname,'data','products.seed.json'),'utf8'));
      for (const p of seed) await client.query('INSERT INTO products(id,name,description,price,category,image,active,"sourcePage","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',[p.id,p.name,p.description,p.price,p.category,p.image,p.active!==false,p.sourcePage||'',now()]);
      console.log(`Catálogo inicial importado: ${seed.length} produtos`);
    }
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

class PostgresSessionStore extends session.Store {
  get(sid,cb) { one('SELECT sess,expire FROM sessions WHERE sid=$1',[sid]).then(r=>{if(!r || Number(r.expire)<=Date.now())return cb(null,null); cb(null,JSON.parse(r.sess));}).catch(cb); }
  set(sid,sess,cb=()=>{}) { const expire=sess.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+8*3600000; query('INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET sess=EXCLUDED.sess,expire=EXCLUDED.expire',[sid,JSON.stringify(sess),expire]).then(()=>cb(null)).catch(cb); }
  destroy(sid,cb=()=>{}) { query('DELETE FROM sessions WHERE sid=$1',[sid]).then(()=>cb(null)).catch(cb); }
  touch(sid,sess,cb=()=>{}) { this.set(sid,sess,cb); }
}

app.disable('x-powered-by');
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'100kb'}));
app.use(express.urlencoded({extended:false}));
app.use(session({store:new PostgresSessionStore(),secret:process.env.SESSION_SECRET||crypto.randomBytes(48).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*3600000}}));
const loginLimiter = rateLimit({windowMs:15*60000,limit:8,standardHeaders:'draft-7',legacyHeaders:false});
const requireAuth=(req,res,next)=>req.session?.admin?next():res.status(401).json({error:'Faça login para continuar.'});
const defaults={businessName:'Pizzaria Sabor de Casa',whatsapp:process.env.WHATSAPP_NUMBER||'',address:'',openingHours:'',deliveryInfo:'',pixKey:'',instagram:''};
async function allSettings(){const data=await rows('SELECT key,value FROM settings');const obj={...defaults};for(const r of data)if(Object.hasOwn(obj,r.key))obj[r.key]=r.value;return obj;}

app.get('/api/public/settings',wrap(async(_req,res)=>{const {businessName,whatsapp,address,openingHours,deliveryInfo,instagram}=await allSettings();res.json({businessName,whatsapp,address,openingHours,deliveryInfo,instagram});}));
app.get('/api/admin/settings',requireAuth,wrap(async(_req,res)=>res.json(await allSettings())));
app.put('/api/admin/settings',requireAuth,wrap(async(req,res)=>{
  for(const key of Object.keys(defaults)) if(Object.hasOwn(req.body||{},key)){
    let val=cleanText(req.body[key],300);
    if(key==='whatsapp'){val=val.replace(/\D/g,'');if(val&&!/^\d{10,15}$/.test(val))return res.status(400).json({error:'WhatsApp deve ter DDI, DDD e número (10 a 15 dígitos).'});}
    await query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key,val]);
  }
  res.json(await allSettings());
}));
app.get('/api/admin/report',requireAuth,wrap(async(req,res)=>{
  const month=String(req.query.month||now().slice(0,7));
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:'Mês inválido.'});
  const orders=(await rows('SELECT * FROM orders WHERE substring("createdAt" from 1 for 7)=$1 ORDER BY id DESC',[month])).map(normalizeOrder);
  const expenses=(await rows('SELECT * FROM expenses WHERE substring(date from 1 for 7)=$1 ORDER BY date DESC,id DESC',[month])).map(e=>({...e,amount:Number(e.amount)}));
  const valid=orders.filter(o=>o.status!=='Cancelado');
  const sales=Number(valid.reduce((s,o)=>s+o.total,0).toFixed(2));
  const expenseTotal=Number(expenses.reduce((s,e)=>s+e.amount,0).toFixed(2));
  const products=new Map();
  for(const o of valid)for(const item of o.items){const x=products.get(item.name)||{name:item.name,quantity:0,total:0};x.quantity+=item.quantity;x.total+=item.quantity*item.unitPrice;products.set(item.name,x);}
  res.json({month,orders,expenses,summary:{orders:orders.length,completed:orders.filter(o=>o.status==='Concluído').length,cancelled:orders.filter(o=>o.status==='Cancelado').length,sales,expenses:expenseTotal,balance:Number((sales-expenseTotal).toFixed(2))},products:[...products.values()].sort((a,b)=>b.quantity-a.quantity)});
}));
app.post('/api/admin/expenses',requireAuth,wrap(async(req,res)=>{
  const description=cleanText(req.body?.description,150),amount=money(req.body?.amount),date=String(req.body?.date||'');
  if(!description||amount===null||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))return res.status(400).json({error:'Preencha descrição, valor e data válidos.'});
  const r=await one('INSERT INTO expenses(description,amount,date) VALUES($1,$2,$3) RETURNING id',[description,amount,date]);res.status(201).json({id:Number(r.id)});
}));
app.delete('/api/admin/expenses/:id',requireAuth,wrap(async(req,res)=>{if(!await count('DELETE FROM expenses WHERE id=$1',[Number(req.params.id)]))return res.status(404).json({error:'Despesa não encontrada.'});res.json({ok:true});}));
app.get('/api/health',wrap(async(_req,res)=>{await query('SELECT 1');res.json({ok:true,service:'Pizzaria Sabor de Casa',database:'postgresql'});}));
app.get('/api/public/products',wrap(async(_req,res)=>res.json((await rows('SELECT id,name,description,price,category,image,active FROM products ORDER BY category,name')).map(normalizeProduct))));
app.post('/api/admin/login',loginLimiter,wrap(async(req,res)=>{
  const username=cleanText(req.body.username,80),password=String(req.body.password||'');
  const admin=await one('SELECT username,"passwordHash" FROM admins WHERE username=$1',[username]);
  if(!admin||!bcrypt.compareSync(password,admin.passwordHash))return res.status(401).json({error:'Usuário ou senha incorretos.'});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Não foi possível iniciar a sessão.'});req.session.admin=admin.username;res.json({ok:true,username:admin.username});});
}));
app.post('/api/admin/logout',requireAuth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',requireAuth,(req,res)=>res.json({username:req.session.admin}));
app.get('/api/admin/dashboard',requireAuth,wrap(async(_req,res)=>{
  const r=await one(`SELECT (SELECT COUNT(*) FROM products) AS "totalProducts",(SELECT COUNT(*) FROM products WHERE active) AS "activeProducts",(SELECT COUNT(*) FROM orders) AS "totalOrders",(SELECT COUNT(*) FROM orders WHERE status IN ('Novo','Em preparo')) AS "pendingOrders",(SELECT COALESCE(SUM(total),0) FROM orders WHERE status <> 'Cancelado') AS sales`);
  res.json(Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Number(v)])));
}));
app.get('/api/admin/products',requireAuth,wrap(async(_req,res)=>res.json((await rows('SELECT * FROM products ORDER BY category,name')).map(normalizeProduct))));
app.post('/api/admin/products',requireAuth,wrap(async(req,res)=>{
  const p=req.body||{},name=cleanText(p.name,100),category=cleanText(p.category,30),price=money(p.price);
  if(!name||!category||price===null)return res.status(400).json({error:'Informe nome, categoria e preço válido.'});
  const id=cleanText(p.id,100)||`${category}-${crypto.randomUUID().slice(0,8)}`;
  try{await query('INSERT INTO products(id,name,description,price,category,image,active,"sourcePage","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,name,cleanText(p.description,500),price,category,cleanText(p.image,250),p.active!==false,'',now()]);res.status(201).json({ok:true,id});}
  catch(e){if(e.code==='23505')return res.status(409).json({error:'Já existe um produto com esse identificador.'});throw e;}
}));
app.put('/api/admin/products/:id',requireAuth,wrap(async(req,res)=>{
  const p=req.body||{},name=cleanText(p.name,100),category=cleanText(p.category,30),price=money(p.price);
  if(!name||!category||price===null)return res.status(400).json({error:'Informe nome, categoria e preço válido.'});
  if(!await count('UPDATE products SET name=$1,description=$2,price=$3,category=$4,image=$5,active=$6,"updatedAt"=$7 WHERE id=$8',[name,cleanText(p.description,500),price,category,cleanText(p.image,250),p.active!==false,now(),req.params.id]))return res.status(404).json({error:'Produto não encontrado.'});
  res.json({ok:true});
}));
app.delete('/api/admin/products/:id',requireAuth,wrap(async(req,res)=>{if(!await count('DELETE FROM products WHERE id=$1',[req.params.id]))return res.status(404).json({error:'Produto não encontrado.'});res.json({ok:true});}));
app.get('/api/admin/orders',requireAuth,wrap(async(_req,res)=>res.json((await rows('SELECT * FROM orders ORDER BY id DESC LIMIT 300')).map(normalizeOrder))));
app.patch('/api/admin/orders/:id/status',requireAuth,wrap(async(req,res)=>{
  const allowed=['Novo','Em preparo','Saiu para entrega','Concluído','Cancelado'],status=cleanText(req.body.status,40);
  if(!allowed.includes(status))return res.status(400).json({error:'Status inválido.'});
  if(!await count('UPDATE orders SET status=$1 WHERE id=$2',[status,Number(req.params.id)]))return res.status(404).json({error:'Pedido não encontrado.'});res.json({ok:true});
}));
app.post('/api/orders',wrap(async(req,res)=>{
  const b=req.body||{},items=Array.isArray(b.items)?b.items.slice(0,40):[];
  if(!items.length)return res.status(400).json({error:'Pedido sem itens.'});
  const normalized=items.map(i=>({name:cleanText(i.name,120),quantity:Math.max(1,Math.min(99,Math.floor(Number(i.quantity)||1))),unitPrice:money(i.unitPrice)}));
  if(normalized.some(i=>!i.name||i.unitPrice===null))return res.status(400).json({error:'Itens inválidos.'});
  const calculated=Number(normalized.reduce((s,i)=>s+i.quantity*i.unitPrice,0).toFixed(2)),total=money(b.total);
  if(total===null||Math.abs(total-calculated)>0.02)return res.status(400).json({error:'Total do pedido inválido.'});
  const customer=b.customer||{};
  const r=await one(`INSERT INTO orders(items,customer,payment,"changeFor",total,status,"createdAt") VALUES($1,$2,$3,$4,$5,'Novo',$6) RETURNING id`,[JSON.stringify(normalized),JSON.stringify({name:cleanText(customer.name,100),phone:cleanText(customer.phone,30),street:cleanText(customer.street,150),number:cleanText(customer.number,20),neighborhood:cleanText(customer.neighborhood,100),complement:cleanText(customer.complement,150),notes:cleanText(customer.notes,500)}),cleanText(b.payment,40),money(b.changeFor),calculated,now()]);
  res.status(201).json({ok:true,orderId:Number(r.id)});
}));

const publicFiles=new Set(['index.html','catalogo30.html','catalogo35.html','mini.html','bebidas.html','promocoes.html','script.js','admin-sync.js','style.css','business-info.js']);
app.get('/',(_req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/:file',(req,res,next)=>publicFiles.has(req.params.file)?res.sendFile(path.join(__dirname,req.params.file)):next());
app.use('/imagens',express.static(path.join(__dirname,'imagens'),{dotfiles:'deny'}));
app.get(['/admin','/admin/'],(_req,res)=>res.sendFile(path.join(__dirname,'admin','index.html')));
app.use('/admin',express.static(path.join(__dirname,'admin'),{index:false,redirect:false,dotfiles:'deny'}));
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Erro interno do servidor.'});});
initialize().then(()=>app.listen(PORT,()=>console.log(`Pizzaria disponível na porta ${PORT} (Supabase PostgreSQL)`))).catch(err=>{console.error('Falha na conexão ou inicialização do banco:',err.message);process.exit(1);});
