import { env } from "./env";
import express from "express";
import "express-async-errors";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { metaAuthRouter } from "./routes/metaAuth";
import { socialAccountsRouter } from "./routes/socialAccounts";
import { mediaRouter } from "./routes/media";
import { postsRouter } from "./routes/posts";
import { schedulesRouter } from "./routes/schedules";
import { publishHistoryRouter } from "./routes/publishHistory";
import { campaignsRouter } from "./routes/campaigns";

export const app = express();

app.use(cors({ origin: env.WEB_BASE_URL }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/auth", authRouter);
app.use("/auth/meta", metaAuthRouter);
app.use("/social-accounts", socialAccountsRouter);
app.use("/media", mediaRouter);
app.use("/posts", postsRouter);
app.use("/schedules", schedulesRouter);
app.use("/publish-history", publishHistoryRouter);
app.use("/campaigns", campaignsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
