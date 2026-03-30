import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: false,
    clean: true,
    sourcemap: false,
    minify: true,
    deps: {
        neverBundle: [
            "better-auth",
            "better-auth/adapters",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/util-dynamodb",
        ],
    },
});
