{{- define "k8s-firewall-ui.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{- define "k8s-firewall-ui.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "k8s-firewall-ui.labels" -}}
app.kubernetes.io/name: {{ include "k8s-firewall-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "k8s-firewall-ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "k8s-firewall-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "k8s-firewall-ui.sessionSecretName" -}}
{{- default (printf "%s-session" (include "k8s-firewall-ui.fullname" .)) .Values.auth.existingSecret -}}
{{- end -}}

{{- define "k8s-firewall-ui.agentSelectorLabels" -}}
app.kubernetes.io/name: {{ include "k8s-firewall-ui.name" . }}-agent
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "k8s-firewall-ui.agentSecretName" -}}
{{- default (printf "%s-agent" (include "k8s-firewall-ui.fullname" .)) .Values.flows.existingSecret -}}
{{- end -}}
