# syntax=docker/dockerfile:1
#
# The audio BASE image. Split from content because narration is 50-200MB against ~2MB of
# JSON — a prose typo fix must not re-pull the entire corpus.
#
# The curriculum repo builds the shipping `audio` image FROM this one.
# Unprivileged nginx: the stock image runs as root and the chart sets runAsNonRoot.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY images/audio/nginx.conf /etc/nginx/conf.d/default.conf

USER root
RUN mkdir -p /usr/share/nginx/html
USER 101

EXPOSE 8080
