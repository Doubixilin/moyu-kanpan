import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "dist-electron/**", "release/**", "node_modules/**"]
  },

  js.configs.recommended,

  // 源码与 Electron 主进程。两个 tsconfig 都显式列出，因为 electron/ 不在 tsconfig.json 的
  // include 里，仅靠 projectService 的"就近查找"会漏掉 electron/main.ts 与 preload.cts。
  {
    files: ["src/**/*.ts", "electron/**/*.ts", "electron/**/*.cts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.electron.json"],
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.node
      }
    },
    rules: {
      // 与 docs/2026-09-25-code-audit.md §6-1 的整改目标一致。
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ],
      // `void promise` 是显式忽略（本仓库共 62 处），允许；真正的悬挂 Promise 仍会报错。
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": "error",
      eqeqeq: ["error", "smart"],
      // 中文排版会用到全角空格（模板串与注释里均属有意为之）。
      "no-irregular-whitespace": [
        "error",
        { skipComments: true, skipStrings: true, skipTemplates: true }
      ],
      // 该规则只报"多余的 as/!"，不捕获缺陷；本仓库尚有 49 处，留作独立的一次性
      // `eslint --fix` 提交处理，避免与功能改动混在一起。
      "@typescript-eslint/no-unnecessary-type-assertion": "off"
    }
  },

  // 渲染层运行在浏览器上下文。
  {
    files: ["src/*Renderer.ts", "src/presentation/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },

  // 测试文件：node:test 的 describe()/it() 本身返回 Promise，直接调用是框架约定，
  // 会被 no-floating-promises 误报（215 处全部来自这里，源码 0 处）。
  {
    files: ["**/*.test.ts", "**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-base-to-string": "off"
    }
  },

  // 构建脚本与配置文件不在任何 tsconfig 项目中，关闭类型感知规则。
  {
    files: ["scripts/**/*.mjs", "*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
);
