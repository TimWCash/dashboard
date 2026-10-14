// Bundled builds inline the SQL migrations (see apps/demo/build.mjs).
declare module 'virtual:migrations' {
  const migrations: { name: string; sql: string }[];
  export default migrations;
}
