import { Hono } from "hono";

export const indexationRouter = new Hono();

// Get current Belgian health index
indexationRouter.get("/health-index", async (c) => {
  // TODO: Fetch from Statbel API or cached value
  // The health index is published monthly by Statbel (Belgian statistics office)
  // URL: https://statbel.fgov.be/en/themes/consumer-prices/health-index
  return c.json({
    currentIndex: 0,
    month: "",
    year: 0,
    source: "Statbel",
    lastUpdated: null,
  });
});

// Get health index history
indexationRouter.get("/health-index/history", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  return c.json({ data: [] });
});

// Calculate indexed rent for a specific lease
indexationRouter.get("/calculate/:leaseId", async (c) => {
  const leaseId = c.req.param("leaseId");

  // Belgian rent indexation formula:
  // New rent = (base rent * current health index) / base health index
  //
  // Where:
  // - base rent = rent at lease start (or last formal revision)
  // - base health index = health index of the month BEFORE the lease start month
  // - current health index = health index of the month BEFORE the anniversary month
  //
  // Important: Indexation can only happen on the anniversary date of the lease
  // Regional differences:
  // - Flanders: automatic indexation allowed
  // - Wallonia: landlord must request it within 3 months of anniversary
  // - Brussels: similar to Wallonia, with energy performance restrictions

  return c.json({
    leaseId,
    baseRent: 0,
    baseIndex: 0,
    currentIndex: 0,
    newRent: 0,
    difference: 0,
    effectiveDate: null,
    region: null,
    formula: "newRent = baseRent * (currentIndex / baseIndex)",
  });
});

// Bulk calculate all upcoming indexations
indexationRouter.get("/upcoming", async (c) => {
  // Find all leases with indexation enabled and anniversary in the next 30/60/90 days
  const days = Number(c.req.query("days")) || 30;
  return c.json({ data: [], period: `next ${days} days` });
});

// Apply indexation to a lease (updates the rent)
indexationRouter.post("/apply/:leaseId", async (c) => {
  const leaseId = c.req.param("leaseId");
  // TODO: Update lease rent, create indexation record, generate notification letter
  return c.json({ message: "Indexation applied", leaseId });
});
