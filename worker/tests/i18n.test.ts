import { describe, expect, test } from "vitest";
import { t, SUPPORTED_LANGS } from "../src/i18n";

describe("premiumGate i18n", () => {
  const LINK = "https://stockfish.ross.gg/go/premium?u=1&t=2&m=realtime";

  test("English substitutes the {link} placeholder", () => {
    const msg = t("premiumGate", "en", { link: LINK });
    expect(msg).toContain(LINK);
    expect(msg).not.toContain("{link}");
    expect(msg).toContain("BGA Premium");
  });

  test("every supported language has a translation with the link and no leftover placeholder", () => {
    for (const lang of SUPPORTED_LANGS) {
      const msg = t("premiumGate", lang, { link: LINK });
      expect(msg, `lang=${lang} empty`).not.toBe("");
      expect(msg, `lang=${lang} missing link`).toContain(LINK);
      expect(msg, `lang=${lang} leftover placeholder`).not.toContain("{link}");
      // House style: no em-dashes in any user-facing string.
      expect(msg, `lang=${lang} has em-dash`).not.toContain("—");
      // "BGA Premium" is intentionally left untranslated everywhere.
      expect(msg, `lang=${lang} missing BGA Premium`).toContain("BGA Premium");
    }
  });

  test("unknown language falls back to English", () => {
    expect(t("premiumGate", "xx", { link: LINK })).toBe(t("premiumGate", "en", { link: LINK }));
  });
});

describe("premiumGateAsyncOther i18n", () => {
  const GAME = "https://boardgamearena.com/table?table=860987170";

  test("English substitutes the {gameLink} placeholder", () => {
    const msg = t("premiumGateAsyncOther", "en", { gameLink: GAME });
    expect(msg).toContain(GAME);
    expect(msg).not.toContain("{gameLink}");
  });

  test("every supported language has the kept-game line with the link and no leftover placeholder", () => {
    for (const lang of SUPPORTED_LANGS) {
      const msg = t("premiumGateAsyncOther", lang, { gameLink: GAME });
      expect(msg, `lang=${lang} empty`).not.toBe("");
      expect(msg, `lang=${lang} missing gameLink`).toContain(GAME);
      expect(msg, `lang=${lang} leftover placeholder`).not.toContain("{gameLink}");
      // House style: no em-dashes in any user-facing string.
      expect(msg, `lang=${lang} has em-dash`).not.toContain("—");
    }
  });

  test("unknown language falls back to English", () => {
    expect(t("premiumGateAsyncOther", "xx", { gameLink: GAME }))
      .toBe(t("premiumGateAsyncOther", "en", { gameLink: GAME }));
  });
});
