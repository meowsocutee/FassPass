-- ลบ version เก่าที่ใช้ reservation_status type ออกก่อน (แก้ ambiguous overload)
DROP FUNCTION IF EXISTS public.update_reservation_status_with_log(uuid, text, uuid, public.reservation_status);

CREATE OR REPLACE FUNCTION public.update_reservation_status_with_log(
  p_user_id        uuid,
  p_user_name      text,
  p_reservation_id uuid,
  p_new_status     text   -- TEXT เพราะ Edge Function ส่งมาเป็น string
)
RETURNS reservations
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_res        reservations;
  v_old_status reservation_status;
  v_action     text;
  v_detail     text;
begin

  -- 1. Get reservation
  select * into v_res
  from reservations
  where id = p_reservation_id;

  if v_res is null then
    raise exception 'Reservation not found';
  end if;

  v_old_status := v_res.status;

  -- 2. Validate transition
  -- Valid enum values: pending, pending_payment, pending_invite,
  --                    confirmed, checked_in, checked_in_pending_payment,
  --                    active, checked_out, cancelled

  if v_old_status = 'pending'
     and p_new_status not in ('checked_in','active','cancelled') then
    raise exception 'Invalid transition from pending';
  end if;

  if v_old_status = 'pending_payment'
     and p_new_status not in ('checked_in_pending_payment','confirmed','active','checked_in','cancelled','pending') then
    raise exception 'Invalid transition from pending_payment';
  end if;

  if v_old_status = 'confirmed'
     and p_new_status not in ('active','checked_in','checked_out','cancelled') then
    raise exception 'Invalid transition from confirmed';
  end if;

  if v_old_status = 'checked_in_pending_payment'
     and p_new_status not in ('active','confirmed','checked_in','cancelled','pending') then
    raise exception 'Invalid transition from checked_in_pending_payment';
  end if;

  if v_old_status = 'checked_in'
     and p_new_status not in ('confirmed','active','checked_out','cancelled') then
    raise exception 'Invalid transition from checked_in';
  end if;

  if v_old_status = 'active'
     and p_new_status not in ('checked_out','confirmed','cancelled') then
    raise exception 'Invalid transition from active';
  end if;

  if v_old_status = 'pending_invite'
     and p_new_status not in ('pending_payment','cancelled') then
    raise exception 'Invalid transition from pending_invite';
  end if;

  if v_old_status in ('checked_out','cancelled') then
    raise exception 'Invalid transition from %', v_old_status;
  end if;

  -- 3. Update status (cast TEXT → enum)
  update reservations
  set    status     = p_new_status::reservation_status,
         updated_at = now()
  where  id = p_reservation_id
  returning * into v_res;

  -- 4. Determine action label
  if v_old_status = 'pending' and p_new_status in ('checked_in','active') then
    v_action := 'reservation_checked_in';
    v_detail := 'Vehicle checked in';

  elsif v_old_status = 'pending_payment' and p_new_status = 'confirmed' then
    v_action := 'reservation_paid_before_checkin';
    v_detail := 'Payment completed, waiting to park';

  elsif v_old_status = 'pending_payment' and p_new_status = 'checked_in_pending_payment' then
    v_action := 'reservation_checked_in_pending_payment';
    v_detail := 'Vehicle checked in, payment pending';

  elsif v_old_status = 'pending_payment' and p_new_status in ('active','checked_in') then
    v_action := 'reservation_checked_in';
    v_detail := 'Vehicle checked in';

  elsif v_old_status = 'confirmed' and p_new_status in ('active','checked_in') then
    v_action := 'reservation_checked_in_after_payment';
    v_detail := 'Vehicle checked in after online payment';

  elsif v_old_status = 'confirmed' and p_new_status = 'checked_out' then
    v_action := 'reservation_completed';
    v_detail := 'Vehicle checked out';

  elsif v_old_status = 'checked_in_pending_payment' and p_new_status in ('active','confirmed','checked_in') then
    v_action := 'reservation_payment_after_checkin';
    v_detail := 'Payment completed after check-in';

  elsif v_old_status in ('checked_in','active') and p_new_status in ('checked_out','confirmed') then
    v_action := 'reservation_completed';
    v_detail := 'Vehicle checked out';

  elsif p_new_status = 'cancelled' then
    v_action := 'reservation_cancelled';
    v_detail := 'Reservation cancelled';

  else
    v_action := 'reservation_status_changed';
    v_detail := 'Status: ' || v_old_status || ' to ' || p_new_status;
  end if;

  -- 5. Insert activity log
  perform insert_activity_log(
    p_site_id     => v_res.parking_site_id::text,
    p_log_type    => 'activity'::activity_log_type,
    p_action      => v_action,
    p_user_id     => p_user_id,
    p_user_name   => p_user_name,
    p_category    => 'normal'::activity_category,
    p_status      => 'success'::activity_status,
    p_entity_type => 'reservation',
    p_entity_id   => v_res.id::text,
    p_detail      => v_detail,
    p_changes     => jsonb_build_object('field','status','old',v_old_status,'new',p_new_status),
    p_old_data    => jsonb_build_object('status', v_old_status),
    p_new_data    => jsonb_build_object('status', p_new_status),
    p_meta        => jsonb_build_object(
      'entity', jsonb_build_object(
        'plate',        v_res.car_plate,
        'slot',         v_res.slot_id,
        'floor',        v_res.floor_id,
        'vehicle_type', v_res.vehicle_type,
        'status_from',  v_old_status,
        'status_to',    p_new_status
      ),
      'context', jsonb_build_object(
        'booking_type', v_res.booking_type,
        'start_time',   v_res.start_time,
        'end_time',     v_res.end_time
      )
    )
  );

  return v_res;

exception when others then

  perform insert_activity_log(
    p_site_id     => v_res.parking_site_id,
    p_log_type    => 'activity',
    p_action      => 'reservation_status_update_failed',
    p_user_id     => p_user_id,
    p_user_name   => p_user_name,
    p_category    => 'abnormal',
    p_status      => 'error',
    p_entity_type => 'reservation',
    p_entity_id   => p_reservation_id::text,
    p_detail      => 'reservation status update failed',
    p_changes     => null,
    p_old_data    => null,
    p_new_data    => null,
    p_meta        => jsonb_build_object(
      'error',  sqlerrm,
      'entity', jsonb_build_object(
        'slot',  v_res.slot_id,
        'plate', v_res.car_plate
      )
    )
  );

  raise;

end;
$$;
