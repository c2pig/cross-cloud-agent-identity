const KNOWN_CITIES = ["austin", "denver", "seattle"];
// Order matters: "townhouse" must be checked before "house" since
// "townhouses" contains "house" as a substring.
const KNOWN_TYPES = ["townhouse", "condo", "house"];

export function parseCriteria(message) {
  const m = message.toLowerCase();
  const criteria = {};

  const city = KNOWN_CITIES.find((c) => m.includes(c));
  if (city) criteria.city = city[0].toUpperCase() + city.slice(1);

  const type = KNOWN_TYPES.find((t) => m.includes(t));
  if (type) criteria.type = type;

  const priceMatch = m.match(/\$?\s?(\d[\d,]*)\s?(k|000)?\b/);
  const underMatch = m.match(/(?:under|below|max(?:imum)?|budget of|up to)\s*\$?\s?(\d[\d,.]*)\s?(k|m)?/);
  if (underMatch) {
    let value = parseFloat(underMatch[1].replace(/,/g, ""));
    if (underMatch[2] === "k") value *= 1_000;
    if (underMatch[2] === "m") value *= 1_000_000;
    criteria.maxPrice = Math.round(value);
  } else if (priceMatch && m.includes("$")) {
    let value = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (priceMatch[2] === "k") value *= 1_000;
    criteria.maxPrice = Math.round(value);
  }

  const bedMatch = m.match(/(\d+)\s*(?:\+)?\s*(?:bed|bedroom|br)\b/);
  if (bedMatch) criteria.minBedrooms = parseInt(bedMatch[1], 10);

  return criteria;
}

export function describeCriteria(criteria) {
  const parts = [];
  if (criteria.city) parts.push(`city: ${criteria.city}`);
  if (criteria.type) parts.push(`type: ${criteria.type}`);
  if (criteria.maxPrice) parts.push(`max price: $${Number(criteria.maxPrice).toLocaleString()}`);
  if (criteria.minBedrooms) parts.push(`min bedrooms: ${criteria.minBedrooms}`);
  return parts.length ? parts.join(", ") : "no specific criteria";
}
