import { expect, test } from "vitest";
import { DestLabel, Journey, Need, PState } from "../../src/sim/people";
import { walkMinutes } from "../../src/sim/routeField";
import { fieldFor } from "../../src/sim/walk";
import { createWorld } from "../../src/sim/world";
import { errandLine, goalFacts, goalLine, timeLeftIsShort, walkFromHere, NEED_LABELS } from "../../src/ui/personText";
import { OX, OY } from "../sim/helpers";

const at = (h: number, m: number): number => 1440 * 3 + h * 60 + m;

test("departing and connecting passengers catch their train", () => {
  const service = { departAt: at(8, 51), destination: "Ashby", platformId: 4 };
  expect(goalLine({ journey: Journey.Departing, service, platformId: 4, exitName: null, destLabel: DestLabel.Home, deadline: at(8, 51) })).toBe(
    "Catch the 08:51 to Ashby, Platform 4",
  );
  expect(goalLine({ journey: Journey.Connecting, service, platformId: 4, exitName: null, destLabel: DestLabel.Home, deadline: at(8, 51) })).toBe(
    "Catch the 08:51 to Ashby, Platform 4",
  );
});

test("a passenger whose service has gone from the timetable still names the platform", () => {
  expect(goalLine({ journey: Journey.Departing, service: null, platformId: 2, exitName: null, destLabel: DestLabel.Home, deadline: at(9, 5) })).toBe(
    "Catch the 09:05, Platform 2",
  );
});

test("arriving passengers leave by an entrance", () => {
  const base = { journey: Journey.Arriving, service: null, platformId: null, exitName: "Quay Lane", deadline: at(9, 10) };
  expect(goalLine({ ...base, destLabel: DestLabel.Work })).toBe("Leave by Quay Lane, going to work by 09:10");
  expect(goalLine({ ...base, destLabel: DestLabel.Home })).toBe("Leave by Quay Lane, going home by 09:10");
  expect(goalLine({ ...base, destLabel: DestLabel.Hotel })).toBe("Leave by Quay Lane, going to a hotel by 09:10");
});

test("time left is short when under the walk from here plus five minutes", () => {
  expect(timeLeftIsShort(10, 6)).toBe(true);
  expect(timeLeftIsShort(11, 6)).toBe(false);
  expect(timeLeftIsShort(4, 0)).toBe(true);
});

test("errand lines", () => {
  expect(errandLine(PState.Walking, -1)).toBeNull();
  expect(errandLine(PState.Waiting, -1)).toBeNull();
  expect(errandLine(PState.Walking, Need.Toilet)).toBe("Looking for a toilet");
  expect(errandLine(PState.InQueue, Need.Toilet)).toBe("Looking for a toilet");
  expect(errandLine(PState.InQueue, Need.Hunger)).toBe("Queueing for food");
  expect(errandLine(PState.InQueue, Need.Thirst)).toBe("Queueing for food");
  expect(errandLine(PState.Walking, Need.Hunger)).toBe("Getting food");
  expect(errandLine(PState.InFacility, Need.Thirst)).toBe("Getting food");
  expect(errandLine(PState.Walking, Need.Tired)).toBe("Looking for somewhere to sit");
  expect(errandLine(PState.Seated, Need.Tired)).toBe("Resting");
  expect(errandLine(PState.Seated, -1)).toBe("Resting");
  expect(errandLine(PState.InFacility, Need.Browse)).toBe("Browsing");
  expect(errandLine(PState.Walking, Need.Charge)).toBe("Charging a phone");
});

test("six need bars, in need order", () => {
  expect(NEED_LABELS).toEqual(["Hunger", "Thirst", "Tired", "Toilet", "Browse", "Charge"]);
});

test("goalFacts reads a departing passenger's service off the world", () => {
  const w = createWorld(3);
  const svc = w.timetable.upcoming(1, w.minute)[0]!;
  const i = w.people.alloc();
  w.people.x[i] = OX + 10.5;
  w.people.y[i] = OY + 56.5;
  w.people.journey[i] = Journey.Departing;
  w.people.goalKey[i] = "platform:1";
  w.people.serviceId[i] = svc.id;
  w.people.deadline[i] = svc.departAt;
  const g = goalFacts(w, i);
  expect(g.service).toEqual({ departAt: svc.departAt, destination: svc.destination, platformId: 1 });
  expect(g.platformId).toBe(1);
  expect(g.exitName).toBeNull();
  expect(goalLine(g)).toMatch(new RegExp(`^Catch the \\d\\d:\\d\\d to ${svc.destination}, Platform 1$`));
});

test("goalFacts names the entrance an arriving passenger leaves by", () => {
  const w = createWorld(3);
  const i = w.people.alloc();
  w.people.x[i] = OX + 10.5;
  w.people.y[i] = OY + 70.5;
  w.people.journey[i] = Journey.Arriving;
  w.people.goalKey[i] = "exit:C";
  w.people.destLabel[i] = DestLabel.Work;
  w.people.deadline[i] = 3 * 1440 + 9 * 60 + 10;
  expect(goalLine(goalFacts(w, i))).toBe("Leave by Footbridge, going to work by 09:10");
});

test("walkFromHere is the unimpeded walk to the goal, or 0 when there is none", () => {
  const w = createWorld(3);
  const i = w.people.alloc();
  w.people.x[i] = OX + 10.5;
  w.people.y[i] = OY + 70.5;
  w.people.goalKey[i] = "exit:A";
  const expected = walkMinutes(fieldFor(w, "exit:A"), w.grid.idx(OX + 10, OY + 70));
  expect(expected).toBeGreaterThan(0);
  expect(walkFromHere(w, i)).toBeCloseTo(expected, 9);
  w.people.goalKey[i] = "";
  expect(walkFromHere(w, i)).toBe(0);
  // Standing on ground the goal can't be reached from.
  w.people.goalKey[i] = "exit:A";
  w.people.x[i] = OX + 60.5;
  w.people.y[i] = OY + 40.5;
  expect(walkFromHere(w, i)).toBe(0);
});
