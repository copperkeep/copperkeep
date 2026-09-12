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

# Files live at the path the browser asks for. The service is mounted at /content/ on
# the shared origin, so /content/manifest.json is served from content/manifest.json here
# — no proxy anywhere has to rewrite the path, and the chart's own Ingress works.
USER root
RUN mkdir -p /usr/share/nginx/html/content && \
    printf '{"contentVersion":"0.0.0","minAppVersion":"0.0.0","courses":[]}' \
      > /usr/share/nginx/html/content/manifest.json && \
    printf '{"ontologyVersion":0,"skills":[],"transitions":[]}' \
      > /usr/share/nginx/html/content/skills.json && \
    printf '{"steps":{}}' > /usr/share/nginx/html/content/steps.json
USER 101

EXPOSE 8080
