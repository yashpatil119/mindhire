import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import path from "node:path";

const outdir = path.join(process.cwd(), "dist");
await rm(outdir, { recursive: true, force: true });

const entrypoints = [...new Bun.Glob("src/**/*.html").scanSync()];

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [tailwind],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "__MINDHIRE_GEMINI_ENV__": JSON.stringify({
      VITE_GEMINI_API_KEY: process.env.VITE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "",
      VITE_GEMINI_MODEL: process.env.VITE_GEMINI_MODEL ?? "gemini-2.0-flash-live-001",
    }),
  },
});

for (const output of result.outputs) {
  console.log(` ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`);
}
