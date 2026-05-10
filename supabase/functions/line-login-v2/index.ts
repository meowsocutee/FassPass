import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ========== Rich Menu Mapping ==========
const ROLE_MENU_MAP: Record<string, string> = {
    'User': 'richmenu-5c02fbef90e4bd69fab12ca54930eda1',
    'Host': 'richmenu-03e2fe912e6c306e29944433283904df',
    'Visitor': 'richmenu-b7df5d101e578a5c49ba36f057593943',
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

        // 2️⃣ Device Binding Check
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('line_id', lineUserId)
            .maybeSingle()

        if (profile && profile.id !== anonymousUid) {

            await logActivity(supabaseAdmin, {
                p_site_id: 'system',
                p_log_type: 'activity',
                p_action: 'auth_device_mismatch',
                p_user_id: profile.id,
                p_user_name: userName,
                p_category: 'security',
                p_status: 'blocked',
                p_entity_type: 'profiles',
                p_entity_id: profile.id,
                p_detail: 'LINE login blocked due to device mismatch',
                p_changes: null,
                p_old_data: null,
                p_new_data: null,
                p_meta: {
                    line_id: lineUserId,
                    ip,
                    user_agent: userAgent
                }
            })

            return new Response(
                JSON.stringify({ error: "Device Mismatch: LINE นี้ผูกกับอุปกรณ์อื่นอยู่" }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
            )
        }

        // 3️⃣ Upsert profile
        await supabaseAdmin.from('profiles').upsert({
            id: anonymousUid,
            line_id: lineUserId,
            role: 'Visitor',
            name: userName,
            avatar: verifiedData.picture,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' })

        // 3.5️⃣ Fetch current role for Rich Menu binding
        const { data: updatedProfile } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', anonymousUid)
            .single()

        const currentRole = updatedProfile?.role ?? 'Visitor'

        // 4️⃣ Upgrade anonymous user
        const targetEmail = `${lineUserId}@line.placeholder.com`
        const tempPassword = crypto.randomUUID()

        await supabaseAdmin.auth.admin.updateUserById(anonymousUid!, {
            email: targetEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
                name: userName,
                avatar: verifiedData.picture
            }
        })

        // 5️⃣ Login
        const { data: authData, error: authError } =
            await supabaseAdmin.auth.signInWithPassword({
                email: targetEmail,
                password: tempPassword
            })

        if (authError) throw authError

        // 5.5️⃣ Bind Rich Menu based on current role
        if (lineUserId) {
            await syncRichMenu(lineUserId, currentRole)
        }

        // 6️⃣ Log success
        await logActivity(supabaseAdmin, {
            p_site_id: 'system',
            p_log_type: 'activity',
            p_action: 'auth_login_success',
            p_user_id: anonymousUid,
            p_user_name: userName,
            p_category: 'security',
            p_status: 'success',
            p_entity_type: 'profiles',
            p_entity_id: anonymousUid,
            p_detail: 'User logged in via LINE',
            p_changes: null,
            p_old_data: null,
            p_new_data: null,
            p_meta: {
                line_id: lineUserId,
                provider: 'line',
                ip,
                user_agent: userAgent
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