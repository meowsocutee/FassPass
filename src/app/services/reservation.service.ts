import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SupabaseService } from './supabase.service';
import { Booking } from '../data/models';

@Injectable({
  providedIn: 'root'
})
export class ReservationService {
  private currentProfileId: string = '';
  private currentProfileIdSubject = new BehaviorSubject<string>('');
  currentProfileId$ = this.currentProfileIdSubject.asObservable();

  private testSlotId: string = '';

  constructor(private supabaseService: SupabaseService) { }

  setCurrentProfileId(id: string) {
    this.currentProfileId = id;
    this.currentProfileIdSubject.next(id);
    console.log('Current Profile ID set:', this.currentProfileId);
  }

  getCurrentProfileId(): string {
    return this.currentProfileId;
  }

  setTestSlotId(id: string) {
    this.testSlotId = id;
    console.log('Test Slot ID set:', this.testSlotId);
  }

  getTestSlotId(): string {
    return this.testSlotId;
  }

  
  async getOccupiedSlotIds(siteId: string, start: Date, end: Date): Promise<string[]> {
    const { data, error } = await this.supabaseService.client
      .from('reservations')
      .select('slot_id')
      .eq('parking_site_id', siteId)
      .neq('status', 'cancelled')
      .neq('status', 'checked_out')
      .lt('start_time', end.toISOString())
      .gt('end_time', start.toISOString());

    if (error) {
      console.error('Error checking availability:', error);
      throw error;
    }
    return [...new Set((data || []).map((r: any) => r.slot_id))];
  }

