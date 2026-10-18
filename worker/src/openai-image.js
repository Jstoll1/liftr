// The Creative Engine's only line to OpenAI, and the only code that reads
// OPENAI_API_KEY1. The existing features keep OPENAI_API_KEY and never come
// through here. Returns { bytes, cost, usage } or throws with a message
// that is safe to show the owner (never the key).
import { PRICE } from "./creative-types.js";

export const IMAGE_MODEL = "gpt-image-1";

export async function drawImage(env, { prompt, size = "1024x1024", quality = "medium", background = "transparent" }, fetchImpl = fetch) {
  if (!env.OPENAI_API_KEY1) throw new Error("OPENAI_API_KEY1 is not set on the Worker.");
  const res = await fetchImpl("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY1}` },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, quality, background, output_format: "png", n: 1 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data?.error?.message || `OpenAI answered ${res.status}`).slice(0, 300);
    const err = new Error(msg);
    err.status = res.status;
    // A refusal on content is final; a rate limit or an outage is worth another try.
    err.retry = res.status === 429 || res.status >= 500;
    throw err;
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) { const err = new Error("OpenAI returned no image."); err.retry = true; throw err; }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const u = data.usage || {};
  const textIn = u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0;
  const imageIn = u.input_tokens_details?.image_tokens ?? 0;
  const cost = +(textIn * PRICE.textIn + imageIn * PRICE.imageIn + (u.output_tokens || 0) * PRICE.imageOut).toFixed(4);
  return { bytes, cost, usage: u };
}
