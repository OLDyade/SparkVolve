ARG NODE_IMAGE=node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates ripgrep && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.npm npm install -g npm@12.2.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json cordis.patch.yml ./
COPY src ./src
RUN npm run build
RUN ln -s /app/node_modules /node_modules
ENV HOME=/home/node
ENV PATH="/app/node_modules/.bin:${PATH}"
ENTRYPOINT []
CMD ["node", "/app/dist/cli.js", "--help"]
