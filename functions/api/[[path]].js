import worker from "../../cloudflare/src/index.js";

export async function onRequest(context) {
  return worker.fetch(context.request, context.env, context.executionCtx);
}
