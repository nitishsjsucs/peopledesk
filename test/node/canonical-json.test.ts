// canonicalJson feeds the pending-action arguments digest (an integrity check, not a security control)
// and the dataset hash. Both need the same bytes for the same value, whatever the key order, and a
// standard SHA-256 over them.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/shared/canonical-json.ts";
import { sha256Hex } from "../../src/shared/sha256.ts";

const nodeSha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const ticketArgs = {
  category: "it",
  subject: "Laptop will not boot",
  description: "My laptop shows a black screen after the logo.",
  priority: "normal",
};

describe("canonicalJson", () => {
  it("is independent of key insertion order, at every depth", () => {
    const a = { b: 1, a: { y: [1, { q: true, p: null }], x: "s" } };
    const b = { a: { x: "s", y: [1, { p: null, q: true }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"x":"s","y":[1,{"p":null,"q":true}]},"b":1}');
  });

  it("keeps array order, because order in an array is meaningful", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson({ k: ["b", "a"] })).not.toBe(canonicalJson({ k: ["a", "b"] }));
  });

  it("sorts string keys by code unit, not by locale", () => {
    // Uppercase before lowercase and accented letters after ASCII: a localeCompare sort would differ.
    expect(canonicalJson({ b: 1, a: 2, Z: 3, é: 4 })).toBe('{"Z":3,"a":2,"b":1,"é":4}');
  });

  it("puts integer-like keys first in numeric order (ECMAScript property order), deterministically", () => {
    expect(canonicalJson({ "10": "x", b: 1, "2": "y" })).toBe('{"2":"y","10":"x","b":1}');
    expect(canonicalJson({ b: 1, "2": "y", "10": "x" })).toBe(canonicalJson({ "10": "x", b: 1, "2": "y" }));
  });

  it("drops undefined members and writes no whitespace, like JSON.stringify", () => {
    expect(canonicalJson({ a: undefined, b: "two words", c: [] })).toBe('{"b":"two words","c":[]}');
  });

  it("serializes values the way JSON.stringify does, including toJSON", () => {
    const at = new Date(Date.UTC(2026, 9, 1));
    expect(canonicalJson({ at })).toBe('{"at":"2026-10-01T00:00:00.000Z"}');
    expect(canonicalJson(at)).toBe(JSON.stringify(at));
    for (const v of [null, true, 0, -1.5, "x", "line\nbreak", [], {}]) expect(canonicalJson(v)).toBe(JSON.stringify(v));
  });

  it("is a fixed point after a JSON round trip", () => {
    const value = { z: [{ b: 2, a: 1 }], a: { at: new Date(0), n: null }, m: "ünïcødé" };
    const once = canonicalJson(value);
    expect(canonicalJson(JSON.parse(once))).toBe(once);
  });
});

describe("arguments digest", () => {
  it("is stable for the same arguments in any key order", () => {
    const reordered = { priority: "normal", description: ticketArgs.description, subject: ticketArgs.subject, category: "it" };
    expect(sha256Hex(canonicalJson(reordered))).toBe(sha256Hex(canonicalJson(ticketArgs)));
  });

  it("is pinned, so a change to serialization or hashing cannot pass silently", () => {
    // Checked independently with: printf '%s' '<canonical json>' | shasum -a 256
    expect(canonicalJson(ticketArgs)).toBe(
      '{"category":"it","description":"My laptop shows a black screen after the logo.","priority":"normal","subject":"Laptop will not boot"}',
    );
    expect(sha256Hex(canonicalJson(ticketArgs))).toBe("7f962d13ed9531aeee66731be292790f4303292fe244a7e268e640c62ee5587d");
  });

  it("changes when any argument changes", () => {
    const base = sha256Hex(canonicalJson(ticketArgs));
    expect(sha256Hex(canonicalJson({ ...ticketArgs, priority: "high" }))).not.toBe(base);
    expect(sha256Hex(canonicalJson({ ...ticketArgs, subject: `${ticketArgs.subject} ` }))).not.toBe(base);
  });
});

describe("sha256Hex", () => {
  it("matches node:crypto across SHA-256 block boundaries and multi-byte UTF-8", () => {
    for (let n = 0; n <= 140; n++) {
      for (const ch of ["a", "é", "€", "😀"]) {
        const text = ch.repeat(n);
        expect(sha256Hex(text), `${JSON.stringify(ch)} x ${n}`).toBe(nodeSha256(text));
      }
    }
  });

  it("matches the FIPS 180-2 test vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });
});
