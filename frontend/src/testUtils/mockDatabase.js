// In-memory query adapter: exercises API branching and filters, not Postgres/RLS.
export function mockDatabase(supabase, db) {
  const state = { db, operations: [], fail: null };
  supabase.from.mockImplementation((table) => {
    let action = "select", payload, cardinality = "many";
    const filters = [];
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push((row) => String(row[key]) === String(value)); return query; },
      in: (key, values) => { filters.push((row) => values.includes(row[key])); return query; },
      order: () => query,
      single: () => { cardinality = "one"; return query; },
      maybeSingle: () => { cardinality = "maybe"; return query; },
      insert: (rows) => { action = "insert"; payload = rows; return query; },
      update: (row) => { action = "update"; payload = row; return query; },
      delete: () => { action = "delete"; return query; },
      then: (resolve, reject) => Promise.resolve().then(() => {
        state.operations.push({ table, action, payload });
        const failure = typeof state.fail === "function" ? state.fail(table, action, payload) : state.fail === `${table}:${action}`;
        if (failure) return { data: null, error: { message: "DB failure" } };
        let rows = db[table].filter((row) => filters.every((filter) => filter(row)));
        if (action === "insert") {
          if (["schedule_finalizations", "schedule_creation_records"].includes(table) &&
              payload.some((candidate) => db[table].some((row) => String(row.schedule_id) === String(candidate.schedule_id)))) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          rows = payload.map((row, index) => ({ id: 200 + db[table].length + index, ...row }));
          db[table].push(...rows);
        }
        if (action === "update") rows.forEach((row) => Object.assign(row, payload));
        if (action === "delete") db[table] = db[table].filter((row) => !rows.includes(row));
        if ((cardinality === "one" && rows.length !== 1) || (cardinality === "maybe" && rows.length > 1)) {
          return { data: null, error: { message: "Invalid query cardinality" } };
        }
        return { data: cardinality === "many" ? rows.map((row) => ({ ...row })) : rows[0] ? { ...rows[0] } : null, error: null };
      }).then(resolve, reject),
    };
    return query;
  });
  return state;
}
