import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGODB_URI;
  const master = await mongoose.createConnection(uri, { dbName: 'master' }).asPromise();
  const dbs = (await master.db.admin().listDatabases()).databases.map((d) => d.name).filter((n) => n.startsWith('db_'));
  await master.close();

  const start = new Date(2026, 8, 1);
  const end = new Date(2026, 8, 30, 23, 59, 59, 999);

  for (const dbName of dbs) {
    const conn = await mongoose.createConnection(uri, { dbName }).asPromise();
    const branches = await conn.db.collection('branches').find({}).project({ id: 1, name: 1, code: 1 }).toArray().catch(() => []);
    const dambai = branches.filter((b) => /dambai/i.test(String(b.name || b.code || '')));
    if (dambai.length) {
      console.log('DAMBAI FOUND IN', dbName, dambai);
    }
    if (/ebk|ekb|^db_eb$/i.test(dbName)) {
      console.log(dbName, 'all branches', branches.map((b) => b.name || b.code || b.id));
    }
    for (const b of branches) {
      const bid = String(b.id || b._id);
      const sales = await conn.db.collection('sales').find({
        branchId: bid,
        created_at: { $gte: start, $lte: end }
      }).project({ total: 1 }).toArray().catch(() => []);
      if (!sales.length) continue;
      const total = sales.reduce((s, x) => s + Number(x.total || 0), 0);
      const count = sales.length;
      const interesting = Math.abs(total - 125546) < 1
        || Math.abs(total - 127636) < 1
        || count === 134
        || /dambai/i.test(String(b.name || ''));
      if (interesting) {
        console.log('CANDIDATE', {
          dbName,
          branch: b.name,
          branchId: bid,
          count,
          total: Math.round(total * 100) / 100
        });
      }
    }
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
