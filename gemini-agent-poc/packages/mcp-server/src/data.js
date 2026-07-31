// In-memory mock data only -- no real database, per POC scope.

export const properties = [
  { id: "p1", city: "Austin", type: "condo", price: 385000, bedrooms: 2, bathrooms: 2, address: "12 Riverside Ave", description: "Downtown condo with skyline views." },
  { id: "p2", city: "Austin", type: "house", price: 610000, bedrooms: 4, bathrooms: 3, address: "88 Oakwood Dr", description: "Family house with a large backyard near good schools." },
  { id: "p3", city: "Denver", type: "condo", price: 340000, bedrooms: 1, bathrooms: 1, address: "5 Mile High Ct", description: "Cozy one-bedroom condo, walk to light rail." },
  { id: "p4", city: "Denver", type: "house", price: 725000, bedrooms: 5, bathrooms: 4, address: "201 Rocky Mtn Rd", description: "Spacious mountain-view house with a finished basement." },
  { id: "p5", city: "Seattle", type: "condo", price: 520000, bedrooms: 2, bathrooms: 2, address: "77 Pike Pl", description: "Modern condo near the waterfront." },
  { id: "p6", city: "Seattle", type: "townhouse", price: 480000, bedrooms: 3, bathrooms: 2, address: "14 Fremont Way", description: "Townhouse in a walkable neighborhood." },
  { id: "p7", city: "Austin", type: "townhouse", price: 445000, bedrooms: 3, bathrooms: 2, address: "9 Zilker Ln", description: "New-build townhouse near the greenbelt." },
  { id: "p8", city: "Denver", type: "condo", price: 295000, bedrooms: 1, bathrooms: 1, address: "33 Union Station Blvd", description: "Compact starter condo downtown." },
];

// userId (Auth0 `sub`) -> preference record
export const preferences = new Map();

export function searchProperties({ city, maxPrice, minBedrooms, type } = {}) {
  return properties.filter((p) => {
    if (city && p.city.toLowerCase() !== String(city).toLowerCase()) return false;
    if (maxPrice && p.price > Number(maxPrice)) return false;
    if (minBedrooms && p.bedrooms < Number(minBedrooms)) return false;
    if (type && p.type.toLowerCase() !== String(type).toLowerCase()) return false;
    return true;
  });
}

export function getPreference(userId) {
  return preferences.get(userId) || null;
}

export function updatePreference(userId, patch) {
  const current = preferences.get(userId) || {};
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  preferences.set(userId, updated);
  return updated;
}
