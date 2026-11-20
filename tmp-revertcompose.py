path = 'docker-compose.prod.yml'
with open(path, 'r', encoding='utf-8') as f:
    s = f.read()
old = '''    volumes:
      - ./apps/api/prisma:/app/apps/api/prisma
    command: ["npm", "run", "prisma:migrate:prod", "--workspace", "@adcode/api"]'''
new = '''    command: ["npm", "run", "prisma:migrate:prod", "--workspace", "@adcode/api"]'''
assert old in s
s = s.replace(old, new)
with open(path, 'w', encoding='utf-8') as f:
    f.write(s)
print('done')
