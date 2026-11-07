/**
 * Drain clinical-check queue with N parallel Playwright pages (same logged-in profile).
 *
 *   npm i -D playwright
 *   npx playwright install chromium
 *   node tools/parallel-clinical-browser.mjs
 *
 * First run opens Chrome with .pw-clinical-profile — log in to rx.everydaymeds.co.uk once.
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
const WORKERS = Number(process.env.CLINICAL_WORKERS || 5);
const ORDERS_PER_WORKER = Number(process.env.CLINICAL_PER_WORKER || 10);
const SCR_MODE = process.env.CLINICAL_SCR_MODE || "not_accessed";

async function workerLoop(page, workerId, stats) {
  for (let i = 0; i < ORDERS_PER_WORKER; i++) {
    await page.goto(QUEUE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ensureClinicalTab(page);
    const url = await firstOrderUrl(page);
    if (!url) {
      console.log(`[w${workerId}] queue empty`);
      return;
    }
    console.log(`[w${workerId}] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('.od2-action[data-action="dispensary"]', { timeout: 30000 }).catch(() => null);
    const res = await runClinicalCheckOnPage(page, SCR_MODE);
    if (res.ok) {
      stats.ok += 1;
      console.log(`[w${workerId}] OK ${res.path}`);
    } else {
      stats.fail += 1;
      console.error(`[w${workerId}] FAIL ${res.err}`);
    }
    await page.waitForTimeout(800);
  }
}

async function main() {
  const browser = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    channel: "chrome",
  });
  const pages = [];
  for (let i = 0; i < WORKERS; i++) {
    pages.push(browser.pages()[i] || (await browser.newPage()));
  }
  const stats = { ok: 0, fail: 0 };
  await Promise.all(pages.map((p, i) => workerLoop(p, i + 1, stats)));
  console.log(`Done. ok=${stats.ok} fail=${stats.fail} (workers=${WORKERS}, perWorker=${ORDERS_PER_WORKER})`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
