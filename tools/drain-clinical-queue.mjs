/**
 * Sequential drain: Playwright + persistent profile (login once in headed Chrome).
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node tools/drain-clinical-queue.mjs
 */
import { chromium } from "playwright";
import path from "path";
import {
  QUEUE_URL,
  ensureClinicalTab,
  firstOrderUrl,
  runClinicalCheckOnPage,
} from "./clinical-check-lib.mjs";

const USER_DATA = path.join(process.cwd(), ".pw-clinical-profile");
const MAX_ORDERS = Number(process.env.CLINICAL_MAX || 120);
const SCR_MODE = process.env.CLINICAL_SCR_MODE || "not_accessed";

async function main() {
  const browser = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    channel: "chrome",
  });
  const page = browser.pages()[0] || (await browser.newPage());
  let done = 0;
  let fail = 0;

  await page.goto(QUEUE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await ensureClinicalTab(page);

  for (let i = 0; i < MAX_ORDERS; i++) {
    const url = await firstOrderUrl(page);
    if (!url) {
      console.log(`Done. Processed=${done} failed=${fail}. Queue empty.`);
      break;
    }
    console.log(`[${i + 1}] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('.od2-action[data-action="dispensary"]', { timeout: 30000 }).catch(() => null);
    const res = await runClinicalCheckOnPage(page, SCR_MODE);
    if (res.ok) {
      done += 1;
      console.log(`  OK ${res.path}`);
    } else {
      fail += 1;
      console.error(`  FAIL ${res.err}`);
      if (process.env.CLINICAL_STOP_ON_ERROR === "1") break;
    }
    await page.goto(QUEUE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ensureClinicalTab(page);
    await page.waitForTimeout(800);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
