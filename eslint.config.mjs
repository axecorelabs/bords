import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const isStrict = process.env.ESLINT_STRICT === "1";
const debtLevel = isStrict ? "error" : "warn";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": debtLevel,
      "@typescript-eslint/no-require-imports": debtLevel,
      "@typescript-eslint/no-empty-object-type": debtLevel,
      "@typescript-eslint/prefer-as-const": debtLevel,
      "react-hooks/immutability": debtLevel,
      "react-hooks/purity": debtLevel,
      "react-hooks/refs": debtLevel,
      "react-hooks/rules-of-hooks": debtLevel,
      "react-hooks/set-state-in-effect": debtLevel,
      "react/no-unescaped-entities": debtLevel,
      "prefer-const": debtLevel,
    },
  },
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
