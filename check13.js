const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const idCitas = [
  '1336224073', '1336227233', '1336485853', '1336079393', '1335813234',
  '1335582584', '1335505613', '1335087928', '1337151256', '1337254913',
  '1337383919', '1337641638', '1340237148', '1340742796', '1341968711',
  '1343359914', '1343364141', '1343791502', '1347049857', '1344898417',
  '1344907704', '1349499196', '1352627841', '1355944023', '1355971183',
  '1356382834', '1358204161', '1358338184', '1361355479', '1365024239',
  '1367307487'
];

async function check() {
  const { rows } = await pool.query(`
    SELECT DISTINCT id_cita, id_paciente, fecha_atencion
    FROM atencion
    WHERE id_cita = ANY($1) AND tipo_diagnostico IN ('P', 'D')
  `, [idCitas]);

  const map = {};
  for(const r of rows) {
     const key = r.id_paciente + '_' + r.fecha_atencion.toISOString().split('T')[0];
     if(!map[key]) map[key] = [];
     map[key].push(r.id_cita);
  }

  for(const [key, citas] of Object.entries(map)) {
     if(citas.length > 1) {
       console.log("¡DUPLICADOS EN EL MISMO DÍA Y PACIENTE! ->", key, citas);
     }
  }

  pool.end();
}
check();
