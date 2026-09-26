package api

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/flows"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

const maxIngestBytes = 8 << 20

// handleFlowIngest accepts agent uploads, authenticated with the shared
// agent token. Flows that touch no pod are dropped (host-only noise).
func (s *Server) handleFlowIngest(w http.ResponseWriter, r *http.Request) {
	if s.flows == nil || s.agentToken == "" {
		writeError(w, http.StatusNotFound, "FLOWS_DISABLED", "flow collection is not enabled on this server")
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(token), []byte(s.agentToken)) != 1 {
		writeError(w, http.StatusUnauthorized, "INVALID_AGENT_TOKEN", "invalid agent token")
		return
	}
	var rep flows.Report
	if err := json.NewDecoder(io.LimitReader(r.Body, maxIngestBytes)).Decode(&rep); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", err.Error())
		return
	}
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	pods := podsByIP(snap)
	kept := rep.Flows[:0]
	for _, f := range rep.Flows {
		if _, ok := pods[f.Src]; ok {
			kept = append(kept, f)
		} else if _, ok := pods[f.Dst]; ok {
			kept = append(kept, f)
		}
	}
	rep.Flows = kept
	s.flows.Ingest(rep)
	writeJSON(w, http.StatusOK, map[string]int{"accepted": len(kept)})
}

// podsByIP maps pod IPs to pods, excluding hostNetwork pods (they share the
// node's address, so an IP does not identify them).
func podsByIP(snap *kube.ClusterSnapshot) map[string]kube.PodInfo {
	out := make(map[string]kube.PodInfo, len(snap.Pods))
	for _, p := range snap.Pods {
		if p.IP != "" && !p.HostNetwork {
			out[p.IP] = p
		}
	}
	return out
}

type observedPort struct {
	Protocol   string    `json:"protocol"`
	Port       uint16    `json:"port"`
	AllowedNow bool      `json:"allowedNow"`
	LastSeen   time.Time `json:"lastSeen"`
	Samples    int       `json:"samples"`
	ServiceIP  string    `json:"serviceIP,omitempty"`
}

type observedRow struct {
	Peer       simulator.Peer `json:"peer"`
	Ports      []observedPort `json:"ports"`
	LastSeen   time.Time      `json:"lastSeen"`
	AllowedNow bool           `json:"allowedNow"`
}

type observedView struct {
	Enabled  bool                 `json:"enabled"`
	Agents   map[string]time.Time `json:"agents"`
	Subject  simulator.Subject    `json:"subject"`
	Outbound []observedRow        `json:"outbound"`
	Inbound  []observedRow        `json:"inbound"`
}

// observe builds the observed traffic of a subject, with each flow's
// verdict under the current policies.
func (s *Server) observe(v *view, subj simulator.Subject) observedView {
	out := observedView{Enabled: s.flows != nil, Subject: subj, Agents: map[string]time.Time{},
		Outbound: []observedRow{}, Inbound: []observedRow{}}
	if s.flows == nil {
		return out
	}
	out.Agents = s.flows.Agents()
	pods := podsByIP(v.full)
	inSubject := func(p kube.PodInfo) bool {
		return p.Namespace == subj.Namespace && (subj.Workload == "" || p.Owner == subj.Workload)
	}
	rows := map[string]*observedRow{} // "out|peer" / "in|peer"
	add := func(dirKey string, peer simulator.Peer, port observedPort) {
		if peer.Kind != simulator.PeerExternal && !v.visible(peer.Namespace) {
			return
		}
		key := dirKey + "|" + peer.ID()
		row := rows[key]
		if row == nil {
			row = &observedRow{Peer: peer, AllowedNow: true}
			rows[key] = row
		}
		for i := range row.Ports {
			if row.Ports[i].Protocol == port.Protocol && row.Ports[i].Port == port.Port {
				row.Ports[i].Samples += port.Samples
				if port.LastSeen.After(row.Ports[i].LastSeen) {
					row.Ports[i].LastSeen = port.LastSeen
				}
				return
			}
		}
		row.Ports = append(row.Ports, port)
		row.AllowedNow = row.AllowedNow && port.AllowedNow
		if port.LastSeen.After(row.LastSeen) {
			row.LastSeen = port.LastSeen
		}
	}
	peerOf := func(ip string) (simulator.Peer, *kube.PodInfo) {
		if p, ok := pods[ip]; ok {
			return simulator.Peer{Kind: simulator.PeerWorkload, Namespace: p.Namespace, Workload: p.Owner}, &p
		}
		return simulator.Peer{Kind: simulator.PeerExternal, CIDR: ip}, nil
	}

	for _, rec := range s.flows.All() {
		src, srcOK := pods[rec.Src]
		dst, dstOK := pods[rec.Dst]
		q := &simulator.PortQuery{Protocol: rec.Protocol, Port: int32(rec.DstPort)}
		port := observedPort{Protocol: rec.Protocol, Port: rec.DstPort, LastSeen: rec.LastSeen, Samples: rec.Samples, ServiceIP: rec.ServiceIP}
		if srcOK && dstOK && sameWorkload(src, dst) {
			continue // traffic inside the subject itself
		}

		if srcOK && inSubject(src) {
			peer, dstPod := peerOf(rec.Dst)
			in := simulator.Input{Source: podEndpoint(src), Port: q}
			if dstPod != nil {
				in.Destination = podEndpoint(*dstPod)
			} else {
				in.Destination = simulator.Endpoint{Kind: "ip", IP: rec.Dst}
			}
			if res, err := simulator.Evaluate(v.full, in); err == nil {
				port.AllowedNow = res.Allowed
			}
			add("out", peer, port)
		}
		if dstOK && inSubject(dst) {
			peer, srcPod := peerOf(rec.Src)
			p := port
			if srcPod != nil {
				if res, err := simulator.Evaluate(v.full, simulator.Input{Source: podEndpoint(*srcPod), Destination: podEndpoint(dst), Port: q}); err == nil {
					p.AllowedNow = res.Allowed
				}
			} else if side, err := simulator.IngressFromIP(v.full, rec.Src, podEndpoint(dst), q); err == nil {
				p.AllowedNow = side.Allowed
			}
			add("in", peer, p)
		}
	}
	for key, row := range rows {
		sort.Slice(row.Ports, func(i, j int) bool { return row.Ports[i].Port < row.Ports[j].Port })
		if strings.HasPrefix(key, "out|") {
			out.Outbound = append(out.Outbound, *row)
		} else {
			out.Inbound = append(out.Inbound, *row)
		}
	}
	for _, list := range [][]observedRow{out.Outbound, out.Inbound} {
		sort.Slice(list, func(i, j int) bool { return list[i].Peer.ID() < list[j].Peer.ID() })
	}
	return out
}