  async createReservation(booking: Booking, profileId: string, siteId: string, floorId: string, slotId: string) {
    const { data, error } = await this.supabaseService.client
      .from('reservations')
      .insert({
        profile_id: profileId, 
        parking_site_id: siteId,
        floor_id: floorId,
        slot_id: slotId,
        start_time: booking.bookingTime.toISOString(),
        end_time: booking.endTime.toISOString(),
        status: booking.status || 'pending',
        vehicle_type: 'car',
        car_id: booking.carId,
        car_plate: booking.licensePlate,
        booking_type: this.mapBookingTypeToEnum(booking.bookingType) 
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23P01' || error.message.includes('Double Booking')) {
        throw new Error('This slot is already booked. Please choose another.');
      }
      throw error;
    }
    return data;
  }
  async createReservationv2(booking: Booking, profileId: string, siteId: string, floorId: string, slotId: string) {
    const { data, error } = await this.supabaseService.client.functions.invoke(
      'create-reservation',
      {
        body: {
          reservation: {
            profileId: profileId,
            siteId: siteId,
            floorId: floorId,
            slotId: slotId,
            startTime: booking.bookingTime.toISOString(),
            endTime: booking.endTime.toISOString(),
            status: booking.status || 'pending',
            vehicleType: 'car',
            carId: booking.carId,
            carPlate: booking.licensePlate,
            bookingType: this.mapBookingTypeToEnum(booking.bookingType),
            inviteCode: booking.inviteCode
          }
        }
      }
    )

    if (error) {
      if (error.code === '23P01' || error.message.includes('Double Booking')) {
        throw new Error('This slot is already booked. Please choose another.');
      }

      
      if (error.message && error.message.includes('non-2xx status code') && (error as any).context) {
        try {
          const responseBody = await (error as any).context.json();
          if (responseBody && responseBody.error) {
            throw new Error(responseBody.error);
          }
        } catch (parseErr: any) {
          
          if (parseErr instanceof Error && parseErr.message !== error.message) {
            throw parseErr;
          }
          
        }
      }

      throw error;
    }
    return data;
  }
  async getReservations() {
    const { data, error } = await this.supabaseService.client
      .from('reservations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async updateReservationStatus(reservationId: string, status: string) {
    const { data, error } = await this.supabaseService.client
      .from('reservations')
      .update({ status: status })
      .eq('id', reservationId);

    if (error) {
      console.error('Error updating reservation status:', error);
      throw error;
    }
    return data;
  }
  async updateReservationStatusv2(reservationId: string, status: string) {
    const { data, error } = await this.supabaseService.client.functions.invoke(
      'update-reservation-status',
      {
        body: {
          reservationId: reservationId,
          status: status
        }
      }
    );

    if (error) {
      console.error('Error updating reservation status:', error);
      throw error;
    }
    return data;
  }

  async checkCarOverlap(carId: string | number, start: Date, end: Date): Promise<boolean> {
    const { data, error } = await this.supabaseService.client
      .from('reservations')
      .select('id')
      .eq('car_id', carId)
      .in('status', ['pending', 'confirmed', 'checked_in', 'pending_payment'])
      .lt('start_time', end.toISOString())
      .gt('end_time', start.toISOString());

    if (error) {
      console.error('Error checking car overlap:', error);
      throw error;
    }
    return (data || []).length > 0;
  }

  async getCarReservations(carId: string | number): Promise<{start_time: string, end_time: string}[]> {
    const { data, error } = await this.supabaseService.client
      .from('reservations')
      .select('start_time, end_time')
      .eq('car_id', carId)
      .in('status', ['pending', 'confirmed', 'checked_in', 'pending_payment']);

    if (error) {
      console.error('Error fetching car reservations:', error);
      throw error;
    }
    return data || [];
  }

  
  async getParkingFee(reservationId: string): Promise<number> {
    const { data, error } = await this.supabaseService.client
      .functions.invoke('calculate-parking-fee', {
        body: { reservationId }
      });

    if (error) {
      console.error('[ReservationService] Error calling calculate-parking-fee edge function:', error);
      return 0;
    }

    return data?.final_net_price ?? 0;
  }

  
  async applyEStamp(reservationId: string, shopId: string, discountAmount: number = 30) {
    const { data, error } = await this.supabaseService.client
      .functions.invoke('post_estamps', {
        body: { 
          reservationId, 
          shopId, 
          discountAmount 
        }
      });

    if (error) {
      console.error('[ReservationService] Error calling apply-e-stamp:', error);
      throw error;
    }

    return data;
  }

  
  async cleanupExpiredReservations(): Promise<number> {
    const { data, error } = await this.supabaseService.client
      .rpc('auto_cancel_expired_pending_reservations');

    if (error) {
      console.error('Error cleaning up expired reservations:', error);
      throw error;
    }

    console.log(`Cleaned up ${data || 0} expired reservation(s)`);
    return data || 0;
  }

  async getUserReservationsFromEdge() {
    console.log('getUserReservationsFromEdge: Method called');

    if (!this.currentProfileId) {
      console.log('getUserReservationsFromEdge: No Current Profile ID set. Waiting for user input.');
      return [];
    }

    
    const { data: { user }, error: userError } = await this.supabaseService.client.auth.getUser();

    if (userError || !user) {
      console.error('getUserReservationsFromEdge: User not logged in', userError);
      throw new Error('User not logged in');
    }

    console.log('getUserReservationsFromEdge: Using currentProfileId:', this.currentProfileId);

    console.log('getUserReservationsFromEdge: Invoking edge function "reservation_user" with body:', { profile_id: this.currentProfileId });
    const { data, error } = await this.supabaseService.client.functions.invoke('reservation_user', {
      body: { profile_id: this.currentProfileId }
    });

    console.log('getUserReservationsFromEdge: Edge function response:', { data, error });

    if (error) {
      console.error('getUserReservationsFromEdge: Error from edge function:', error);
      throw error;
    }

    console.log('getUserReservationsFromEdge: Success, returning data:', data.data);
    return data.data;
  }

  subscribeToUserReservations(callback: () => void) {
    if (!this.currentProfileId) {
      console.warn('subscribeToUserReservations: No Current Profile ID set. Skipping subscription.');
      return null;
    }

    console.log('Subscribing to reservations changes for profile:', this.currentProfileId);
    return this.supabaseService.client
      .channel(`user_reservations_${this.currentProfileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservations',
          filter: `profile_id=eq.${this.currentProfileId}`
        },
        (payload) => {
          console.log('Realtime update received for reservations:', payload);
          callback();
        }
      )
      .subscribe();
  }
  
  private mapBookingTypeToEnum(type: string): string {
    switch (type) {
      case 'daily': return 'hourly';
      case 'flat24': return 'flat_24h';
      case 'monthly': return 'monthly_regular';

      default: return type; 
    }
  }
}
