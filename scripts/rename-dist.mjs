import { renameSync, existsSync } from 'node:fs';
if (existsSync('dist/index.html')) renameSync('dist/index.html', 'dist/essay-anonymizer.html');
console.log('Built dist/essay-anonymizer.html');
