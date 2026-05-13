import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ========== Rich Menu Mapping ==========
const ROLE_MENU_MAP: Record<string, string> = {
    'User': 'richmenu-4d93f148f681202401da651443fafbe4',
    'Host': 'richmenu-f9142e7b1a3fe67413309cdf6f30d358',
    'Visitor': 'richmenu-3b6ff5e7de90e7e26f619cd2d718f353',
}

/** Link or Unlink Rich Menu based on role */
async function syncRichMenu(lineId: string, role: string | null) {
    const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
    if (!token || !lineId) {
        console.warn('[line-login-v2] Skipping Rich Menu sync: no token or line_id')
        return
    }

    const menuId = role ? ROLE_MENU_MAP[role] : null

    try {
        if (menuId) {
            // Link specific Rich Menu
            const url = `https://api.line.me/v2/bot/user/${lineId}/richmenu/${menuId}`
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            })
            if (!res.ok) {
                const errText = await res.text()
                console.error(`[line-login-v2] LINE Link API Error (${res.status}):`, errText)
            } else {
                console.log(`[line-login-v2] ✅ Rich Menu linked: ${role} → ${menuId}`)
            }
        } else {
            // Unlink to revert to default Guest Menu
            const url = `https://api.line.me/v2/bot/user/${lineId}/richmenu`
            const res = await fetch(url, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            })
            if (!res.ok) {
                const errText = await res.text()
                console.error(`[line-login-v2] LINE Unlink API Error (${res.status}):`, errText)
            } else {
                console.log(`[line-login-v2] ✅ Rich Menu unlinked (Guest Menu active)`)
            }
        }
    } catch (e) {
        console.error('[line-login-v2] Rich Menu sync failed:', e)
        // Don't throw — login should still succeed even if menu switch fails
    }
}

