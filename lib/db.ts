import Database from 'better-sqlite3';
import path from 'path';
import { hashPassword } from './auth-helpers';

const DB_PATH =
  process.env.DATABASE_PATH ||           // Railway volume (set in env vars)
  (process.env.VERCEL ? '/tmp/rpj.db'   // Vercel serverless tmp
  : path.join(process.cwd(), 'rpj.db')); // Local development

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    seedStatusesIfEmpty();
    seedUsersIfEmpty();
    seedIfEmpty();
  }
  return db;
}

export function runTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      cogs REAL,
      srp REAL,
      reorder_point INTEGER DEFAULT 10,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY,
      product_id INTEGER UNIQUE REFERENCES products(id),
      quantity INTEGER DEFAULT 0,
      last_updated TEXT
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      type TEXT CHECK(type IN ('IN','OUT')),
      quantity INTEGER,
      note TEXT,
      moved_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_number TEXT UNIQUE,
      supplier TEXT,
      total_amount REAL,
      status TEXT CHECK(status IN ('pending','received','cancelled')) DEFAULT 'pending',
      ordered_at TEXT,
      received_at TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS po_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id INTEGER REFERENCES purchase_orders(id),
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER,
      unit_cost REAL
    );
    CREATE TABLE IF NOT EXISTS product_research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      image_ready INTEGER DEFAULT 0,
      google_link TEXT,
      cogs REAL,
      srp REAL,
      fb_page_name TEXT,
      fb_page_admin TEXT,
      status TEXT DEFAULT 'For Research',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS research_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT 'gray',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('owner','staff')) DEFAULT 'staff',
      avatar_color TEXT DEFAULT 'blue',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      module TEXT NOT NULL,
      UNIQUE(user_id, module)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function seedStatusesIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM research_statuses').get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO research_statuses (name, color, sort_order) VALUES (?,?,?)');
  const defaults: [string, string, number][] = [
    ['For Research', 'gray', 0],
    ['For Ads Testing', 'blue', 1],
    ['For FB Page', 'amber', 2],
    ['Done', 'green', 3],
  ];
  for (const [name, color, order] of defaults) insert.run(name, color, order);
}

function seedUsersIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (count > 0) return;

  const allModules = ['dashboard','products','inventory','purchase_orders','product_research','reports'];
  const insertUser = db.prepare('INSERT INTO users (name,username,password_hash,role,avatar_color) VALUES (?,?,?,?,?)');
  const insertPerm = db.prepare('INSERT INTO user_permissions (user_id,module) VALUES (?,?)');

  const owner = insertUser.run('Owner', 'owner', hashPassword('rpj2026'), 'owner', 'indigo');
  for (const m of allModules) insertPerm.run(owner.lastInsertRowid, m);

  const staff = [
    { name: 'Maria Santos',   username: 'maria', color: 'pink',   modules: ['inventory','dashboard'] },
    { name: 'Juan dela Cruz', username: 'juan',  color: 'blue',   modules: ['purchase_orders','dashboard'] },
    { name: 'Ana Reyes',      username: 'ana',   color: 'green',  modules: ['product_research','dashboard'] },
    { name: 'Carlo Mendoza',  username: 'carlo', color: 'amber',  modules: ['products','inventory','dashboard'] },
  ];
  for (const s of staff) {
    const info = insertUser.run(s.name, s.username, hashPassword('staff123'), 'staff', s.color);
    for (const m of s.modules) insertPerm.run(info.lastInsertRowid, m);
  }
}

