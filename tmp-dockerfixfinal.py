path = 'apps/api/Dockerfile.prod'
with open(path, 'r', encoding='utf-8') as f:
    s = f.read()
# In build stage: explicitly copy prisma before COPY . .
s = s.replace(
    'COPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nRUN ls /app/apps/api/prisma/migrations/20261112150000_init/ && test -f /app/apps/api/prisma/migrations/20261112150000_init/migration.sql\nRUN npm run build --workspace @adcode/shared -- --force && ls /app/packages/shared/dist',
    'COPY --from=deps /app/node_modules ./node_modules\nCOPY apps/api/prisma ./apps/api/prisma\nCOPY . .\nRUN npm run build --workspace @adcode/shared -- --force && ls /app/packages/shared/dist'
)
# In runner stage: prisma already copied via COPY . . in build, and runner copies from build
with open(path, 'w', encoding='utf-8') as f:
    f.write(s)
print('done')
