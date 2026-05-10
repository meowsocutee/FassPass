import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ========== Rich Menu Mapping ==========
// Maps role → LINE Rich Menu ID
// Guest Menu (richmenu-f406d0b3e16bb2fdf467d74cba4e9a98) is the Default in LINE system — no need to link.
const ROLE_MENU_MAP: Record<string, string> = {
    'User': 'richmenu-5c02fbef90e4bd69fab12ca54930eda1',
    'Host': 'richmenu-03e2fe912e6c306e29944433283904df',
    'Visitor': 'richmenu-b7df5d101e578a5c49ba36f057593943',
}

/**
 * Link a specific Rich Menu to a LINE user.
 * POST https://api.line.me/v2/bot/user/{line_id}/richmenu/{rich_menu_id}
 */
async function linkRichMenu(lineId: string, richMenuId: string, token: string): Promise<boolean> {
    const url = `https://api.line.me/v2/bot/user/${lineId}/richmenu/${richMenuId}`
    console.log(`[switch-menu] Linking menu ${richMenuId} for LINE user ${lineId}`)

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!res.ok) {
        const errText = await res.text()
        console.error(`[switch-menu] LINE Link API Error (${res.status}):`, errText)
        return false
    }

    console.log(`[switch-menu] ✅ Rich Menu linked successfully`)
    return true
}

/**
 * Unlink Rich Menu from a LINE user (reverts to default Guest Menu).
 * DELETE https://api.line.me/v2/bot/user/{line_id}/richmenu
 */
async function unlinkRichMenu(lineId: string, token: string): Promise<boolean> {
    const url = `https://api.line.me/v2/bot/user/${lineId}/richmenu`
    console.log(`[switch-menu] Unlinking menu for LINE user ${lineId} (revert to Guest)`)

    const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!res.ok) {
        const errText = await res.text()
        console.error(`[switch-menu] LINE Unlink API Error (${res.status}):`, errText)
        return false
    }

    console.log(`[switch-menu] ✅ Rich Menu unlinked (Guest Menu active)`)
    return true
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { user_id, role, role_level } = await req.json()

        if (!user_id) throw new Error('Missing user_id')

        console.log(`[switch-menu] Request: user_id=${user_id}, role=${role}, role_level=${role_level}`)

        // 1. Update profile role and fetch line_id
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .update({ role: role, role_level: role_level })
            .eq('id', user_id)
            .select('line_id')
            .single()

        if (profileError) {
            throw new Error(`Failed to update profile: ${profileError.message}`)
        }

        const lineId = profileData?.line_id
        if (!lineId) {
            console.warn('[switch-menu] No line_id found for user, skipping LINE API call')
            return new Response(
                JSON.stringify({ success: false, reason: 'no_line_id' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Validate line_id format (must start with 'U' followed by 32 hex chars)
        if (!/^U[0-9a-f]{32}$/i.test(lineId)) {
            console.error(`[switch-menu] Invalid line_id format: ${lineId}`)
            throw new Error('Invalid line_id format — must start with U followed by 32 alphanumeric characters')
        }

        // 2. Get LINE Channel Access Token
        const channelAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
        if (!channelAccessToken) {
            throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured in environment secrets')
        }

        // 3. Determine action: Link or Unlink
        const targetMenuId = ROLE_MENU_MAP[role]
        let lineSuccess = false

        if (targetMenuId) {
            // Role has a mapping → Link the specific Rich Menu
            lineSuccess = await linkRichMenu(lineId, targetMenuId, channelAccessToken)
        } else {
            // No mapping (unknown role, null, Admin, etc.) → Unlink to revert to Guest default
            lineSuccess = await unlinkRichMenu(lineId, channelAccessToken)
        }

        return new Response(
            JSON.stringify({
                success: true,
                role: role ?? null,
                menu_action: targetMenuId ? 'linked' : 'unlinked',
                line_api_success: lineSuccess,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error: any) {
        console.error('[switch-menu] Error:', error.message)
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})