//go:build linux

package flows

import (
	"net"

	"github.com/vishvananda/netlink"
	"golang.org/x/sys/unix"
)

// Collect dumps the node's conntrack table (IPv4 and IPv6) and returns the
// distinct flows, skipping loopback traffic. Requires CAP_NET_ADMIN in the
// host network namespace.
func Collect() ([]Flow, error) {
	var out []Flow
	seen := map[Key]bool{}
	for _, family := range []netlink.InetFamily{unix.AF_INET, unix.AF_INET6} {
		entries, err := netlink.ConntrackTableList(netlink.ConntrackTable, family)
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			f, ok := fromConntrack(e.Forward.Protocol, e.Forward.SrcIP, e.Forward.DstIP, e.Forward.DstPort, e.Reverse.SrcIP, e.Reverse.SrcPort)
			if !ok || seen[f.key()] {
				continue
			}
			seen[f.key()] = true
			out = append(out, f)
		}
	}
	return out, nil
}

// fromConntrack turns one conntrack entry into a Flow. The reply tuple's
// source is the real destination after DNAT, so Service traffic resolves
// to the backend pod.
func fromConntrack(proto uint8, src, origDst net.IP, origPort uint16, replySrc net.IP, replyPort uint16) (Flow, bool) {
	name := protoName(proto)
	if name == "" || src.IsLoopback() || origDst.IsLoopback() {
		return Flow{}, false
	}
	f := Flow{Protocol: name, Src: src.String(), Dst: replySrc.String(), DstPort: replyPort}
	if !replySrc.Equal(origDst) || replyPort != origPort {
		f.ServiceIP, f.ServicePort = origDst.String(), origPort
	}
	return f, true
}

func protoName(p uint8) string {
	switch p {
	case unix.IPPROTO_TCP:
		return "TCP"
	case unix.IPPROTO_UDP:
		return "UDP"
	case unix.IPPROTO_SCTP:
		return "SCTP"
	}
	return ""
}
