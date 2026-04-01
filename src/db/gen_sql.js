const fs = require('fs');
let rows = [];
for (let i = 0; i <= 999; i++) {
    let code = 'F' + i.toString().padStart(3, '0');
    rows.push(`    ('PF_CONTINUIDAD_CUIDADOS', '${code}')`);
}
fs.writeFileSync('rows.txt', rows.join(',\n'), 'utf8');
