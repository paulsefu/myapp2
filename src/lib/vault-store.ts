import { assertVaultEnvelope, type VaultEnvelope } from "./vault-crypto";
import { requireSupabase } from "./supabase";

export type VaultRecord = {
  vault: VaultEnvelope | null;
  revision: number;
  updatedAt: string | null;
};

export class VaultConflictError extends Error {}

async function currentUserId(): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Autentificare necesară.");
  return data.user.id;
}

export async function loadVaultRecord(): Promise<VaultRecord> {
  const client = requireSupabase();
  const userId = await currentUserId();
  const { data, error } = await client
    .from("vaults")
    .select("envelope, revision, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Seiful nu a putut fi încărcat: ${error.message}`);
  if (!data) return { vault: null, revision: 0, updatedAt: null };

  assertVaultEnvelope(data.envelope);
  return {
    vault: data.envelope,
    revision: data.revision,
    updatedAt: data.updated_at,
  };
}

export async function saveVaultRecord(
  vault: VaultEnvelope,
  baseRevision: number,
): Promise<{ revision: number; updatedAt: string }> {
  const client = requireSupabase();
  const userId = await currentUserId();
  const updatedAt = new Date().toISOString();

  if (baseRevision === 0) {
    const { data, error } = await client
      .from("vaults")
      .insert({
        user_id: userId,
        envelope: vault,
        revision: 1,
        updated_at: updatedAt,
      })
      .select("revision, updated_at")
      .single();

    if (error) {
      if (error.code === "23505") throw new VaultConflictError();
      throw new Error(`Seiful nu a putut fi creat: ${error.message}`);
    }
    return { revision: data.revision, updatedAt: data.updated_at };
  }

  const { data, error } = await client
    .from("vaults")
    .update({
      envelope: vault,
      revision: baseRevision + 1,
      updated_at: updatedAt,
    })
    .eq("user_id", userId)
    .eq("revision", baseRevision)
    .select("revision, updated_at")
    .maybeSingle();

  if (error) throw new Error(`Modificarea nu a putut fi sincronizată: ${error.message}`);
  if (!data) throw new VaultConflictError();
  return { revision: data.revision, updatedAt: data.updated_at };
}

export async function deleteVaultRecord(): Promise<void> {
  const client = requireSupabase();
  const userId = await currentUserId();
  const { error } = await client.from("vaults").delete().eq("user_id", userId);
  if (error) throw new Error(`Seiful nu a putut fi resetat: ${error.message}`);
}
