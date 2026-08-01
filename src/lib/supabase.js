import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled = Boolean(url && anon)

export const supabase = supabaseEnabled
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

const SYNC_KEYS = ['profile', 'theme', 'days', 'customFoods', 'customIngredients', 'recents', 'prefs']

export function pickSyncable(state) {
  const out = {}
  for (const k of SYNC_KEYS) out[k] = state[k]
  return out
}

// Pull the user's saved state blob from Supabase. Returns { state, updatedAt } or null.
export async function pullState(userId) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('app_state')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { state: data.state, updatedAt: data.updated_at }
}

// Push the state blob (upsert). Returns the new updated_at.
export async function pushState(userId, state) {
  if (!supabase) return null
  const payload = { user_id: userId, state: pickSyncable(state), updated_at: new Date().toISOString() }
  const { data, error } = await supabase
    .from('app_state')
    .upsert(payload, { onConflict: 'user_id' })
    .select('updated_at')
    .single()
  if (error) throw error
  return data.updated_at
}