func sameWorkload(a, b kube.PodInfo) bool { return a.Namespace == b.Namespace && a.Owner == b.Owner }

func podEndpoint(p kube.PodInfo) simulator.Endpoint {
	return simulator.Endpoint{Kind: "pod", Namespace: p.Namespace, Name: p.Name}
}

// handleFlows: GET /api/v1/flows?namespace=&workload= — observed traffic.
func (s *Server) handleFlows(w http.ResponseWriter, r *http.Request) {
	v, ok := s.view(w, r)
	if !ok {
		return
	}
	subj := simulator.Subject{Namespace: r.URL.Query().Get("namespace"), Workload: r.URL.Query().Get("workload")}
	if subj.Namespace == "" {
		writeError(w, http.StatusBadRequest, "NAMESPACE_REQUIRED", "pass ?namespace= (and optionally workload=)")
		return
	}
	if !v.visible(subj.Namespace) {
		notVisible(w, "namespace "+subj.Namespace)
		return
	}
	writeJSON(w, http.StatusOK, s.observe(v, subj))
}

type learnBody struct {
	Subject   simulator.Subject `json:"subject"`
	Direction string            `json:"direction"`
	Signature string            `json:"signature"`
}

// learnPlan turns the observed flows of a subject into a least-privilege plan.
func (s *Server) learnPlan(w http.ResponseWriter, r *http.Request) (simulator.Plan, string, bool) {
	var body learnBody
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBodySize)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", err.Error())
		return simulator.Plan{}, "", false
	}
	if s.flows == nil {
		writeError(w, http.StatusNotFound, "FLOWS_DISABLED", "flow collection is not enabled on this server")
		return simulator.Plan{}, "", false
	}
	v, ok := s.view(w, r)
	if !ok {
		return simulator.Plan{}, "", false
	}
	if !v.visible(body.Subject.Namespace) {
		notVisible(w, "namespace "+body.Subject.Namespace)
		return simulator.Plan{}, "", false
	}
	obs := s.observe(v, body.Subject)
	rows := obs.Outbound
	if body.Direction == "inbound" {
		rows = obs.Inbound
	}
	req := simulator.LearnRequest{Subject: body.Subject, Direction: body.Direction}
	for _, row := range rows {
		op := simulator.ObservedPeer{Peer: row.Peer}
		for _, p := range row.Ports {
			op.Ports = append(op.Ports, simulator.PortSpec{Protocol: p.Protocol, Port: int32(p.Port)})
		}
		req.Observed = append(req.Observed, op)
	}
	plan, err := simulator.PlanLearn(v.full, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "PLAN_FAILED", err.Error())
		return simulator.Plan{}, "", false
	}
	return plan, body.Signature, true
}

func (s *Server) handleLearnPlan(w http.ResponseWriter, r *http.Request) {
	plan, _, ok := s.learnPlan(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toPlanView(plan))
}

func (s *Server) handleLearnApply(w http.ResponseWriter, r *http.Request) {
	plan, signature, ok := s.learnPlan(w, r)
	if !ok {
		return
	}
	s.applyPlan(w, r, plan, signature)
}
