// The demo talks to an in-browser Postgres instead; db.ts only needs these to load.
class Pool {
  constructor() {
    throw new Error('pg is not available in the browser demo');
  }
}

export default { types: { setTypeParser() {}, builtins: { INT8: 20 } }, Pool };
