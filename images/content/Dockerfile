# syntax=docker/dockerfile:1
#
# The content BASE image: nginx and the serving policy, with an empty webroot.
#
# The curriculum repo builds the shipping `content` image FROM this one and copies its
# built JSON in. That keeps the nginx config in this repo — where §10.2 puts it — while
# the curriculum keeps its own release cadence and its own CI. One conf, no copy to
# drift.
# Unprivileged nginx: the stock image runs as root and the chart sets runAsNonRoot.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY images/content/nginx.conf /etc/nginx/conf.d/default.conf

USER root
RUN mkdir -p /usr/share/nginx/html && \
    printf '{"contentVersion":"0.0.0","minAppVersion":"0.0.0","courses":[]}' \
      > /usr/share/nginx/html/manifest.json && \
    printf '{"ontologyVersion":0,"skills":[],"transitions":[]}' \
      > /usr/share/nginx/html/skills.json && \
    printf '{"steps":{}}' > /usr/share/nginx/html/steps.json
USER 101

EXPOSE 8080
