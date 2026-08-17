export function hostMatchesCookieDomain(
	host: string,
	cookieDomain: string,
	hostOnly = false,
): boolean {
	const normalizedHost = host.toLowerCase();
	const normalizedDomain = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
	const domainLower = normalizedDomain.toLowerCase();
	return (
		normalizedHost === domainLower || (!hostOnly && normalizedHost.endsWith(`.${domainLower}`))
	);
}
