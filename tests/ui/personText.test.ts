import { expect, test } from "vitest";
import { DestLabel, Journey, Need, PState } from "../../src/sim/people";
import { errandLine, goalLine, timeLeftIsShort, NEED_LABELS } from "../../src/ui/personText";

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
