import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from 'src/environments/environment';
@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;
  constructor() {
    
    const w = window as any;
    if (w.__SUPABASE_CLIENT__) {
      this.supabase = w.__SUPABASE_CLIENT__;
    } else {
      this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false, // <-- Disable to prevent conflict with LIFF
          
          lock: (name, acquireTimeout, fn) => fn(),
        }
      });
      w.__SUPABASE_CLIENT__ = this.supabase;
    }
  }
  get client() {
    return this.supabase;
  }
}