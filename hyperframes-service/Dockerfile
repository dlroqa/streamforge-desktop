# HyperFrames render service: Node 22 + FFmpeg + unzip (the Chrome download
# is a .zip — extraction fails without it) + the shared libraries the
# headless Chrome build needs. `browser ensure` bakes the ~115MB Chrome
# download into the image so deploys don't pay it on every cold start.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates unzip \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libglib2.0-0 \
    libx11-6 libxcb1 libxext6 \
    fonts-liberation fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Bake the Chrome Headless Shell download into the image. `doctor` only
# CHECKS for a browser — `browser ensure` is what downloads it. Without this
# the deployed service reports doctor:false and every render fails. Kept
# above the source COPY so code-only changes reuse this cached layer.
RUN npx hyperframes browser ensure

COPY server.mjs llm.mjs templates.mjs ./

# Assert the render essentials the server checks at startup, so a broken
# toolchain fails the image build loudly instead of shipping. Doctor's exit
# code alone is unusable here (non-zero for optional extras like Docker).
RUN (npx hyperframes doctor > /tmp/doctor.out 2>&1 || true) \
 && grep -E '✓[[:space:]]+FFmpeg' /tmp/doctor.out \
 && grep -E '✓[[:space:]]+Chrome' /tmp/doctor.out \
 && rm /tmp/doctor.out

ENV HYPERFRAMES_NO_UPDATE_CHECK=1
ENV PORT=8791
EXPOSE 8791
CMD ["node", "server.mjs"]
