FROM node:18-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl ca-certificates bash ffmpeg openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything first so postinstall script is available
COPY . .

# Bro's CPU voice uses onnxruntime-node; never fetch its CUDA binaries from GitHub (we run on CPU)
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip

# Install deps (postinstall runs fetch-audio.sh)
RUN npm install --production

EXPOSE 3000

CMD ["node", "server.js"]
