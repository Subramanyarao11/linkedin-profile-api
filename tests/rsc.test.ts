import { describe, expect, it } from "vitest";
import {
  collectCardText,
  findAsyncComponent,
  parseFlightRecords,
  parseHydrationRecords
} from "../src/extractor/rsc.js";

const componentId = "com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity";
const stream = [
  '0:["$","div",null,{"componentkey":"profile.About","children":"$1"}]\n',
  '1:["$","p",null,{"children":["About","$2"]}]\n',
  '2:"Builds useful products."\n',
  `3:{"newComponentId":"${componentId}","requestedArguments":{"payload":{"profileId":"abc"},"requestMetadata":{"$type":"metadata"}}}\n`
].join("");

describe("RSC parsing", () => {
  it("parses React Flight records and follows rendered references", () => {
    expect(collectCardText(parseFlightRecords(stream), "About")).toEqual([
      "About",
      "Builds useful products."
    ]);
  });

  it("follows the lazy initialContent wrapper used by live profile cards", () => {
    const wrapped = [
      '0:{"componentKey":"profile.About","children":["$","$L5",null,{"initialContent":"$L1"}]}\n',
      '1:["$","section",null,{"children":"$L2"}]\n',
      '2:["$","p",null,{"textProps":{"children":["A complete about paragraph."]}}]\n'
    ].join("");

    expect(collectCardText(parseFlightRecords(wrapped), "About")).toEqual([
      "A complete about paragraph."
    ]);
  });

  it("finds async component request metadata in hydration chunks", () => {
    const html = `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([
      stream.slice(0, 80),
      stream.slice(80)
    ])};</script>`;
    const request = findAsyncComponent(parseHydrationRecords(html), componentId);

    expect(request).toEqual(expect.objectContaining({
      newComponentId: componentId,
      requestedArguments: expect.objectContaining({ payload: { profileId: "abc" } })
    }));
  });

  it("ignores malformed and non-JSON Flight rows", () => {
    const records = parseFlightRecords("1:I[1,2]\n2:not-json\n3:{\"ok\":true}\n");
    expect([...records.entries()]).toEqual([["3", { ok: true }]]);
  });
});
