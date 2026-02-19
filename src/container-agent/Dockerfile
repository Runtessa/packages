FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY lib ./lib

RUN mkdir -p /app/certs
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production \
    CONTAINER_MANAGER_HOST=0.0.0.0 \
    CONTAINER_MANAGER_PORT=4070 \
    CONTAINER_MANAGER_TLS_REQUIRED=true \
    CONTAINER_MANAGER_TLS_ENABLED=true \
    CONTAINER_MANAGER_TLS_AUTO_SELF_SIGNED=true \
    CONTAINER_MANAGER_TLS_KEY_PATH=/app/certs/server.key \
    CONTAINER_MANAGER_TLS_CERT_PATH=/app/certs/server.crt

EXPOSE 4070

CMD ["node", "index.js"]
