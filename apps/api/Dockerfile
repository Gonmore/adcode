FROM node:20-alpine

WORKDIR /workspace

RUN apk add --no-cache libc6-compat wget

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install

COPY . .

EXPOSE 4100

CMD ["npm", "run", "dev", "--workspace", "@adcode/api"]
