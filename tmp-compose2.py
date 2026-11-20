path = 'docker-compose.prod.yml'
with open(path, 'r', encoding='utf-8') as f:
    s = f.read()
old = '''  api-migrate:
    image: gonmore14/api-adcode:${APP_VERSION:-latest}
    container_name: api-adcode-migrate
    env_file:
      - .env
    environment:
      NODE_ENV: production
    command: ["npm", "run", "prisma:migrate:prod", "--workspace", "@adcode/api"]
    networks:
      - red-interna
    profiles:
      - tools'''
new = '''  api-migrate:
    image: gonmore14/api-adcode:${APP_VERSION:-latest}
    container_name: api-adcode-migrate
    env_file:
      - .env
    environment:
      NODE_ENV: production
    volumes:
      - ./apps/api/prisma:/app/apps/api/prisma
    command: ["npm", "run", "prisma:migrate:prod", "--workspace", "@adcode/api"]
    networks:
      - red-interna
    profiles:
      - tools'''
assert old in s
s = s.replace(old, new)
with open(path, 'w', encoding='utf-8') as f:
    f.write(s)
print('done')
