import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./lib/env.js";

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
    app.log.info(`API listening on 0.0.0.0:${env.API_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
