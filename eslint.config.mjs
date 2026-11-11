import nextPlugin from "@next/eslint-plugin-next";
import hooks from "eslint-plugin-react-hooks";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
export default [{ignores:["src/generated/**",".next/**"]},{files:["src/**/*.{ts,tsx}"],languageOptions:{parser,parserOptions:{ecmaVersion:"latest",sourceType:"module",ecmaFeatures:{jsx:true}}},plugins:{"@next/next":nextPlugin,"react-hooks":hooks,"@typescript-eslint":tsPlugin},rules:{...nextPlugin.configs.recommended.rules,...nextPlugin.configs["core-web-vitals"].rules}}];
