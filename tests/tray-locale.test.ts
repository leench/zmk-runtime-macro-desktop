import assert from "node:assert/strict";
import { test } from "node:test";
import { setTrayLocale } from "../src/bridge.ts";
import { getMessages, resolveLocale } from "../src/i18n.ts";
import type { Locale } from "../src/i18n.ts";

/**
 * Frontend half of the tray locale contract.
 *
 * The Rust `set_tray_locale` command accepts exactly `en` and `zh-CN` and never
 * derives a language from the host, so the frontend may only ever send the
 * result of `resolveLocale` for the two known locales. These checks are pure
 * locale/bridge behavior: they never open HID and never touch the tray itself.
 */
const TRAY_LOCALE_TAGS: readonly string[] = ["en", "zh-CN"];
const TRAY_LOCALES: readonly Locale[] = ["en", "zh-CN"];

test("resolveLocale maps every preference onto an exact tray locale tag", () => {
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("zh-CN"), "zh-CN");
  for (const preference of ["system", "zh-CN", "en"] as const) {
    const locale = resolveLocale(preference);
    assert.ok(
      TRAY_LOCALE_TAGS.includes(locale),
      `${preference} resolved to ${locale}, which the tray command rejects`,
    );
  }
});

test("tray locales are the UI locales and nothing else", () => {
  assert.deepEqual(TRAY_LOCALE_TAGS, [...TRAY_LOCALES]);
  for (const locale of TRAY_LOCALES) {
    // Both locales must exist as message tables; the tray mirrors the UI locale
    // rather than introducing an extra one.
    assert.ok(getMessages(locale).settings.length > 0);
  }
});

test("setTrayLocale never reports success outside a Tauri host", async () => {
  // The App only calls this behind its Tauri check, so a browser preview must
  // not end up with a resolved label update: without Tauri internals the bridge
  // rejects and the call site stays silent.
  await assert.rejects(() => setTrayLocale("en"));
});
