FROM node:20-bullseye-slim AS builder

WORKDIR /app/src/kernel

# Build this image from repository root:
# docker build -f src/kernel/Dockerfile .
COPY src/kernel/package.json src/kernel/package-lock.json ./
RUN npm ci

COPY src/kernel /app/src/kernel

RUN npm run build

FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/src/public /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
