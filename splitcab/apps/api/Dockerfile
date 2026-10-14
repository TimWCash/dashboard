# Build from the repository root:  docker build -f apps/api/Dockerfile -t splitcab-api .
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
# Listed so the lockfile matches the workspaces; their dependencies aren't installed.
COPY apps/mobile/package.json apps/mobile/
COPY apps/demo/package.json apps/demo/
COPY apps/site/package.json apps/site/
# Only the API's dependencies; the mobile app, demo and website aren't needed here.
RUN npm ci --workspace @splitcab/api --include-workspace-root --ignore-scripts
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build -w @splitcab/api && npm prune --omit=dev --workspace @splitcab/api --ignore-scripts

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/migrations ./migrations
COPY --from=build /repo/apps/api/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
