import { getSupabaseServer } from "../../lib/supabaseClient";

interface EnsureAuthResult {
  userId: string;
  isNew: boolean;
}

export async function ensureAuthUserForDriver({
  name,
  email,
}: {
  name: string;
  email: string;
}): Promise<EnsureAuthResult> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error("Invalid email format");
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    throw new Error("Supabase is not configured. Cannot provision driver auth.");
  }

  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    throw new Error(`Failed to list Supabase users: ${listError.message}`);
  }

  const existingUser = listData?.users?.find(
    (u: any) => u.email?.toLowerCase() === email.toLowerCase()
  );

  if (existingUser) {
    await upsertProfile(supabase, existingUser.id, name, email);
    return { userId: existingUser.id, isNew: false };
  }

  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name, role: "driver" },
  });

  if (createError) {
    throw new Error(`Failed to create Supabase auth user: ${createError.message}`);
  }

  if (!createData?.user) {
    throw new Error("Supabase user creation returned no user");
  }

  await upsertProfile(supabase, createData.user.id, name, email);
  return { userId: createData.user.id, isNew: true };
}

async function upsertProfile(
  supabase: any,
  userId: string,
  name: string,
  email: string,
) {
  try {
    await supabase.from("profiles").upsert(
      {
        id: userId,
        role: "driver",
        name,
        email,
      },
      { onConflict: "id" }
    );
  } catch (err: any) {
    console.error("[driverAuth] Profile upsert failed (non-fatal):", err.message);
  }
}

export async function generateInviteLink(email: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return { success: false, error: "Supabase is not configured" };
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) {
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email);
    if (inviteError) {
      return { success: false, error: `Failed to send invite: ${inviteError.message}` };
    }
  }

  return { success: true };
}

export async function checkSupabaseHealth(): Promise<{
  ok: boolean;
  supabase: boolean;
  canCreateUsers: boolean;
}> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return { ok: false, supabase: false, canCreateUsers: false };
  }

  let canCreateUsers = false;
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    canCreateUsers = !error;
  } catch {
    canCreateUsers = false;
  }

  return { ok: true, supabase: true, canCreateUsers };
}
