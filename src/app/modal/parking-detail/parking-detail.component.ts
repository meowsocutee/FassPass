import { Component, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../services/supabase.service';
import { ModalController, ToastController, LoadingController, AlertController } from '@ionic/angular';
import { ParkingLot, Booking } from '../../data/models';
import { ParkingDataService } from '../../services/parking-data.service';

import { CheckBookingComponent } from '../check-booking/check-booking.component';
import { BookingSlotComponent } from '../booking-slot/booking-slot.component';
import { BookingSuccessModalComponent } from '../booking-success-modal/booking-success-modal.component';
import { ReservationService } from '../../services/reservation.service';
import { ParkingService } from '../../services/parking.service';
import { UiEventService } from '../../services/ui-event';
import { AddVehicleModalComponent } from '../add-vehicle/add-vehicle-modal.component';
import { take } from 'rxjs/operators';


interface DaySection {
  date: Date;
  dateLabel: string; 
  dayName: string;   
  dateNumber: string; 
  timeLabel: string;
  slots: TimeSlot[];
  available: number;
  capacity: number;
}

interface TimeSlot {
  id: string;
  timeText: string;
  dateTime: Date;
  isAvailable: boolean;
  isSelected: boolean;
  isInRange: boolean;
  remaining: number;
  isUserReserved?: boolean; 
  originalRemaining?: number; 
  duration?: number;
}

interface ZoneData {
  id: string;
  name: string;
  available: number;
  capacity: number;
  status: 'available' | 'full';
}

interface FloorData {
  id: string;
  name: string;
  zones: ZoneData[];
  totalAvailable: number;
  capacity: number;
}

interface DailySchedule {
  dayName: string;
  timeRange: string;
  isToday: boolean;
}

interface AggregatedZone {
  name: string;
  available: number;
  capacity: number;
  status: 'available' | 'full';
  floorIds: string[];
  ids: string[];
}

@Component({
  selector: 'app-parking-detail',
  templateUrl: './parking-detail.component.html',
  styleUrls: ['./parking-detail.component.scss'],
  standalone: false
})
export class ParkingDetailComponent implements OnInit, OnDestroy {

  @Input() lot!: ParkingLot;
  @Input() initialType: string = 'normal';
  @Input() bookingMode: 'daily' | 'monthly' | 'flat24' = 'daily';
  @Input() isInviteMode: boolean = false;

  availableSites: ParkingLot[] = [];
  weeklySchedule: DailySchedule[] = [];
  isOpenNow = false;
  todayCloseTime: string = '20:00'; 

  selectedType = 'normal';

  
  slotInterval: number = 60; 
  displayDays: DaySection[] = [];
  selectedDateIndex: number = 0; 
  currentMonthLabel: string = ''; 
  currentDisplayedDate: Date = new Date(); 

  startSlot: TimeSlot | null = null;
  endSlot: TimeSlot | null = null;

  
  floorData: FloorData[] = [];

  
  selectedFloorIds: string[] = [];

  
  selectedZoneIds: string[] = [];

  
  displayZones: AggregatedZone[] = [];

  userCarReservations: {start_time: string, end_time: string}[] = [];

  currentImageIndex = 0;
  isSpecificSlot: boolean = true; 
  crossDayCount: number = 1;
  minDate: string = new Date().toISOString(); 
  isBooking: boolean = false; 
  currentUserRole: string = 'Guest';
  private realtimeChannel: RealtimeChannel | null = null;

  constructor(
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private parkingDataService: ParkingDataService, 
    private parkingApiService: ParkingService, 
    private reservationService: ReservationService,
    private uiEventService: UiEventService,
    private router: Router,
    private supabaseService: SupabaseService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    
    this.parkingDataService.parkingLots$.subscribe(sites => {
      if (this.availableSites.length === 0) {
        this.availableSites = sites;
      }
    });

    this.parkingDataService.userProfile$.subscribe(profile => {
      if (profile) {
        this.currentUserRole = profile.role || 'Guest';
      }
    });

    
    
    
    
    if (this.lot && this.lot.id) {
      const siteId = this.lot.id.split('-')[0];
      const profileId = this.reservationService.getCurrentProfileId(); 
      
      this.parkingApiService.getSiteBuildings(siteId, 0, 0, profileId).subscribe(realSites => {
        if (realSites && realSites.length > 0) {
          console.log('Refreshed Site Data from RPC:', realSites);
          this.availableSites = realSites;

          
          const freshLot = realSites.find(s => s.id === this.lot.id);
          if (freshLot) {
            console.log('Updated ' + this.lot.name + ' with fresh schedule:', freshLot.schedule);
            this.lot = freshLot;

            
            this.checkOpenStatus();
            this.generateWeeklySchedule();
            this.generateTimeSlots();

            
            this.refreshRealtimeData();
          }
        }
      });
    }

    if (this.initialType && this.lot.supportedTypes.includes(this.initialType)) {
      this.selectedType = this.initialType;
    } else if (this.lot.supportedTypes.length > 0) {
      this.selectedType = this.lot.supportedTypes[0];
    }

    this.checkOpenStatus();
    this.generateWeeklySchedule();

    
    this.generateTimeSlots();

    
    this.realtimeChannel = this.supabaseService.client
      .channel('public:reservations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations' },
        (payload) => {
          console.log('Realtime Update:', payload);
          this.refreshRealtimeData();
        }
      )
      .subscribe();

    
    this.loadUserCarReservations();
  }

  async loadUserCarReservations() {
    this.parkingDataService.vehicles$.pipe(take(1)).subscribe(async vehicles => {
      if (vehicles && vehicles.length > 0) {
        try {
          const res = await this.reservationService.getCarReservations(vehicles[0].id);
          this.userCarReservations = res;
          this.generateTimeSlots(); 
        } catch (e) {
          console.error('Error loading car reservations:', e);
        }
      }
    });
  }

  ngOnDestroy() {
    if (this.realtimeChannel) {
      this.supabaseService.client.removeChannel(this.realtimeChannel);
    }
  }

  refreshRealtimeData() {
    
    this.loadUserCarReservations();

    
    this.fetchTimeSlotAvailability();

    
    if (this.startSlot && this.endSlot) {
      this.loadAvailability(true);
    }
  }

  
  selectDate(index: number) {
    this.selectedDateIndex = index;
    
    this.updateSelectionUI();
  }

  
  changeMonth(offset: number) {
    const newDate = new Date(this.currentDisplayedDate);
    newDate.setMonth(newDate.getMonth() + offset);

    
    const today = new Date();
    if (offset < 0 && newDate.getMonth() < today.getMonth() && newDate.getFullYear() <= today.getFullYear()) {
      
      
      
    }
    this.currentDisplayedDate = newDate;

    
    
    this.generateTimeSlots();
  }

  get isPrevMonthDisabled(): boolean {
    const today = new Date();
    
    return this.currentDisplayedDate.getFullYear() <= today.getFullYear() &&
      this.currentDisplayedDate.getMonth() <= today.getMonth();
  }

  updateMonthLabel() {
    
    if (this.bookingMode === 'daily' || this.bookingMode === 'flat24') {
      if (this.displayDays.length > 0 && this.displayDays[this.selectedDateIndex]) {
        const date = this.displayDays[this.selectedDateIndex].date;
        const monthNames = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
        this.currentMonthLabel = `${monthNames[date.getMonth()]} ${date.getFullYear() + 543}`;
      }
    }
  }

  

  selectInterval(minutes: number) {
    this.slotInterval = minutes;
    
    const oldTime = this.startSlot ? this.startSlot.dateTime.getTime() : null;

    this.resetTimeSelection(false);
    this.generateTimeSlots();

    
    if (oldTime) {
      
      let newSlot: TimeSlot | undefined;
      for (const day of this.displayDays) {
        newSlot = day.slots.find(s => s.dateTime.getTime() === oldTime);
        if (newSlot) break;
      }

      if (newSlot) {
        this.startSlot = newSlot;
        this.endSlot = newSlot;
        
        this.updateSelectionUI();
        this.loadAvailability(true);
      }
    }

    const popovers = document.querySelectorAll('ion-popover');
    popovers.forEach((p: any) => p.dismiss());

    this.cdr.detectChanges();
  }



  selectCrossDayCount(count: number) {
    this.crossDayCount = count;
    this.resetTimeSelection();
    
    const popovers = document.querySelectorAll('ion-popover');
    popovers.forEach((p: any) => p.dismiss());

    this.cdr.detectChanges();

    
    if (this.crossDayCount > 1) {
      setTimeout(() => {
        const el = document.getElementById('month-section-header');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }

  get dayIndices(): number[] {
    
    
    
    
    return Array.from({ length: this.crossDayCount }, (_, i) => this.selectedDateIndex + i);
  }

  resetTimeSelection(fullReset: boolean = true) {
    this.startSlot = null;
    this.endSlot = null;
    if (fullReset) {
      this.selectedDateIndex = 0;
      
    }
    this.floorData = [];
    this.selectedFloorIds = [];
    this.selectedZoneIds = [];
    this.displayZones = [];
    this.updateSelectionUI();
  }

  generateTimeSlots() {
    console.log('Generating slots for:', this.lot?.name, 'Mode:', this.bookingMode);

    this.displayDays = [];
    
    
    const baseDate = (this.bookingMode === 'monthly') ? this.currentDisplayedDate : new Date();

    
    const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

    if (this.bookingMode === 'monthly') {
      
      this.currentMonthLabel = `${thaiMonths[baseDate.getMonth()]} ${baseDate.getFullYear() + 543}`;

      const year = baseDate.getFullYear();
      const month = baseDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      
      const startDay = firstDay.getDay();

      
      for (let i = 0; i < startDay; i++) {
        this.displayDays.push({
          date: new Date(year, month, 0), 
          dateLabel: '',
          dayName: '',
          dateNumber: '',
          timeLabel: 'padding',
          slots: [], 
          available: 0,
          capacity: 0
        });
      }

      for (let i = 1; i <= daysInMonth; i++) {
        const targetDate = new Date(year, month, i);
        const dayIndex = targetDate.getDay();
        const dailyCapacity = this.getCurrentCapacity();

        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isPast = targetDate < today;

        
        
        
        let dailyAvailable = dailyCapacity;
        if (isPast) dailyAvailable = 0; 

        const timeStr = this.bookingMode === 'monthly' ? 'เริ่มสัญญา' : 'เริ่ม 18:00';

        const slots: TimeSlot[] = [{
          id: `${targetDate.toISOString()}-MONTHLY`,
          timeText: timeStr,
          dateTime: new Date(targetDate),
          isAvailable: !isPast, 
          remaining: dailyAvailable,
          isSelected: false,
          isInRange: false,
          duration: 0
        }];

        this.displayDays.push({
          date: targetDate,
          dateLabel: `${i}`,
          dayName: thaiDays[dayIndex],
          dateNumber: i.toString(),
          timeLabel: 'ว่าง',
          slots: slots,
          available: dailyAvailable,
          capacity: dailyCapacity
        });
      }

    } else {
      
      
      const today = new Date();

      for (let i = 0; i < 5; i++) {
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + i);

        const dayIndex = targetDate.getDay();
        const dayName = thaiDays[dayIndex];
        const dateNumber = targetDate.getDate().toString();
        const dateLabel = `${dayName} ${dateNumber}`;

        
        const dailyCapacity = this.getCurrentCapacity();
        let dailyAvailable = 0;
        
        if (i === 0) {
          dailyAvailable = Math.min(this.getCurrentAvailable(), dailyCapacity);
        } else {
          
          dailyAvailable = dailyCapacity;
        }

        let startH = 8, startM = 0;
        let endH = 20, endM = 0;
        let isOpen = false;
        let timeLabel = 'ปิดบริการ';

        const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const currentDayKey = dayKeys[dayIndex];

        if (this.lot && this.lot.schedule && this.lot.schedule.length > 0) {
          const schedule = this.lot.schedule.find(s => s.days.includes(currentDayKey));
          if (schedule) {
            isOpen = true;
            const [oH, oM] = schedule.open_time.split(':').map(Number);
            const [cH, cM] = schedule.close_time.split(':').map(Number);
            startH = oH; startM = oM;
            endH = cH; endM = cM;
            timeLabel = `${schedule.open_time.slice(0, 5)} - ${schedule.close_time.slice(0, 5)}`;
          } else {
            
            isOpen = false;
          }
        } else {
          
          isOpen = true;
          timeLabel = '24 ชั่วโมง';
          startH = 0; endH = 24;
        }

        console.log(`Day: ${dayName} (${currentDayKey}), IsOpen: ${isOpen}, Time: ${timeLabel}`);

        const slots: TimeSlot[] = [];
        const startTime = new Date(targetDate);
        startTime.setHours(startH, startM, 0, 0);
        const closingTime = new Date(targetDate);
        closingTime.setHours(endH, endM, 0, 0);

        const totalOpenMinutes = Math.floor((closingTime.getTime() - startTime.getTime()) / 60000);

        if (!isOpen) {
          
        } else {

          
          

          if (this.slotInterval === -1) {
            
            const timeStr = `${this.pad(startH)}:${this.pad(startM)} - ${this.pad(endH)}:${this.pad(endM)}`;
            const isPast = startTime < new Date();
            let remaining = 0;
            if (!isPast) remaining = Math.floor(Math.random() * dailyCapacity) + 1;

            slots.push({
              id: `${targetDate.toISOString()}-FULL`,
              timeText: timeStr,
              dateTime: new Date(startTime),
              isAvailable: remaining > 0,
              remaining: remaining,
              isSelected: false,
              isInRange: false,
              duration: totalOpenMinutes
            });
          } else if (this.slotInterval === -2) {
            
            const halfDuration = Math.floor(totalOpenMinutes / 2);
            const slot1Time = new Date(startTime);
            this.createSingleSlot(slots, targetDate, slot1Time, dailyCapacity, halfDuration);
            const slot2Time = new Date(startTime.getTime() + halfDuration * 60000);
            if (slot2Time < closingTime) {
              this.createSingleSlot(slots, targetDate, slot2Time, dailyCapacity, halfDuration);
            }
          } else {
            
            
            

            let currentBtnTime = new Date(startTime);
            while (currentBtnTime < closingTime) {
              
              let duration = this.slotInterval;
              if (this.bookingMode === 'flat24') {
                duration = 1440; 
              }

              this.createSingleSlot(slots, targetDate, currentBtnTime, dailyCapacity, duration);

              
              
              
              const step = this.bookingMode === 'flat24' ? 60 : this.slotInterval;
              currentBtnTime.setMinutes(currentBtnTime.getMinutes() + step);
            }
          }
        }

        this.displayDays.push({
          date: targetDate,
          dateLabel: dateLabel,
          dayName: dayName,
          dateNumber: dateNumber,
          timeLabel: isOpen ? timeLabel : 'ปิดบริการ',
          slots: slots,
          available: dailyAvailable,
          capacity: dailyCapacity
        });
      }
      this.updateMonthLabel(); 
    }

    
    this.fetchTimeSlotAvailability();

    this.updateSelectionUI();
  }

  
  onMonthSelected(event: any) {
    const val = event.detail.value;
    if (val) {
      this.currentDisplayedDate = new Date(val);
      this.generateTimeSlots();
      
      const popover = document.querySelector('ion-popover.date-picker-popover') as any;
      if (popover) popover.dismiss();
    }
  }

  createSingleSlot(slots: TimeSlot[], targetDate: Date, timeObj: Date, capacity: number, duration: number) {
    const startH = timeObj.getHours();
    const startM = timeObj.getMinutes();
    const endTime = new Date(timeObj.getTime() + duration * 60000);
    const endH = endTime.getHours();
    const endM = endTime.getMinutes();

    let timeStr = `${this.pad(startH)}:${this.pad(startM)} - ${this.pad(endH)}:${this.pad(endM)}`;

    
    if (this.bookingMode === 'flat24') {
      timeStr = `${this.pad(startH)}:${this.pad(startM)} (24 ชม.)`;
    }

    const isPast = timeObj < new Date();
    
    let remaining = isPast ? 0 : capacity;

    slots.push({
      id: `${targetDate.toISOString()}-${timeStr}`,
      timeText: timeStr,
      dateTime: new Date(timeObj),
      isAvailable: !isPast, 
      remaining: remaining,
      isSelected: false,
      isInRange: false,
      duration: duration
    });
  }

  fetchTimeSlotAvailability() {
    if (!this.lot || !this.parkingApiService || this.displayDays.length === 0) return;

    
    let startDate = new Date(this.displayDays[0].date);

    
    startDate.setHours(0, 0, 0, 0);

    
    
    if (this.lot && this.lot.schedule) {
      const daysKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayKey = daysKey[startDate.getDay()];
      const schedule = this.lot.schedule.find(s => s.days.includes(dayKey));
      if (schedule && schedule.open_time) {
        const [h, m] = schedule.open_time.split(':').map(Number);
        startDate.setHours(h, m, 0, 0);
      }
    }

    const lastDay = this.displayDays[this.displayDays.length - 1].date;
    const endDate = new Date(lastDay);
    
    
    endDate.setDate(endDate.getDate() + 2);
    endDate.setHours(23, 59, 59, 999);

    
    let interval = this.slotInterval;

    if (this.bookingMode === 'flat24') {
      interval = 60; 
    } else if (interval < 0) {
      
      
      
      const firstDayWithSlots = this.displayDays.find(d => d.slots.length > 0);
      if (firstDayWithSlots && firstDayWithSlots.slots.length > 0) {
        interval = firstDayWithSlots.slots[0].duration || 720;
      } else {
        interval = 720; 
      }
    }

    if (interval <= 0) interval = 60; 

    const buildingId = this.lot.id;
    
    

    
    const vehicleType = this.selectedType === 'motorcycle' ? 'motorcycle' : (this.selectedType === 'ev' ? 'ev' : 'car');

    
    
    let durationToCheck = interval;
    if (this.bookingMode === 'flat24') {
      durationToCheck = 1440;
    } else if (interval < 0) {
      
      const firstDayWithSlots = this.displayDays.find(d => d.slots.length > 0); 
      if (firstDayWithSlots && firstDayWithSlots.slots.length > 0) {
        durationToCheck = firstDayWithSlots.slots[0].duration || 720;
      } else {
        durationToCheck = 720;
      }
    }

    this.parkingApiService.getBuildingTimeSlots(buildingId, startDate, endDate, interval, vehicleType, durationToCheck)
      .subscribe(data => {
        
        

        
        
        const availabilityMap = new Map<string, number>();
        data.forEach((row: any) => {
          
          
          const timeVal = row.t_start || row.slot_time;
          if (timeVal) {
            
            const d = new Date(timeVal);
            d.setSeconds(0, 0);
            availabilityMap.set(d.toISOString(), row.available_count);
          }
        });

        
        
        const intervalMs = interval * 60000;

        this.displayDays.forEach(day => {
          day.slots.forEach(slot => {
            const slotTime = slot.dateTime.getTime();

            
            
            
            
            
            

            
            const timeSinceStart = slotTime - startDate.getTime();
            const alignedOffset = Math.floor(timeSinceStart / intervalMs) * intervalMs;
            const alignedTime = new Date(startDate.getTime() + alignedOffset);

            const slotIsoKey = alignedTime.toISOString();

            let minAvailable = 0;
            
            
            if (availabilityMap.has(slotIsoKey)) {
              minAvailable = availabilityMap.get(slotIsoKey) || 0;
            } else {
              
              const exactD = new Date(slot.dateTime);
              exactD.setSeconds(0, 0);
              if (availabilityMap.has(exactD.toISOString())) {
                minAvailable = availabilityMap.get(exactD.toISOString()) || 0;
              }
            }

            
            const duration = slot.duration || this.slotInterval || 60;
            const slotStart = slot.dateTime.getTime();
            const slotEnd = slotStart + (duration * 60000);

            let isReservedByThisCar = false;
            for (const res of this.userCarReservations) {
              const resStart = new Date(res.start_time).getTime();
              const resEnd = new Date(res.end_time).getTime();
              
              if (slotStart < resEnd && slotEnd > resStart) {
                isReservedByThisCar = true;
                break;
              }
            }

            slot.isUserReserved = isReservedByThisCar;
            slot.remaining = isReservedByThisCar ? 0 : minAvailable;
            slot.originalRemaining = minAvailable;
            
            slot.isAvailable = slot.remaining > 0 && slot.dateTime > new Date() && !isReservedByThisCar;
          });
        });

        
        this.updateSelectionUI();
      });
  }

  onSlotClick(slot: TimeSlot, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!slot.isAvailable) return;

    
    if (this.bookingMode === 'daily') {
      
      
      if (!this.startSlot || !this.endSlot) {
        this.startSlot = slot;
        this.endSlot = slot;
      }
      
      else if (this.startSlot.id === this.endSlot.id) {
        if (slot.id === this.startSlot.id) {
          
          this.resetTimeSelection(false);
          return;
        } else {
          
          if (slot.dateTime.getTime() < this.startSlot.dateTime.getTime()) {
            
            const oldStart = this.startSlot;
            this.startSlot = slot;
            this.endSlot = oldStart;
          } else {
            
            this.endSlot = slot;
          }
        }
      }
      
      else {
        
        if (slot.id === this.startSlot.id || slot.id === this.endSlot.id) {
          this.resetTimeSelection(false);
          return;
        }
        else {
          
          this.startSlot = slot;
          this.endSlot = slot;
        }
      }
    } else {
      
      
      this.startSlot = slot;
      this.endSlot = slot; 
    }

    this.updateSelectionUI();

    
    if (this.startSlot && this.endSlot) {
      this.loadAvailability();

      
      
      
      
      
      
      
    } else {
      this.floorData = [];
    }
  }



  updateSelectionUI() {
    let slotsInRange: TimeSlot[] = [];

    this.displayDays.forEach(day => {
      day.slots.forEach(s => {
        
        if (s.originalRemaining !== undefined) {
          s.remaining = s.originalRemaining;
        }

        
        const isStart = !!this.startSlot && s.id === this.startSlot.id;
        const isEnd = !!this.endSlot && s.id === this.endSlot.id;
        s.isSelected = isStart || isEnd;

        
        if (this.startSlot && this.endSlot) {
          const sTime = s.dateTime.getTime();
          const startT = this.startSlot.dateTime.getTime();
          const endT = this.endSlot.dateTime.getTime();

          
          
          
          
          
          

          
          
          if (sTime >= startT && sTime <= endT) {
            slotsInRange.push(s);
          }

          
          s.isInRange = sTime > startT && sTime < endT;

          
          if (isStart || isEnd) {
            s.isInRange = false;
          }
        } else {
          s.isInRange = false;
        }
      });
    });

    
    if (slotsInRange.length > 0) {
      const minAvailable = Math.min(...slotsInRange.map(s => s.remaining));
      slotsInRange.forEach(s => {
        s.remaining = minAvailable;
      });
    }
  }

  

  
  loadAvailability(preserveSelection: boolean = false) {
    
    if (!this.startSlot || !this.endSlot) return;

    
    this.floorData = [];

    
    const endTime = new Date(this.endSlot.dateTime.getTime() + (this.endSlot.duration || 60) * 60000);

    this.parkingApiService.getAvailability(
      this.lot.id,
      this.startSlot.dateTime,
      endTime,
      this.selectedType 
    ).subscribe({
      next: (data) => {
        console.log('Real Availability Data:', data);
        this.floorData = data; 

        
        
        const totalRangeAvailable = this.floorData.reduce((sum, f) => sum + (f.totalAvailable || 0), 0);

        if (this.startSlot && this.endSlot) {
          const startT = this.startSlot.dateTime.getTime();
          const endT = this.endSlot.dateTime.getTime();

          this.displayDays.forEach(day => {
            day.slots.forEach(s => {
              const sTime = s.dateTime.getTime();
              if (sTime >= startT && sTime <= endT) {
                s.remaining = totalRangeAvailable;
              }
            });
          });
        }

        
        if (this.floorData.length > 0) {
          if (preserveSelection) {
            
            const validFloors = this.selectedFloorIds.filter(id => this.floorData.some(f => f.id === id));
            if (validFloors.length > 0) {
              this.selectedFloorIds = validFloors;
            } else {
              
              this.selectedFloorIds = [this.floorData[0].id];
              this.clearAllZones(); 
            }
            this.updateDisplayZones();

            
            this.displayZones.forEach(z => {
              if (this.isZoneSelected(z.name) && z.status === 'full') {
                
                this.selectedZoneIds = this.selectedZoneIds.filter(id => !z.ids.includes(id));
              }
            });
          } else {
            
            this.selectedFloorIds = [this.floorData[0].id];
            this.updateDisplayZones();
            this.clearAllZones();
          }
        }
      },
      error: (err) => {
        console.error('Error loading detailed availability', err);
        
      }
    });
  }

  
  toggleFloor(floor: FloorData) {
    
    if (this.isFloorSelected(floor.id)) {
      
      
      
      
      this.selectedFloorIds = [];
    } else {
      this.selectedFloorIds = [floor.id];
    }
    this.updateDisplayZones();
    this.clearAllZones();
  }

  selectAllFloors() {
    
  }

  clearAllFloors() {
    this.selectedFloorIds = [];
    this.updateDisplayZones();
    this.clearAllZones();
  }

  isFloorSelected(floorId: string): boolean {
    return this.selectedFloorIds.includes(floorId);
  }

  isAllFloorsSelected(): boolean {
    return false; 
  }

  
  updateDisplayZones() {
    const aggMap = new Map<string, AggregatedZone>();

    this.selectedFloorIds.forEach(fid => {
      const floor = this.floorData.find(f => f.id === fid);
      if (floor) {
        floor.zones.forEach(z => {
          if (!aggMap.has(z.name)) {
            aggMap.set(z.name, {
              name: z.name,
              available: 0,
              capacity: 0,
              status: 'full',
              floorIds: [],
              ids: []
            });
          }
          const agg = aggMap.get(z.name)!;
          agg.available += z.available;
          agg.capacity += z.capacity;
          agg.floorIds.push(fid);
          agg.ids.push(z.id);

          if (agg.available > 0) agg.status = 'available';
        });
      }
    });

    this.displayZones = Array.from(aggMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  
  toggleZone(aggZone: AggregatedZone) {
    const isSelected = this.isZoneSelected(aggZone.name);

    if (isSelected) {
      this.selectedZoneIds = [];
    } else {
      
      this.selectedZoneIds = [...aggZone.ids];
    }
  }

  isZoneSelected(aggZoneName: string): boolean {
    const aggZone = this.displayZones.find(z => z.name === aggZoneName);
    if (!aggZone) return false;
    return aggZone.ids.length > 0 && aggZone.ids.every(id => this.selectedZoneIds.includes(id));
  }

  selectAllZones() {
    
  }

  clearAllZones() {
    this.selectedZoneIds = [];
  }

  isAllZonesSelected(): boolean {
    return false;
  }

  get selectedZonesCount(): number {
    return this.displayZones.filter(z => this.isZoneSelected(z.name)).length;
  }

  
  selectSite(site: ParkingLot) {
    console.log('--- [ParkingDetail] Switching Site ---');
    console.log('New Site:', site.name, site.id);
    console.log('Full Site Data:', site);

    this.lot = site;
    if (this.lot.supportedTypes.length > 0 && !this.lot.supportedTypes.includes(this.selectedType)) {
      this.selectedType = this.lot.supportedTypes[0];
    }
    this.checkOpenStatus();
    this.generateWeeklySchedule();
    this.resetTimeSelection();
    
    this.selectedDateIndex = 0;
    this.generateTimeSlots();

    const popovers = document.querySelectorAll('ion-popover');
    popovers.forEach((p: any) => p.dismiss());

    this.cdr.detectChanges();
  }

  selectType(type: string) {
    this.selectedType = type;
    this.resetTimeSelection();
    this.generateTimeSlots();

    
    const popovers = document.querySelectorAll('ion-popover');
    popovers.forEach((p: any) => p.dismiss());

    this.cdr.detectChanges();
  }

  async selectBookingMode(mode: 'daily' | 'monthly' | 'flat24') {
    
    const popovers = document.querySelectorAll('ion-popover');
    if (popovers.length > 0) {
      await Promise.all(Array.from(popovers).map((p: any) => p.dismiss()));
    }

    
    this.bookingMode = mode;
    this.crossDayCount = 1;
    this.displayDays = []; 

    
    this.resetTimeSelection(true);

    
    if (this.bookingMode === 'daily' || this.bookingMode === 'flat24') {
      this.slotInterval = 60; 
    } else {
      this.slotInterval = -1; 
    }

    
    setTimeout(() => {
      this.generateTimeSlots();
      this.updateSelectionUI();
    }, 50); 
  }

  
  
  get singleLineSummary(): string {
    if (!this.startSlot || !this.endSlot) return '';

    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const sDate = this.startSlot.dateTime;

    
    if (this.bookingMode === 'monthly') {
      
      
      const eDate = new Date(sDate);
      eDate.setMonth(sDate.getMonth() + 1);

      const sDateStr = `${sDate.getDate()} ${thaiMonths[sDate.getMonth()]}`; 
      
      
      const eDateStr = `${eDate.getDate()} ${thaiMonths[eDate.getMonth()]}`;

      return `ใช้งานได้ ${sDateStr} - ${eDateStr} (${this.getModeLabel()})`;
    }

    if (this.bookingMode === 'flat24') {
      const sDateStr = `${sDate.getDate()} ${thaiMonths[sDate.getMonth()]}`;
      const sTimeStr = `${this.pad(sDate.getHours())}:${this.pad(sDate.getMinutes())}`;
      return `เริ่ม ${sDateStr} ${sTimeStr} (+24 ชม.) | ${this.getModeLabel()}`;
    }

    const sDateStr = `${sDate.getDate()} ${thaiMonths[sDate.getMonth()]}`;
    const sTimeStr = `${this.pad(sDate.getHours())}:${this.pad(sDate.getMinutes())}`;

    const eSlotVal = this.endSlot;
    const duration = eSlotVal.duration || this.slotInterval || 60;
    const eDate = new Date(eSlotVal.dateTime.getTime() + duration * 60000);

    let datePart = '';

    if (sDate.getDate() !== eDate.getDate()) {
      
      const eDateStr = `${eDate.getDate()} ${thaiMonths[eDate.getMonth()]}`;
      const eTimeStr = `${this.pad(eDate.getHours())}:${this.pad(eDate.getMinutes())}`;
      datePart = `${sDateStr} ${sTimeStr} - ${eDateStr} ${eTimeStr}`;
    } else {
      
      const eTimeStr = `${this.pad(eDate.getHours())}:${this.pad(eDate.getMinutes())}`;
      datePart = `${sDateStr} ${sTimeStr} - ${eTimeStr}`;
    }

    
    if (this.selectedFloorIds.length === 0) return datePart;

    const fNames = this.floorData.filter(f => this.selectedFloorIds.includes(f.id)).map(f => f.name.replace('Floor', 'F').replace(' ', '')).join(', ');
    let zNames = '';
    if (this.selectedZonesCount > 0) {
      zNames = this.displayZones.filter(z => this.isZoneSelected(z.name)).map(z => z.name.replace('Zone ', '')).join(', ');
    } else {
      zNames = '-';
    }

    return `${datePart} | ชั้น ${fNames} Zone ${zNames}`;
  }

  getModeLabel(): string {
    switch (this.bookingMode) {
      case 'monthly': return 'รายเดือน';

      case 'flat24': return 'เหมา 24 ชม.';
      default: return 'รายชั่วโมง';
    }
  }

  get locationSummary(): string {
    if (this.selectedFloorIds.length === 0) return '';

    const fNames = this.floorData.filter(f => this.selectedFloorIds.includes(f.id)).map(f => f.name.replace('Floor', 'F').replace(' ', '')).join(', ');

    let zNames = '';
    if (this.selectedZonesCount > 0) {
      zNames = this.displayZones.filter(z => this.isZoneSelected(z.name)).map(z => z.name.replace('Zone ', '')).join(', ');
    } else {
      zNames = '-';
    }
    return `ชั้น ${fNames} | Zone ${zNames}`;
  }

  async Reservations() {
    if (!this.startSlot || !this.endSlot) {
      this.presentToast('กรุณาเลือกเวลา');
      return;
    }

    
    if (this.selectedZoneIds.length === 0) {
      this.presentToast('กรุณาเลือกโซน');
      return;
    }

    if (this.isInviteMode) {
      const role = this.currentUserRole?.toLowerCase();
      if (role === 'visitor' || role === 'guest') {
        this.presentToast('เฉพาะเจ้าของห้อง/ผู้ที่มีสิทธิ์เท่านั้นที่สามารถสร้างคำเชิญได้');
        return;
      }
      this.processBooking();
      return;
    }

    this.parkingDataService.vehicles$.pipe(take(1)).subscribe(async (vehicles) => {
      if (!vehicles || vehicles.length === 0) {
        
        const addModal = await this.modalCtrl.create({
          component: AddVehicleModalComponent,
          breakpoints: [0, 1],
          initialBreakpoint: 1,
        });
        await addModal.present();

        const { data, role } = await addModal.onDidDismiss();
        if (role === 'confirm' && data) {
          try {
            await this.parkingDataService.addVehicle(data);
            const userId = this.reservationService.getCurrentProfileId();
            await this.parkingDataService.loadUserVehicles(userId);
            
            const userRole = this.currentUserRole?.toLowerCase();
            if (userRole === 'visitor' || userRole === 'guest') {
              this.presentToast('คุณเพิ่มรถสำเร็จ แต่เฉพาะผู้ที่มีสิทธิ์เท่านั้นจึงจะสามารถจองได้ (คุณต้องได้รับคำเชิญ)');
              return;
            }

            this.processBooking();
          } catch (e: any) {
            console.error('Error adding vehicle', e);
            const msg = e.message === 'รถป้ายทะเบียนนี้มีอยู่ในระบบแล้ว'
              ? e.message
              : 'เกิดข้อผิดพลาดในการเพิ่มรถ';
            this.presentToast(msg);
          }
        }
      } else {
        const userRole = this.currentUserRole?.toLowerCase();
        if (userRole === 'visitor' || userRole === 'guest') {
          this.presentToast('เฉพาะผู้ที่มีสิทธิ์หรือได้รับคำเชิญเท่านั้นจึงจะสามารถจองได้');
          return;
        }
        
        this.processBooking();
      }
    });
  }

  private async processBooking() {
    if (!this.startSlot || !this.endSlot) return; 

    
    let finalStart = new Date(this.startSlot.dateTime);
    let finalEnd = new Date(this.endSlot.dateTime);

    if (this.bookingMode === 'monthly') {
      finalEnd = new Date(finalStart);
      finalEnd.setMonth(finalStart.getMonth() + 1);
      finalStart.setHours(0, 0, 0, 0);
      finalEnd.setHours(23, 59, 59, 999);
    }

    else if (this.bookingMode === 'flat24') {
      finalEnd = new Date(finalStart.getTime() + (24 * 60 * 60 * 1000));
    } else {
      
      const duration = this.endSlot.duration || 60;
      finalEnd = new Date(this.endSlot.dateTime.getTime() + (duration * 60000));
    }

    let data: any = {
      siteId: this.lot.id.split('-')[0],
      siteName: this.lot.name,
      selectedType: this.selectedType,
      selectedFloors: this.selectedFloorIds,
      selectedZones: this.displayZones.filter(z => this.isZoneSelected(z.name)).map(z => z.name),
      selectedZoneIds: this.selectedZoneIds,
      startSlot: { ...this.startSlot, dateTime: finalStart },
      endSlot: { ...this.endSlot, dateTime: finalEnd },
      isSpecificSlot: true,
      isRandomSystem: false,
      bookingMode: this.bookingMode,
      lotPrice: this.lot?.price !== undefined ? this.lot.price : 20,
      price: this.calculatePrice(finalStart, finalEnd),
      isInvite: this.isInviteMode
    };

    try {
      const modal = await this.modalCtrl.create({
        component: CheckBookingComponent,
        componentProps: {
          data: { ...data }
        },
        initialBreakpoint: 1,
        breakpoints: [0, 0.5, 1],
        backdropDismiss: true,
        cssClass: 'detail-sheet-modal',
      });
      await modal.present();

      const { data: result, role } = await modal.onDidDismiss();
      if (role === 'confirm' && result && result.confirmed) {
        
        const loading = await this.loadingCtrl.create({
          message: 'กำลังดำเนินการจอง...',
          spinner: 'crescent',
          cssClass: 'custom-loading'
        });
        await loading.present();
        this.isBooking = true;

        const bookingData = result.data;

        let inviteCode = '';
        if (bookingData.isInvite) {
          inviteCode = 'PRK-' + Math.random().toString(36).substring(2, 8).toUpperCase();
          if (!bookingData.car_plate || bookingData.car_plate === 'INVITATION') {
            
            bookingData.car_plate = inviteCode;
          }
          
          bookingData.status = bookingData.status === 'pending_payment' ? 'pending_payment' : 'pending_invite';
        }

        const newBooking: Booking = {
          id: 'BK-' + new Date().getTime(),
          placeName: bookingData.siteName,
          locationDetails: `ชั้น ${bookingData.selectedFloors[0]} | โซน ${bookingData.selectedZones[0]} | ${bookingData.selectedSlotId}`,
          bookingTime: bookingData.startSlot.dateTime,
          endTime: bookingData.endSlot.dateTime,
          status: bookingData.status,
          price: bookingData.price || bookingData.totalPrice,
          carBrand: 'N/A',
          licensePlate: bookingData.car_plate || '-',
          bookingType: bookingData.bookingMode || 'daily',
          carId: bookingData.car_id,
          isInvite: bookingData.isInvite,
          inviteCode: inviteCode
        };

        this.parkingDataService.addBooking(newBooking);

        try {
          if (!bookingData.alreadyCreatedInDB) {
            await this.reservationService.createReservationv2(
              newBooking,
              this.reservationService.getCurrentProfileId(),
              bookingData.siteId,
              bookingData.selectedFloors[0],
              bookingData.selectedSlotId
            );
          } else {
            console.log('Reservation already created in CheckBooking modal:', bookingData.dbReservationId);
            // We could update the status here if needed, but since the webhook handles payment status, 
            // we can just proceed to success modal.
          }

          
          await loading.dismiss();
          this.isBooking = false;

          
          this.uiEventService.triggerRefreshParkingData();

          
          const successData = {
            ...newBooking,
            selectedSlotId: bookingData.selectedSlotId,
            selectedFloors: bookingData.selectedFloors,
            selectedZones: bookingData.selectedZones,
            siteName: bookingData.siteName,
            startSlot: bookingData.startSlot,
            endSlot: bookingData.endSlot,
            isInvite: bookingData.isInvite,
            inviteCode: inviteCode || bookingData.car_plate
          };
          await this.showSuccessModal(successData);

        } catch (e: any) {
          
          await loading.dismiss();
          this.isBooking = false;

          console.error('Reservation Failed', e);

          
          await this.showErrorAlert(e);
        }
      }

    } catch (err) {
      console.error('Error showing booking modal', err);
      this.isBooking = false;
    }
  }

  calculatePrice(start: Date, end: Date): number {
    const timeDiffRaw = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const hours = Math.max(1, Math.ceil(timeDiffRaw));
    
    const hourlyRate = this.lot?.price !== undefined ? this.lot.price : 20;
    
    if (this.bookingMode === 'monthly') return 1500; 
    if (this.bookingMode === 'flat24') return hourlyRate * 10; 
    return hours * hourlyRate;
  }

  
  onImageScroll(event: any) {
    const scrollLeft = event.target.scrollLeft;
    const width = event.target.offsetWidth;
    this.currentImageIndex = Math.round(scrollLeft / width);
  }

  pad(num: number): string { return num < 10 ? '0' + num : num.toString(); }
  dismiss() { this.modalCtrl.dismiss(); }
  checkOpenStatus() {
    this.todayCloseTime = '';
    const now = new Date();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayName = days[now.getDay()];

    let openH = 8, openM = 0;
    let closeH = 20, closeM = 0;
    let isTodayClosed = false;

    
    if (this.lot && this.lot.schedule && this.lot.schedule.length > 0) {
      
      const todaySchedule = this.lot.schedule.find(s => s.days.includes(currentDayName));
      if (todaySchedule) {
        [openH, openM] = todaySchedule.open_time.split(':').map(Number);
        [closeH, closeM] = todaySchedule.close_time.split(':').map(Number);
        this.todayCloseTime = todaySchedule.close_time.slice(0, 5);
      } else {
        
        isTodayClosed = true;
      }
    } else {
      
      openH = 0; openM = 0;
      closeH = 24; closeM = 0;
      this.todayCloseTime = '24:00';
    }

    
    if (isTodayClosed) {
      this.isOpenNow = false;
      this.todayCloseTime = ''; 
    } else {
      const openTime = new Date(now);
      openTime.setHours(openH, openM, 0, 0);

      const closeTime = new Date(now);

      
      if (closeH === 24) {
        closeTime.setDate(closeTime.getDate() + 1);
        closeTime.setHours(0, 0, 0, 0);
      } else {
        closeTime.setHours(closeH, closeM, 0, 0);
      }

      this.isOpenNow = now >= openTime && now < closeTime;
    }
  }

  getCurrentCapacity(): number { return (this.lot?.capacity as any)?.[this.selectedType] || 0; }
  getCurrentAvailable(): number { return (this.lot?.available as any)?.[this.selectedType] || 0; }
  getTypeName(type: string): string {
    switch (type) {
      case 'normal': return 'รถทั่วไป';
      case 'ev': return 'รถ EV';
      case 'motorcycle': return 'มอเตอร์ไซค์';
      default: return type;
    }
  }

  generateWeeklySchedule() {
    const today = new Date().getDay();
    const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    this.weeklySchedule = [];

    for (let i = 0; i < 7; i++) {
      const dayIndex = (today + i) % 7;
      const dayKey = dayKeys[dayIndex];

      let timeRange = 'ปิดบริการ';

      if (this.lot && this.lot.schedule) {
        const schedule = this.lot.schedule.find(s => s.days.includes(dayKey));
        if (schedule) {
          timeRange = `${schedule.open_time.slice(0, 5)} - ${schedule.close_time.slice(0, 5)}`;
        }
      }

      this.weeklySchedule.push({
        dayName: dayNames[dayIndex],
        timeRange: timeRange,
        isToday: i === 0
      });
    }
  }

  async presentToast(message: string) {
    const toast = await this.toastCtrl.create({
      message: message, duration: 2000, color: 'danger', position: 'top',
    });
    toast.present();
  }

  async showSuccessModal(bookingData: any) {
    const modal = await this.modalCtrl.create({
      component: BookingSuccessModalComponent,
      componentProps: {
        bookingData: bookingData
      },
      backdropDismiss: true,
      cssClass: 'success-modal'
    });
    await modal.present();
  }

  async showErrorAlert(error: any) {
    let errorTitle = 'เกิดข้อผิดพลาด';
    let errorMessage = 'ไม่สามารถดำเนินการจองได้ กรุณาลองใหม่อีกครั้ง';
    let errorButtons: any[] = ['ตกลง'];

    
    const rawMessage: string = error.message || '';
    const cleanMessage = rawMessage.includes(':') ? rawMessage.substring(rawMessage.indexOf(':') + 1).trim() : rawMessage;

    
    if (rawMessage.includes('USER_BLACKLISTED')) {
      errorTitle = 'ไม่สามารถจองได้';
      errorMessage = cleanMessage || 'คุณถูกระงับการใช้งานการจอง กรุณาติดต่อเจ้าหน้าที่';
    } else if (rawMessage.includes('SLOT_NOT_AVAILABLE') || rawMessage.includes('already booked')) {
      errorTitle = 'ช่องจอดเต็มแล้ว';
      errorMessage = cleanMessage || 'ขออภัย ช่องจอดนี้เพิ่งมีผู้จองไปแล้ว กรุณาเลือกช่องจอดอื่นหรือเวลาอื่น';
      errorButtons = [
        {
          text: 'เลือกใหม่',
          role: 'cancel'
        }
      ];
    } else if (error.code === '23P01' || rawMessage.includes('Double Booking') || rawMessage.includes('DOUBLE_BOOKING')) {
      errorTitle = 'มีการจองซ้ำ';
      errorMessage = cleanMessage || 'มีการจองช่องนี้ในเวลาที่ทับซ้อนกันแล้ว กรุณาเลือกช่องใหม่';
    } else if (rawMessage.includes('network') || rawMessage.includes('fetch') || error.status === 0) {
      errorTitle = 'ไม่สามารถเชื่อมต่อได้';
      errorMessage = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตและลองใหม่อีกครั้ง';
      errorButtons = [
        {
          text: 'ยกเลิก',
          role: 'cancel'
        }
      ];
    } else if (rawMessage && !rawMessage.includes('non-2xx status code')) {
      errorMessage = rawMessage;
    }

    const alert = await this.alertCtrl.create({
      header: errorTitle,
      message: errorMessage,
      buttons: errorButtons,
      cssClass: 'error-alert'
    });

    await alert.present();
  }

  
  openMap(lat?: number, lng?: number) {
    if (!lat || !lng) {
      console.warn('Coordinates not available for this location.');
      return;
    }

    
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  }
}