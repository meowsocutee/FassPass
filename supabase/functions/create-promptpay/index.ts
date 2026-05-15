import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { reservation_id, amount } = await req.json()

    if (!reservation_id || !amount) {
      return new Response(JSON.stringify({ error: 'Missing reservation_id or amount' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const OMISE_SECRET_KEY = Deno.env.get('OMISE_SECRET_KEY')
    if (!OMISE_SECRET_KEY) {
      throw new Error('Missing OMISE_SECRET_KEY')
    }

    // Omise requires Basic Auth: secret_key as username, empty password
    const encodedKey = btoa(`${OMISE_SECRET_KEY}:`)

    // 1. Create a Source for PromptPay
    // Note: Omise accepts amounts in the smallest currency unit (e.g., satang for THB). So amount * 100.
    const amountInSatang = Math.round(amount * 100)
    const sourceResponse = await fetch('https://api.omise.co/sources', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encodedKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'promptpay',
        amount: amountInSatang,
        currency: 'THB'
      })
    })

    const sourceData = await sourceResponse.json()
    if (!sourceResponse.ok) {
      throw new Error(sourceData.message || 'Failed to create Omise Source')
    }

    // 2. Create a Charge using the Source
    const chargeResponse = await fetch('https://api.omise.co/charges', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encodedKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountInSatang,
        currency: 'THB',
        source: sourceData.id,
        // Optional but recommended by Omise for redirect flows
        return_uri: 'http://localhost:3000/payment/complete' // Update to your frontend URL
      })
    })

    const chargeData = await chargeResponse.json()
    if (!chargeResponse.ok) {
      throw new Error(chargeData.message || 'Failed to create Omise Charge')
    }

    // 3. Insert a new record into the `payments` table
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (supabaseUrl && supabaseServiceKey) {
      // We use the Service Role Key here to bypass RLS for server-side inserts
      const supabase = createClient(supabaseUrl, supabaseServiceKey)

      const { error: dbError } = await supabase
        .from('payments')
        .insert({
          reservation_id,
          amount,
          status: 'pending',
          omise_charge_id: chargeData.id
        })

      if (dbError) {
        console.error("DB Insert Error:", dbError)
        // Note: we can still return the charge to the client even if DB insert fails during testing,
        // but in production you might want to handle this stricter.
      }
    } else {
      console.warn("Supabase URL or Service Key not found. Skipping DB insert for testing.")
    }

    // 4. Return the charge object to the client
    // You can access the QR Code URI via: chargeData.source.scannable_code.image.download_uri
    return new Response(JSON.stringify(chargeData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
