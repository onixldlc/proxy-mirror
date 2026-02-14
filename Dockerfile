FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app
COPY src/ ./src/

ENV CONF_DIR=/app/conf
ENV CERTS_DIR=/app/certs
ENV HTTP_PORT=80
ENV HTTPS_PORT=443

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget --no-check-certificate -qO- https://localhost:443/ || wget -qO- http://localhost:80/ || exit 1

CMD ["node", "src/proxy.js"]