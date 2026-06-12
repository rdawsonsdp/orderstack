/**
 * Creates a staff login + membership for a restaurant. Uses raw REST (not
 * supabase-js — its realtime client needs Node 22's native WebSocket).
 *   node --env-file=.env.local scripts/create-staff.mjs <email> <password> <restaurant-slug> [role]
 */
const [email, password, slug, role = "owner"] = process.argv.slice(2);
if (!email || !password || !slug) {
  console.error(
    "usage: node --env-file=.env.local scripts/create-staff.mjs <email> <password> <slug> [role]"
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const restaurants = await fetch(
  `${url}/rest/v1/restaurants?slug=eq.${slug}&select=id,name`,
  { headers }
).then((r) => r.json());
const restaurant = restaurants[0];
if (!restaurant) {
  console.error(`restaurant '${slug}' not found`);
  process.exit(1);
}

const user = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers,
  body: JSON.stringify({ email, password, email_confirm: true }),
}).then((r) => r.json());
if (!user.id) {
  console.error("createUser failed:", JSON.stringify(user));
  process.exit(1);
}

const membership = await fetch(`${url}/rest/v1/staff_memberships`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    user_id: user.id,
    restaurant_id: restaurant.id,
    role,
  }),
});
if (!membership.ok) {
  console.error("membership insert failed:", await membership.text());
  process.exit(1);
}

console.log(`${role} '${email}' created for ${restaurant.name} (${slug})`);
