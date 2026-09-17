import { env } from "./env";
import { app } from "./app";

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`PostPilot API listening on port ${env.PORT}`);
});