function seedIfEmpty() {
  // Only seed ONCE — check a permanent flag so deleted products don't re-appear on restart
  const alreadySeeded = db.prepare("SELECT value FROM app_settings WHERE key='products_seeded'").get();
  if (alreadySeeded) return;

  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace('T',' ').slice(0,19);
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate()-n); return fmt(d); };

  const products = [
    { sku:'ELEC-001', name:'Wireless Earbuds Pro',        category:'Electronics', cogs:450,  srp:999,  reorder_point:15 },
    { sku:'ELEC-002', name:'Smart Watch Series X',        category:'Electronics', cogs:1200, srp:2499, reorder_point:10 },
    { sku:'ELEC-003', name:'Portable Bluetooth Speaker',  category:'Electronics', cogs:350,  srp:799,  reorder_point:12 },
    { sku:'ELEC-004', name:'USB-C Hub 7-in-1',            category:'Electronics', cogs:180,  srp:399,  reorder_point:20 },
    { sku:'ELEC-005', name:'Phone Stand Adjustable',      category:'Electronics', cogs:80,   srp:199,  reorder_point:25 },
    { sku:'APP-001',  name:'Premium Cotton T-Shirt',      category:'Apparel',     cogs:120,  srp:350,  reorder_point:30 },
    { sku:'APP-002',  name:'Jogger Pants Slim Fit',       category:'Apparel',     cogs:200,  srp:550,  reorder_point:20 },
    { sku:'APP-003',  name:'Hoodie Zip-Up Classic',       category:'Apparel',     cogs:280,  srp:750,  reorder_point:15 },
    { sku:'APP-004',  name:'Baseball Cap Unisex',         category:'Apparel',     cogs:90,   srp:250,  reorder_point:25 },
    { sku:'APP-005',  name:'Compression Leggings',        category:'Apparel',     cogs:160,  srp:480,  reorder_point:20 },
    { sku:'HOME-001', name:'Stainless Tumbler 500ml',     category:'Home Goods',  cogs:140,  srp:380,  reorder_point:20 },
    { sku:'HOME-002', name:'Bamboo Cutting Board Set',    category:'Home Goods',  cogs:220,  srp:580,  reorder_point:10 },
    { sku:'HOME-003', name:'Aromatherapy Diffuser',       category:'Home Goods',  cogs:310,  srp:799,  reorder_point:8  },
    { sku:'HOME-004', name:'Non-Stick Cooking Pan 28cm',  category:'Home Goods',  cogs:380,  srp:899,  reorder_point:8  },
    { sku:'HOME-005', name:'Silicone Kitchen Utensil Set',category:'Home Goods',  cogs:190,  srp:490,  reorder_point:12 },
  ];

  const insertProd = db.prepare('INSERT INTO products (sku,name,category,cogs,srp,reorder_point) VALUES (@sku,@name,@category,@cogs,@srp,@reorder_point)');
  const insertInv  = db.prepare('INSERT INTO inventory (product_id,quantity,last_updated) VALUES (?,?,?)');
  const startQty   = [45,8,30,22,5,60,18,7,40,25,12,9,35,6,20];

  db.transaction(() => {
    for (let i = 0; i < products.length; i++) {
      const info = insertProd.run(products[i]);
      insertInv.run(info.lastInsertRowid, startQty[i], fmt(now));
    }
  })();

  const pids = (db.prepare('SELECT id FROM products ORDER BY id').all() as {id:number}[]).map(r=>r.id);
  const insertMove = db.prepare('INSERT INTO stock_movements (product_id,type,quantity,note,moved_at) VALUES (?,?,?,?,?)');
  const fast=[0,5,10], slow=[4,11];

  db.transaction(() => {
    for (let day=30;day>=1;day--) {
      const date=daysAgo(day);
      for (const idx of fast) {
        insertMove.run(pids[idx],'OUT',Math.floor(Math.random()*8)+3,'Sale',date);
        if (day%5===0) insertMove.run(pids[idx],'IN',20,'Restock',date);
      }
      for (let i=0;i<pids.length;i++) {
        if (fast.includes(i)||slow.includes(i)) continue;
        if (Math.random()>0.4) insertMove.run(pids[i],'OUT',Math.floor(Math.random()*4)+1,'Sale',date);
        if (day%10===0) insertMove.run(pids[i],'IN',10,'Restock',date);
      }
      for (const idx of slow) if (day%7===0) insertMove.run(pids[idx],'OUT',1,'Sale',date);
    }
    const today=fmt(now);
    insertMove.run(pids[0],'IN',50,'New stock received',today);
    insertMove.run(pids[0],'OUT',5,'Sale',today);
    insertMove.run(pids[5],'OUT',8,'Sale',today);
    insertMove.run(pids[10],'OUT',3,'Sale',today);
  })();

  const insertPO   = db.prepare('INSERT INTO purchase_orders (po_number,supplier,total_amount,status,ordered_at,received_at,notes) VALUES (?,?,?,?,?,?,?)');
  const insertPOI  = db.prepare('INSERT INTO po_items (po_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)');

  db.transaction(() => {
    const po1 = insertPO.run('PO-20260610-001','TechSource PH',18000,'received',daysAgo(14),daysAgo(10),'Initial stock order');
    insertPOI.run(po1.lastInsertRowid,pids[0],30,450); insertPOI.run(po1.lastInsertRowid,pids[1],10,1200);
    const po2 = insertPO.run('PO-20260617-001','Fashion Hub Manila',9600,'pending',daysAgo(7),null,'Awaiting delivery');
    insertPOI.run(po2.lastInsertRowid,pids[5],30,120); insertPOI.run(po2.lastInsertRowid,pids[6],20,200); insertPOI.run(po2.lastInsertRowid,pids[7],10,280);
    const po3 = insertPO.run('PO-20260601-001','HomeKing Wholesale',5800,'cancelled',daysAgo(23),null,'Supplier unavailable');
    insertPOI.run(po3.lastInsertRowid,pids[11],20,220); insertPOI.run(po3.lastInsertRowid,pids[12],10,310);
  })();

  const insertRes = db.prepare('INSERT INTO product_research (product_name,image_ready,google_link,cogs,srp,fb_page_name,fb_page_admin,status) VALUES (?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    insertRes.run('LED Strip Lights RGB',1,'https://google.com/search?q=led+strip+lights',120,349,'HomeLux PH','Maria Santos','Done');
    insertRes.run('Magnetic Phone Case',0,'https://google.com/search?q=magnetic+phone+case',80,249,'GadgetZone PH','Juan dela Cruz','For Ads Testing');
    insertRes.run('Posture Corrector Belt',1,'https://google.com/search?q=posture+corrector',150,450,'HealthFirst PH','Ana Reyes','For FB Page');
    insertRes.run('Reusable Silicone Bag Set',0,null,95,280,null,null,'For Research');
    insertRes.run('Wireless Charging Pad 15W',0,'https://google.com/search?q=wireless+charger+15w',200,599,'TechDeals PH','Carlo Mendoza','For Ads Testing');
  })();

  // Mark as seeded permanently — even if all products are deleted later, won't re-seed
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('products_seeded', '1')").run();
}
