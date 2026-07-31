FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

# Vite bakes these in at build time, so they must be supplied as build args
# (see infra/README.md for the two-phase apply this implies: frontdoor must
# already be deployed so its URL can be passed as VITE_FRONTDOOR_URL here).
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ARG VITE_FRONTDOOR_URL
ARG VITE_ALLOW_MOCK_AUTH=false
ENV VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN \
    VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID \
    VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE \
    VITE_FRONTDOOR_URL=$VITE_FRONTDOOR_URL \
    VITE_ALLOW_MOCK_AUTH=$VITE_ALLOW_MOCK_AUTH
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
ENV PORT=8083
EXPOSE 8083
CMD ["sh", "-c", "serve -s dist -l ${PORT}"]
