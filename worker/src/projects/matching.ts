export const isTestAccount = (id: string) => id.startsWith("pf-e2e-");
type Pick = { id: string; title: string; rank: number };
export function compatibility(a: Pick[], b: Pick[]) {
  const left = new Map(a.map((p) => [p.id, 1 / p.rank]));
  const right = new Map(b.map((p) => [p.id, 1 / p.rank]));
  let overlap = 0,
    total = 0;
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    overlap += Math.min(left.get(id) || 0, right.get(id) || 0);
    total += Math.max(left.get(id) || 0, right.get(id) || 0);
  }
  const shared = a
    .filter((p) => right.has(p.id))
    .sort(
      (x, y) =>
        Math.min(left.get(y.id)!, right.get(y.id)!) -
        Math.min(left.get(x.id)!, right.get(x.id)!),
    );
  return {
    score: total ? Math.round((100 * overlap) / total) : 0,
    shared: shared.map(({ id, title }) => ({ id, title })),
  };
}
export async function findPairs(db: D1Database) {
  // Bounded MVP pool. Ranking favors overlap in top choices, not merely one common show.
  const rows = (
    await db
      .prepare(
        `SELECT u.user_id,u.podcast_id AS id,p.title,u.rank
    FROM user_podcasts u JOIN podcasts p ON p.id=u.podcast_id
    WHERE u.user_id IN (SELECT user_id FROM profiles ORDER BY created_at LIMIT 200)
    ORDER BY u.user_id,u.rank`,
      )
      .all<Pick & { user_id: string }>()
  ).results;
  const users = new Map<string, Pick[]>();
  for (const r of rows) {
    const picks = users.get(r.user_id) || [];
    picks.push(r);
    users.set(r.user_id, picks);
  }
  const existing = (
    await db
      .prepare("SELECT pair_key FROM quartets WHERE pair_key IS NOT NULL")
      .all<{ pair_key: string }>()
  ).results;
  const known = new Set(existing.map((q) => q.pair_key));
  const counts = new Map(
    (
      await db
        .prepare(
          "SELECT m.user_id,COUNT(*) AS n FROM quartet_members m JOIN quartets q ON q.id=m.quartet_id WHERE q.status='active' AND q.kind='pair' GROUP BY m.user_id",
        )
        .all<{ user_id: string; n: number }>()
    ).results.map((r) => [r.user_id, r.n]),
  );
  const ids = [...users.keys()].sort();
  const candidates = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i],
        b = ids[j],
        key = JSON.stringify([a, b]);
      if (known.has(key)) continue;
      // Automated end-to-end test accounts must never be introduced to real people.
      if (isTestAccount(a) !== isTestAccount(b)) continue;
      const match = compatibility(users.get(a)!, users.get(b)!);
      if (match.shared.length) candidates.push({ a, b, key, ...match });
    }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.shared.length - a.shared.length ||
      a.key.localeCompare(b.key),
  );
  for (const pair of candidates) {
    if ((counts.get(pair.a) || 0) >= 5 || (counts.get(pair.b) || 0) >= 5)
      continue;
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO quartets(id,podcast_id,name,created_at,kind,pair_key,match_score,shared_podcasts_json) VALUES (?,?,?,?,'pair',?,?,?)",
          )
          .bind(
            id,
            pair.shared[0].id,
            "A podcast connection",
            now,
            pair.key,
            pair.score,
            JSON.stringify(pair.shared),
          ),
        ...[pair.a, pair.b].map((uid) =>
          db
            .prepare(
              "INSERT INTO quartet_members(quartet_id,user_id,joined_at) VALUES (?,?,?)",
            )
            .bind(id, uid, now),
        ),
      ]);
      counts.set(pair.a, (counts.get(pair.a) || 0) + 1);
      counts.set(pair.b, (counts.get(pair.b) || 0) + 1);
    } catch (e) {
      // A racing matcher may have inserted this pair or filled the user's slots.
      if (!/UNIQUE constraint|Active chat limit|Chat is full/.test(String(e)))
        throw e;
    }
  }
}
