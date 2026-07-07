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
