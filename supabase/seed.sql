-- Seed: Authentic Cooking Soul Food Kitchen (pilot restaurant)
-- Menu captured from acsoulfood.com/order (Menufy) on 2026-06-12.
-- Run via `supabase db reset` (applies migrations then this file) or psql.

insert into restaurants (id, slug, name, branding, timezone, status, platform_fee_cents, plan)
values (
  '11111111-1111-1111-1111-111111111111',
  'ac-soul-food',
  'Authentic Cooking Soul Food Kitchen',
  '{
    "logoUrl": "https://folfgrybqtssqkqiyygn.supabase.co/storage/v1/object/public/branding/ac-soul-food.png",
    "heroUrl": "https://folfgrybqtssqkqiyygn.supabase.co/storage/v1/object/public/branding/ac-soul-food-hero.jpg",
    "colors": { "primary": "#1a1714", "accent": "#d01f27", "background": "#ffffff" },
    "font": "system-ui"
  }',
  'America/Chicago',
  'live',
  129,
  'free'
);

insert into locations (
  id, restaurant_id, name, address_line1, address_line2, city, state, postal_code,
  lat, lng, phone, pickup_enabled, delivery_enabled, delivery_radius_m,
  prep_time_min, tax_rate
)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Chatham',
  '306 E 75th St',
  'Suite B',
  'Chicago', 'IL', '60619',
  41.7585, -87.6149,
  '(773) 366-6357',
  true, true, 8000,
  20,
  0.10750 -- Chicago prepared-food rate placeholder; confirm before go-live
);

-- Mon & Tue closed (no rows); Wed-Sat 11a-8p; Sun 2p-6p (0 = Sunday)
insert into business_hours (location_id, day_of_week, opens, closes) values
  ('22222222-2222-2222-2222-222222222222', 3, '11:00', '20:00'),
  ('22222222-2222-2222-2222-222222222222', 4, '11:00', '20:00'),
  ('22222222-2222-2222-2222-222222222222', 5, '11:00', '20:00'),
  ('22222222-2222-2222-2222-222222222222', 6, '11:00', '20:00'),
  ('22222222-2222-2222-2222-222222222222', 0, '14:00', '18:00');

insert into menus (id, restaurant_id, name, active)
values ('33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111', 'Main Menu', true);

