FROM node:20-slim

# system deps for C++ and Python runners
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && g++ --version && python --version

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production || npm install --production

COPY . .

# Render sets PORT env; expose for local
EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "server.js"]
