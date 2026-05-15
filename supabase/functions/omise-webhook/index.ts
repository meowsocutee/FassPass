import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

serve(async (req) => {
  try {
    const payload = await req.json()

    if (payload.key === 'charge.complete') {
      const charge = payload.data

      if (charge.status === 'successful') {
        const omise_charge_id = charge.id

        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (supabaseUrl && supabaseServiceKey) {
          const supabase = createClient(supabaseUrl, supabaseServiceKey)

          // 1. Mark payment as success
          const { data: paymentData, error: paymentError } = await supabase
            .from('payments')
            .update({ status: 'success', updated_at: new Date().toISOString() })
            .eq('omise_charge_id', omise_charge_id)
            .select('reservation_id')
            .single()

          if (paymentError) {
            console.error(`Failed to update payment: ${paymentError.message}`)
          }

          // 2. Update reservation based on its CURRENT status
          //    - pending_payment            → confirmed  (paid, not yet checked-in)
          //    - checked_in_pending_payment → active     (paid, currently parked)
          //    - anything else              → confirmed  (fallback)
          if (paymentData && paymentData.reservation_id) {
            const { data: resData, error: fetchErr } = await supabase
              .from('reservations')
              .select('status')
              .eq('id', paymentData.reservation_id)
              .single()

            if (fetchErr) {
              console.error(`Failed to fetch reservation: ${fetchErr.message}`)
            }

            let newStatus = 'confirmed'
            if (resData?.status === 'checked_in_pending_payment') {
              newStatus = 'active'   // paid while parked → now "active" (can check-out)
            }

            const { error: reservationError } = await supabase
              .from('reservations')
              .update({ status: newStatus })
              .eq('id', paymentData.reservation_id)

            if (reservationError) {
              console.error(`Failed to update reservation: ${reservationError.message}`)
            }

            console.log(`Reservation ${paymentData.reservation_id} updated to '${newStatus}'`)
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
