import next from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...next,
  ...nextTs,
  // eslint-plugin-react's "detect" calls an API ESLint 10 removed; name the version instead.
  { settings: { react: { version: "19.3" } } },
  { ignores: [".next/**", "out/**", "test-results/**", "playwright-report/**", "next-env.d.ts"] },
];

export default config;