insert into categories (id, menu_id, name, sort) values
  ('44444444-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Dinners', 1),
  ('44444444-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Side Dishes', 2),
  ('44444444-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Sandwiches', 3),
  ('44444444-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', 'Tenders (Fried or Jerk)', 4),
  ('44444444-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'Dessert', 5);

-- Modifier groups (reusable). Dinner sides are included in dinner price ($0 deltas).
insert into modifier_groups (id, restaurant_id, name, min_select, max_select, required) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Choice of 1st Side', 1, 1, true),
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Choice of 2nd Side', 1, 1, true),
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Size', 1, 1, true);

insert into modifiers (modifier_group_id, name, price_delta_cents, sort) values
  -- Choice of 1st Side
  ('55555555-0000-0000-0000-000000000001', 'Sauteed Spinach', 0, 1),
  ('55555555-0000-0000-0000-000000000001', 'Spaghetti', 0, 2),
  -- Choice of 2nd Side
  ('55555555-0000-0000-0000-000000000002', 'Jazzy Sweet Potatoes', 0, 1),
  ('55555555-0000-0000-0000-000000000002', 'Cheesy Macaroni and Cheese', 0, 2),
  ('55555555-0000-0000-0000-000000000002', 'Collard Greens', 0, 3),
  ('55555555-0000-0000-0000-000000000002', 'Red Beans and Rice', 0, 4),
  ('55555555-0000-0000-0000-000000000002', 'Sauteed Spinach', 0, 5),
  ('55555555-0000-0000-0000-000000000002', 'Spaghetti', 0, 6),
  -- Size (tenders; base price = 4 tenders)
  ('55555555-0000-0000-0000-000000000003', '4 Tenders', 0, 1),
  ('55555555-0000-0000-0000-000000000003', '8 Tenders', 500, 2),
  ('55555555-0000-0000-0000-000000000003', '10 Tenders', 600, 3);

insert into items (id, category_id, name, description, price_cents, sort, is_available) values
  -- Dinners: "All dinners come with your choice of two sides and a johnny cake."
  ('66666666-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001',
   'Grilled Catfish Fillets', 'Four pieces of catfish grilled to perfection. Comes with your choice of two sides and a johnny cake.', 2000, 1, true),
  ('66666666-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001',
   'Jerked Chicken Tenders', 'Four jerked chicken tenders. Comes with your choice of two sides and a johnny cake.', 1700, 2, true),
  ('66666666-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001',
   'Southern Fried Catfish', 'Four pieces of catfish fried to perfection! Comes with your choice of two sides and a johnny cake.', 2000, 3, true),
  ('66666666-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001',
   'Louisiana Fried Chicken Tenders', 'Four fried chicken tenders cooked with our spin on it! Comes with your choice of two sides and a johnny cake.', 1700, 4, true),
  -- Side Dishes
  ('66666666-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002',
   'Jazzy Sweet Potatoes', null, 700, 1, true),
  ('66666666-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002',
   'Cheesy Macaroni and Cheese', null, 700, 2, true),
  ('66666666-0000-0000-0000-000000000007', '44444444-0000-0000-0000-000000000002',
   'Collard Greens', null, 600, 3, true),
  ('66666666-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000002',
   'Red Beans and Rice', null, 500, 4, true),
  ('66666666-0000-0000-0000-000000000009', '44444444-0000-0000-0000-000000000002',
   'Sauteed Spinach', null, 500, 5, true),
  ('66666666-0000-0000-0000-000000000010', '44444444-0000-0000-0000-000000000002',
   'Spaghetti', null, 500, 6, true),
  ('66666666-0000-0000-0000-000000000011', '44444444-0000-0000-0000-000000000002',
   'Johnny Cakes (2)', null, 400, 7, true),
  -- Sandwiches: "All orders come with hand cut fries and coleslaw."
  ('66666666-0000-0000-0000-000000000012', '44444444-0000-0000-0000-000000000003',
   'World''s Best Turkey Burger', 'Turkey burger on brioche bun with lettuce, tomato, house sauce, pickle, grilled onions, and cheese. Comes with hand cut fries and coleslaw.', 1200, 1, true),
  ('66666666-0000-0000-0000-000000000013', '44444444-0000-0000-0000-000000000003',
   'Jerk Chicken Pita', 'Jerk chicken on pita bread with spinach, tomato, red onions, and house sauce. Comes with hand cut fries and coleslaw.', 1200, 2, true),
  ('66666666-0000-0000-0000-000000000014', '44444444-0000-0000-0000-000000000003',
   'Catfish Po''Boy', 'Southern fried catfish with lettuce, tomato, pickles, and house sauce. Comes with hand cut fries and coleslaw.', 1476, 3, true),
  ('66666666-0000-0000-0000-000000000015', '44444444-0000-0000-0000-000000000003',
   'Fried Chicken Po'' Boy', 'Fried chicken on a toasted bun with lettuce, tomato, and remoulade sauce. Comes with hand cut fries and coleslaw.', 1476, 4, true),
  -- Tenders: base price = 4 tenders; size modifier upsizes
  ('66666666-0000-0000-0000-000000000016', '44444444-0000-0000-0000-000000000004',
   'Fried Tenders', 'Comes with hand cut fries and coleslaw.', 1099, 1, true),
  ('66666666-0000-0000-0000-000000000017', '44444444-0000-0000-0000-000000000004',
   'Jerk Tenders', 'Comes with hand cut fries and coleslaw.', 1099, 2, true),
  -- Dessert
  ('66666666-0000-0000-0000-000000000018', '44444444-0000-0000-0000-000000000005',
   'Peach Cobbler', null, 500, 1, true),
  -- Seasonal item, out of season — seeded unavailable for menu-manager testing
  ('66666666-0000-0000-0000-000000000019', '44444444-0000-0000-0000-000000000005',
   'Thanksgiving Specials', 'Seasonal — order by November 21st.', 6500, 2, false);

insert into item_modifier_groups (item_id, modifier_group_id, sort) values
  -- Dinners get both side choices
  ('66666666-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 1),
  ('66666666-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 2),
  ('66666666-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', 1),
  ('66666666-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002', 2),
  ('66666666-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000001', 1),
  ('66666666-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000002', 2),
  ('66666666-0000-0000-0000-000000000004', '55555555-0000-0000-0000-000000000001', 1),
  ('66666666-0000-0000-0000-000000000004', '55555555-0000-0000-0000-000000000002', 2),
  -- Tenders get the size group
  ('66666666-0000-0000-0000-000000000016', '55555555-0000-0000-0000-000000000003', 1),
  ('66666666-0000-0000-0000-000000000017', '55555555-0000-0000-0000-000000000003', 1);
