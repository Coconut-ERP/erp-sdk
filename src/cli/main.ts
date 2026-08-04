import { runCli } from "./index";

runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  cwd: process.cwd(),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${JSON.stringify({ error: { type: "Error", message: String(error) } })}\n`);
    process.exitCode = 1;
  },
);
