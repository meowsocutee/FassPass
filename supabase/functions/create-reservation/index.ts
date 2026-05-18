import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        )

        const { reservation } = await req.json()

        //--------------------------------------------------
        // Validate request
        //--------------------------------------------------

        if (
            !reservation?.profileId ||
            !reservation?.siteId ||
            !reservation?.floorId ||
            !reservation?.slotId ||
            !reservation?.startTime ||
            !reservation?.endTime
        ) {
            return new Response(
                JSON.stringify({ error: 'Missing required reservation fields' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
            )
        }

        //--------------------------------------------------
        // 1. Get current user
        //--------------------------------------------------

        const {
            data: { user },
            error: userError
        } = await supabaseClient.auth.getUser()

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized: User not logged in' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
            )
        }

        const userId = user.id

        //--------------------------------------------------
        // 2. Get profile
        //--------------------------------------------------

        const { data: profile, error: profileError } = await supabaseClient
            .from('profiles')
            .select('name')
            .eq('id', userId)
            .single()

        if (profileError) {
            throw new Error(profileError.message)
        }

        //--------------------------------------------------
        // 3. Prepare reservation data
        //--------------------------------------------------

        const vehicleType =
            reservation.vehicleType !== 'car' &&
                reservation.vehicleType !== 'ev' &&
                reservation.vehicleType !== 'motorcycle'
                ? 'other'
                : reservation.vehicleType

        //--------------------------------------------------
        // Normalize license plate
        //--------------------------------------------------

        let plate = reservation.carPlate
            ?.trim()
            .replace(/\s+/g, ' ')
            ?.toUpperCase()

        //--------------------------------------------------
        // 4. Call RPC (Insert + Log)
        //--------------------------------------------------

        const { data, error } = await supabaseClient.rpc(
            'create_reservation_with_log2',
            {
                p_user_id: userId,
                p_user_name: profile.name ?? user.email,

                p_profile_id: reservation.profileId,
                p_site_id: reservation.siteId,
                p_floor_id: reservation.floorId,
                p_slot_id: reservation.slotId,

                p_start_time: reservation.startTime,
                p_end_time: reservation.endTime,

                p_reserve_status: reservation.status ?? 'pending',

                p_vehicle_type: vehicleType,
                p_car_id: reservation.carId ?? null,
                p_car_plate: plate,

                p_booking_type: reservation.bookingType,
                p_invite_code: reservation.inviteCode ?? null
            }
        )

        if (error) {
            throw error
        }

        //--------------------------------------------------
        // 5. Return result
        //--------------------------------------------------

        return new Response(
            JSON.stringify(data),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error: any) {

        console.error('Edge Function Error:', error)

        return new Response(
            JSON.stringify({ error: error.message || 'Unknown error occurred' }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        )
    }

})