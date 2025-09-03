import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  platform: "node",
  minify: true,
  target: ["node22"],
  external: ["oracledb"],
  plugins: [],
});
