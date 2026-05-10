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
        console.warn('[line-login] Skipping Rich Menu sync: no token or line_id')
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
                console.error(`[line-login] LINE Link API Error (${res.status}):`, errText)
            } else {
                console.log(`[line-login] ✅ Rich Menu linked: ${role} → ${menuId}`)
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
                console.error(`[line-login] LINE Unlink API Error (${res.status}):`, errText)
            } else {
                console.log(`[line-login] ✅ Rich Menu unlinked (Guest Menu active)`)
            }
        }
    } catch (e) {
        console.error('[line-login] Rich Menu sync failed:', e)
        // Don't throw — login should still succeed even if menu switch fails
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

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

        const { idToken, anonymousUid } = body
        const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
        const LINE_CHANNEL_ID = Deno.env.get('LINE_CHANNEL_ID')!

        // 1. ตรวจสอบ Token กับ LINE
        const params = new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID })
        const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        })

        if (!verifyRes.ok) throw new Error('Invalid LINE Token (LINE rejected)')
        const verifiedData = await verifyRes.json()
        const lineUserId = verifiedData.sub

        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

        // 2. เช็คการผูกเครื่อง (Binding)
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('line_id', lineUserId)
            .maybeSingle()

        if (profile && profile.id !== anonymousUid) {
            return new Response(
                JSON.stringify({ error: "Device Mismatch: LINE นี้ผูกกับอุปกรณ์อื่นอยู่" }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
            )
        }

        // 3. สร้างข้อมูลใหม่
        await supabaseAdmin.from('profiles').upsert({
            id: anonymousUid,
            line_id: lineUserId,
            role: 'Visitor',
            name: verifiedData.name,
            avatar: verifiedData.picture,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' })

        // 3.5 Fetch current role for Rich Menu binding
        const { data: updatedProfile } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', anonymousUid)
            .single()

        const currentRole = updatedProfile?.role ?? 'Visitor'

        // 4. อัปเกรด Anonymous User
        const targetEmail = `${lineUserId}@line.placeholder.com`
        const tempPassword = crypto.randomUUID()

        await supabaseAdmin.auth.admin.updateUserById(anonymousUid, {
            email: targetEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { name: verifiedData.name, avatar: verifiedData.picture }
        })

        const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
            email: targetEmail,
            password: tempPassword
        })

        if (authError) throw authError;

        // 5. Bind Rich Menu based on current role
        if (lineUserId) {
            await syncRichMenu(lineUserId, currentRole)
        }

        return new Response(
            JSON.stringify({ session: authData.session }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error: any) {
        console.error('❌ Function Error:', error.message)
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})