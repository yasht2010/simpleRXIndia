import dns from 'dns';

// Force IPV4 first
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
    console.log("🚀 Bootstrap: IPv4 DNS resolution enforced.");
}
