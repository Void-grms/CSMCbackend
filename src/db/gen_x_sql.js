const fs = require('fs');
let rows = [];
for (let i = 600; i <= 849; i++) {
    let code = 'X' + i.toString().padStart(3, '0');
    rows.push(`    ('PF_CONTINUIDAD_CUIDADOS', '${code}')`);
}
fs.writeFileSync('rows_x.txt', rows.join(',\n'), 'utf8');
console.log('Generated rows_x.txt from X600 to X849');
