export function buildHostWhereClause(hosts, column) {
    const candidates = new Set();
    for (const host of hosts) {
        candidates.add(host);
        const parts = host.split(".").filter(Boolean);
        // Include parent domains down to two labels, without TLD-only fragments.
        for (let index = 1; index <= parts.length - 2; index += 1) {
            candidates.add(parts.slice(index).join("."));
        }
    }
    let clauses = Array.from(candidates).flatMap((candidate) => [
        `${column} = ${sqlLiteral(candidate)}`,
        `${column} = ${sqlLiteral(`.${candidate}`)}`,
        `${column} LIKE ${sqlLiteral(`%.${candidate}`)}`,
    ]);
    // A flat OR chain exceeds SQLite's expression depth limit for large origin lists.
    // Pair terms into a balanced tree so depth grows logarithmically instead.
    while (clauses.length > 1) {
        const paired = [];
        for (let index = 0; index < clauses.length; index += 2) {
            const left = clauses[index];
            const right = clauses[index + 1];
            paired.push(right === undefined ? left : `(${left} OR ${right})`);
        }
        clauses = paired;
    }
    return clauses[0] ?? "1=0";
}
function sqlLiteral(value) {
    return `'${value.replaceAll("'", "''")}'`;
}
//# sourceMappingURL=sqliteHosts.js.map