import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const body = await req.json().catch(() => ({}));
        const { reservationId } = body;

        if (!reservationId) throw new Error('Missing reservationId');

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // ── Step 1: Fetch reservation ───────────────────────────────────────────
        const { data: res, error: resError } = await supabase
            .from('reservations')
            .select('id, start_time, end_time, status, floor_id, slot_id, parking_site_id, profiles ( role )')
            .eq('id', reservationId)
            .single();

        if (resError || !res) throw new Error('Reservation not found: ' + resError?.message);
        if (!res.start_time) throw new Error('start_time is missing');

        // ── Step 2: Determine role key ──────────────────────────────────────────
        let rawRole = (res.profiles as any)?.role || 'Visitor';
        if (rawRole.toLowerCase() === 'authenticated') rawRole = 'User';
        const roleKey = rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase();

        // ── Step 3: Find hourly rate via multiple paths ─────────────────────────
        let hourlyRate: number | null = null;
        const debugInfo: any = { roleKey, floor_id: res.floor_id, slot_id: res.slot_id, status: res.status };

        const extractRate = (rolePrices: any, key: string): number | null => {
            if (!rolePrices) return null;
            const rate = rolePrices[key] ?? rolePrices[key.toLowerCase()] ?? rolePrices['User'] ?? rolePrices['user'];
            if (rate !== null && rate !== undefined) return Number(rate);
            const firstNum = Object.values(rolePrices).find(v => typeof v === 'number' && (v as number) > 0);
            return firstNum !== undefined ? firstNum as number : null;
        };

        // PATH A: floor_id → floors → buildings.role_prices
        if (res.floor_id) {
            const { data: floorRow } = await supabase
                .from('floors').select('building_id').eq('id', res.floor_id).single();
            if (floorRow?.building_id) {
                const { data: bldg } = await supabase
                    .from('buildings').select('role_prices').eq('id', floorRow.building_id).single();
                hourlyRate = extractRate(bldg?.role_prices, roleKey);
                debugInfo.buildingFromFloor = bldg?.role_prices;
            }
        }

        // PATH B: derive building from slot_id pattern "SITE-BLDG-..."
        if (!hourlyRate && res.slot_id) {
            const parts = res.slot_id.split('-');
            if (parts.length >= 2) {
                const derivedBuildingId = `${parts[0]}-${parts[1]}`;
                const { data: bldg } = await supabase
                    .from('buildings').select('role_prices').eq('id', derivedBuildingId).single();
                hourlyRate = extractRate(bldg?.role_prices, roleKey);
                debugInfo.buildingFromSlot = { id: derivedBuildingId, role_prices: bldg?.role_prices };
            }
        }

        // PATH C: any building under the parking_site
        if (!hourlyRate && res.parking_site_id) {
            const { data: bldgs } = await supabase
                .from('buildings').select('role_prices').eq('parking_site_id', res.parking_site_id).limit(1);
            if (bldgs && bldgs.length > 0) {
                hourlyRate = extractRate(bldgs[0].role_prices, roleKey);
            }
        }

        // FALLBACK: never return 0
        if (!hourlyRate || hourlyRate <= 0) {
            hourlyRate = 20;
            debugInfo.usedFallbackRate = true;
        }

        // ── Step 4: Calculate duration based on payment status ──────────────────
        const startTime = new Date(res.start_time);
        const now = new Date();

        let parkedHours: number;

        if (res.status === 'pending_payment') {
            // Not yet checked in → charge for the BOOKED duration (end_time - start_time)
            if (res.end_time) {
                const endTime = new Date(res.end_time);
                const bookedMs = endTime.getTime() - startTime.getTime();
                parkedHours = Math.max(1, Math.ceil(bookedMs / (1000 * 60 * 60)));
                debugInfo.durationMode = 'booked_duration';
            } else {
                parkedHours = 1;
                debugInfo.durationMode = 'fallback_1hr_no_endtime';
            }
        } else {
            // Checked in → charge for ACTUAL time, but at least the booked duration
            // (prevents paying less than booked if they overstay)
            let billMs = now.getTime() - startTime.getTime();
            if (res.end_time) {
                const bookedMs = new Date(res.end_time).getTime() - startTime.getTime();
                billMs = Math.max(billMs, bookedMs); // at least the booked duration
            }
            parkedHours = Math.max(1, Math.ceil(billMs / (1000 * 60 * 60)));
            debugInfo.durationMode = 'actual_time';
        }

        // ── Step 5: E-Stamp discount ────────────────────────────────────────────
        const { data: stamp } = await supabase
            .from('e_stamps')
            .select('discount_amount, free_hours')
            .eq('reservation_id', reservationId)
            .maybeSingle();

        const discountAmount = stamp?.discount_amount || 0;
        const freeHours = stamp?.free_hours || 0;
        const billableHours = Math.max(0, parkedHours - freeHours);
        const grossPrice = billableHours * hourlyRate;
        const netPrice = Math.max(0, grossPrice - discountAmount);

        debugInfo.parkedHours = parkedHours;
        debugInfo.freeHours = freeHours;
        debugInfo.billableHours = billableHours;
        debugInfo.hourlyRate = hourlyRate;
        debugInfo.grossPrice = grossPrice;
        debugInfo.discountAmount = discountAmount;

        return new Response(JSON.stringify({ final_net_price: netPrice, debug: debugInfo }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
        });

    } catch (error: any) {
        console.error('[calculate-parking-fee] Error:', error.message);
        return new Response(JSON.stringify({ error: error.message, final_net_price: 0 }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400
        });
    }
})
