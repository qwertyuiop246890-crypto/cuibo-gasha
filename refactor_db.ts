import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Add imports
content = content.replace(/import \{ auth, db \} from '\.\/firebase';/g, "import { auth, db, col, dbDoc } from './firebase';");

// 1. doc(collection(db, 'name')) -> dbDoc('name')
content = content.replace(/doc\(collection\(db,\s*'([^']+)'\)\)/g, "dbDoc('$1')");

// 2. collection(db, 'name') -> col('name')
content = content.replace(/collection\(db,\s*'([^']+)'\)/g, "col('$1')");

// 3. doc(db, 'name', id) -> dbDoc('name', $2)
content = content.replace(/doc\(db,\s*'([^']+)',\s*([^)]+)\)/g, "dbDoc('$1', $2)");

fs.writeFileSync('src/App.tsx', content, 'utf-8');
console.log("Done refactoring App.tsx!");
