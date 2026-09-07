FROM accel.way2api.fun/docker.io/library/nginx:alpine
COPY deploy/arcane/lingxiloop-app-b/gateway.conf /etc/nginx/conf.d/default.conf
