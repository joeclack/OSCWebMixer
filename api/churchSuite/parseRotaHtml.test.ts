import assert from "assert";
import { readFileSync } from "fs";
import path from "path";
import {
  membersForDate,
  parseRotaOverviewHtml,
} from "./parseRotaHtml";
import {
  buildRotaPeople,
  findAuxChannelForRole,
  mapMembersToAuxs,
} from "../userProvider/rotaUtils";

const fixture = readFileSync(
  path.join(__dirname, "fixtures", "rotaOverview.sample.html"),
  "utf8",
);

const parsed = parseRotaOverviewHtml(fixture);
assert.equal(parsed.length, 1);

const members = membersForDate(parsed, new Date(2025, 5, 8), [
  "Worship Team",
]);
assert.equal(members.length, 2);
assert.equal(members[0].name, "Jane Smith");
assert.equal(members[0].role, "LV");
assert.equal(members[0].id, "jane-smith");

const people = buildRotaPeople(members);
assert.equal(people.length, 2);
assert.deepEqual(people[0].roles, ["LV"]);

const auxList = mapMembersToAuxs(
  [
    { label: "LV", channel: 8, extraRoleNames: [] },
    { label: "Drums", channel: 2, extraRoleNames: [] },
  ],
  members,
);
assert.equal(auxList[0].user?.name, "Jane Smith");
assert.equal(findAuxChannelForRole(auxList, "Drums"), 2);

console.log("rota tests passed");
