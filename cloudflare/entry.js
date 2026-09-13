import apiWorker from "./src/index.js";
import { onRequest as telegramRequest } from "../functions/api/telegram.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/telegram") {
      return telegramRequest({ request, env, executionCtx: ctx });
    }

    if (url.pathname.startsWith("/api/")) {
      return apiWorker.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  }
};
