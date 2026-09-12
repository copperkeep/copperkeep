{{/*
Four of the five services are nginx serving static files. They differ only in image,
replica count and resources, so they share one definition — and stay separately imaged,
versioned and rolled back, which is the point of splitting them in the first place.

Usage: {{- include "copperkeep.staticService" (dict "root" . "name" "web" "cfg" .Values.web) }}
*/}}
{{- define "copperkeep.staticService" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $cfg := .cfg -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "copperkeep.fullname" $root }}-{{ $name }}
  labels:
    {{- include "copperkeep.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
spec:
  replicas: {{ $cfg.replicas }}
  selector:
    matchLabels:
      {{- include "copperkeep.selectorLabels" $root | nindent 6 }}
      app.kubernetes.io/component: {{ $name }}
  template:
    metadata:
      labels:
        {{- include "copperkeep.selectorLabels" $root | nindent 8 }}
        app.kubernetes.io/component: {{ $name }}
      {{- if eq $name "web" }}
      annotations:
        checksum/config: {{ include (print $root.Template.BasePath "/configmap-config-json.yaml") $root | sha256sum }}
      {{- end }}
    spec:
      {{- with $root.Values.image.pullSecrets }}
      imagePullSecrets: {{ toYaml . | nindent 8 }}
      {{- end }}
      securityContext: {{- toYaml $root.Values.podSecurityContext | nindent 8 }}
      containers:
        - name: {{ $name }}
          image: {{ include "copperkeep.image" (dict "root" $root "name" $name "tag" (default $root.Values.image.tag ($cfg.tag | default ""))) }}
          imagePullPolicy: {{ $root.Values.image.pullPolicy }}
          securityContext: {{- toYaml $root.Values.securityContext | nindent 12 }}
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 2
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 10
            periodSeconds: 30
          resources: {{- toYaml $cfg.resources | nindent 12 }}
          {{- if eq $name "web" }}
          volumeMounts:
            # The SPA fetches /config.json at boot; it is a ConfigMap, never baked into
            # the bundle (§9.1 rule 2).
            - name: config-json
              mountPath: /usr/share/nginx/html/config.json
              subPath: config.json
          {{- end }}
      {{- if eq $name "web" }}
      volumes:
        - name: config-json
          configMap:
            name: {{ include "copperkeep.fullname" $root }}-config
      {{- end }}
      {{- with $root.Values.nodeSelector }}
      nodeSelector: {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $root.Values.tolerations }}
      tolerations: {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $root.Values.affinity }}
      affinity: {{- toYaml . | nindent 8 }}
      {{- end }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "copperkeep.fullname" $root }}-{{ $name }}
  labels:
    {{- include "copperkeep.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 8080
      targetPort: http
  selector:
    {{- include "copperkeep.selectorLabels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
{{- end -}}