// helper สำหรับ log (กัน error ทำให้ login พัง)
async function logActivity(supabaseAdmin: any, payload: any) {
    try {
        await supabaseAdmin.rpc('insert_activity_log', payload)
    } catch (e) {
        console.error("⚠️ Activity log failed:", e)
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const ip = req.headers.get("x-forwarded-for")
    const userAgent = req.headers.get("user-agent")

    let anonymousUid: string | null = null
    let lineUserId: string | null = null
    let userName = "Unknown"

    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const LINE_CHANNEL_ID = Deno.env.get('LINE_CHANNEL_ID')!

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    try {
        console.log(`[Request Method]: ${req.method}`)

        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ error: `Method ${req.method} not allowed. Please use POST.` }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 405 }
            )
        }

        const body = await req.json().catch(() => null)
        if (!body || !body.idToken) throw new Error('Missing request body or idToken')

        const { idToken } = body
        anonymousUid = body.anonymousUid

        // 1️⃣ Verify LINE Token
        const params = new URLSearchParams({
            id_token: idToken,
            client_id: LINE_CHANNEL_ID
        })

        const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        })

        if (!verifyRes.ok) throw new Error('Invalid LINE Token (LINE rejected)')

        const verifiedData = await verifyRes.json()

        lineUserId = verifiedData.sub
        userName = verifiedData.name ?? "Unknown"

        // 2️⃣ Check for Existing User (Device Binding)
        const { data: existingProfile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('line_id', lineUserId)
            .maybeSingle()

        if (profileError) {
            console.error("Profile fetch error:", profileError)
        }

        let targetUserId = anonymousUid
        let currentRole = 'Visitor'
        let isReLogin = false

        if (existingProfile) {
            // User already exists in the system
            targetUserId = existingProfile.id
            currentRole = existingProfile.role || 'Visitor'
            isReLogin = true
            
            console.log(`[line-login-v2] Existing user found. targetUserId: ${targetUserId}`)

            // Optional: If this is a new anonymous session but they have an old account,
            // we will log them into their old account.
            if (targetUserId !== anonymousUid) {
                console.log(`[line-login-v2] Seamless re-login: Switch from anonymous ${anonymousUid} to existing ${targetUserId}`)
            }

        } else {
            // 3️⃣ New User: Insert profile
            // Use insert instead of upsert to avoid overwriting existing roles
            const { error: insertError } = await supabaseAdmin.from('profiles').insert({
                id: anonymousUid,
                line_id: lineUserId,
                role: 'Visitor', // Default role for new users
                name: userName,
                avatar: verifiedData.picture,
                updated_at: new Date().toISOString()
            })

            if (insertError) {
                console.error("Insert profile error:", insertError)
                // If it fails because id already exists but has no line_id, we can fallback to update
                if (insertError.code === '23505') {
                     await supabaseAdmin.from('profiles')
                        .update({ line_id: lineUserId, name: userName, avatar: verifiedData.picture })
                        .eq('id', anonymousUid)
                } else {
                     throw new Error('Failed to create user profile')
                }
            }
        }

        // 4️⃣ Generate Deterministic Password
        const targetEmail = `${lineUserId}@line.placeholder.com`
        const encoder = new TextEncoder()
        const data = encoder.encode(lineUserId + (Deno.env.get('SUPABASE_ANON_KEY') || 'secret'))
        const hashBuffer = await crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const deterministicPassword = hashArray.map(b => b.toString(16).padStart(2, '0')).join('') + 'A1!'

        // 5️⃣ Generate Auth Session
        let authData: any = null
        
        // Attempt to login first (prevents session revocation if password is correct)
        const loginAttempt = await supabaseAdmin.auth.signInWithPassword({
            email: targetEmail,
            password: deterministicPassword
        })

        if (loginAttempt.error) {
            console.log(`[line-login-v2] First login failed, updating password for user ${targetUserId}`)
            // Update the target user's auth data and set the deterministic password
            // Note: This will revoke existing sessions ONCE, but future logins will use the same password.
            const { error: updateUserError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId!, {
                email: targetEmail,
                password: deterministicPassword,
                email_confirm: true,
                user_metadata: {
                    name: userName,
                    avatar: verifiedData.picture
                }
            })
            if (updateUserError) throw updateUserError

            const retryLogin = await supabaseAdmin.auth.signInWithPassword({
                email: targetEmail,
                password: deterministicPassword
            })
            if (retryLogin.error) throw retryLogin.error
            authData = retryLogin.data
        } else {
            authData = loginAttempt.data
            // Just update metadata without changing password
            const { error: updateUserError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId!, {
                email: targetEmail,
                user_metadata: {
                    name: userName,
                    avatar: verifiedData.picture
                }
            })
            if (updateUserError) throw updateUserError
        }

        // 5.5️⃣ Clean up orphaned anonymous user if we switched accounts
        if (isReLogin && targetUserId !== anonymousUid && anonymousUid) {
            try {
                await supabaseAdmin.auth.admin.deleteUser(anonymousUid)
                console.log(`[line-login-v2] Cleaned up orphaned anonymous user: ${anonymousUid}`)
            } catch (cleanupError) {
                console.warn(`[line-login-v2] Failed to cleanup anonymous user: ${anonymousUid}`, cleanupError)
            }
        }

        // 6️⃣ Bind Rich Menu based on current role
        if (lineUserId) {
            await syncRichMenu(lineUserId, currentRole)
        }

        // 7️⃣ Log success
        await logActivity(supabaseAdmin, {
            p_site_id: 'system',
            p_log_type: 'activity',
            p_action: isReLogin ? 'auth_relogin_success' : 'auth_login_success',
            p_user_id: targetUserId,
            p_user_name: userName,
            p_category: 'security',
            p_status: 'success',
            p_entity_type: 'profiles',
            p_entity_id: targetUserId,
            p_detail: isReLogin ? 'User re-logged in via LINE' : 'User logged in via LINE (New)',
            p_changes: null,
            p_old_data: null,
            p_new_data: null,
            p_meta: {
                line_id: lineUserId,
                provider: 'line',
                ip,
                user_agent: userAgent,
                previous_anonymous_uid: isReLogin ? anonymousUid : null
            }
        })

        return new Response(
            JSON.stringify({ session: authData.session }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error: any) {

        console.error('❌ Function Error:', error.message)

        await logActivity(supabaseAdmin, {
            p_site_id: 'system',
            p_log_type: 'activity',
            p_action: 'auth_login_failed',
            p_user_id: anonymousUid,
            p_user_name: userName,
            p_category: 'security',
            p_status: 'error',
            p_entity_type: 'auth',
            p_entity_id: null,
            p_detail: 'LINE login failed',
            p_changes: null,
            p_old_data: null,
            p_new_data: null,
            p_meta: {
                line_id: lineUserId,
                error: error.message,
                ip,
                user_agent: userAgent
            }
        })

        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})