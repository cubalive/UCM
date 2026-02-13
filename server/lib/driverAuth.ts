import { getSupabaseServer } from "../../lib/supabaseClient";
import crypto from "crypto";

interface EnsureAuthResult {
  userId: string;
  isNew: boolean;
  tempPassword?: string;
}

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  let password = "";
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

export { generateTempPassword };

export async function ensureAuthUser({
  name,
  email,
  role,
}: {
  name: string;
  email: string;
  role: "driver" | "clinic" | "viewer";
}): Promise<EnsureAuthResult> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error("Invalid email format");
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Replit deployment secrets.");
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
    await upsertProfile(supabase, existingUser.id, name, email, role);
    return { userId: existingUser.id, isNew: false };
  }

  const tempPassword = generateTempPassword();

  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { name, role, must_change_password: true },
  });

  if (createError) {
    throw new Error(`Failed to create Supabase auth user: ${createError.message}`);
  }

  if (!createData?.user) {
    throw new Error("Supabase user creation returned no user");
  }

  await upsertProfile(supabase, createData.user.id, name, email, role);
  return { userId: createData.user.id, isNew: true, tempPassword };
}

export async function ensureAuthUserForDriver({
  name,
  email,
}: {
  name: string;
  email: string;
}): Promise<EnsureAuthResult> {
  return ensureAuthUser({ name, email, role: "driver" });
}

export async function ensureAuthUserForClinic({
  name,
  email,
}: {
  name: string;
  email: string;
}): Promise<EnsureAuthResult> {
  return ensureAuthUser({ name, email, role: "clinic" });
}

async function upsertProfile(
  supabase: any,
  userId: string,
  name: string,
  email: string,
  role: string,
) {
  try {
    await supabase.from("profiles").upsert(
      {
        id: userId,
        role,
        name,
        email,
      },
      { onConflict: "id" }
    );
  } catch (err: any) {
    console.error("[authProvisioning] Profile upsert failed (non-fatal):", err.message);
  }
}

export async function generateInviteLink(email: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return { success: false, error: "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Replit deployment secrets." };
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

export async function adminSetPassword(userId: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return { success: false, error: "Supabase is not configured." };
  }

  const { error } = await supabase.auth.admin.updateUser(userId, {
    password: newPassword,
    user_metadata: { must_change_password: false },
  });

  if (error) {
    return { success: false, error: `Failed to update password: ${error.message}` };
  }

  return { success: true };
}

export async function checkAdminHealth(): Promise<{
  ok: boolean;
  hasServiceRole: boolean;
  canCreateUsers: boolean;
  error?: string;
}> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return {
      ok: false,
      hasServiceRole: false,
      canCreateUsers: false,
      error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Replit deployment secrets.",
    };
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    return {
      ok: false,
      hasServiceRole: false,
      canCreateUsers: false,
      error: "Supabase client could not be initialized.",
    };
  }

  let canCreateUsers = false;
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    canCreateUsers = !error;
    if (error) {
      return {
        ok: false,
        hasServiceRole: true,
        canCreateUsers: false,
        error: `Admin API call failed: ${error.message}`,
      };
    }
  } catch (err: any) {
    return {
      ok: false,
      hasServiceRole: true,
      canCreateUsers: false,
      error: `Admin API exception: ${err.message}`,
    };
  }

  return { ok: true, hasServiceRole: true, canCreateUsers };
}

export async function checkSupabaseHealth(): Promise<{
  ok: boolean;
  supabase: boolean;
  canCreateUsers: boolean;
}> {
  const result = await checkAdminHealth();
  return {
    ok: result.ok,
    supabase: result.hasServiceRole,
    canCreateUsers: result.canCreateUsers,
  };
}
