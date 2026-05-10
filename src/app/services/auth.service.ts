import { Injectable } from '@angular/core';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { BehaviorSubject, Observable, from, map } from 'rxjs';

export interface RolePermission {
  role: string;
}

export interface UserProfile {
  id: string;
  full_name?: string;
  is_staff?: boolean;
  role_label?: string;
  name?: string;
  avatar?: string;
  role?: string;
  line_id?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase: SupabaseClient;

  private userProfileSubject = new BehaviorSubject<UserProfile | null>(null);
  userProfile$ = this.userProfileSubject.asObservable();

  constructor(private supabaseService: SupabaseService) {
    this.supabase = this.supabaseService.client;
  }

  async refreshProfile(userId: string) {
    const { data } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (data) this.userProfileSubject.next(data);
  }

  
  async signInWithLineToken(idToken: string) {
    let { data: { user } } = await this.supabase.auth.getUser();

    if (!user) {
      console.log('No session found, initializing anonymous session...');
      user = await this.signInAnonymously();
    }

    const currentUid = user?.id;
    if (!currentUid) throw new Error("Could not establish a device anchor (Anonymous UID)");

    const { data, error } = await this.supabase.functions.invoke('line-login', {
      body: {
        idToken,
        anonymousUid: currentUid
      }
    });

    if (error) throw error;

    if (data?.session) {
      await this.supabase.auth.setSession(data.session);
      const loggedInUser = data.session.user;
      await this.refreshProfile(loggedInUser.id);
      return loggedInUser;
    }
    return null;
  }

  
  async getCurrentUser(): Promise<User | null> {
    const { data: sessionData } = await this.supabase.auth.getSession();
    if (sessionData.session?.user) {
      return sessionData.session.user;
    }

    const MAX_RETRIES = 3;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const { data, error } = await this.supabase.auth.getUser();

        if (!error) return data.user;

        if (!this.isLockError(error)) {
          console.warn('Auth Error (Non-Lock):', error.message);
          return null;
        }

        throw error;
      } catch (err: any) {
        if (this.isLockError(err)) {
          console.log(`Storage Locked, retrying ${i + 1}/${MAX_RETRIES}...`);
          await this.delay(500 * (i + 1));
          continue;
        }
        return null;
      }
    }

    const { data: finalCheck } = await this.supabase.auth.getSession();
    return finalCheck.session?.user || null;
  }

  private isLockError(err: any): boolean {
    const msg = err?.message || err?.name || '';
    return msg.includes('Lock') || msg.includes('NavigatorLockAcquireTimeoutError');
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async signInAnonymously() {
    const existing = await this.getCurrentUser();
    if (existing) return existing;

    console.log('🆕 Creating NEW Device Anchor (Confirmed No Session)');
    const { data, error } = await this.supabase.auth.signInAnonymously();
    if (error) throw error;
    return data.user;
  }

  async signOut() {
    const { error } = await this.supabase.auth.signOut();
    if (error) console.error('SignOut Error:', error);
  }

  async logicalLogout() {
    localStorage.removeItem('user_profile');
  }

  async upgradeGuestToEmail(email: string, password: string) {
    const { data, error } = await this.supabase.auth.updateUser({
      email: email,
      password: password
    });
    if (error) throw error;
    return data.user;
  }

  async getSession() {
    const { data } = await this.supabase.auth.getSession();
    return data.session;
  }

  async getProfile(userId: string) {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Get Profile Error:', error);
      return null;
    }
    return data;
  }

  getCurrentUserProfile(): Observable<UserProfile | null> {
    return from(this.supabase.auth.getUser()).pipe(
      map(({ data }) => {
        if (!data.user) return null;
        return {
          id: data.user.id,
          full_name: data.user.user_metadata['full_name'] || 'Guest',
          is_staff: false,
          role_label: (data.user.user_metadata['full_name'] || 'Guest')
        } as UserProfile;
      })
    );
  }

  
  
  

  async syncLineProfile(lineProfile: any): Promise<any> {
    try {
      const upsertData: any = {
        id: lineProfile.userId,
        line_id: lineProfile.userId,
        name: lineProfile.displayName,
        avatar: lineProfile.pictureUrl,
        updated_at: new Date(),
        role: 'Visitor'
      };

      const { data, error } = await this.supabase
        .from('profiles')
        .upsert(upsertData, { onConflict: 'id' })
        .select()
        .single();

      if (error) throw error;
      return data;

    } catch (err) {
      console.error('Auth Sync Error:', err);
      throw err;
    }
  }

  async updateProfile(userId: string, updateData: any) {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      
      if (data) {
        this.userProfileSubject.next(data);
      }
      return data;
    } catch (err) {
      console.error('Update Profile Error:', err);
      throw err; 
    }
  }
  async updateProfilev2(userId: string, updateData: any) {
    try {
      
      const { data, error } = await this.supabase.functions.invoke(
        'update-profile',
        {
          body: {
            userId: userId,
            updateData: updateData
          }
        }
      );

      if (error) throw error;

      
      if (data) {
        this.userProfileSubject.next(data);
      }
      
      return data;
    } catch (err) {
      console.error('Update Profile Error:', err);
      throw err;
    }
  }
  async changeRichMenu(userId: string, newRole: string) {
    const { data, error } = await this.supabase.functions.invoke('switch-menu', {
      body: { user_id: userId, role: newRole }
    });
    if (error) throw error;
    return data;
  }

  
  
  

  getRoles(): Observable<RolePermission[]> {
    const request = this.supabase
      .from('roles')
      .select('role');
    return from(request).pipe(map(response => response.data || []));
  }

  getPermissionList(role: string): Observable<string[]> {
    const request = this.supabase
      .from('access_rules')
      .select('asset_id')
      .eq('role', role);
    return from(request).pipe(
      map(response => response.data ? response.data.map((item: any) => item.asset_id) : [])
    );
  }

  getUserPermissions(userId: string, isStaff: boolean): Observable<string[]> {
    if (isStaff) {
      return from(this.supabase.from('assets').select('id')).pipe(
        map(res => res.data ? res.data.map((a: any) => a.id) : [])
      );
    }
    const now = new Date().toISOString();
    const request = this.supabase
      .from('invitation_access_items')
      .select('asset_id, invitations!inner(visitor_id, valid_from, valid_until)')
      .eq('invitations.visitor_id', userId)
      .lte('invitations.valid_from', now)
      .gte('invitations.valid_until', now);

    return from(request).pipe(
      map(response => response.data ? response.data.map((item: any) => item.asset_id) : [])
    );
  }
}