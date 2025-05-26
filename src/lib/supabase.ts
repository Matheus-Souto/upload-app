import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseKey)

export interface HistoricoUpload {
  id?: number
  nome_arquivo: string
  status: 'pending' | 'processing' | 'completed' | 'error'
  link?: string
  criado_em?: string
  user_id: string
} 