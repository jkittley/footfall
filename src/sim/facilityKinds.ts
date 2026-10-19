// A leaf module: needs.ts reads these at load time and must not import facilities.ts, which imports it.

export enum FacilityKind {
  Retail = 0,
  Toilet = 1,
  Seating = 2,
}

export enum Tenant {
  None = 0,
  FoodDrink = 1,
  Newsagent = 2,
  PhoneCharging = 3,
  Electronics = 4,
}
