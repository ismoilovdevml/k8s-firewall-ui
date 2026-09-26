//go:build linux

package flows

import (
	"net"
	"testing"

	"golang.org/x/sys/unix"
)

func TestFromConntrack(t *testing.T) {
	ip := net.ParseIP
	cases := []struct {
		name               string
		proto              uint8
		src, dst, replySrc string
		port, replyPort    uint16
		want               Flow
		ok                 bool
	}{
		{"direct pod to pod", unix.IPPROTO_TCP, "10.42.0.5", "10.42.0.9", "10.42.0.9", 8080, 8080,
			Flow{Protocol: "TCP", Src: "10.42.0.5", Dst: "10.42.0.9", DstPort: 8080}, true},
		{"service DNAT resolves to the backend", unix.IPPROTO_UDP, "10.42.0.5", "10.43.0.10", "10.42.0.3", 53, 53,
			Flow{Protocol: "UDP", Src: "10.42.0.5", Dst: "10.42.0.3", DstPort: 53, ServiceIP: "10.43.0.10", ServicePort: 53}, true},
		{"service port differs from target port", unix.IPPROTO_TCP, "10.42.0.5", "10.43.1.1", "10.42.0.7", 80, 8080,
			Flow{Protocol: "TCP", Src: "10.42.0.5", Dst: "10.42.0.7", DstPort: 8080, ServiceIP: "10.43.1.1", ServicePort: 80}, true},
		{"loopback ignored", unix.IPPROTO_TCP, "127.0.0.1", "127.0.0.1", "127.0.0.1", 80, 80, Flow{}, false},
		{"ICMP ignored", unix.IPPROTO_ICMP, "10.42.0.5", "10.42.0.9", "10.42.0.9", 0, 0, Flow{}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := fromConntrack(c.proto, ip(c.src), ip(c.dst), c.port, ip(c.replySrc), c.replyPort)
			if ok != c.ok || got != c.want {
				t.Fatalf("got %+v %v, want %+v %v", got, ok, c.want, c.ok)
			}
		})
	}
}
