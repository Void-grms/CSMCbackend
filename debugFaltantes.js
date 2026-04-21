require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function debugFaltantes() {
  const client = await pool.connect();
  try {
    // Tomar 10 paquetes que DEBEN abrirse pero no existían según script anterior.
    // Vamos a forzar a calcularPaquetes() simulando su lógica:
    const { rows: candidatos } = await client.query(`
      SELECT
        a.id_paciente,
        a.fecha_atencion,
        a.codigo_item,
        a.tipo_diagnostico,
        pgd.id_paquete,
        p.id_paciente AS paciente_existe,
        p.fecha_nacimiento,
        EXTRACT(YEAR FROM AGE(a.fecha_atencion, p.fecha_nacimiento))::INT AS edad_anos
      FROM atencion a
      JOIN paquete_grupo_dx pgd ON pgd.codigo_cie10 = a.codigo_item
      LEFT JOIN paciente p ON p.id_paciente = a.id_paciente
      WHERE a.tipo_diagnostico IN ('P', 'D')
        AND EXTRACT(YEAR FROM a.fecha_atencion) = 2026
      ORDER BY a.id_paciente, pgd.id_paquete, a.fecha_atencion ASC
    `);

    // Paquetes abiertos en BD 2026:
    const { rows: paquetesBD } = await client.query(`
      SELECT id_paciente, id_paquete 
      FROM paquete_paciente 
      WHERE EXTRACT(YEAR FROM fecha_inicio) = 2026
    `);
    const bdSet = new Set(paquetesBD.map(p => `${p.id_paciente}_${p.id_paquete}`));

    let faltantes = [];

    for (const c of candidatos) {
      const key = `${c.id_paciente}_${c.id_paquete}`;
      if (!bdSet.has(key)) {
        if (!faltantes.find(f => f.key === key)) {
          faltantes.push({key, data: c});
        }
      }
    }

    console.log("Faltantes: ", faltantes.length);
    for (let i = 0; i < Math.min(faltantes.length, 10); i++) {
        const c = faltantes[i].data;
        let razon = "";
        
        // Simular reglas calcularPaquetes.js:
        if (!c.paciente_existe) {
          razon = "NO HAY PACIENTE (Falta Maestro_Paciente)";
        } else {
          // Chequear edad
          const { rows: def } = await client.query('SELECT edad_minima, edad_maxima FROM paquete_definicion WHERE id_paquete=$1', [c.id_paquete]);
          const d = def[0];
          let fueraDeEdad = false;
          if (c.edad_anos !== null) {
            if (d.edad_minima && c.edad_anos < d.edad_minima) {
                fueraDeEdad = true;
                razon = `EDAD_INSUFICIENTE (Tiene ${c.edad_anos}, Min: ${d.edad_minima})`;
            }
            if (d.edad_maxima && c.edad_anos > d.edad_maxima) {
                fueraDeEdad = true;
                razon = `EDAD_EXCESIVA (Tiene ${c.edad_anos}, Max: ${d.edad_maxima})`;
            }
          } else {
             razon = "PACIENTE TIENE fecha_nacimiento NULL Y PASÓ FILTRO. Error FK?";
          }
          
          if (!fueraDeEdad) {
             if (c.id_paquete === 'PF_REHAB_PSICOSOCIAL_ALC') {
                const { rows: check } = await client.query(`
                  SELECT 1 FROM atencion a1 JOIN atencion a2 ON a1.id_paciente=a2.id_paciente 
                  AND DATE_TRUNC('month', a1.fecha_atencion) = DATE_TRUNC('month', a2.fecha_atencion)
                  WHERE a1.id_paciente=$1 AND a1.codigo_item='F102' AND a2.codigo_item='Z502' AND a1.tipo_diagnostico='D' AND a2.tipo_diagnostico='D' LIMIT 1
                `, [c.id_paciente]);
                if (check.length === 0) razon = "NO CUMPLE AMBOS CÓDIGOS (F102+Z502 en mismo mes)";
             } else {
                razon = "DEBERIA ESTAR CREADO. Posible error en Base de Datos durante cálculo.";
             }
          }
        }
        
        console.log(`[${c.id_paquete}] Paciente ${c.id_paciente}: ${razon}`);
    }

  } finally {
    client.release();
    pool.end();
  }
}
debugFaltantes();
