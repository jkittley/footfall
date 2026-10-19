// A leaf module, so needs.ts can build its tables at load time despite the facilities/world/needs import cycle.

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
