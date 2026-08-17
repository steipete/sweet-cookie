export function hostMatchesCookieDomain(host, cookieDomain, hostOnly = false) {
    const normalizedHost = host.toLowerCase();
    const normalizedDomain = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
    const domainLower = normalizedDomain.toLowerCase();
    return (normalizedHost === domainLower || (!hostOnly && normalizedHost.endsWith(`.${domainLower}`)));
}
//# sourceMappingURL=hostMatch.js.map