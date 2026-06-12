import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/dashboard/items/photo — staff uploads a menu item photo.
 * Membership is verified server-side, then the file goes to the public
 * menu-images bucket via service role (no client storage policies needed).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const itemId = form.get("itemId");
  if (!(file instanceof File) || typeof itemId !== "string") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: "UNSUPPORTED_TYPE" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
  }

  const admin = createAdminClient();
  const { data: item } = await admin
    .from("items")
    .select("id, categories (menus (restaurant_id))")
    .eq("id", itemId)
    .single();
  const restaurantId = (
    item as { categories?: { menus?: { restaurant_id?: string } } } | null
  )?.categories?.menus?.restaurant_id;
  if (!restaurantId) {
    return NextResponse.json({ error: "ITEM_NOT_FOUND" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("staff_memberships")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const path = `${restaurantId}/${itemId}-${Date.now()}.${ext}`;
  const { error: uploadError } = await admin.storage
    .from("menu-images")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: "UPLOAD_FAILED" }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("items")
    .update({ image_path: path })
    .eq("id", itemId);
  if (updateError) {
    return NextResponse.json({ error: "ITEM_UPDATE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    path,
    publicUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/menu-images/${path}`,
  });
}
