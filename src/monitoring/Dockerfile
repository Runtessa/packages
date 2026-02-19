FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY lib ./lib

RUN mkdir -p /app/certs && chown -R node:node /app
USER node

ENV NODE_ENV=production \
    MONITORING_HOST=0.0.0.0 \
    MONITORING_PORT=3011 \
    MONITORING_TLS_REQUIRED=true \
    MONITORING_TLS_ENABLED=true \
    MONITORING_TLS_AUTO_SELF_SIGNED=true \
    MONITORING_TLS_KEY_PATH=/app/certs/server.key \
    MONITORING_TLS_CERT_PATH=/app/certs/server.crt

EXPOSE 3011

CMD ["node", "index.js"]
