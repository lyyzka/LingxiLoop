FROM accel.way2api.fun/docker.io/library/nginx:alpine
COPY deploy/openship/gateway.conf /etc/nginx/conf.d/default.conf
COPY website /usr/share/nginx/html
