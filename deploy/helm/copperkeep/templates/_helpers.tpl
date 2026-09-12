{{- define "copperkeep.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "copperkeep.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "copperkeep.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "copperkeep.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "copperkeep.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: copperkeep
{{- end -}}

{{- define "copperkeep.selectorLabels" -}}
app.kubernetes.io/name: {{ include "copperkeep.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Every service DNS name is a chart value, not a hardcoded string (§9.1 rule 6). */}}
{{- define "copperkeep.serviceName" -}}
{{- printf "%s-%s" (include "copperkeep.fullname" .root) .name -}}
{{- end -}}

{{- define "copperkeep.image" -}}
{{- $tag := default .root.Chart.AppVersion .tag -}}
{{- printf "%s/%s/%s:%s" .root.Values.image.registry .root.Values.image.repository .name $tag -}}
{{- end -}}

{{- define "copperkeep.secretName" -}}
{{- default (printf "%s-secrets" (include "copperkeep.fullname" .)) .Values.api.existingSecret -}}
{{- end -}}

{{/*
The database URL the API receives. Three modes, one connection string: the API takes
nothing else, so the mode is purely a chart concern (§9.3).
*/}}
{{- define "copperkeep.databaseUrlEnv" -}}
{{- if eq .Values.postgres.mode "external" -}}
{{- if .Values.postgres.externalUrlSecret }}
- name: COPPERKEEP_DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgres.externalUrlSecret }}
      key: {{ .Values.postgres.externalUrlSecretKey }}
{{- else }}
- name: COPPERKEEP_DATABASE_URL
  value: {{ .Values.postgres.externalUrl | quote }}
{{- end }}
{{- else if eq .Values.postgres.mode "operator" -}}
- name: COPPERKEEP_DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgres.externalUrlSecret | default (printf "%s-app" (include "copperkeep.fullname" .)) }}
      key: {{ .Values.postgres.externalUrlSecretKey }}
{{- else -}}
- name: COPPERKEEP_DATABASE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "copperkeep.secretName" . }}
      key: postgres-password
- name: COPPERKEEP_DATABASE_URL
  value: postgresql://{{ .Values.postgres.username }}:$(COPPERKEEP_DATABASE_PASSWORD)@{{ include "copperkeep.fullname" . }}-postgres:5432/{{ .Values.postgres.database }}
{{- end -}}
{{- end -}}

{{/* The environment the API and the migration Job share. Same names as Compose. */}}
{{- define "copperkeep.apiEnv" -}}
{{ include "copperkeep.databaseUrlEnv" . }}
- name: COPPERKEEP_APP_VERSION
  value: {{ .Chart.AppVersion | quote }}
- name: COPPERKEEP_LOG_LEVEL
  value: {{ .Values.api.logLevel | quote }}
{{- /* /content is part of the path inside the image too, so the API asks for exactly
       what a browser asks for. */}}
- name: COPPERKEEP_CONTENT_BASE_URL
  value: http://{{ include "copperkeep.fullname" . }}-content:8080/content
- name: COPPERKEEP_SESSION_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "copperkeep.secretName" . }}
      key: session-secret
- name: COPPERKEEP_ADMIN_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ include "copperkeep.secretName" . }}
      key: admin-token
{{/*
Whether the BROWSER is on HTTPS — which is not the same question as whether this
ingress terminates TLS. With termination offloaded to something in front of the
cluster (Nginx Proxy Manager, a load balancer, Cloudflare), ingress.tls.enabled is
false while the browser is still on HTTPS, and deriving the flag from it would quietly
downgrade every session cookie.

Defaults to ingress.tls.enabled; set api.cookieSecure to state it outright. An explicit
false is honoured, so `default` is the wrong tool here.
*/}}
{{- $cookieSecure := .Values.ingress.tls.enabled -}}
{{- if not (kindIs "invalid" .Values.api.cookieSecure) -}}
{{- $cookieSecure = .Values.api.cookieSecure -}}
{{- end }}
- name: COPPERKEEP_COOKIE_SECURE
  value: {{ $cookieSecure | quote }}
- name: COPPERKEEP_AUTH_BACKOFF_AFTER
  value: {{ .Values.api.auth.backoffAfter | quote }}
- name: COPPERKEEP_AUTH_HARD_LOCK_AFTER
  value: {{ .Values.api.auth.hardLockAfter | quote }}
- name: COPPERKEEP_EVENT_WRITES_PER_MINUTE
  value: {{ .Values.api.quotas.eventWritesPerMinute | quote }}
- name: COPPERKEEP_SUBMISSION_MAX_BYTES
  value: {{ .Values.api.quotas.submissionMaxBytes | quote }}
- name: COPPERKEEP_MASTERY_THRESHOLD
  value: {{ .Values.api.mastery.threshold | quote }}
- name: COPPERKEEP_MASTERY_MIN_OPPORTUNITIES
  value: {{ .Values.api.mastery.minOpportunities | quote }}
- name: COPPERKEEP_MASTERY_MIN_STEP_TYPES
  value: {{ .Values.api.mastery.minStepTypes | quote }}
- name: COPPERKEEP_REVIEW_INTERVALS_DAYS
  value: {{ .Values.api.mastery.reviewIntervalsDays | toJson | quote }}
- name: COPPERKEEP_TUTOR_ENABLED
  value: {{ .Values.tutor.enabled | quote }}
{{- if .Values.tutor.enabled }}
- name: COPPERKEEP_TUTOR_BASE_URL
  value: http://{{ include "copperkeep.fullname" . }}-tutor:8000
- name: COPPERKEEP_TUTOR_TIMEOUT_SECONDS
  value: {{ .Values.tutor.timeoutSeconds | quote }}
{{- end }}
{{- if .Values.api.bootstrap.enabled }}
- name: COPPERKEEP_BOOTSTRAP_ORG_SLUG
  value: {{ .Values.api.bootstrap.orgSlug | quote }}
- name: COPPERKEEP_BOOTSTRAP_ORG_NAME
  value: {{ .Values.api.bootstrap.orgName | quote }}
- name: COPPERKEEP_BOOTSTRAP_ADMIN_USERNAME
  value: {{ .Values.api.bootstrap.adminUsername | quote }}
- name: COPPERKEEP_BOOTSTRAP_ADMIN_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "copperkeep.secretName" . }}
      key: bootstrap-admin-password
{{- end }}
{{- end -}}
