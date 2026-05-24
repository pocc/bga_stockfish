import { describe, expect, test } from "vitest";
import {
  extractCentrifugeAuth,
  isVisitorId,
  channelsFor,
  buildHandshake,
  parseFrames,
} from "../src/centrifuge";

describe("extractCentrifugeAuth", () => {
  // Shape captured live: completesetup("chess","Chess", <tableId>, <userId>,
  //   /*archivemask_begin*/"<token>"/*archivemask_end*/, "0","", {...})
  const sample = (uid: string, token: string) =>
    `globalThis.gameui.completesetup( "chess", "Chess", 855420157, ${uid}, /*archivemask_begin*/"${token}"/*archivemask_end*/, "0","", {"players":{}})`;

  test("extracts uid + token from a logged-in game page", () => {
    const got = extractCentrifugeAuth(sample("99861258", "c6d35f6f99d32f9e3849476421e5fdef"));
    expect(got).toEqual({ userId: "99861258", token: "c6d35f6f99d32f9e3849476421e5fdef" });
  });

  test("captures the negative visitor uid (stale-cookie detection)", () => {
    const got = extractCentrifugeAuth(sample("-531514359", "abcdef0123456789abcdef0123456789"));
    expect(got?.userId).toBe("-531514359");
    expect(isVisitorId(got!.userId)).toBe(true);
    expect(isVisitorId("99861258")).toBe(false);
  });

  test("returns null when the markers are absent", () => {
    expect(extractCentrifugeAuth("<html>no token here</html>")).toBeNull();
  });
});

describe("channelsFor + buildHandshake", () => {
  test("subscribes to bus, emergency, player, and each table", () => {
    expect(channelsFor("99861258", ["855420157", "856262854"])).toEqual([
      "bgamsg",
      "/general/emergency",
      "/player/p99861258",
      "/table/t855420157",
      "/table/t856262854",
    ]);
  });

  test("handshake is newline-delimited: connect id=1 then one subscribe per channel", () => {
    const frame = buildHandshake({
      userId: "99861258",
      username: "bot_stockfish",
      token: "tok",
      channels: ["bgamsg", "/table/t1"],
    });
    const lines = frame.split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      connect: { data: { user_id: "99861258", username: "bot_stockfish", credentials: "tok" }, name: "js" },
      id: 1,
    });
    expect(lines[1]).toEqual({ subscribe: { channel: "bgamsg" }, id: 2 });
    expect(lines[2]).toEqual({ subscribe: { channel: "/table/t1" }, id: 3 });
  });
});

describe("parseFrames", () => {
  test("classifies the bare {} server ping", () => {
    const frames = parseFrames("{}");
    expect(frames).toHaveLength(1);
    expect(frames[0].isPing).toBe(true);
  });

  test("splits multiple newline-delimited commands", () => {
    const frames = parseFrames('{"id":2,"subscribe":{}}\n{"id":3,"subscribe":{}}');
    expect(frames).toHaveLength(2);
    expect(frames.every((f) => !f.isPing)).toBe(true);
  });

  test("surfaces an async push with its channel", () => {
    const frames = parseFrames('{"push":{"channel":"/table/t855420157","pub":{"data":{"x":1}}}}');
    expect(frames[0].push?.channel).toBe("/table/t855420157");
    expect(frames[0].push?.pub).toEqual({ data: { x: 1 } });
    expect(frames[0].isPing).toBe(false);
  });

  test("tolerates an unparseable line without throwing", () => {
    const frames = parseFrames("not json");
    expect(frames[0].obj).toBeNull();
  });
});
