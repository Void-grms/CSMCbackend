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
  try {
    const res = await pool.query(`
      SELECT DISTINCT 
             a.id_cita, 
             a.id_paciente, 
             a.fecha_atencion,
             a.codigo_item
      FROM atencion a
      WHERE a.id_cita = ANY($1)
        AND a.tipo_diagnostico IN ('P', 'D')
      ORDER BY a.fecha_atencion ASC
    `, [idCitas]);

    const items = res.rows;
    let missingCitas = [];
    
    // Veamos si cada una de estas "citas" generó o estuvo dentro de un paquete PF_PSICOSIS
    for (const item of items) {
      const p = await pool.query(`
        SELECT id_paquete, fecha_inicio, fecha_limite, estado
        FROM paquete_paciente
        WHERE id_paciente = $1 AND id_paquete = 'PF_PSICOSIS'
        ORDER BY fecha_inicio ASC
      `, [item.id_paciente]);
      
      const covering = p.rows.find(pkg => {
         const fa = new Date(item.fecha_atencion);
         const fi = new Date(pkg.fecha_inicio);
         const fl = new Date(pkg.fecha_limite);
         return fa >= fi && fa <= fl;
      });

      console.log('Cita: ' + item.id_cita + ' | Pct: ' + item.id_paciente + ' | Fecha: ' + item.fecha_atencion.toISOString().substring(0,10) + ' | Dx: ' + item.codigo_item + ' => Cubierto por PF_PSICOSIS: ' + (covering ? covering.fecha_inicio.toISOString().substring(0,10) : 'NO'));
      
      if (!covering) {
         missingCitas.push(item);
      }
    }
    
    console.log("\\nCitas que NO están cubiertas por ningún paquete PF_PSICOSIS:");
    console.table(missingCitas);

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

check();
