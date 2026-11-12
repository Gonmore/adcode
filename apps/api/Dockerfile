FROM node:20-bookworm-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl wget && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install

COPY . .

EXPOSE 4100

CMD ["npm", "run", "dev", "--workspace", "@adcode/api"]
