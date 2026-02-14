FROM node:20-alpine

WORKDIR /app

COPY src/ ./src/
COPY conf/ ./conf/

ENV CONF_DIR=/app/conf
ENV LOCAL_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "src/proxy.js"]