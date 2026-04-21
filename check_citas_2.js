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
    let newPackages = 0;
    let continuedPackages = 0;
    let missingCitas = [];
    
    const uniqueCitas = new Set(items.map(i => i.id_cita));
    console.log("Total unique Citas analyzed:", uniqueCitas.size);

    for (const citaId of uniqueCitas) {
       const rowsForCita = items.filter(i => i.id_cita === citaId);
       const item = rowsForCita[0]; // Just take first to check if covered

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

       if (!covering) {
          missingCitas.push({cita: citaId, pcte: item.id_paciente, dx: rowsForCita.map(r => r.codigo_item).join(',')});
       } else {
          // Check if this cita was the EXACT trigger (fecha_atencion == fecha_inicio)
          const isTrigger = new Date(item.fecha_atencion).getTime() === new Date(covering.fecha_inicio).getTime();
          if (isTrigger) {
             newPackages++;
          // console.log("New:", citaId); 
          } else {
             continuedPackages++;
             console.log("Continuación de 2025:", citaId, "=> Paquete inició el", covering.fecha_inicio.toISOString().substring(0,10));
          }
       }
    }
    
    console.log("\\n--- RESUMEN ---");
    console.log("Atenciones que abrieron NUEVOS paquetes:", newPackages);
    console.log("Atenciones que CAYERON DENTRO de un paquete de 2025:", continuedPackages);
    console.log("Atenciones que NO abrieron PF_PSICOSIS:", missingCitas.length);
    console.log(missingCitas);

  } catch(e) { console.error(e); } finally { pool.end(); }
}

check();
