FROM node:20-slim

# system deps for C++ and Python runners
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && g++ --version && python --version

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY . .

# Render sets PORT env; expose for local
EXPOSE 3000
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=320 \
    UV_THREADPOOL_SIZE=4 \
    ENABLE_PCH=0 \
    DB_POOL_MAX=2

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
