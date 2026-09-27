import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  activeQuoteRequests,
  activeSecurityCodes,
  loadAppConfigFromObject,
  toUserSettings
} from "../dist-electron/src/config.js";
import { previewProfileImport } from "../dist-electron/src/settings/profile.js";
import { fetchQuotesWithFallback } from "../dist-electron/src/services/quotes.js";

const root = process.cwd();
const defaults = JSON.parse(await readFile(path.join(root, "config/defaults.json"), "utf8"));
const example = await readFile(path.join(root, "config/example-profile.json"), "utf8");
const current = toUserSettings(loadAppConfigFromObject(defaults, {}));
const preview = previewProfileImport(current, example, "replace");
if (!preview.valid || !preview.nextSettings) {
  throw new Error("Public example profile is invalid: " + JSON.stringify(preview.issues));
}
const config = loadAppConfigFromObject(preview.nextSettings, {});
const codes = activeSecurityCodes(config);
// 行情请求带显式市场（§3-2）。
const result = await fetchQuotesWithFallback(activeQuoteRequests(config), config.providers.quote);
const received = new Set(result.quotes.map((quote) => quote.code));
const missing = codes.filter((code) => !received.has(code));
const missingSourceTimes = result.quotes
  .filter((quote) => !quote.updatedAt)
  .map((quote) => quote.code);

console.log(
  JSON.stringify(
    {
      requested: codes.length,
      received: result.quotes.length,
      source: result.source,
      missing,
      missingSourceTimes,
      sample: result.quotes.slice(0, 5).map((quote) => ({
        code: quote.code,
        name: quote.name,
        price: quote.price,
        updatedAt: quote.updatedAt
      }))
    },
    null,
    2
  )
);

if (missingSourceTimes.length > 0) {
  throw new Error("Missing quote source times: " + missingSourceTimes.join(", "));
}

if (missing.length > 0) {
  throw new Error("Missing configured quotes: " + missing.join(", "));
}
