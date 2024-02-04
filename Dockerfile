FROM alpine:latest

COPY . .

RUN apk add nodejs yarn rust cargo git python3 make npm g++ openssl-dev alsa-utils alsaconf alsa-lib-dev

RUN yarn install --immutable
RUN yarn electron:build --dir