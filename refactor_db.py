import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add imports
content = re.sub(r"import \{ auth, db \} from \'\.\/firebase\';", "import { auth, db, col, dbDoc } from './firebase';", content)

# 1. doc(collection(db, 'name')) -> dbDoc('name')
content = re.sub(r"doc\(collection\(db,\s*'([^']+)'\)\)", r"dbDoc('\1')", content)

# 2. collection(db, 'name') -> col('name')
content = re.sub(r"collection\(db,\s*'([^']+)'\)", r"col('\1')", content)

# 3. doc(db, 'name', id) -> dbDoc('name', id)
content = re.sub(r"doc\(db,\s*'([^']+)',\s*([^)]+)\)", r"dbDoc('\1', \2)", content)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done!")
